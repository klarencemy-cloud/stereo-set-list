import { describe, expect, it } from "vitest";
import { analysisSize, centsOff, clampA4, detectPitch, noteFromFrequency } from "../../src/app/tuner/pitch";

const SR = 48000;

/** A plucked-string-like tone: the fundamental plus some harmonics. */
function tone(freq: number, sampleRate = SR, size = analysisSize(sampleRate), harmonics = [1, 0.6, 0.35, 0.2]): Float32Array {
  const buf = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    let v = 0;
    harmonics.forEach((amp, h) => {
      v += amp * Math.sin((2 * Math.PI * freq * (h + 1) * i) / sampleRate + h);
    });
    buf[i] = 0.3 * v;
  }
  return buf;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

/** Notes from a 5-string bass's low B up to a guitar's high E, plus a low B tuned 20 cents flat. */
const NOTES: [string, number][] = [
  ["B0", 30.87],
  ["B0 20 cents flat", 30.87 * Math.pow(2, -20 / 1200)],
  ["E1", 41.2],
  ["A1", 55],
  ["D2", 73.42],
  ["G2", 98],
  ["E2", 82.41],
  ["A2", 110],
  ["D3", 146.83],
  ["G3", 196],
  ["B3", 246.94],
  ["E4", 329.63],
  ["A4", 440],
];

describe("detectPitch", () => {
  for (const [name, freq] of NOTES) {
    it(`finds ${name} (${freq.toFixed(2)} Hz) within 0.5 cents`, () => {
      const f = detectPitch(tone(freq), SR);
      expect(f).not.toBeNull();
      expect(Math.abs(cents(f!, freq))).toBeLessThan(0.5);
    });
  }

  it("finds a pure sine and a slightly flat string at 44.1 kHz", () => {
    const f1 = detectPitch(tone(110, 44100, analysisSize(44100), [1]), 44100)!;
    expect(Math.abs(cents(f1, 110))).toBeLessThan(2);
    const flat = 82.41 * Math.pow(2, -20 / 1200);
    const f2 = detectPitch(tone(flat, 44100, analysisSize(44100)), 44100)!;
    expect(Math.abs(cents(f2, flat))).toBeLessThan(2);
  });

  it("ignores silence and very quiet input", () => {
    expect(detectPitch(new Float32Array(analysisSize(SR)), SR)).toBeNull();
    const quiet = tone(110).map((v) => v * 0.001);
    expect(detectPitch(quiet, SR)).toBeNull();
  });

  it("ignores noise with no clear pitch", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const noise = new Float32Array(analysisSize(SR)).map(() => rand() * 0.5);
    expect(detectPitch(noise, SR)).toBeNull();
  });
});

describe("noteFromFrequency", () => {
  it("names the note, octave and cents", () => {
    expect(noteFromFrequency(440)).toEqual({ name: "A", octave: 4, cents: 0, exactCents: 0, midi: 69 });
    expect(noteFromFrequency(41.2034)).toMatchObject({ name: "E", octave: 1, cents: 0 });
    const sharp = noteFromFrequency(440 * Math.pow(2, 10 / 1200));
    expect(sharp).toMatchObject({ name: "A", octave: 4, cents: 10 });
    expect(noteFromFrequency(277.18)).toMatchObject({ name: "C#", octave: 4 });
  });

  it("gives the unrounded cents too", () => {
    const n = noteFromFrequency(110 * Math.pow(2, 0.4 / 1200));
    expect(n.cents).toBe(0);
    expect(n.exactCents).toBeCloseTo(0.4, 6);
    const m = noteFromFrequency(110 * Math.pow(2, -1.3 / 1200));
    expect(m.cents).toBe(-1);
    expect(m.exactCents).toBeCloseTo(-1.3, 6);
    expect(noteFromFrequency(441, 440).exactCents).toBeCloseTo(3.93, 2);
  });
});

describe("centsOff", () => {
  it("measures cents against a target", () => {
    expect(centsOff(110, 110)).toBe(0);
    expect(Math.round(centsOff(110 * Math.pow(2, 1 / 12), 110))).toBe(100);
    expect(Math.round(centsOff(108, 110))).toBe(-32);
  });
});

describe("reference pitch A4", () => {
  it("names notes against the chosen A4", () => {
    expect(noteFromFrequency(432, 432)).toMatchObject({ name: "A", octave: 4, cents: 0 });
    const n = noteFromFrequency(440, 432);
    expect(n).toMatchObject({ name: "A", octave: 4 });
    expect(n.cents).toBeGreaterThanOrEqual(31);
    expect(n.cents).toBeLessThanOrEqual(32);
  });

  it("clamps to 415-466 Hz in whole Hz, with 440 for nonsense", () => {
    expect(clampA4(414)).toBe(415);
    expect(clampA4(500)).toBe(466);
    expect(clampA4(441.6)).toBe(442);
    expect(clampA4(NaN)).toBe(440);
    expect(clampA4(440)).toBe(440);
  });
});
