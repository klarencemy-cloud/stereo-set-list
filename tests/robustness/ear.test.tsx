// @vitest-environment jsdom
// Matching the leader by ear (ADR 0001) in the test world: the real panel and the real listen() hear the leader's
// clicks through the world's fake mic. Only while the LISTEN_BY_EAR test switch is on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome, { ROUNDTRIP_KEY } from "../../src/app/components/SongMetronome";
import { LISTEN_BY_EAR } from "../../src/app/metronome/byEar";
import { advance, advanceUntil, FakeAudioContext, heard, setHidden, setupWorld, sleepPhone, teardownWorld, world } from "./harness";

/** Which beat dot is lit now. */
const lit = () => Array.from(document.querySelectorAll(".metro-dot")).findIndex((d) => d.classList.contains("lit"));

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

describe.runIf(LISTEN_BY_EAR)("a joining phone matches the leader by ear", () => {
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

  it("H7 fixed: a matched phone that slept listens again, flash still going, then is back in time", async () => {
    const ctx = await joinLed();
    await advanceUntil(() => status().startsWith("Matched to the band"), 10_000, 10);
    await advance(2000, 10);
    setHidden(true);
    await advance(3000, 50);
    sleepPhone(30_250); // half a beat off, if nothing re-lines it up
    setHidden(false);
    // It listens again, quiet for a few seconds, with the flash moving the whole time.
    const lastChange = { at: world.perf, dot: lit() };
    let longestStillMs = 0;
    let listenedFromS: number | null = null;
    await advanceUntil(
      () => {
        if (listenedFromS === null && status().startsWith("Listening to the band")) listenedFromS = ctx.currentTime;
        const listened = listenedFromS !== null;
        const dot = lit();
        if (dot !== lastChange.dot) Object.assign(lastChange, { at: world.perf, dot });
        longestStillMs = Math.max(longestStillMs, world.perf - lastChange.at);
        return listened && status().startsWith("Matched to the band");
      },
      10_000,
      10,
    );
    expect(longestStillMs).toBeLessThan(600); // a beat is 500 ms: the flash never stopped
    // Quiet while it listened, for about 3–4 s.
    const quietS = ctx.currentTime - listenedFromS!;
    expect(quietS).toBeGreaterThanOrEqual(3);
    expect(quietS).toBeLessThan(5);
    expect(heard(ctx, listenedFromS!, ctx.currentTime)).toEqual([]);
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

  it("H7: a matched phone that didn't sleep doesn't listen again", async () => {
    await joinLed();
    await advanceUntil(() => status().startsWith("Matched to the band"), 10_000, 10);
    await advance(2000, 10);
    setHidden(true);
    await advance(3000, 50);
    setHidden(false);
    for (let i = 0; i < 300; i++) {
      await advance(10, 10);
      expect(status()).toMatch(/^Matched to the band/);
    }
    // (The clock-only sync takes a round of time calls whenever the page is shown again; the match's offset is
    // frozen, so that round doesn't move it.)
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
