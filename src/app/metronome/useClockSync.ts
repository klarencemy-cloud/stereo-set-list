import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CLOCK_PAUSE_MS, estimateOffset, fitDrift, pausedMs, type ClockMark, type TimeSample } from "./clock";

/** Time calls made when sync starts (and after the phone slept), and then on each later round. */
export const FIRST_ROUND = 20;
export const LATER_ROUND = 3;
/** How long after a round lands the next one starts. */
export const ROUND_EVERY_MS = 60_000;
/** The best sample is chosen from this many latest rounds, so a slow patch of network doesn't stick. */
export const ROUNDS_KEPT = 3;
/** The drift is fitted over a longer history: over a few minutes, a slope is mostly noise. */
const DRIFT_ROUNDS_KEPT = 10;
/** Rounds closer together than this (a round runs as soon as the screen is back) can't tell drift from noise. */
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

/** A clock sync, plus a way to take a round now ("Try syncing again"). */
export interface ClockSyncHandle extends ClockSync {
  /** Takes a round of time calls now, instead of waiting for the next one. Does nothing while not active. */
  resync: () => void;
}

/** Both clocks now. */
const mark = (): ClockMark => ({ wallMs: Date.now(), perfMs: performance.now() });

const IDLE: ClockSync = { offsetMs: 0, rttMs: 0, status: "idle", driftPerMs: 0 };

/** Takes `n` time samples, one at a time, stopping early once `alive()` is false. */
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
 * How far this phone's clock is from the server's (Cristian's algorithm), while `active`. Only /api/time calls are
 * samples: 20 at the start, then 3 every 60 s, keeping the fastest network round trip of the last few rounds, and
 * how fast that offset drifts. No calls while the page is hidden; a round as soon as it is visible again.
 *
 * When the page is visible again and the wall clock moved more than CLOCK_PAUSE_MS further than performance.now(),
 * performance.now() paused (the phone slept) while the server's clock ran on, so every sample so far is off by
 * that much (H7). They are dropped and a full round is taken, as at the start; until it lands, the estimate is the
 * old one moved by the pause, so a phone playing along stays about right.
 */
export function useClockSync(active: boolean): ClockSyncHandle {
  const [sync, setSync] = useState<ClockSync>(IDLE);
  /** Starts a round now: set while active. */
  const roundNow = useRef<(() => void) | null>(null);
  const resync = useCallback(() => roundNow.current?.(), []);

  useEffect(() => {
    if (!active) {
      setSync(IDLE);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rounds: TimeSample[][] = [];
    let history: TimeSample[][] = [];
    /** Bumped when the page comes back, so a round still running from before is dropped. */
    let generation = 0;
    /** Both clocks when the page was last hidden or shown, to tell on the next showing whether the phone slept. */
    let seen = mark();
    setSync({ ...IDLE, status: "syncing" });
    const hidden = () => document.visibilityState === "hidden";

    async function run(n: number, gen: number) {
      const current = () => alive && gen === generation;
      const samples = await sampleRound(n, current);
      if (!current()) return;
      if (samples.length) {
        rounds = [...rounds, samples].slice(-ROUNDS_KEPT);
        history = [...history, samples].slice(-DRIFT_ROUNDS_KEPT);
      }
      const best = estimateOffset(rounds.flat());
      if (best) setSync({ offsetMs: best.offsetMs, rttMs: best.rttMs, status: "synced", driftPerMs: driftOf(history) });
      // Only "never synced" is a failure. After a wake with no answers at all, the moved estimate stands.
      else setSync((s) => (s.status === "synced" ? s : { ...IDLE, status: "failed" }));
      if (hidden()) return;
      timer = setTimeout(() => run(rounds.length ? LATER_ROUND : FIRST_ROUND, gen), ROUND_EVERY_MS);
    }

    /** Drops the round waiting to run (or running) and takes one now. A failed sync is syncing again meanwhile. */
    roundNow.current = () => {
      clearTimeout(timer);
      if (hidden()) return;
      setSync((s) => (s.status === "failed" ? { ...IDLE, status: "syncing" } : s));
      run(rounds.length ? LATER_ROUND : FIRST_ROUND, ++generation);
    };

    const onVisibility = () => {
      const now = mark();
      const paused = pausedMs(seen, now);
      seen = now;
      clearTimeout(timer);
      if (hidden()) return;
      generation++;
      if (Math.abs(paused) > CLOCK_PAUSE_MS) {
        rounds = [];
        history = [];
        setSync((s) => (s.status === "synced" ? { ...s, offsetMs: s.offsetMs + paused, driftPerMs: 0 } : s));
      }
      run(rounds.length ? LATER_ROUND : FIRST_ROUND, generation);
    };
    document.addEventListener("visibilitychange", onVisibility);
    run(FIRST_ROUND, generation);
    return () => {
      alive = false;
      roundNow.current = null;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);

  return { ...sync, resync };
}
