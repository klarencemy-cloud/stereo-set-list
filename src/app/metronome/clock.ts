// Clock maths for the synced metronome. Pure: no browser APIs, so it is unit-tested directly.

/** One clock sample: local times (performance.now()) around a call to /api/time or a metronome answer, and the server's time in its answer. */
export interface TimeSample {
  sentMs: number;
  serverMs: number;
  receivedMs: number;
}

export interface ClockEstimate {
  /** Add to a local performance.now() time to get server time. */
  offsetMs: number;
  /** Round trip of the sample used; half of it bounds the error. */
  rttMs: number;
}

/**
 * Cristian's algorithm: assume the server answered halfway through the round trip, and trust the sample with
 * the fastest round trip, since it has the least room for a lopsided delay.
 */
export function estimateOffset(samples: TimeSample[]): ClockEstimate | null {
  let best: ClockEstimate | null = null;
  for (const s of samples) {
    const rttMs = s.receivedMs - s.sentMs;
    if (rttMs < 0) continue;
    if (!best || rttMs < best.rttMs) best = { offsetMs: s.serverMs - (s.sentMs + s.receivedMs) / 2, rttMs };
  }
  return best;
}

/**
 * How fast the offset is changing (ms per ms of local time): the least-squares slope of each round's best
 * (fastest) sample's offset against the local time it was taken. 0 with fewer than 3 rounds, too few to tell.
 */
export function fitDrift(rounds: TimeSample[][]): number {
  const points: { x: number; y: number }[] = [];
  for (const round of rounds) {
    let best: TimeSample | null = null;
    for (const s of round) {
      if (s.receivedMs - s.sentMs < 0) continue;
      if (!best || s.receivedMs - s.sentMs < best.receivedMs - best.sentMs) best = s;
    }
    if (best) points.push({ x: (best.sentMs + best.receivedMs) / 2, y: best.serverMs - (best.sentMs + best.receivedMs) / 2 });
  }
  if (points.length < 3) return 0;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : 0;
}

/** The same moment on performance.now() (ms) and on AudioContext.currentTime (s). */
export interface ClockLink {
  perfMs: number;
  audioS: number;
}

/**
 * When to play a server-time beat on the AudioContext clock. `nudgeMs` is this phone's calibration:
 * plus means "my phone sounds late", so the click is played that much earlier.
 */
export function toAudioTime(serverMs: number, offsetMs: number, link: ClockLink, nudgeMs: number): number {
  const localMs = serverMs - offsetMs - nudgeMs;
  return link.audioS + (localMs - link.perfMs) / 1000;
}

/** Warm-up taps that are ignored while the player finds the beat. */
const WARM_UP_TAPS = 4;
/** A tap further than this from every click is a miss. */
const MAX_TAP_ERROR_MS = 200;
const MIN_GOOD_TAPS = 5;
/** The calibration slider's step. */
export const NUDGE_STEP_MS = 5;
export const MAX_NUDGE_MS = 300;

/**
 * How late this phone sounds, from a tap-along (both lists in ms on one clock): each tap after the warm-up is
 * matched to its nearest click, misses are dropped, and the median lateness is rounded to the slider's step.
 * Null when there are too few good taps to trust.
 */
export function nudgeFromTaps(clickTimes: number[], tapTimes: number[]): number | null {
  if (clickTimes.length === 0) return null;
  const late: number[] = [];
  for (const tap of tapTimes.slice(WARM_UP_TAPS)) {
    let nearest = clickTimes[0];
    for (const c of clickTimes) if (Math.abs(tap - c) < Math.abs(tap - nearest)) nearest = c;
    const d = tap - nearest;
    if (Math.abs(d) <= MAX_TAP_ERROR_MS) late.push(d);
  }
  if (late.length < MIN_GOOD_TAPS) return null;
  late.sort((a, b) => a - b);
  const mid = late.length / 2;
  const median = late.length % 2 ? late[Math.floor(mid)] : (late[mid - 1] + late[mid]) / 2;
  const stepped = Math.round(median / NUDGE_STEP_MS) * NUDGE_STEP_MS;
  return Math.max(-MAX_NUDGE_MS, Math.min(MAX_NUDGE_MS, stepped)) || 0;
}
