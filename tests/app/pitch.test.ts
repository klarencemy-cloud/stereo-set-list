import { describe, expect, it } from "vitest";
import {
  INSTRUMENTS,
  analysisSize,
  centsOff,
  detectPitch,
  nearestString,
  noteFromFrequency,
} from "../../src/app/tuner/pitch";

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

describe("detectPitch", () => {
  for (const inst of Object.values(INSTRUMENTS)) {
    for (const s of inst.strings) {
      it(`finds ${inst.label} ${s.name} (${s.freq.toFixed(2)} Hz) within 2 cents`, () => {
        const f = detectPitch(tone(s.freq), SR);
        expect(f).not.toBeNull();
        expect(Math.abs(cents(f!, s.freq))).toBeLessThan(2);
      });
    }
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
    expect(noteFromFrequency(440)).toEqual({ name: "A", octave: 4, cents: 0, midi: 69 });
    expect(noteFromFrequency(41.2034)).toMatchObject({ name: "E", octave: 1, cents: 0 });
    const sharp = noteFromFrequency(440 * Math.pow(2, 10 / 1200));
    expect(sharp).toMatchObject({ name: "A", octave: 4, cents: 10 });
    expect(noteFromFrequency(277.18)).toMatchObject({ name: "C#", octave: 4 });
  });
});

describe("centsOff and nearestString", () => {
  it("measures cents against a target", () => {
    expect(centsOff(110, 110)).toBe(0);
    expect(Math.round(centsOff(110 * Math.pow(2, 1 / 12), 110))).toBe(100);
    expect(Math.round(centsOff(108, 110))).toBe(-32);
  });

  it("picks the closest string of the instrument", () => {
    const g = INSTRUMENTS.guitar.strings;
    expect(nearestString(84, g).name).toBe("E2");
    expect(nearestString(105, g).name).toBe("A2");
    expect(nearestString(320, g).name).toBe("E4");
    expect(nearestString(60, INSTRUMENTS.bass.strings).name).toBe("A1");
  });

  it("has standard tunings", () => {
    expect(INSTRUMENTS.guitar.strings.map((s) => s.name)).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
    expect(INSTRUMENTS.bass.strings.map((s) => s.name)).toEqual(["E1", "A1", "D2", "G2"]);
    expect(INSTRUMENTS.bass.strings[0].freq).toBeCloseTo(41.2, 1);
  });
});
