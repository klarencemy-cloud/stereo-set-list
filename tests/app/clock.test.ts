import { describe, expect, it } from "vitest";
import { CLOCK_PAUSE_MS, estimateOffset, fitDrift, pausedMs, toAudioTime } from "../../src/app/metronome/clock";

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

  it("takes the newest sample when network round trips tie (H7)", () => {
    // The offset drifted from 1000 to 1003 between the samples; both network round trips took 20 ms.
    const older = { sentMs: 0, serverMs: 1010, receivedMs: 20 };
    const newer = { sentMs: 5000, serverMs: 6013, receivedMs: 5020 };
    expect(estimateOffset([older, newer])).toEqual({ offsetMs: 1003, rttMs: 20 });
    expect(estimateOffset([newer, older])).toEqual({ offsetMs: 1003, rttMs: 20 });
  });

  it("counts an older sample as slower, by about 0.1 ms per second of age (H7)", () => {
    // 100 s apart: the old one is 5 ms faster but counts 10 ms slower, so the new one wins.
    const old = { sentMs: 0, serverMs: 1010, receivedMs: 20 };
    const recent = { sentMs: 100_000, serverMs: 101_012, receivedMs: 100_025 };
    expect(estimateOffset([old, recent])).toEqual({ offsetMs: 999.5, rttMs: 25 });
    // 20 s apart, it counts only 2 ms slower: the 5 ms faster old one still wins.
    const soon = { sentMs: 20_000, serverMs: 21_012, receivedMs: 20_025 };
    expect(estimateOffset([old, soon])).toEqual({ offsetMs: 1000, rttMs: 20 });
  });
});

describe("pausedMs", () => {
  it("is how much further the wall clock moved than performance.now() (H7)", () => {
    // 5 s of performance.now(), 35.25 s of wall clock: asleep for 30.25 s.
    expect(pausedMs({ wallMs: 1_000_000, perfMs: 10_000 }, { wallMs: 1_035_250, perfMs: 15_000 })).toBe(30_250);
  });

  it("is about 0 when the phone didn't sleep, under the CLOCK_PAUSE_MS threshold", () => {
    const p = pausedMs({ wallMs: 1_000_000, perfMs: 10_000 }, { wallMs: 1_005_003, perfMs: 15_000 });
    expect(p).toBe(3);
    expect(p).toBeLessThan(CLOCK_PAUSE_MS);
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

describe("fitDrift", () => {
  /** A round of samples answered with `offset` at local time `at`, plus slower ones that are further off. */
  const round = (at: number, offset: number) => [
    { sentMs: at - 10, serverMs: at + offset, receivedMs: at + 10 },
    { sentMs: at - 100, serverMs: at + offset + 70, receivedMs: at + 100 },
  ];

  it("is 0 with fewer than 3 rounds", () => {
    expect(fitDrift([])).toBe(0);
    expect(fitDrift([round(0, 100), round(60_000, 130)])).toBe(0);
  });

  it("is 0 for a steady offset", () => {
    expect(fitDrift([round(0, 100), round(60_000, 100), round(120_000, 100)])).toBeCloseTo(0, 12);
  });

  it("is the slope of each round's best offset against local time", () => {
    // 3 ms more every minute: 50 ppm.
    const rounds = [round(0, 100), round(60_000, 103), round(120_000, 106), round(180_000, 109)];
    expect(fitDrift(rounds)).toBeCloseTo(3 / 60_000, 12);
  });

  it("skips empty rounds", () => {
    expect(fitDrift([round(0, 100), [], round(60_000, 106), round(120_000, 112)])).toBeCloseTo(6 / 60_000, 12);
  });
});
