// @vitest-environment jsdom
// B. Stop doesn't stick, or a change bounces back (H4, H5, H18, and H23 found while testing).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome from "../../src/app/components/SongMetronome";
import type { MetroSession } from "../../src/shared/metronome";
import { advance, advanceUntil, FakeAudioContext, heard, serverNow, setupWorld, teardownWorld, world } from "./harness";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeEach(async () => {
  w = await setupWorld();
});
afterEach(teardownWorld);


/** This phone joined to a running 120/4 session, polls answered slowly (50 ms up, 400 ms down). */
async function joinedPhone() {
  world.latency = { getTime: [10, 10], getMetronome: [50, 400], putMetronome: [50, 50] };
  await w.other({ bpm: 120, beatsPerBar: 4, running: true });
  render(<SongMetronome song={w.song} onSongChange={() => {}} />);
  await advance(500, 10);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(4000, 10);
  return FakeAudioContext.instances[0];
}

/** Waits until this phone has just sent a poll (it is in flight: read at +50 ms, answered at +450 ms). */
async function pollInFlight() {
  const sent = world.sent.getMetronome;
  await advanceUntil(() => world.sent.getMetronome > sent);
  await advance(60, 1); // the poll has been read at the server; its answer is still on the way
}

describe("H4: a poll in flight when this phone sends a change comes back after it, and is taken", () => {
  it.fails("BUG H4: Stop for everyone, then clicks start again on the phone that pressed it", async () => {
    const ctx = await joinedPhone();
    await pollInFlight();
    fireEvent.click(screen.getByRole("button", { name: "Stop for everyone" }));
    await advance(150, 5); // the stop's answer is back
    const stoppedAt = ctx.currentTime;
    expect(screen.getByRole("button", { name: "Start for everyone" })).toBeInTheDocument();
    await advance(3000, 10);
    const after = heard(ctx, stoppedAt + 0.05, stoppedAt + 3);
    expect(after.map((h) => +(h.t - stoppedAt).toFixed(3))).toEqual([]);
  });

  it("H4 measure: what the stopping phone does after Stop (logged)", async () => {
    const ctx = await joinedPhone();
    await pollInFlight();
    fireEvent.click(screen.getByRole("button", { name: "Stop for everyone" }));
    const log: string[] = [];
    let last = "";
    const t0 = ctx.currentTime;
    for (let i = 0; i < 300; i++) {
      await advance(10, 10);
      const view = screen.queryByRole("button", { name: "Start for everyone" }) ? "stopped" : "playing";
      if (view !== last) log.push(`  +${Math.round((ctx.currentTime - t0) * 1000)} ms: panel shows ${view}`);
      last = view;
    }
    const clicks = heard(ctx, t0 + 0.2, t0 + 3).map((h) => Math.round((h.t - t0) * 1000));
    console.log(`[H4] Stop for everyone with a poll in flight:\n${log.join("\n")}\n  clicks after the stop at +ms: ${clicks.join(", ")}`);
    expect(log.length).toBeGreaterThan(0);
  }, 30_000); // many simulated seconds; slow on a loaded machine

  it.fails("BUG H4: a beats-per-bar change shows the old value again before the next poll fixes it", async () => {
    await joinedPhone();
    await pollInFlight();
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    const seen: number[] = [];
    for (let i = 0; i < 200; i++) {
      await advance(10, 10);
      const n = document.querySelectorAll(".metro-dot").length;
      if (seen[seen.length - 1] !== n) seen.push(n);
    }
    expect(seen).toEqual([6]);
  });

  it("H4 regression: the new beats per bar still starts on its bar line (the next poll lands inside the lead)", async () => {
    const ctx = await joinedPhone();
    await pollInFlight();
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    await advance(5000, 10);
    const s = (await w.stored())!;
    expect(s.beatsPerBar).toBe(6);
    const first = ctx.audioAt(s.startAt);
    const bar = heard(ctx, first - 0.01, first + 3 - 0.01);
    expect(bar).toHaveLength(6);
    expect(Math.abs(bar[0].t - first)).toBeLessThan(0.002);
    expect(bar[0].accent).toBe(true);
  });
});

describe("H5: two phones change it at the same moment", () => {
  it("refuted (audibly): the loser shows its own tempo until its next poll, but plays the winner's on the bar line", async () => {
    world.latency = { getTime: [10, 10], getMetronome: [50, 50], putMetronome: [50, 50] };
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(300, 10);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(3000, 10);
    const ctx = FakeAudioContext.instances[0];
    const puts = world.served.putMetronome.length;
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    await advanceUntil(() => world.served.putMetronome.length > puts);
    // A bandmate's change lands right after ours: theirs wins.
    await w.other({ beatsPerBar: 3 });
    await advance(80, 5);
    // This phone shows its own (losing) change for now.
    expect(document.querySelectorAll(".metro-dot")).toHaveLength(6);
    await advance(5000, 10);
    expect(document.querySelectorAll(".metro-dot")).toHaveLength(3);
    const s = (await w.stored())!;
    const first = ctx.audioAt(s.startAt);
    const bar = heard(ctx, first - 0.01, first + 1.5 - 0.01);
    expect(bar.map((h) => h.accent)).toEqual([true, false, false]);
    expect(Math.abs(bar[0].t - first)).toBeLessThan(0.002);
  });
});

describe("H18: Start for everyone from a panel whose view is old", () => {
  it.fails("BUG H18: a phone that still shows 'stopped' turns a bandmate's fresh start into a tempo change for everyone", async () => {
    world.latency = { getMetronome: [20, 20], putMetronome: [20, 20], getTime: [10, 10] };
    render(<SongMetronome song={w.song} onSongChange={() => {}} />); // the song's tempo is 96/3
    await advance(100, 10);
    // Right after this panel's check, the drummer starts it at 120/4.
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    await advance(3000, 10);
    // This panel only checks every 10 s, so it still offers Start for everyone.
    fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
    await advance(500, 10);
    const s = (await w.stored()) as MetroSession;
    expect({ bpm: s.bpm, beatsPerBar: s.beatsPerBar }).toEqual({ bpm: 120, beatsPerBar: 4 });
  });
});

describe("H23 (new): two changes inside one lead put phones on different grids for a bar", () => {
  it.fails("BUG H23: a phone that polled between the two changes plays a different bar from one that didn't", async () => {
    world.latency = { getTime: [10, 10], getMetronome: [10, 10], putMetronome: [10, 10] };
    // Short bars, so the second change always lands after the first one's bar line.
    await w.other({ bpm: 240, beatsPerBar: 2, running: true });
    const a = render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    const b = render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(100, 10);
    const joinA = serverNow();
    fireEvent.click(within(a.container).getByRole("button", { name: "Join" }));
    await advance(750, 5);
    fireEvent.click(within(b.container).getByRole("button", { name: "Join" }));
    // Phone A's polls are read at joinA + 10 + 1500k; phone B's 750 ms later.
    const justAfterA = joinA + 10 + 1500 * 4 + 2;
    await advance(justAfterA - serverNow(), 1);
    const s1 = (await w.other({ beatsPerBar: 3 }))!; // change 1: A won't hear of it, B will (its read is 748 ms later)
    await advance(800, 5);
    const s2 = (await w.other({ bpm: 200 }))!; // change 2, worked out from change 1's grid
    await advance(6000, 10);
    const [ctxA, ctxB] = FakeAudioContext.instances;
    const accents = (ctx: FakeAudioContext, from: number, to: number) =>
      heard(ctx, ctx.audioAt(from) - 0.001, ctx.audioAt(to) - 0.001)
        .filter((h) => h.accent)
        .map((h) => Math.round(ctx.serverAtAudio(h.t) - from));
    const from = s1.startAt;
    console.log(
      `[H23] change 1 starts at +0, change 2 at +${s2.startAt - from} ms. Accents heard in between (ms):
` +
        `  A (missed change 1): ${accents(ctxA, from, s2.startAt)}
  B (saw change 1):    ${accents(ctxB, from, s2.startAt)}`,
    );
    const from_ = from;
    expect(accents(ctxA, from_, s2.startAt)).toEqual(accents(ctxB, from_, s2.startAt));
  });
});
