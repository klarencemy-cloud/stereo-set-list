import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CLOCK_PAUSE_MS, estimateOffset, fitDrift, pausedMs, type ClockMark, type TimeSample } from "./clock";

/** Time calls made when sync starts. After that, the session checks' answers are the samples. */
export const FIRST_ROUND = 20;
/** Time calls made every ROUND_EVERY_MS while the session checks' answers are no samples (`timeRounds`). */
export const LATER_ROUND = 3;
/** The samples handed in are grouped into rounds this long, so they age out and the drift can be fitted. */
export const ROUND_EVERY_MS = 60_000;
/** The best sample is chosen from this many latest rounds, so a slow patch of network doesn't stick. */
export const ROUNDS_KEPT = 3;
/** The drift is fitted over a longer history: over a few minutes, a slope is mostly noise. */
const DRIFT_ROUNDS_KEPT = 10;
/** Rounds closer together than this can't tell drift from noise. */
const DRIFT_MIN_SPAN_MS = 120_000;
/** Real clocks drift less than this (200 ppm); a steeper slope is the network, not the clock. */
const MAX_DRIFT_PER_MS = 0.0002;

/** fitDrift, but 0 over too short a span, and never more than a clock can drift. */
function driftOf(history: TimeSample[][]): number {
  const times = history.flat().map((s) => s.sentMs);
  if (times.length === 0 || Math.max(...times) - Math.min(...times) < DRIFT_MIN_SPAN_MS) return 0;
  return Math.max(-MAX_DRIFT_PER_MS, Math.min(MAX_DRIFT_PER_MS, fitDrift(history)));
}

export type ClockStatus = "idle" | "syncing" | "synced" | "failed";

export interface ClockSync {
  /** Add to performance.now() to get server time. */
  offsetMs: number;
  rttMs: number;
  status: ClockStatus;
  /** How fast the offset is changing, in ms per ms of local time (see fitDrift); 0 until there are 3 rounds. */
  driftPerMs: number;
}

/** A clock sync, plus a way to hand it samples taken elsewhere (every metronome answer carries the server's time). */
export interface ClockSyncHandle extends ClockSync {
  /** Adds one sample (local send and receive times around a call, and the server's time in its answer). */
  addSample: (sample: TimeSample) => void;
  /** How many times the page came back to find performance.now() had paused (the phone slept): see useClockSync. */
  wakes: number;
}

/** Both clocks now. */
const mark = (): ClockMark => ({ wallMs: Date.now(), perfMs: performance.now() });

const IDLE: ClockSync = { offsetMs: 0, rttMs: 0, status: "idle", driftPerMs: 0 };

/** Takes `n` time samples, stopping early once `alive()` is false (the panel closed). */
async function sampleRound(n: number, alive: () => boolean): Promise<TimeSample[]> {
  const out: TimeSample[] = [];
  // One at a time: parallel calls would queue behind each other and look slower than they are.
  for (let i = 0; i < n && alive(); i++) {
    try {
      const sentMs = performance.now();
      const { now } = await api.getTime();
      const receivedMs = performance.now();
      if (typeof now === "number") out.push({ sentMs, serverMs: now, receivedMs });
    } catch {
      // A lost sample; the others still count.
    }
  }
  return out;
}

/**
 * How far this phone's clock is from the server's (Cristian's algorithm), while `active`: 20 time calls at the
 * start, then the samples handed in by `addSample` (every session check's answer carries the server's time), so no
 * more time calls. While `timeRounds` (the checks' answers may be shared copies, so they are no samples), a round of
 * LATER_ROUND time calls every ROUND_EVERY_MS as well. Samples are grouped into ROUND_EVERY_MS rounds; the fastest network round trip of the last few rounds
 * wins, and the drift is fitted over a longer history of rounds.
 *
 * Samples that arrive while the first round runs join it when it lands. After a first round where every time call
 * failed, the answers still sync it. Ignored while not active.
 *
 * When the page is visible again and the wall clock moved more than CLOCK_PAUSE_MS further than performance.now(),
 * performance.now() paused (the phone slept) while the server's clock ran on, so every sample so far is off by
 * that much (H7). They are dropped and a full round is taken, as at the start; until it lands, the estimate is the
 * old one moved by the pause, so a phone playing along stays about right. `wakes` counts these.
 */
export function useClockSync(active: boolean, timeRounds = false): ClockSyncHandle {
  const [sync, setSync] = useState<ClockSync>(IDLE);
  const [wakes, setWakes] = useState(0);
  /** Where addSample's samples go: set while active. */
  const sink = useRef<((s: TimeSample) => void) | null>(null);
  const addSample = useCallback((s: TimeSample) => sink.current?.(s), []);
  /** Where a later round of time calls goes: set while active. */
  const roundSink = useRef<((samples: TimeSample[]) => void) | null>(null);

  useEffect(() => {
    if (!active) {
      setSync(IDLE);
      return;
    }
    let alive = true;
    let rounds: TimeSample[][] = [];
    let history: TimeSample[][] = [];
    /** When the latest round began (local ms, its first sample's send time). */
    let roundStartMs = 0;
    /** Samples handed in while the first round runs; it takes them when it lands. */
    let pending: TimeSample[] = [];
    let firstRoundDone = false;
    /** Bumped on a wake, so a round from before it is dropped when it lands. */
    let generation = 0;
    /** When (performance.now()) the phone last woke: a sample sent before then may straddle the sleep. */
    let wokeAtMs = -Infinity;
    /** Both clocks when the page was last hidden or shown, to tell on the next showing whether the phone slept. */
    let seen = mark();
    setSync({ ...IDLE, status: "syncing" });

    /** Publishes the estimate from the rounds kept. Only "never synced" is a failure. */
    function publish() {
      const best = estimateOffset(rounds.flat());
      if (best) setSync({ offsetMs: best.offsetMs, rttMs: best.rttMs, status: "synced", driftPerMs: driftOf(history) });
      else setSync({ ...IDLE, status: "failed" });
    }

    /** Starts a new round with these samples. */
    function newRound(samples: TimeSample[]) {
      rounds = [...rounds, samples].slice(-ROUNDS_KEPT);
      history = [...history, samples].slice(-DRIFT_ROUNDS_KEPT);
      roundStartMs = Math.min(...samples.map((x) => x.sentMs));
    }

    sink.current = (s) => {
      if (s.sentMs < wokeAtMs) return;
      if (!firstRoundDone) {
        pending.push(s);
        return;
      }
      if (!rounds.length || s.sentMs - roundStartMs >= ROUND_EVERY_MS) newRound([s]);
      else {
        // The latest round of `rounds` is also the latest of `history`.
        const last = [...rounds[rounds.length - 1], s];
        rounds = [...rounds.slice(0, -1), last];
        history = [...history.slice(0, -1), last];
      }
      publish();
    };

    roundSink.current = (taken) => {
      const samples = taken.filter((s) => s.sentMs >= wokeAtMs);
      if (!samples.length) return;
      if (!firstRoundDone) {
        pending.push(...samples);
        return;
      }
      newRound(samples);
      publish();
    };

    /** Takes a full round of time calls; the samples handed in meanwhile join it. */
    function fullRound() {
      const gen = generation;
      const current = () => alive && gen === generation;
      firstRoundDone = false;
      pending = [];
      sampleRound(FIRST_ROUND, current).then((taken) => {
        if (!current()) return;
        const samples = [...taken, ...pending];
        pending = [];
        firstRoundDone = true;
        if (samples.length) newRound(samples);
        // After a wake with no answers at all, the moved estimate stands: only "never synced" is a failure.
        if (samples.length || gen === 0) publish();
      });
    }

    const onVisibility = () => {
      const now = mark();
      const paused = pausedMs(seen, now);
      seen = now;
      if (document.visibilityState === "hidden" || Math.abs(paused) <= CLOCK_PAUSE_MS) return;
      generation++;
      wokeAtMs = now.perfMs;
      rounds = [];
      history = [];
      setSync((s) => (s.status === "synced" ? { ...s, offsetMs: s.offsetMs + paused, driftPerMs: 0 } : s));
      setWakes((n) => n + 1);
      fullRound();
    };
    document.addEventListener("visibilitychange", onVisibility);
    fullRound();
    return () => {
      alive = false;
      sink.current = null;
      roundSink.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);

  // While the answers are no samples: a few time calls every round, never while the page is hidden.
  useEffect(() => {
    if (!active || !timeRounds) return;
    let alive = true;
    let running = false;
    const t = setInterval(() => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      sampleRound(LATER_ROUND, () => alive).then((taken) => {
        running = false;
        if (alive) roundSink.current?.(taken);
      });
    }, ROUND_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [active, timeRounds]);

  return { ...sync, addSample, wakes };
}
