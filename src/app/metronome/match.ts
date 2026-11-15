// Matching this phone to the band by ear. Pure: no browser APIs, so it is unit-tested directly.
// All times are seconds on one audio clock (the AudioContext that recorded the samples).

/** The energy envelope's window. Short, so the rise is sharp. */
const WINDOW_S = 0.001;
/** A click is a rise to this share of the loudest envelope in the recording. */
const REL_THRESHOLD = 0.05;
/** ...and to well above the background (the envelope's median). */
const NOISE_FACTOR = 10;
/** The onset is the first sample to reach this share of the click's own peak. */
const ONSET_FRACTION = 0.2;
/** How much of the envelope's median is sampled (every Nth value): the exact median doesn't matter. */
const MEDIAN_STRIDE = 16;

export const MIN_MATCHED = 5;
export const MAX_SPREAD_MS = 10;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length / 2;
  return v.length % 2 ? v[Math.floor(mid)] : (v[mid - 1] + v[mid]) / 2;
}

/** The median and the median absolute deviation from it. */
function medianAndMad(values: number[]): { median: number; mad: number } {
  const m = median(values);
  return { median: m, mad: median(values.map((v) => Math.abs(v - m))) };
}

/**
 * Click onsets in a recording, in seconds on the clock where sample 0 is at `startS`. An onset is where a short
 * energy envelope rises past a threshold (a share of the loudest click, and well above the background), refined
 * back to the first sample that reaches a share of that click's own peak, so a loud and a soft click are timed
 * alike. After an onset, nothing within `minGapS` counts (about 60% of a beat), so each click counts once and a
 * quieter echo or second phone in between doesn't.
 */
export function detectOnsets(samples: Float32Array, sampleRate: number, startS: number, minGapS = 0.1): number[] {
  const n = samples.length;
  const w = Math.max(1, Math.round(WINDOW_S * sampleRate));
  if (n < w) return [];
  // Trailing mean of x² over w samples.
  const env = new Float32Array(n);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    sum += samples[i] * samples[i];
    if (i >= w) sum -= samples[i - w] * samples[i - w];
    const e = Math.max(0, sum) / w;
    env[i] = e;
    if (e > peak) peak = e;
  }
  const strided: number[] = [];
  for (let i = w; i < n; i += MEDIAN_STRIDE) strided.push(env[i]);
  const background = strided.length ? median(strided) : 0;
  if (peak <= 0 || peak < NOISE_FACTOR * 2 * background) return [];
  const threshold = Math.max(REL_THRESHOLD * peak, NOISE_FACTOR * background);

  const gap = Math.max(1, Math.round(minGapS * sampleRate));
  const out: number[] = [];
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (i < next || env[i] < threshold) continue;
    // The click's peak amplitude, from just before the rise to a window after it.
    const from = Math.max(0, i - w);
    const to = Math.min(n, i + w);
    let localPeak = 0;
    for (let j = from; j < to; j++) localPeak = Math.max(localPeak, Math.abs(samples[j]));
    const level = ONSET_FRACTION * localPeak;
    let onset = i;
    for (let j = from; j <= i; j++) {
      if (Math.abs(samples[j]) >= level) {
        onset = j;
        break;
      }
    }
    out.push(startS + onset / sampleRate);
    next = onset + gap;
  }
  return out;
}

/**
 * How far this phone's grid is from the band's, from a recording of the band. `expectedS` are the times this phone
 * would play each beat; a click heard at `onset` was played `roundTripS` before (this phone's speaker-to-mic
 * delay, which is how late a sound scheduled now is heard by its own mic). For each beat, the nearest
 * `onset − roundTrip` within half a beat is taken, and `expected − (onset − roundTrip)` is how late this phone
 * would be. Plus = late, so (like the nudge) it should play that much earlier.
 *
 * The median is `shiftMs`; the median absolute deviation is `spreadMs`. Null with fewer than 5 matched beats or a
 * spread over 10 ms: too unsure to trust.
 */
export function matchShift(
  expectedS: number[],
  onsetsS: number[],
  roundTripS: number,
  beatS: number,
): { shiftMs: number; spreadMs: number } | null {
  const played = onsetsS.map((o) => o - roundTripS);
  const late: number[] = [];
  for (const e of expectedS) {
    let best: number | null = null;
    for (const p of played) if (Math.abs(p - e) <= beatS / 2 && (best === null || Math.abs(p - e) < Math.abs(best - e))) best = p;
    if (best !== null) late.push((e - best) * 1000);
  }
  if (late.length < MIN_MATCHED) return null;
  const { median: shiftMs, mad: spreadMs } = medianAndMad(late);
  return spreadMs > MAX_SPREAD_MS ? null : { shiftMs, spreadMs };
}

/**
 * This phone's speaker-to-mic delay, from clicks it played at `scheduledS` and the onsets it heard: for each
 * click, the first onset after it and before the next one (`gapS` apart). The median is the round trip; null when
 * fewer than 5 clicks are heard or they disagree by more than 10 ms.
 */
export function measureRoundTrip(
  scheduledS: number[],
  onsetsS: number[],
  gapS: number,
): { roundTripMs: number; spreadMs: number } | null {
  const delays: number[] = [];
  for (const s of scheduledS) {
    const heard = onsetsS.find((o) => o >= s && o < s + gapS);
    if (heard !== undefined) delays.push((heard - s) * 1000);
  }
  if (delays.length < MIN_MATCHED) return null;
  const { median: roundTripMs, mad: spreadMs } = medianAndMad(delays);
  return spreadMs > MAX_SPREAD_MS ? null : { roundTripMs, spreadMs };
}
