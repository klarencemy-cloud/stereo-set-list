import { useEffect, useState } from "react";
import { api } from "../api";
import { estimateOffset, type TimeSample } from "./clock";

/** Samples taken when sync starts, and then on each later round. */
const FIRST_ROUND = 10;
const LATER_ROUND = 3;
export const ROUND_EVERY_MS = 60_000;
/** The best sample is chosen from this many latest rounds, so a slow patch of network doesn't stick. */
const ROUNDS_KEPT = 3;

export type ClockStatus = "idle" | "syncing" | "synced" | "failed";

export interface ClockSync {
  /** Add to performance.now() to get server time. */
  offsetMs: number;
  rttMs: number;
  status: ClockStatus;
}

const IDLE: ClockSync = { offsetMs: 0, rttMs: 0, status: "idle" };

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
 * How far this phone's clock is from the server's (Cristian's algorithm), while `active`: 10 samples at the
 * start, then 3 every 60 s, keeping the fastest round trip of the last few rounds. No samples while the page is
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
    // Bumped when the page comes back, so a round still running from before doesn't start a second chain.
    let generation = 0;
    setSync({ ...IDLE, status: "syncing" });
    const hidden = () => document.visibilityState === "hidden";
    const nextRound = () => (estimateOffset(rounds.flat()) ? LATER_ROUND : FIRST_ROUND);

    async function run(n: number, gen: number) {
      const samples = await sampleRound(n);
      if (!alive || gen !== generation) return;
      if (samples.length) rounds = [...rounds, samples].slice(-ROUNDS_KEPT);
      const best = estimateOffset(rounds.flat());
      // A failed later round keeps the last good estimate; only "never synced" is a failure.
      if (best) setSync({ offsetMs: best.offsetMs, rttMs: best.rttMs, status: "synced" });
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
