// @vitest-environment jsdom
// A. Missed count-in (H1, H2, H11). Every phone should hear beat 1 of a start (target T1, round trips up to 1 s).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome from "../../src/app/components/SongMetronome";
import type { MetroSession } from "../../src/shared/metronome";
import { advance, advanceUntil, FakeAudioContext, heard, setupWorld, teardownWorld, world } from "./harness";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeEach(async () => {
  w = await setupWorld();
});
afterEach(teardownWorld);

const symmetric = (rttMs: number): [number, number] => [rttMs / 2, rttMs / 2];

/** The beats of a session's first bar this phone actually plays (audio onsets), and how many it should. */
function firstBar(s: MetroSession) {
  const ctx = FakeAudioContext.instances[0];
  if (!ctx) return { got: [], first: NaN, want: s.beatsPerBar, missed: s.beatsPerBar };
  const first = ctx.audioAt(s.startAt);
  const beatS = 60 / s.bpm;
  const all = heard(ctx, first - 0.1, first + s.beatsPerBar * beatS);
  // Each beat of bar 1 counts as heard when a click plays within 15 ms of it.
  const got = Array.from({ length: s.beatsPerBar }, (_, k) => all.find((h) => Math.abs(h.t - (first + k * beatS)) < 0.015))
    .filter((h) => h !== undefined);
  return { got, first, want: s.beatsPerBar, missed: s.beatsPerBar - got.length };
}

/** The phone that taps Start for everyone, with this round trip on every request. Returns its first bar. */
async function starter(rttMs: number) {
  world.latency = { getTime: symmetric(rttMs), getMetronome: symmetric(rttMs), putMetronome: symmetric(rttMs) };
  render(<SongMetronome song={w.song} onSongChange={() => {}} />);
  await advance(rttMs + 20, 10);
  fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
  await advance(2600 + 11 * rttMs, 10);
  const s = (await w.stored())!;
  return firstBar(s);
}

describe("H1: the starter waits for 20 serial clock samples before it plays anything", () => {
  it("control: with a 100 ms round trip the starter hears beat 1 of its own count-in", async () => {
    const { got, first, want } = await starter(100);
    expect(got).toHaveLength(want);
    expect(got[0].accent).toBe(true);
    expect(Math.abs(got[0].t - first)).toBeLessThan(0.002);
  });

  it.fails("BUG H1: with a 300 ms round trip (4G) the starter misses the start of its own count-in", async () => {
    const { got, want } = await starter(300);
    expect(got).toHaveLength(want);
  });

  it("H1 measure: beats of the first bar the starter misses, by round trip (logged)", async () => {
    const rows: string[] = [];
    for (const rtt of [100, 150, 200, 220, 250, 300, 500, 1000]) {
      cleanup();
      teardownWorld();
      w = await setupWorld();
      const { missed, want } = await starter(rtt);
      rows.push(`  RTT ${String(rtt).padStart(4)} ms: missed ${missed} of ${want} beats in bar 1`);
    }
    console.log(`[H1] starter, 96 BPM 3/4 (bar = 1.875 s), 2 s lead:\n${rows.join("\n")}`);
    expect(rows).toHaveLength(8);
  });
});

/**
 * A follower that is joined while the session is stopped (someone pressed Stop, everyone stayed joined). Another
 * phone restarts it right after this phone's poll was read at the server: the worst case for the 1.5 s poll.
 */
async function followerOfRestart(metroLeg: [number, number], timeLeg: [number, number] = [10, 10]) {
  world.latency = { getTime: timeLeg, getMetronome: metroLeg, putMetronome: metroLeg };
  await w.other({ bpm: 120, beatsPerBar: 4, running: true });
  render(<SongMetronome song={w.song} onSongChange={() => {}} />);
  await advance(metroLeg[0] + metroLeg[1] + 20, 10);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(12 * (timeLeg[0] + timeLeg[1]) + 3000, 10);
  await w.other({ running: false });
  await advance(3000, 10);
  const reads = world.served.getMetronome.length;
  await advanceUntil(() => world.served.getMetronome.length > reads);
  const s = (await w.other({ bpm: 120, beatsPerBar: 4, running: true }))!;
  await advance(5000, 10);
  return firstBar(s);
}

describe("H2: a joined follower hears of a restart too late for the count-in", () => {
  it("control: 200 ms round trip, the follower hears every beat of bar 1", async () => {
    const { got, want, first } = await followerOfRestart([100, 100]);
    expect(got).toHaveLength(want);
    expect(Math.abs(got[0].t - first)).toBeLessThan(0.002);
  });

  it.fails("BUG H2: 1 s round trip (500 ms each way, congested 4G) misses beat 1 of the restart", async () => {
    const { got, want } = await followerOfRestart([500, 500]);
    expect(got).toHaveLength(want);
  });

  it.fails("BUG H2: a slow downlink (100 ms up, 600 ms down) misses beat 1 of the restart", async () => {
    const { got, want } = await followerOfRestart([100, 600]);
    expect(got).toHaveLength(want);
  });

  it("H2 measure: beats of bar 1 missed against the downlink delay, worst-case timing (logged)", async () => {
    const rows: string[] = [];
    for (const down of [300, 400, 420, 440, 500, 700, 1000]) {
      cleanup();
      teardownWorld();
      w = await setupWorld();
      const { missed, want } = await followerOfRestart([50, down]);
      rows.push(`  up 50 / down ${String(down).padStart(4)} ms: missed ${missed} of ${want}`);
    }
    console.log(`[H2] joined follower, restart right after its poll was read:\n${rows.join("\n")}`);
    expect(rows).toHaveLength(7);
  });
});

describe("H11: the sync status is a fair bound but never warns", () => {
  it("a lopsided link (10 ms up, 70 ms down) puts the clicks 30 ms late and calls it 'Synced ±40 ms'", async () => {
    world.latency = { getTime: [10, 70], getMetronome: [10, 10], putMetronome: [10, 10] };
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(50, 10);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(4000, 10);
    const s = (await w.stored())!;
    const ctx = FakeAudioContext.instances[0];
    const bar = heard(ctx, ctx.audioAt(s.startAt) + 2.5, ctx.audioAt(s.startAt) + 4.5).find((h) => h.accent)!;
    // Grid bar lines are startAt + k·2000 ms; how far the played one is from the true one.
    const errMs = (((bar.t - ctx.audioAt(s.startAt)) % 2) + 2) % 2 * 1000;
    const late = errMs > 1000 ? errMs - 2000 : errMs;
    expect(Math.round(late)).toBe(30);
    // The bound shown is honest (error ≤ half the round trip)...
    expect(screen.getByRole("status")).toHaveTextContent("Synced ±40 ms");
    // ...and no warning appears even at ±200 ms (checked below).
  });

  it("at a 400 ms round trip it shows 'Synced ±200 ms' with no warning style", async () => {
    world.latency = { getTime: [200, 200], getMetronome: [10, 10], putMetronome: [10, 10] };
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(50, 10);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    // 20 serial samples at 400 ms each before the first estimate.
    await advance(8500, 10);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Synced ±200 ms");
    expect(status).not.toHaveClass("warn");
  });
});
