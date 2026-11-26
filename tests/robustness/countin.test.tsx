// @vitest-environment jsdom
// A. Missed count-in (H1, H2, H11). Every phone should hear beat 1 of a start (target T1, round trips up to 1 s).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome, { ROUNDTRIP_KEY } from "../../src/app/components/SongMetronome";
import { LEAD_MS, type MetroSession } from "../../src/shared/metronome";
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

/**
 * The phone that taps Start for everyone, with this network round trip on every request, after the panel was open for
 * `openMs` (default: just long enough to show the Start button). Returns its first bar.
 */
async function starter(rttMs: number, openMs = rttMs + 20) {
  world.latency = { getTime: symmetric(rttMs), getMetronome: symmetric(rttMs), putMetronome: symmetric(rttMs) };
  render(<SongMetronome song={w.song} onSaveTempo={async () => true} saving={false} />);
  await advance(openMs, 10);
  fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
  await advance(2600 + 11 * rttMs, 10);
  const s = (await w.stored())!;
  return firstBar(s);
}

describe("H1: the clock syncs from when the panel opens, so the starter is ready", () => {
  it("control: with a 100 ms round trip the starter hears beat 1 of its own count-in", async () => {
    const { got, first, want } = await starter(100);
    expect(got).toHaveLength(want);
    expect(got[0].accent).toBe(true);
    expect(Math.abs(got[0].t - first)).toBeLessThan(0.002);
  });

  it("H1 fixed: with a 300 ms network round trip (4G) the starter hears beat 1, the panel open a moment before Start", async () => {
    // 20 serial samples at 300 ms each: 6 s. Reading the song and finding the tempo takes about that long.
    const { got, want, first } = await starter(300, 8000);
    expect(got).toHaveLength(want);
    expect(got[0].accent).toBe(true);
    expect(Math.abs(got[0].t - first)).toBeLessThan(0.002);
  });

  it("H1 measure: beats of the first bar the starter misses, by round trip (logged)", async () => {
    const rows: string[] = [];
    for (const rtt of [100, 150, 200, 220, 250, 300, 500, 1000]) {
      cleanup();
      teardownWorld();
      w = await setupWorld();
      const { missed, want } = await starter(rtt, 8000);
      rows.push(`  RTT ${String(rtt).padStart(4)} ms: missed ${missed} of ${want} beats in bar 1`);
    }
    console.log(`[H1] starter, 96 BPM 3/4 (bar = 1.875 s), ${LEAD_MS / 1000} s lead, panel open 8 s:\n${rows.join("\n")}`);
    expect(rows).toHaveLength(8);
  });
});

describe("H1: Join on a panel that has been open plays without waiting for the clock", () => {
  it("at a 300 ms network round trip, the first click comes within a beat of tapping Join", async () => {
    world.latency = { getTime: symmetric(300), getMetronome: symmetric(300), putMetronome: symmetric(300) };
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    render(<SongMetronome song={w.song} onSaveTempo={async () => true} saving={false} />);
    await advance(8000, 10);
    const timeCalls = world.sent.getTime;
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(600, 10);
    const ctx = FakeAudioContext.instances[0];
    expect(heard(ctx, 0, ctx.currentTime).length).toBeGreaterThan(0);
    expect(world.sent.getTime).toBe(timeCalls);
  });
});

/**
 * A follower that is joined while the session is stopped (someone pressed Stop, everyone stayed joined). Another
 * phone restarts it right after this phone's poll was read at the server: the worst case for the 2 s check.
 */
async function followerOfRestart(metroLeg: [number, number], timeLeg: [number, number] = [10, 10]) {
  world.latency = { getTime: timeLeg, getMetronome: metroLeg, putMetronome: metroLeg };
  await w.other({ bpm: 120, beatsPerBar: 4, running: true });
  render(<SongMetronome song={w.song} onSaveTempo={async () => true} saving={false} />);
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

  it("H2 fixed: 1 s round trip (500 ms each way, congested 4G) hears beat 1 of the restart", async () => {
    const { got, want } = await followerOfRestart([500, 500]);
    expect(got).toHaveLength(want);
  });

  it("H2 fixed: a slow downlink (100 ms up, 600 ms down) hears beat 1 of the restart", async () => {
    const { got, want } = await followerOfRestart([100, 600]);
    expect(got).toHaveLength(want);
  });

  it("H2 with the 2 s check: a downlink up to about 900 ms (50 ms up, 850 ms down) still hears beat 1", async () => {
    const { got, want } = await followerOfRestart([50, 850]);
    expect(got).toHaveLength(want);
  });

  it("H2 measure: beats of bar 1 missed against the downlink delay, worst-case timing (logged)", async () => {
    const rows: string[] = [];
    for (const down of [300, 500, 700, 850, 900, 950, 1000]) {
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

/** Joins a running session after the panel was open a moment, with this link on every call. Returns the status line. */
async function joinWith(leg: [number, number], over: { leader?: string } = {}) {
  world.latency = { getTime: leg, getMetronome: leg, putMetronome: leg };
  await w.other({ bpm: 120, beatsPerBar: 4, running: true, ...over });
  render(<SongMetronome song={w.song} onSaveTempo={async () => true} saving={false} />);
  await advance(25 * (leg[0] + leg[1]) + 100, 10);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(1000, 10);
  return screen.getByRole("status");
}

const ROUGH = /measure this phone or use Wi-Fi/i;

describe("H11: the sync status is a fair bound, and a rough clock-only sync warns", () => {
  it("a lopsided link (10 ms up, 70 ms down) puts the clicks 30 ms late, says 'Synced ±40 ms' and warns", async () => {
    // One link for every call: the metronome answers carry the server's time too, so they are clock samples.
    world.latency = { getTime: [10, 70], getMetronome: [10, 70], putMetronome: [10, 70] };
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    render(<SongMetronome song={w.song} onSaveTempo={async () => true} saving={false} />);
    await advance(100, 10);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(4000, 10);
    const s = (await w.stored())!;
    const ctx = FakeAudioContext.instances[0];
    const bar = heard(ctx, ctx.audioAt(s.startAt) + 2.5, ctx.audioAt(s.startAt) + 4.5).find((h) => h.accent)!;
    // Grid bar lines are startAt + k·2000 ms; how far the played one is from the true one.
    const errMs = (((bar.t - ctx.audioAt(s.startAt)) % 2) + 2) % 2 * 1000;
    const late = errMs > 1000 ? errMs - 2000 : errMs;
    expect(Math.round(late)).toBe(30);
    // The bound shown is honest (error ≤ half the round trip), and over 25 ms it warns.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Synced ±40 ms");
    expect(status).toHaveClass("warn");
    expect(status).toHaveTextContent(ROUGH);
  });

  it("at a 400 ms network round trip it shows 'Synced ±200 ms' with the warning style", async () => {
    const status = await joinWith([200, 200]);
    expect(status).toHaveTextContent("Synced ±200 ms");
    expect(status).toHaveClass("warn");
    expect(status).toHaveTextContent(ROUGH);
  });

  it("at ±25 ms (a 50 ms network round trip) it doesn't warn", async () => {
    const status = await joinWith([25, 25]);
    expect(status).toHaveTextContent("Synced ±25 ms");
    expect(status).not.toHaveClass("warn");
    expect(status).not.toHaveTextContent(ROUGH);
  });

  it("a phone that couldn't hear the band warns over 25 ms", async () => {
    localStorage.setItem(ROUNDTRIP_KEY, "50");
    world.mic.blocked = true;
    await joinWith([50, 50], { leader: "them" });
    await advanceUntil(() => /Couldn't hear the band/.test(screen.getByRole("status").textContent ?? ""), 10_000, 10);
    expect(screen.getByRole("status")).toHaveClass("warn");
    expect(screen.getByRole("status")).toHaveTextContent(ROUGH);
  });

  it("a phone matched to the band by ear doesn't warn, however long its network round trip", async () => {
    localStorage.setItem(ROUNDTRIP_KEY, String(world.mic.loopbackMs));
    await joinWith([100, 100], { leader: "them" });
    await advanceUntil(() => /Matched to the band/.test(screen.getByRole("status").textContent ?? ""), 10_000, 10);
    expect(screen.getByRole("status")).not.toHaveClass("warn");
    expect(screen.getByRole("status")).not.toHaveTextContent(ROUGH);
  });
});
