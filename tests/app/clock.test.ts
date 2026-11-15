import { describe, expect, it } from "vitest";
import { estimateOffset, nudgeFromTaps, toAudioTime } from "../../src/app/metronome/clock";

describe("estimateOffset", () => {
  it("is null with no samples", () => {
    expect(estimateOffset([])).toBeNull();
  });

  it("uses the midpoint of the round trip", () => {
    // Server is 1000 ms ahead; 40 ms each way.
    expect(estimateOffset([{ sentMs: 100, serverMs: 1140, receivedMs: 180 }])).toEqual({ offsetMs: 1000, rttMs: 80 });
  });

  it("trusts the fastest round trip, even when slow ones are lopsided", () => {
    // True offset 1000. Slow samples spend most of their time on the way back, which skews their midpoint.
    const samples = [
      { sentMs: 0, serverMs: 1010, receivedMs: 300 }, // 10 out, 290 back: midpoint says 860
      { sentMs: 1000, serverMs: 2020, receivedMs: 1250 }, // 20 out, 230 back: says 895
      { sentMs: 2000, serverMs: 3010, receivedMs: 2022 }, // 10 out, 12 back: says 999
      { sentMs: 3000, serverMs: 4150, receivedMs: 3200 }, // 150 out, 50 back: says 1050
    ];
    expect(estimateOffset(samples)).toEqual({ offsetMs: 999, rttMs: 22 });
  });
});

describe("toAudioTime", () => {
  const link = { perfMs: 5000, audioS: 2 };

  it("turns server time into AudioContext time through the offset and the clock link", () => {
    // Server 11 000 is local 10 000 (offset 1000), 5 s after the link point.
    expect(toAudioTime(11_000, 1000, link, 0)).toBeCloseTo(7);
  });

  it("plays earlier by the nudge (a phone that sounds late)", () => {
    expect(toAudioTime(11_000, 1000, link, 150)).toBeCloseTo(6.85);
  });

  it("plays later with a negative nudge", () => {
    expect(toAudioTime(11_000, -1000, link, -100)).toBeCloseTo(9.1);
  });
});

describe("nudgeFromTaps", () => {
  const clicks = Array.from({ length: 12 }, (_, i) => 1000 + i * 667);

  it("is the median lateness of the taps after the first four", () => {
    const late = [400, -300, 900, 50, 140, 150, 130, 145, 135, 160, 120, 140];
    const taps = clicks.map((c, i) => c + late[i]);
    expect(nudgeFromTaps(clicks, taps)).toBe(140);
  });

  it("matches each tap to its nearest click, whatever order or count", () => {
    // Taps for clicks 4..11 only, all 100 ms late, after four warm-up taps.
    const warmUp = [0, 10, 20, 30];
    const taps = [...warmUp, ...clicks.slice(4).map((c) => c + 100)];
    expect(nudgeFromTaps(clicks, taps)).toBe(100);
  });

  it("ignores taps more than 200 ms from any click", () => {
    const late = [0, 0, 0, 0, -60, -55, 250, -60, 330, -65, -50, -60];
    const taps = clicks.map((c, i) => c + late[i]);
    expect(nudgeFromTaps(clicks, taps)).toBe(-60);
  });

  it("needs at least 5 good taps", () => {
    const taps = clicks.slice(0, 8).map((c) => c + 80); // 4 warm-up + 4 good
    expect(nudgeFromTaps(clicks, taps)).toBeNull();
    expect(nudgeFromTaps(clicks, clicks.slice(0, 9).map((c) => c + 80))).toBe(80);
  });

  it("rounds to the slider's 5 ms steps", () => {
    const taps = clicks.map((c) => c + 87);
    expect(nudgeFromTaps(clicks, taps)).toBe(85);
  });

  it("is null without clicks", () => {
    expect(nudgeFromTaps([], [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
  });
});
