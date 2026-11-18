import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { estimateOffset, fitDrift, type TimeSample } from "./clock";

/** Time calls made when sync starts. After that, the session checks' answers are the samples. */
const FIRST_ROUND = 20;
/** The samples handed in are grouped into rounds this long, so they age out and the drift can be fitted. */
export const ROUND_EVERY_MS = 60_000;
/** The best sample is chosen from this many latest rounds, so a slow patch of network doesn't stick. */
const ROUNDS_KEPT = 3;
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
}

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
 * more time calls. Samples are grouped into ROUND_EVERY_MS rounds; the fastest network round trip of the last few rounds
 * wins, and the drift is fitted over a longer history of rounds.
 *
 * Samples that arrive while the first round runs join it when it lands. After a first round where every time call
 * failed, the answers still sync it. Ignored while not active.
 */
export function useClockSync(active: boolean): ClockSyncHandle {
  const [sync, setSync] = useState<ClockSync>(IDLE);
  /** Where addSample's samples go: set while active. */
  const sink = useRef<((s: TimeSample) => void) | null>(null);
  const addSample = useCallback((s: TimeSample) => sink.current?.(s), []);

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

    sampleRound(FIRST_ROUND, () => alive).then((taken) => {
      if (!alive) return;
      const samples = [...taken, ...pending];
      pending = [];
      firstRoundDone = true;
      if (samples.length) newRound(samples);
      publish();
    });
    return () => {
      alive = false;
      sink.current = null;
    };
  }, [active]);

  return { ...sync, addSample };
}
