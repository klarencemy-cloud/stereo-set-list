// @vitest-environment jsdom
// D. Silent failure (H12, H17, H21, and H22 found while testing). Target T5: when sync or sound is lost, the
// screen says so within 2 s.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome from "../../src/app/components/SongMetronome";
import { METRO_STALE_MS } from "../../netlify/functions/lib/repo";
import { advance, FakeAudioContext, heard, serverNow, setHidden, setupWorld, soundingAt, teardownWorld, world } from "./harness";

const OFFLINE = "Can't sync: playing on this phone only";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeEach(async () => {
  w = await setupWorld();
  world.latency = { getTime: [10, 10], getMetronome: [10, 10], putMetronome: [10, 10] };
});
afterEach(teardownWorld);

async function joined() {
  await w.other({ bpm: 120, beatsPerBar: 4, running: true });
  render(<SongMetronome song={w.song} onSongChange={() => {}} />);
  await advance(100, 10);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(3000, 10);
  return FakeAudioContext.instances[0];
}

/** Which beat dot is lit now. */
const lit = () => Array.from(document.querySelectorAll(".metro-dot")).findIndex((d) => d.classList.contains("lit"));

/** Any on-screen hint that this phone has no sound. */
const soundWarning = () => screen.queryByText(/no sound|tap to (resume|unmute)|sound (is )?(off|paused)|audio/i);

describe("H12: the audio context is suspended or interrupted (call, Siri, another app)", () => {
  it.fails("BUG H12: the flash keeps going with no sound and nothing on screen says so", async () => {
    const ctx = await joined();
    // A phone call: iOS interrupts the context, and resume() without a fresh tap is refused.
    ctx.resumeBlocked = true;
    ctx.freeze("interrupted");
    setHidden(true);
    await advance(1000, 50);
    setHidden(false); // back to the page: it calls resume(), which is refused
    const seen = new Set<number>();
    for (let i = 0; i < 80; i++) {
      await advance(25, 25);
      seen.add(lit());
    }
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.state).toBe("interrupted");
    expect(seen.size).toBeGreaterThan(1); // the flash is still moving
    expect(soundWarning()).not.toBeNull();
  });

  it("H12 measure: what the booking does while the audio clock is frozen (logged)", async () => {
    const ctx = await joined();
    const before = ctx.loops.length;
    ctx.resumeBlocked = true;
    ctx.freeze("suspended");
    await advance(10_000, 25);
    const frozen = ctx.loops.length - before;
    ctx.resumeBlocked = false;
    await ctx.resume();
    const t = ctx.currentTime;
    await advance(6000, 25);
    console.log(
      `[H12] 10 s frozen: ${frozen} loop(s) booked while frozen; after resuming, ${ctx.loops.length - before - frozen} more, ` +
        `${heard(ctx, t, ctx.currentTime).filter((h) => h.cut).length} cut clicks`,
    );
    expect(frozen).toBeGreaterThanOrEqual(0);
  });
});

describe("H21: offline, then back online", () => {
  it.fails("BUG H21: 'Try syncing again' does nothing visible for up to 10 s", async () => {
    world.offline = true;
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(100, 10);
    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    world.offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Try syncing again" }));
    await advance(2000, 10);
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });

  it.fails("BUG H21: the network coming back stops the local metronome that is playing, without a tap", async () => {
    world.offline = true;
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(100, 10);
    fireEvent.click(screen.getByRole("button", { name: "Start on this phone" }));
    await advance(500, 10);
    const ctx = FakeAudioContext.instances[0];
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(1);
    world.offline = false; // the Wi-Fi comes back mid-song
    await advance(11_000, 50);
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(1);
  });

  it("regression: when the clock can't sync, 'Try syncing again' offers Join at once once the network is back", async () => {
    await w.other({ bpm: 120, beatsPerBar: 4, running: true });
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(100, 10);
    world.offline = true;
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(500, 10);
    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    world.offline = false;
    await advance(1000, 10);
    fireEvent.click(screen.getByRole("button", { name: "Try syncing again" }));
    await advance(50, 10);
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("regression: a joined phone that loses the network keeps playing and says so within 2 s", async () => {
    const ctx = await joined();
    world.offline = true;
    await advance(2000, 10);
    expect(screen.getByText(/Can't reach the server/)).toBeInTheDocument();
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(1);
  });
});

describe("H22 (new): a request that never answers", () => {
  it("H22 fixed: after a hung poll (Wi-Fi up, no internet) the checks resume, and a later Stop silences the phone", async () => {
    const ctx = await joined();
    world.hang = true;
    await advance(3000, 10);
    world.hang = false; // the network is fine again
    const sent = world.sent.getMetronome;
    await w.other({ running: false }); // someone presses Stop for everyone
    await advance(10_000, 50);
    console.log(`[H22] checks sent in the 10 s after the network recovered: ${world.sent.getMetronome - sent}`);
    expect(world.sent.getMetronome - sent).toBeGreaterThan(0);
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(0);
    expect(screen.queryByText(/Can't reach the server/)).toBeNull();
  });

  it("while every request hangs, the status says it can't reach the server within about 5 s, and stops saying Synced", async () => {
    await joined();
    expect(screen.getByRole("status").textContent).toContain("Synced");
    world.hang = true;
    // At worst: the first hung check goes out 1.5 s in, the second 1.5 s later, and it gives up 2.5 s after that.
    await advance(5500, 10);
    expect(screen.getByRole("status").textContent).toMatch(/Can't reach the server/);
    expect(screen.getByRole("status").textContent).not.toMatch(/Synced/i);
  });

  it("one hung check alone says nothing: the next check goes out on time and its answer counts", async () => {
    await joined();
    world.hang = true;
    const sent = world.sent.getMetronome;
    while (world.sent.getMetronome === sent) await advance(10, 10);
    world.hang = false; // only that one check hangs
    let told = false;
    for (let i = 0; i < 80; i++) {
      await advance(50, 10);
      told ||= screen.queryByText(/Can't reach the server/) !== null;
    }
    expect(told).toBe(false);
    expect(world.sent.getMetronome - sent).toBeGreaterThanOrEqual(3); // ~1.5 s apart over 4 s, the hung one included
  });

  it("a slow check's late answer never overrides a newer check's answer", async () => {
    const ctx = await joined();
    // The next check is slow on the way back (it sees the session running); the ones after it are quick.
    let slow = true;
    world.latency.getMetronome = () => (slow ? ((slow = false), [10, 2000]) : [10, 10]);
    const sent = world.sent.getMetronome;
    while (world.sent.getMetronome === sent) await advance(5, 5);
    await advance(50, 10);
    await w.other({ running: false }); // Stop for everyone, after the slow check was served
    await advance(1650, 10); // the newer check (1.5 s after the slow one) has heard the Stop
    expect(world.sent.getMetronome - sent).toBe(2);
    const t = ctx.currentTime;
    // The slow answer lands ~2 s after it was sent; the check after that is due at 3 s.
    await advance(1100, 10);
    expect(world.sent.getMetronome - sent).toBe(2);
    expect(heard(ctx, t, ctx.currentTime)).toEqual([]);
    expect(screen.getByRole("button", { name: "Start for everyone" })).toBeInTheDocument();
  });
});

describe("H17: a session running at one tempo for 2 h", () => {
  it("H17: a joined phone keeps it running past 2 h; it doesn't stop mid-song", async () => {
    // Started 2 h minus 5 s ago (server time) and never changed since.
    await w.repo.setMetronome(w.song.id, { bpm: 120, beatsPerBar: 4, running: true }, serverNow() - METRO_STALE_MS + 5000);
    render(<SongMetronome song={w.song} onSongChange={() => {}} />);
    await advance(100, 10);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await advance(3000, 10);
    const ctx = FakeAudioContext.instances[0];
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(1);
    await advance(6000, 50);
    expect(soundingAt(ctx, ctx.currentTime)).toHaveLength(1);
  });
});
