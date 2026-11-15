import { useEffect, useState } from "react";
import { api } from "../api";
import { estimateOffset, fitDrift, type TimeSample } from "./clock";

/** Samples taken when sync starts, and then on each later round. */
const FIRST_ROUND = 20;
const LATER_ROUND = 3;
export const ROUND_EVERY_MS = 60_000;
/** The best sample is chosen from this many latest rounds, so a slow patch of network doesn't stick. */
const ROUNDS_KEPT = 3;
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

const IDLE: ClockSync = { offsetMs: 0, rttMs: 0, status: "idle", driftPerMs: 0 };

async function sampleRound(n: number): Promise<TimeSample[]> {
  const out: TimeSample[] = [];
  // One at a time: parallel calls would queue behind each other and look slower than they are.
  for (let i = 0; i < n; i++) {
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
 * How far this phone's clock is from the server's (Cristian's algorithm), while `active`: 20 samples at the
 * start, then 3 every 60 s, keeping the fastest round trip of the last few rounds, and how fast that offset drifts. No samples while the page is
 * hidden; a round as soon as it is visible again.
 */
export function useClockSync(active: boolean): ClockSync {
  const [sync, setSync] = useState<ClockSync>(IDLE);

  useEffect(() => {
    if (!active) {
      setSync(IDLE);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rounds: TimeSample[][] = [];
    let history: TimeSample[][] = [];
    // Bumped when the page comes back, so a round still running from before doesn't start a second chain.
    let generation = 0;
    setSync({ ...IDLE, status: "syncing" });
    const hidden = () => document.visibilityState === "hidden";
    const nextRound = () => (estimateOffset(rounds.flat()) ? LATER_ROUND : FIRST_ROUND);

    async function run(n: number, gen: number) {
      const samples = await sampleRound(n);
      if (!alive || gen !== generation) return;
      if (samples.length) {
        rounds = [...rounds, samples].slice(-ROUNDS_KEPT);
        history = [...history, samples].slice(-DRIFT_ROUNDS_KEPT);
      }
      const best = estimateOffset(rounds.flat());
      // A failed later round keeps the last good estimate; only "never synced" is a failure.
      if (best) setSync({ offsetMs: best.offsetMs, rttMs: best.rttMs, status: "synced", driftPerMs: driftOf(history) });
      else setSync({ ...IDLE, status: "failed" });
      if (hidden()) return;
      timer = setTimeout(() => run(nextRound(), gen), ROUND_EVERY_MS);
    }
    const onVisibility = () => {
      clearTimeout(timer);
      if (!hidden()) run(nextRound(), ++generation);
    };
    document.addEventListener("visibilitychange", onVisibility);
    run(FIRST_ROUND, generation);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);

  return sync;
}
