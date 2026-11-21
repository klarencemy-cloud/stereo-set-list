// @vitest-environment jsdom
// C. Drift, flams, pops (H7, H9), and the 10 ms re-align check.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome from "../../src/app/components/SongMetronome";
import { useClockSync } from "../../src/app/metronome/useClockSync";
import type { MetroSession } from "../../src/shared/metronome";
import { advance, FakeAudioContext, heard, rng, serverNow, setHidden, setupWorld, sleepPhone, teardownWorld, world } from "./harness";

let w: Awaited<ReturnType<typeof setupWorld>>;
beforeEach(async () => {
  w = await setupWorld();
});
afterEach(teardownWorld);

/** Joined to a running 120/4 session (2 s bars). */
async function joined() {
  await w.other({ bpm: 120, beatsPerBar: 4, running: true });
  render(<SongMetronome song={w.song} onSongChange={() => {}} />);
  await advance(100, 10);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  await advance(3000, 10);
  return { ctx: FakeAudioContext.instances[0], s: (await w.stored()) as MetroSession };
}

/** How far (ms, + = late) each heard downbeat is from the true grid. */
function barErrorsMs(ctx: FakeAudioContext, s: MetroSession, fromS: number, toS: number) {
  const barMs = (s.beatsPerBar * 60000) / s.bpm;
  return heard(ctx, fromS, toS)
    .filter((h) => h.accent)
    .map((h) => {
      const d = (((ctx.serverAtAudio(h.t) - s.startAt) % barMs) + barMs) % barMs;
      return Math.round((d > barMs / 2 ? d - barMs : d) * 10) / 10;
    });
}

/** Problems a listener hears: a click cut short, or two onsets closer than 30 ms (a flam). */
function glitches(ctx: FakeAudioContext, fromS: number, toS: number) {
  const h = heard(ctx, fromS, toS);
  const out: string[] = [];
  h.forEach((x, i) => {
    if (x.cut) out.push(`cut click at ${x.t.toFixed(3)} s`);
    if (i > 0 && x.t - h[i - 1].t < 0.03) out.push(`flam: onsets ${Math.round((x.t - h[i - 1].t) * 1000)} ms apart at ${x.t.toFixed(3)} s`);
  });
  return out;
}

describe("H7: performance.now() pausing while the server's clock runs (device sleep)", () => {
  it("H7 fixed: after waking, the pre-sleep samples are dropped and a fresh round puts the clicks back in time", async () => {
    world.latency = { getTime: [10, 10], getMetronome: [10, 10], putMetronome: [10, 10] };
    const { ctx, s } = await joined();
    expect(barErrorsMs(ctx, s, ctx.currentTime, ctx.currentTime + 4).every((e) => Math.abs(e) < 2)).toBe(true);
    setHidden(true);
    await advance(5000, 50);
    // Asleep: this phone's performance.now() (and audio clock) stood still while 30.25 s passed on the server.
    sleepPhone(30_250);
    // The network is slower after waking (4G instead of Wi-Fi), so every fresh sample is slower than the old ones.
    world.latency = { getTime: [100, 100], getMetronome: [100, 100], putMetronome: [100, 100] };
    setHidden(false);
    await advance(5000, 10);
    const errs = barErrorsMs(ctx, s, ctx.currentTime, ctx.currentTime + 6);
    console.log(`[H7] downbeat errors after waking (ms): ${errs.join(", ")}`);
    expect(errs.every((e) => Math.abs(e) < 5)).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(/^Synced$/);
  });

  it("H7 fixed: with equal network round trips the newest sample wins, so at 100 ppm drift each round lands fresh", async () => {
    world.driftPpm = 100;
    world.latency = { getTime: [0, 0] }; // every sample has the same (zero) network round trip: a tie
    const { result } = renderHook(() => useClockSync(true));
    const errMs = () => result.current.offsetMs - (serverNow() - world.perf);
    // Just before the round at 240 s, the estimate is a minute old: at 100 ppm it is 6 ms behind (drift isn't
    // applied between rounds, as in the old build).
    await advance(239_500, 500);
    const staleMs = errMs();
    // Just after it, the newest of the tied samples is in use, not one from 3 minutes ago (18 ms behind).
    await advance(1000, 500);
    console.log(`[H7] offset error at +100 ppm: ${staleMs.toFixed(1)} ms before the 240 s round, ${errMs().toFixed(1)} ms after`);
    expect(Math.abs(errMs())).toBeLessThan(1);
  });
});

/** Counts re-alignments (a fresh loop booked for the same grid) over `seconds`, with getOutputTimestamp jitter. */
async function realignsWithJitter(jitterMs: number, seconds: number, seed = 1) {
  const r = rng(seed);
  FakeAudioContext.outputTimestampJitter = () => (r() * 2 - 1) * jitterMs;
  world.latency = { getTime: [0, 0], getMetronome: [0, 0], putMetronome: [0, 0] };
  const { ctx } = await joined();
  const before = ctx.loops.length;
  const t0 = ctx.currentTime;
  await advance(seconds * 1000, 25);
  return { realigns: ctx.loops.length - before, glitches: glitches(ctx, t0, ctx.currentTime) };
}

describe("the 10 ms re-align check (no smoothing)", () => {
  it("±5 ms of getOutputTimestamp jitter never re-aligns the loop", async () => {
    const { realigns } = await realignsWithJitter(5, 60);
    expect(realigns).toBe(0);
  });

  it("a real 30 ms jump of the audio clock is corrected once, at a bar line", async () => {
    world.latency = { getTime: [0, 0], getMetronome: [0, 0], putMetronome: [0, 0] };
    const { ctx, s } = await joined();
    await advance(10_000, 25);
    const before = ctx.loops.length;
    ctx.skewS -= 0.03; // the audio clock falls 30 ms behind: the loop now plays 30 ms late
    await advance(4000, 25);
    expect(ctx.loops.length).toBe(before + 1);
    await advance(10_000, 25);
    expect(ctx.loops.length).toBe(before + 1);
    const errs = barErrorsMs(ctx, s, ctx.currentTime, ctx.currentTime + 6);
    expect(errs.every((e) => Math.abs(e) < 2)).toBe(true);
  });
});

describe("H9: re-aligning a loop that runs early finishes its bar first", () => {
  it("H9 fixed: the audio clock jumps 30 ms ahead; the re-align neither cuts the old downbeat nor plays a second one", async () => {
    world.latency = { getTime: [0, 0], getMetronome: [0, 0], putMetronome: [0, 0] };
    const { ctx } = await joined();
    const t0 = ctx.currentTime;
    ctx.skewS += 0.03;
    await advance(6000, 25);
    const g = glitches(ctx, t0, ctx.currentTime);
    console.log(`[H9] after a 30 ms early jump: ${g.join("; ") || "clean"}`);
    expect(g).toEqual([]);
  });

  it("H9 fixed soak: an audio clock 100 ppm fast re-aligns without a flam or a cut click (T4)", async () => {
    world.latency = { getTime: [0, 0], getMetronome: [0, 0], putMetronome: [0, 0] };
    const { ctx } = await joined();
    ctx.rate = 1e-4;
    const t0 = ctx.currentTime;
    await advance(250_000, 25);
    const g = glitches(ctx, t0, ctx.currentTime);
    console.log(`[H9] 250 s with the audio clock +100 ppm: ${ctx.loops.length - 1} re-alignments; ${g.join("; ") || "clean"}`);
    expect(g).toEqual([]);
  });

  it("H9 regression: a loop that runs LATE (audio clock 100 ppm slow) re-aligns cleanly", async () => {
    world.latency = { getTime: [0, 0], getMetronome: [0, 0], putMetronome: [0, 0] };
    const { ctx } = await joined();
    ctx.rate = -1e-4;
    const t0 = ctx.currentTime;
    await advance(250_000, 25);
    expect(ctx.loops.length).toBeGreaterThan(1); // it did re-align
    expect(glitches(ctx, t0, ctx.currentTime)).toEqual([]);
  });
});


