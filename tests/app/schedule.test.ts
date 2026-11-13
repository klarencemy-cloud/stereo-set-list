import { describe, expect, it } from "vitest";
import { BeatScheduler, MAX_BPM, MIN_BPM, bpmFromTaps, clampBpm } from "../../src/app/metronome/schedule";

describe("clampBpm", () => {
  it("rounds and keeps tempo within range", () => {
    expect(clampBpm(120.4)).toBe(120);
    expect(clampBpm(5)).toBe(MIN_BPM);
    expect(clampBpm(999)).toBe(MAX_BPM);
    expect(clampBpm(Number.NaN)).toBe(MIN_BPM);
  });
});

describe("BeatScheduler", () => {
  it("lays beats evenly from the start time, accenting the first of each bar", () => {
    const s = new BeatScheduler(10, 120, 4);
    const beats = s.due(12.01);
    expect(beats.map((b) => b.time)).toEqual([10, 10.5, 11, 11.5, 12]);
    expect(beats.map((b) => b.beat)).toEqual([0, 1, 2, 3, 0]);
    expect(beats.map((b) => b.accent)).toEqual([true, false, false, false, true]);
  });

  it("hands out each beat only once", () => {
    const s = new BeatScheduler(0, 60, 4);
    expect(s.due(1.5).map((b) => b.time)).toEqual([0, 1]);
    expect(s.due(1.5)).toEqual([]);
    expect(s.due(2.5).map((b) => b.time)).toEqual([2]);
  });

  it("applies a tempo change from the beat after the one already scheduled", () => {
    const s = new BeatScheduler(0, 60, 4);
    s.due(0.5); // beat at 0 handed out; the next is already due at 1
    s.setBpm(120);
    expect(s.due(2.01).map((b) => b.time)).toEqual([1, 1.5, 2]);
  });

  it("starts a fresh, accented bar when the beats per bar change", () => {
    const s = new BeatScheduler(0, 60, 4);
    s.due(1.5); // beats 0 and 1
    s.setBeatsPerBar(3);
    const next = s.due(5.5);
    expect(next.map((b) => b.beat)).toEqual([0, 1, 2, 0]);
    expect(next[0].accent).toBe(true);
  });

  it("works on any clock, so a shared clock can drive it later", () => {
    const s = new BeatScheduler(1000.25, 240, 2);
    expect(s.due(1000.8).map((b) => b.time)).toEqual([1000.25, 1000.5, 1000.75]);
  });
});

describe("bpmFromTaps", () => {
  it("needs at least two taps", () => {
    expect(bpmFromTaps([])).toBeNull();
    expect(bpmFromTaps([1000])).toBeNull();
  });

  it("averages the gaps between taps", () => {
    expect(bpmFromTaps([0, 500, 1000, 1500])).toBe(120);
    expect(bpmFromTaps([0, 480, 1000, 1500])).toBe(120);
  });

  it("uses only the latest few taps", () => {
    expect(bpmFromTaps([0, 1000, 2000, 2500, 3000, 3500, 4000, 4500])).toBe(120);
  });

  it("starts over after a long pause", () => {
    expect(bpmFromTaps([0, 1000, 2000, 6000, 6400])).toBe(150);
  });

  it("keeps the result within the tempo range", () => {
    expect(bpmFromTaps([0, 100, 200])).toBe(MAX_BPM);
  });
});
