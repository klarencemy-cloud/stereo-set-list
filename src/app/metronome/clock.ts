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
 * How much slower a sample counts per ms of age (0.1 ms per second), so an old fast sample gives way to a newer
 * one before the clocks drift far from it (100 ppm drifts 0.1 ms a second).
 */
export const AGE_PENALTY_PER_MS = 1e-4;

/**
 * Cristian's algorithm: assume the server answered halfway through the round trip, and trust the sample with
 * the fastest network round trip, since it has the least room for a lopsided delay. A sample counts as slower by
 * its age (AGE_PENALTY_PER_MS, against the newest sample), and the newer one wins a tie, so drift can't build up
 * unseen.
 */
export function estimateOffset(samples: TimeSample[]): ClockEstimate | null {
  const valid = samples.filter((s) => s.receivedMs >= s.sentMs);
  const newestMs = Math.max(...valid.map((s) => s.receivedMs));
  let best: (ClockEstimate & { score: number; receivedMs: number }) | null = null;
  for (const s of valid) {
    const rttMs = s.receivedMs - s.sentMs;
    const score = rttMs + AGE_PENALTY_PER_MS * (newestMs - s.receivedMs);
    if (!best || score < best.score || (score === best.score && s.receivedMs > best.receivedMs)) {
      best = { offsetMs: s.serverMs - (s.sentMs + s.receivedMs) / 2, rttMs, score, receivedMs: s.receivedMs };
    }
  }
  return best && { offsetMs: best.offsetMs, rttMs: best.rttMs };
}

/** The wall clock (Date.now()) and performance.now() read at one moment, to tell later whether the latter paused. */
export interface ClockMark {
  wallMs: number;
  perfMs: number;
}

/** A gap between the two clocks bigger than this means performance.now() paused (the phone slept). */
export const CLOCK_PAUSE_MS = 50;

/**
 * How long performance.now() stood still between two marks while the wall clock ran on (a phone asleep): how much
 * further the wall clock moved. Under CLOCK_PAUSE_MS it is noise (the two clocks round and drift apart a little).
 */
export const pausedMs = (from: ClockMark, to: ClockMark) => to.wallMs - from.wallMs - (to.perfMs - from.perfMs);

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

/** How far back the link smoother looks (ms of performance.now()). */
export const LINK_WINDOW_MS = 1500;
/** And never more readings than this (a tick every 25 ms fills the window with 60). */
const MAX_LINK_READINGS = 120;

/**
 * Smooths the link between performance.now() and the audio clock: one getOutputTimestamp() reading can be
 * several ms off. `add` takes a reading and gives back the link averaged over the last LINK_WINDOW_MS of them.
 * The two clocks are taken to run at the same rate (they differ by ~100 ppm, less than a rate fitted over so short
 * a window would be off by), so the average is of the offset between them.
 */
export function linkSmoother() {
  let readings: ClockLink[] = [];
  const link = (perfMs: number): ClockLink => {
    const meanOffsetS = readings.reduce((a, r) => a + (r.audioS - r.perfMs / 1000), 0) / readings.length;
    return { perfMs, audioS: perfMs / 1000 + meanOffsetS };
  };
  return {
    add(reading: ClockLink): ClockLink {
      readings.push(reading);
      // performanceTime may itself be jittered, so readings aren't kept in order: drop by time, not by position.
      const newest = Math.max(...readings.map((r) => r.perfMs));
      readings = readings.filter((r) => r.perfMs > newest - LINK_WINDOW_MS).slice(-MAX_LINK_READINGS);
      return link(reading.perfMs);
    },
    /**
     * Forgets all but the newest `n` readings and gives back the link from those. After the clocks really moved,
     * the older readings are from before the move, so the full average is still catching up.
     */
    keepNewest(n: number): ClockLink {
      readings = readings.slice(-n);
      return link(readings[readings.length - 1].perfMs);
    },
    /** Forgets every reading, e.g. when the audio clock was paused. */
    clear() {
      readings = [];
    },
  };
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
