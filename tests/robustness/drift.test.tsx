// @vitest-environment jsdom
// C. Drift, flams, pops (H7, H8, H9).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { ...actual.api, updateSong: vi.fn() } };
});

import SongMetronome from "../../src/app/components/SongMetronome";
import { useClockSync } from "../../src/app/metronome/useClockSync";
import type { MetroSession } from "../../src/shared/metronome";
import { advance, FakeAudioContext, heard, rng, serverNow, setHidden, setupWorld, teardownWorld, world } from "./harness";

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
  it.fails("BUG H7: after waking, the pre-sleep sample (fastest round trip) is kept, so the clicks are 250 ms off", async () => {
    world.latency = { getTime: [10, 10], getMetronome: [10, 10], putMetronome: [10, 10] };
    const { ctx, s } = await joined();
    expect(barErrorsMs(ctx, s, ctx.currentTime, ctx.currentTime + 4).every((e) => Math.abs(e) < 2)).toBe(true);
    setHidden(true);
    await advance(5000, 50);
    // Asleep: this phone's performance.now() (and audio clock) stood still while 30.25 s passed on the server.
    world.serverAhead += 30_250;
    world.latency.getTime = [100, 100]; // the network is slower after waking (4G instead of Wi-Fi)
    setHidden(false);
    await advance(5000, 10);
    const errs = barErrorsMs(ctx, s, ctx.currentTime, ctx.currentTime + 6);
    console.log(`[H7] downbeat errors after waking (ms): ${errs.join(", ")}; status says "${screen.getByRole("status").textContent}"`);
    expect(errs.every((e) => Math.abs(e) < 5)).toBe(true);
  });

  it.fails("BUG H7: with equal round trips the OLDEST sample wins, so at 100 ppm drift the estimate is ~18 ms stale", async () => {
    world.driftPpm = 100;
    world.latency = { getTime: [0, 0] }; // every sample has the same (zero) round trip: a tie
    const { result } = renderHook(() => useClockSync(true));
    await advance(239_000, 1000);
    const trueOffset = serverNow() - world.perf;
    const errMs = result.current.offsetMs - trueOffset;
    console.log(`[H7] offset error after 239 s at +100 ppm with tied round trips: ${errMs.toFixed(1)} ms`);
    expect(Math.abs(errMs)).toBeLessThan(5);
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

describe("H8: jitter in the audio link re-aligns the loop", () => {
  it("control: ±5 ms of getOutputTimestamp jitter never re-aligns", async () => {
    const { realigns } = await realignsWithJitter(5, 60);
    expect(realigns).toBe(0);
  });

  it("H8 fixed: ±15 ms of getOutputTimestamp jitter re-aligns the loop at most a few times in 60 s", async () => {
    for (const seed of [1, 2, 3]) {
      cleanup();
      teardownWorld();
      w = await setupWorld();
      const { realigns } = await realignsWithJitter(15, 60, seed);
      expect(realigns).toBeLessThanOrEqual(3);
    }
  });

  it("H8 regression: a real 30 ms jump of the audio clock is still corrected within a couple of bars, despite jitter", async () => {
    const r = rng(4);
    FakeAudioContext.outputTimestampJitter = () => (r() * 2 - 1) * 15;
    world.latency = { getTime: [0, 0], getMetronome: [0, 0], putMetronome: [0, 0] };
    const { ctx, s } = await joined();
    await advance(10_000, 25); // settled
    const before = ctx.loops.length;
    ctx.skewS -= 0.03; // the audio clock falls 30 ms behind: the loop now plays 30 ms late
    await advance(4000, 25); // two bars
    expect(ctx.loops.length).toBe(before + 1);
    await advance(10_000, 25); // and it stays put: one jump, one correction (each one can be heard)
    expect(ctx.loops.length).toBe(before + 1);
    const errs = barErrorsMs(ctx, s, ctx.currentTime, ctx.currentTime + 6);
    expect(errs.every((e) => Math.abs(e) < 8)).toBe(true);
  });

  it("H8 measure: re-alignments and audible glitches in 60 s against link jitter (logged)", async () => {
    const rows: string[] = [];
    for (const j of [0, 5, 8, 10, 12, 15, 20, 30]) {
      cleanup();
      teardownWorld();
      w = await setupWorld();
      const { realigns, glitches: g } = await realignsWithJitter(j, 60, 7);
      rows.push(`  ±${String(j).padStart(2)} ms: ${String(realigns).padStart(2)} re-alignments, ${g.length} cut clicks or flams`);
    }
    console.log(`[H8] 120 BPM 4/4, 60 s, uniform jitter on getOutputTimestamp().performanceTime:\n${rows.join("\n")}`);
    expect(rows).toHaveLength(8);
  }, 30_000); // 8 runs of 60 s each: near the 5 s default on a busy machine
});

describe("H9: re-aligning a loop that runs early cuts its bar-line click and flams", () => {
  it.fails("BUG H9: the audio clock jumps 30 ms ahead; the re-align cuts the old downbeat 30 ms in and plays a second one", async () => {
    world.latency = { getTime: [0, 0], getMetronome: [0, 0], putMetronome: [0, 0] };
    const { ctx } = await joined();
    const t0 = ctx.currentTime;
    ctx.skewS += 0.03;
    await advance(6000, 25);
    const g = glitches(ctx, t0, ctx.currentTime);
    console.log(`[H9] after a 30 ms early jump: ${g.join("; ") || "clean"}`);
    expect(g).toEqual([]);
  });

  it.fails("BUG H9 soak: an audio clock 100 ppm fast flams every ~100 s (T4)", async () => {
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


