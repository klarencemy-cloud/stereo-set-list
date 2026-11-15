import { describe, expect, it } from "vitest";
import { detectOnsets, matchShift, measureRoundTrip } from "../../src/app/metronome/match";
import { renderBar } from "../../src/app/metronome/loop";

const SR = 48000;

/** A repeatable pseudo-random generator, so the noise is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** `bars` bars of renderBar, added into `out` from sample `at`, scaled by `gain`. */
function addBars(out: Float32Array, at: number, bpm: number, beatsPerBar: number, bars: number, gain = 1) {
  const bar = renderBar(SR, bpm, beatsPerBar);
  for (let b = 0; b < bars; b++) {
    const from = at + b * bar.length;
    for (let i = 0; i < bar.length && from + i < out.length; i++) if (from + i >= 0) out[from + i] += gain * bar[i];
  }
}

describe("detectOnsets", () => {
  // 120 BPM, 4/4: a beat every 24 000 samples, so each bar is exactly 96 000 samples.
  const beat = SR / 2;
  const startS = 12.345;

  it("finds each click to within 0.5 ms, through noise and a quieter second click train", () => {
    const out = new Float32Array(SR * 5);
    const at = 14_990; // 0.3123 s in
    addBars(out, at, 120, 4, 2);
    // A quieter phone further away, 170 ms behind.
    addBars(out, at + Math.round(0.17 * SR), 120, 4, 2, 0.1);
    const r = rng(7);
    for (let i = 0; i < out.length; i++) out[i] += (r() * 2 - 1) * 0.02;

    const found = detectOnsets(out, SR, startS, 0.6 * 0.5);
    const truth = Array.from({ length: 8 }, (_, k) => startS + (at + k * beat) / SR);
    expect(found).toHaveLength(8);
    found.forEach((t, k) => expect(Math.abs(t - truth[k])).toBeLessThan(0.0005));
  });

  it("counts each click once, however long it rings", () => {
    const out = new Float32Array(SR * 3);
    addBars(out, 1000, 120, 4, 1);
    expect(detectOnsets(out, SR, 0, 0.3)).toHaveLength(4);
  });

  it("hears nothing in silence or plain noise", () => {
    expect(detectOnsets(new Float32Array(SR), SR, 0, 0.3)).toEqual([]);
    const noise = new Float32Array(SR * 2);
    const r = rng(3);
    for (let i = 0; i < noise.length; i++) noise[i] = (r() * 2 - 1) * 0.02;
    expect(detectOnsets(noise, SR, 0, 0.3)).toEqual([]);
  });
});

describe("matchShift", () => {
  const beatS = 0.5;
  const expected = Array.from({ length: 8 }, (_, i) => 10 + i * beatS);
  const roundTripS = 0.1;
  /** What the mic hears if this phone's grid is `lateMs` behind the band's. */
  const heard = (lateMs: number) => expected.map((e) => e + roundTripS - lateMs / 1000);

  it("is plus when this phone would play late (so it should play earlier, like the nudge)", () => {
    // The band's click is heard 12 ms sooner than this phone's own would be: this phone is 12 ms late.
    const r = matchShift(expected, heard(12), roundTripS, beatS);
    expect(r!.shiftMs).toBeCloseTo(12, 6);
    expect(r!.spreadMs).toBeCloseTo(0, 6);
    expect(matchShift(expected, heard(-30), roundTripS, beatS)!.shiftMs).toBeCloseTo(-30, 6);
  });

  it("matches across a round trip longer than half a beat", () => {
    const longTrip = 0.32;
    const onsets = expected.map((e) => e + longTrip - 0.005);
    expect(matchShift(expected, onsets, longTrip, beatS)!.shiftMs).toBeCloseTo(5, 6);
  });

  it("shrugs off outliers, stray onsets and missed beats", () => {
    const onsets = heard(12);
    onsets[2] += 0.08; // a bump in the room
    onsets.splice(5, 1); // a click it missed
    onsets.push(10.27, 11.83); // stray noises off the beat
    onsets.sort((a, b) => a - b);
    const r = matchShift(expected, onsets, roundTripS, beatS);
    expect(r!.shiftMs).toBeCloseTo(12, 6);
    expect(r!.spreadMs).toBeLessThan(1);
  });

  it("needs at least 5 matched beats", () => {
    expect(matchShift(expected, heard(12).slice(0, 4), roundTripS, beatS)).toBeNull();
    expect(matchShift(expected, heard(12).slice(0, 5), roundTripS, beatS)).not.toBeNull();
    expect(matchShift(expected, [], roundTripS, beatS)).toBeNull();
  });

  it("gives up when the beats disagree by more than 10 ms", () => {
    const jitter = heard(12).map((t, i) => t + (i % 2 ? 0.02 : -0.02));
    expect(matchShift(expected, jitter, roundTripS, beatS)).toBeNull();
    const fine = heard(12).map((t, i) => t + (i % 2 ? 0.004 : -0.004));
    expect(matchShift(expected, fine, roundTripS, beatS)!.spreadMs).toBeCloseTo(4, 6);
  });
});

describe("measureRoundTrip", () => {
  const gapS = 0.8;
  const clicks = Array.from({ length: 8 }, (_, i) => 2 + i * gapS);

  it("is the median time from playing a click to hearing it", () => {
    const onsets = clicks.map((c, i) => c + 0.142 + (i === 3 ? 0.05 : 0));
    const r = measureRoundTrip(clicks, onsets, gapS);
    expect(r!.roundTripMs).toBeCloseTo(142, 6);
  });

  it("works for a round trip longer than half the gap", () => {
    expect(measureRoundTrip(clicks, clicks.map((c) => c + 0.55), gapS)!.roundTripMs).toBeCloseTo(550, 6);
  });

  it("is null when too few clicks are heard, or they disagree", () => {
    expect(measureRoundTrip(clicks, [], gapS)).toBeNull();
    expect(measureRoundTrip(clicks, clicks.slice(0, 4).map((c) => c + 0.1), gapS)).toBeNull();
    expect(measureRoundTrip(clicks, clicks.map((c, i) => c + 0.1 + (i % 2 ? 0.03 : -0.03)), gapS)).toBeNull();
  });
});
