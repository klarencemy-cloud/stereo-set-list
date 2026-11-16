// @vitest-environment jsdom
// Matching the leader by ear (ADR 0001) in the test world: the real panel and the real listen() hear the leader's
// clicks through the world's fake mic.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome, { ROUNDTRIP_KEY } from "../../src/app/components/SongMetronome";
import { advance, advanceUntil, FakeAudioContext, heard, setupWorld, teardownWorld, world } from "./harness";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeEach(async () => {
  w = await setupWorld();
  world.latency = { getTime: [10, 10], getMetronome: [10, 10], putMetronome: [10, 10] };
});
afterEach(teardownWorld);

const status = () => screen.queryByRole("status")?.textContent ?? "";

/** Joins a running session another phone ("them") leads, with this phone's loopback delay measured. */
async function joinLed() {
  localStorage.setItem(ROUNDTRIP_KEY, String(world.mic.loopbackMs));
  await w.other({ bpm: 120, beatsPerBar: 4, running: true, leader: "them" });
  render(<SongMetronome song={w.song} onSongChange={() => {}} />);
  await advance(100, 10);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advanceUntil(() => FakeAudioContext.instances.length > 0, 1000, 10);
  return FakeAudioContext.instances[0];
}

describe("a joining phone matches the leader by ear", () => {
  it("reaches 'Matched to the band', and its clicks land on the leader's", async () => {
    // A lopsided network round trip: the clock alone puts this phone 15 ms off. The match takes that out.
    world.latency = { getTime: [40, 10], getMetronome: [10, 10], putMetronome: [10, 10] };
    world.mic.loopbackMs = 120;
    const ctx = await joinLed();
    await advanceUntil(() => status().startsWith("Listening to the band"), 5000, 10);
    expect(ctx.loops).toHaveLength(0);
    await advanceUntil(() => status().startsWith("Matched to the band"), 10_000, 10);
    await advance(3000, 10);
    const t = ctx.currentTime;
    const clicks = heard(ctx, t - 2, t);
    expect(clicks.length).toBeGreaterThan(2);
    const s = (await w.stored())!;
    for (const c of clicks) {
      const n = Math.round((ctx.serverAtAudio(c.t) - s.startAt) / 500);
      expect(Math.abs(c.t - ctx.audioAt(s.startAt + 500 * n)) * 1000).toBeLessThan(2);
    }
  });

  it("falls back to 'Couldn't hear the band' with the mic blocked", async () => {
    world.mic.blocked = true;
    await joinLed();
    await advanceUntil(() => status().startsWith("Couldn't hear the band"), 10_000, 10);
    expect(world.mic.open).toBe(0);
  });

  it("falls back to 'Couldn't hear the band' when no clicks reach the mic", async () => {
    world.mic.hearsBand = false;
    const ctx = await joinLed();
    await advanceUntil(() => status().startsWith("Couldn't hear the band"), 10_000, 10);
    await advance(1000, 10);
    expect(heard(ctx, ctx.currentTime - 1, ctx.currentTime).length).toBeGreaterThan(0); // by the clock alone
    expect(world.mic.open).toBe(0);
  });
});
