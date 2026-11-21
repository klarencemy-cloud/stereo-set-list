import { describe, expect, it } from "vitest";
import { loopStart, phaseError, renderBar } from "../../src/app/metronome/loop";

const SR = 48000;
/** Where the clicks start: a sample that is silent before and sounding at the onset. */
function onsets(bar: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bar.length; i++) if (bar[i] !== 0 && (i === 0 || bar[i - 1] === 0) && (i < 2 || bar[i - 2] === 0)) out.push(i);
  return out;
}

describe("renderBar", () => {
  it("is exactly one bar long", () => {
    expect(renderBar(SR, 120, 4).length).toBe(SR * 2);
    expect(renderBar(SR, 90, 3).length).toBe(SR * 2);
  });

  it("has a click on every beat", () => {
    const starts = onsets(renderBar(SR, 120, 4));
    expect(starts.length).toBe(4);
    // A sine starts at 0, so the first non-zero sample is the one after each onset.
    expect(starts.map((i) => Math.round(i / (SR / 1000)))).toEqual([0, 500, 1000, 1500]);
  });

  it("makes beat 1 louder than the others", () => {
    const bar = renderBar(SR, 120, 4);
    const peak = (from: number) => Math.max(...Array.from(bar.subarray(from, from + 480), Math.abs));
    expect(peak(0)).toBeGreaterThan(peak(SR / 2) * 1.4);
  });

  it("goes quiet between clicks", () => {
    const bar = renderBar(SR, 60, 2);
    expect(Math.max(...Array.from(bar.subarray(SR * 0.2, SR * 0.99), Math.abs))).toBe(0);
  });
});

describe("loopStart", () => {
  it("waits for a grid that hasn't started", () => {
    expect(loopStart(5, 2, 3)).toEqual({ when: 5, offset: 0 });
  });

  it("joins a running grid part-way through the bar", () => {
    const { when, offset } = loopStart(5, 2, 8.5);
    expect(when).toBe(8.5);
    expect(offset).toBeCloseTo(1.5);
  });

  it("joins exactly on a bar line at offset 0", () => {
    expect(loopStart(5, 2, 9).offset).toBeCloseTo(0);
  });
});

describe("phaseError", () => {
  it("is how far the loop is from where the grid says it should be, within half a bar", () => {
    expect(phaseError(10, 10.004, 2)).toBeCloseTo(0.004);
    expect(phaseError(10, 11.998, 2)).toBeCloseTo(-0.002);
    expect(phaseError(10, 14, 2)).toBeCloseTo(0);
  });
});
