// Pitch detection for the tuner. Pure maths: no React, no browser APIs, so it can be tested with synthetic tones.

export interface TunerString {
  /** Note and octave, e.g. "E2". */
  name: string;
  freq: number;
}

export type InstrumentId = "guitar" | "bass";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const A4 = 440;

function freqOfMidi(midi: number): number {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

function stringOf(midi: number): TunerString {
  return { name: `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`, freq: freqOfMidi(midi) };
}

/** Standard tunings, low string first. */
export const INSTRUMENTS: Record<InstrumentId, { label: string; strings: TunerString[] }> = {
  guitar: { label: "Guitar", strings: [40, 45, 50, 55, 59, 64].map(stringOf) },
  bass: { label: "Bass", strings: [28, 33, 38, 43].map(stringOf) },
};

/** Lowest pitch looked for: below a bass's low E (41.2 Hz), with room for a string tuned well flat. */
export const MIN_FREQ = 35;
export const MAX_FREQ = 1100;
/** Readings quieter than this (RMS) are ignored: nothing is being played. */
const MIN_RMS = 0.01;
/** YIN threshold: how clear the pitch must be. Higher accepts murkier sounds. */
const CLARITY = 0.15;

/** How many samples to analyse: enough to hold two periods of the lowest pitch, a power of two for the analyser. */
export function analysisSize(sampleRate: number): number {
  let size = 2048;
  while (size < 2 * (sampleRate / MIN_FREQ)) size *= 2;
  return size;
}

/**
 * The fundamental frequency in Hz, or null when the input is too quiet or has no clear pitch. Uses the YIN
 * method (de Cheveigné & Kawahara, 2002), which resists the octave errors plain autocorrelation makes on
 * plucked strings with strong harmonics.
 */
export function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  if (Math.sqrt(sumSq / buf.length) < MIN_RMS) return null;

  const maxTau = Math.min(Math.floor(sampleRate / MIN_FREQ), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const w = buf.length - maxTau;

  // Cumulative mean normalised difference.
  const d = new Float32Array(maxTau + 1);
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    running += sum;
    d[tau] = running === 0 ? 1 : (sum * tau) / running;
  }

  let tau = -1;
  for (let t = minTau; t < maxTau; t++) {
    if (d[t] < CLARITY) {
      while (t + 1 < maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // Parabolic interpolation between neighbouring lags for sub-sample accuracy.
  const a = d[tau - 1];
  const b = d[tau];
  const c = d[tau + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
  const freq = sampleRate / (tau + (Math.abs(shift) < 1 ? shift : 0));
  return freq >= MIN_FREQ && freq <= MAX_FREQ ? freq : null;
}

/** Cents from `target` to `freq`: positive is sharp. */
export function centsOff(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target);
}

/** The nearest equal-tempered note (A4 = 440 Hz) and how many cents away it is. */
export function noteFromFrequency(freq: number): { name: string; octave: number; cents: number; midi: number } {
  const exact = 69 + 12 * Math.log2(freq / A4);
  const midi = Math.round(exact);
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: Math.round((exact - midi) * 100) || 0,
    midi,
  };
}

/** The instrument string closest in pitch to `freq`. */
export function nearestString(freq: number, strings: TunerString[]): TunerString {
  let best = strings[0];
  for (const s of strings) {
    if (Math.abs(centsOff(freq, s.freq)) < Math.abs(centsOff(freq, best.freq))) best = s;
  }
  return best;
}
