// Steadies the tuner's pitch readings. Pure maths: no React, no browser APIs.
//
// A single pitch reading wobbles by about a cent with room noise, a plucked string starts sharp, and now and then
// a reading jumps an octave. The smoother works in cents (log frequency), so the same wobble is smoothed the same
// at every pitch, and it outputs Hz: the reference pitch (A4) is applied later, so changing it never resets this.

/** Smoothing time constant: settles in about half a second. */
export const SMOOTH_TAU_MS = 150;
/** A reading further than this from the smoothed pitch is held back as a possible glitch. */
export const OUTLIER_CENTS = 50;
/** ...unless this many readings in a row agree on it: then it's a real note change. */
export const SWITCH_READINGS = 3;
/** Readings skipped at the start of a note (after silence): a plucked string starts sharp. */
export const ATTACK_SKIP = 2;

const toCents = (hz: number) => 1200 * Math.log2(hz);
const toHz = (cents: number) => Math.pow(2, cents / 1200);

/**
 * Moves `current` towards `target` as a first-order lag with time constant `tauMs`, for a step of `dtMs`. Never
 * overshoots, and gives the same result whether it's called often with small steps or rarely with big ones.
 */
export function approach(current: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return current;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return alpha >= 1 ? target : current + alpha * (target - current);
}

export interface Smoother {
  /** Adds a reading (Hz, or null for nothing heard) taken at `nowMs`. Returns the steady pitch in Hz, or null. */
  push(freq: number | null, nowMs: number): number | null;
  /** Forgets everything, as at the start. */
  reset(): void;
}

export function createSmoother(): Smoother {
  /** Smoothed pitch in cents, or null before the first note. */
  let value: number | null = null;
  let lastMs = 0;
  /** Readings still to skip: a note's attack. */
  let skip = ATTACK_SKIP;
  /** Set after silence: the next accepted reading may start a new note without the outlier gate. */
  let afterGap = true;
  /** Far-away readings that agree with each other, waiting to count as a note change. */
  let pending: { cents: number; count: number } | null = null;

  function restart(c: number, nowMs: number) {
    value = c;
    lastMs = nowMs;
    pending = null;
    afterGap = false;
  }

  return {
    push(freq, nowMs) {
      if (freq === null || !(freq > 0)) {
        skip = ATTACK_SKIP;
        afterGap = true;
        pending = null;
        return null;
      }
      if (skip > 0) {
        skip--;
        return null;
      }
      const c = toCents(freq);
      if (value === null || (afterGap && Math.abs(c - value) > OUTLIER_CENTS)) {
        // First note, or a different note after a gap: start from it.
        restart(c, nowMs);
      } else if (Math.abs(c - value) > OUTLIER_CENTS) {
        // Held back unless it repeats: a one-off is a glitch (often an octave error), a run is a new note.
        pending = pending && Math.abs(c - pending.cents) <= OUTLIER_CENTS ? { cents: c, count: pending.count + 1 } : { cents: c, count: 1 };
        if (pending.count >= SWITCH_READINGS) restart(c, nowMs);
      } else {
        pending = null;
        afterGap = false;
        value = approach(value, c, nowMs - lastMs, SMOOTH_TAU_MS);
        lastMs = nowMs;
      }
      return value === null ? null : toHz(value);
    },
    reset() {
      value = null;
      lastMs = 0;
      skip = ATTACK_SKIP;
      afterGap = true;
      pending = null;
    },
  };
}
