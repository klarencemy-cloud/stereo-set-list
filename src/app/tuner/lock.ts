// When the tuner may say "In tune". Pure logic: no React, no browser APIs.
//
// The pitch must stay within 3 cents of the note (either way) for a whole second. Once locked it stays locked
// through small wobble (up to 4 cents), so the tick doesn't flicker.

/** Within this many cents (either way, inclusive) starts and continues the hold. */
export const LOCK_ENTER = 3;
/** Once locked, it stays locked up to this many cents. */
export const LOCK_EXIT = 4;
/** Within this many cents counts as nearly there: a hint, not in tune. */
export const NEAR = 5;
/** How long the pitch must stay within LOCK_ENTER to lock. */
export const LOCK_HOLD_MS = 1000;

export type LockPhase = "off" | "near" | "holding" | "locked";

export interface LockState {
  phase: LockPhase;
  /** How far through the hold, 0 to 1 (1 when locked). */
  progress: number;
  /** When the current hold started, or null when not holding. */
  since: number | null;
  /** The note (midi number) being held or locked. */
  midi: number | null;
}

export const LOCK_OFF: LockState = { phase: "off", progress: 0, since: null, midi: null };

/** The lock after a reading (`cents` unrounded) taken at `nowMs`. A null reading means nothing is heard. */
export function nextLock(prev: LockState, reading: { cents: number; midi: number } | null, nowMs: number): LockState {
  if (reading === null) return LOCK_OFF;
  const off = Math.abs(reading.cents);
  const sameNote = prev.midi === reading.midi;

  if (prev.phase === "locked" && sameNote && off <= LOCK_EXIT) return prev;

  if (off <= LOCK_ENTER) {
    const since = prev.phase === "holding" && sameNote && prev.since !== null ? prev.since : nowMs;
    const held = nowMs - since;
    if (held >= LOCK_HOLD_MS) return { phase: "locked", progress: 1, since, midi: reading.midi };
    return { phase: "holding", progress: held / LOCK_HOLD_MS, since, midi: reading.midi };
  }
  return { phase: off <= NEAR ? "near" : "off", progress: 0, since: null, midi: reading.midi };
}
