import { describe, expect, it } from "vitest";
import { applyChange, beatsInWindow, gridBeats, type MetroSession } from "../../src/shared/metronome";
import * as schedule from "../../src/app/metronome/schedule";
import * as shared from "../../src/shared/metronome";

const session = (over: Partial<MetroSession> = {}): MetroSession => ({
  bpm: 120,
  beatsPerBar: 4,
  startAt: 10_000,
  running: true,
  updatedAt: "2026-11-15T00:00:00.000Z",
  ...over,
});

describe("tempo constants", () => {
  it("are shared with the v1 scheduler", () => {
    expect(schedule.MIN_BPM).toBe(shared.MIN_BPM);
    expect(schedule.MAX_BPM).toBe(shared.MAX_BPM);
    expect(schedule.BEATS_PER_BAR).toBe(shared.BEATS_PER_BAR);
    expect(schedule.clampBpm(500)).toBe(300);
  });
});

describe("beatsInWindow", () => {
  it("lists beats from startAt, every 60000/bpm ms, accenting bar starts", () => {
    expect(beatsInWindow(session(), 10_000, 12_000)).toEqual([
      { n: 0, timeMs: 10_000, beat: 0, accent: true },
      { n: 1, timeMs: 10_500, beat: 1, accent: false },
      { n: 2, timeMs: 11_000, beat: 2, accent: false },
      { n: 3, timeMs: 11_500, beat: 3, accent: false },
    ]);
  });

  it("includes a beat exactly at the window start and excludes one exactly at the end", () => {
    const beats = beatsInWindow(session(), 10_500, 11_000);
    expect(beats.map((b) => b.n)).toEqual([1]);
  });

  it("gives a late joiner the next beats with the right bar position", () => {
    // 60 s in at 120 BPM is beat 120; 120 % 4 = 0, so the first beat after 70 001 ms is n = 121.
    const beats = beatsInWindow(session(), 70_001, 71_100);
    expect(beats).toEqual([
      { n: 121, timeMs: 70_500, beat: 1, accent: false },
      { n: 122, timeMs: 71_000, beat: 2, accent: false },
    ]);
  });

  it("has no beats before startAt", () => {
    expect(beatsInWindow(session(), 0, 10_000)).toEqual([]);
  });

  it("has no beats when stopped", () => {
    expect(beatsInWindow(session({ running: false }), 10_000, 20_000)).toEqual([]);
  });

  it("accents by beats per bar", () => {
    const accents = beatsInWindow(session({ beatsPerBar: 3 }), 10_000, 13_000).map((b) => b.accent);
    expect(accents).toEqual([true, false, false, true, false, false]);
  });
});

describe("gridBeats", () => {
  it("plays the old grid until the new startAt, then the new one", () => {
    const prev = session();
    const cur = session({ bpm: 60, startAt: 12_000 });
    expect(gridBeats(prev, cur, 11_000, 14_000).map((b) => b.timeMs)).toEqual([11_000, 11_500, 12_000, 13_000]);
  });

  it("plays nothing once the session is stopped", () => {
    expect(gridBeats(session(), session({ running: false }), 10_000, 20_000)).toEqual([]);
  });

  it("plays the current grid alone without a previous one", () => {
    expect(gridBeats(null, session(), 10_000, 11_000).map((b) => b.n)).toEqual([0, 1]);
  });
});

describe("applyChange", () => {
  const now = 50_000;

  it("starts a new session the lead time ahead", () => {
    const s = applyChange(null, { bpm: 90, beatsPerBar: 3, running: true }, now);
    expect(s).toEqual({ bpm: 90, beatsPerBar: 3, startAt: 52_000, running: true, updatedAt: new Date(now).toISOString() });
  });

  it("restarts a stopped session from now + lead with the stored tempo", () => {
    const s = applyChange(session({ running: false }), { running: true }, now, 1000);
    expect(s).toMatchObject({ bpm: 120, beatsPerBar: 4, startAt: 51_000, running: true });
  });

  it("puts a tempo change on the first bar line at or after now + lead", () => {
    // Bars are 2000 ms long from 10 000: bar lines at ..., 50 000, 52 000, 54 000. now + lead = 52 100.
    const s = applyChange(session(), { bpm: 100 }, 50_100);
    expect(s).toMatchObject({ bpm: 100, beatsPerBar: 4, startAt: 54_000, running: true });
  });

  it("keeps a bar line that falls exactly on now + lead", () => {
    expect(applyChange(session(), { bpm: 100 }, 50_000).startAt).toBe(52_000);
  });

  it("puts a beats-per-bar change on the next bar line of the old bar length", () => {
    const s = applyChange(session(), { beatsPerBar: 3 }, 50_100);
    expect(s).toMatchObject({ bpm: 120, beatsPerBar: 3, startAt: 54_000 });
  });

  it("keeps the start of a session that hasn't started yet when the tempo changes", () => {
    const s = applyChange(session({ startAt: 60_000 }), { bpm: 140 }, now);
    expect(s.startAt).toBe(60_000);
  });

  it("leaves a running session alone when asked to start it again with the same tempo", () => {
    const cur = session();
    expect(applyChange(cur, { running: true, bpm: 120 }, now)).toEqual(cur);
  });

  it("stops at once", () => {
    const s = applyChange(session(), { running: false }, now);
    expect(s).toMatchObject({ running: false, bpm: 120, beatsPerBar: 4, updatedAt: new Date(now).toISOString() });
  });

  it("stores a new tempo on a stopped session without starting it", () => {
    const s = applyChange(session({ running: false }), { bpm: 80 }, now);
    expect(s).toMatchObject({ running: false, bpm: 80 });
  });

  it("refuses to start with no session and no tempo rather than inventing one", () => {
    expect(() => applyChange(null, { running: true }, now)).toThrow(/bpm/);
  });
});
