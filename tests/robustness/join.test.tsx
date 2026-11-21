// @vitest-environment jsdom
// The band's target (ADR 0002): a phone that joins plays by the clock alone, within 5 ms of the grid on Wi-Fi.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome from "../../src/app/components/SongMetronome";
import type { MetroSession } from "../../src/shared/metronome";
import { advance, FakeAudioContext, heard, setupWorld, teardownWorld, world } from "./harness";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeEach(async () => {
  w = await setupWorld();
});
afterEach(teardownWorld);

/** How far (ms, + = late) each heard downbeat in audio [fromS, toS) is from the true grid. */
function downbeatErrorsMs(ctx: FakeAudioContext, s: MetroSession, fromS: number, toS: number) {
  const barMs = (s.beatsPerBar * 60000) / s.bpm;
  return heard(ctx, fromS, toS)
    .filter((h) => h.accent)
    .map((h) => {
      const d = (((ctx.serverAtAudio(h.t) - s.startAt) % barMs) + barMs) % barMs;
      return Math.round((d > barMs / 2 ? d - barMs : d) * 10) / 10;
    });
}

/** Same Wi-Fi: 15 ms each way. The session check's answer is read ~40 ms after the request lands (storage read). */
function sameWifi() {
  world.latency = { getTime: [15, 15], getMetronome: [15, 15], putMetronome: [15, 15] };
  world.serverWork = { getMetronome: 40 };
}

/** Opens the panel on a running 120/4 session (2 s bars) a bandmate leads, and taps Join. */
async function join() {
  await w.other({ bpm: 120, beatsPerBar: 4, running: true, leader: "bandmate-phone" });
  render(<SongMetronome song={w.song} onSongChange={() => {}} />);
  await advance(1000, 5);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(500, 5);
  return { ctx: FakeAudioContext.instances[0], s: (await w.stored()) as MetroSession };
}

describe("a joining phone plays by the clock alone", () => {
  it("on symmetric Wi-Fi it plays every downbeat within 5 ms of the grid for over 4 minutes", async () => {
    sameWifi();
    const { ctx, s } = await join();
    const fromS = ctx.currentTime;
    // Steps of 5 ms divide every network leg, so the virtual clock reads exact send and receive times.
    // Long enough for the first round of time calls (taken when the panel opened) to age out.
    await advance(250_000, 5);
    const errs = downbeatErrorsMs(ctx, s, fromS, ctx.currentTime);
    expect(errs.length).toBeGreaterThan(120);
    const worst = Math.max(...errs.map(Math.abs));
    console.log(`[join] worst downbeat error over 250 s: ${worst} ms`);
    expect(worst).toBeLessThan(5);
    // By the clock alone: it never asked for the mic.
    expect(world.micRequests).toBe(0);
  }, 30_000);
});

describe("a Nudge change", () => {
  it("a 5 ms change moves the downbeats 5 ms from the next bar", async () => {
    sameWifi();
    const { ctx, s } = await join();
    await advance(10_000, 5);
    const before = downbeatErrorsMs(ctx, s, ctx.currentTime - 6, ctx.currentTime);
    expect(before.every((e) => e === 0)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Adjust timing" }));
    // + means "this phone sounds late": it plays 5 ms earlier.
    fireEvent.change(screen.getByRole("slider", { name: "Nudge" }), { target: { value: "5" } });
    const changedS = ctx.currentTime;
    await advance(12_000, 5);
    // From the next bar line at least 100 ms ahead (2 s bars), every downbeat is 5 ms early.
    const after = downbeatErrorsMs(ctx, s, changedS + 2.1, ctx.currentTime);
    expect(after.length).toBeGreaterThan(4);
    expect(after.every((e) => e === -5)).toBe(true);
  });
});
