// Server side of the synced metronome (H5, H17, H18, H20), on memoryKV with makeMetronomeHandler.
import { describe, it, expect } from "vitest";
import { memoryKV } from "../../netlify/functions/lib/kv";
import { makeRepo, METRO_STALE_MS } from "../../netlify/functions/lib/repo";
import { makeMetronomeHandler } from "../../netlify/functions/metronome";
import { routeFor } from "../../src/sw/strategy";
import { LEAD_MS, type MetroAnswer, type MetroSession } from "../../src/shared/metronome";

const U = "http://localhost";
const req = (method: string, path: string, body?: unknown) =>
  new Request(U + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function setup() {
  const repo = makeRepo(memoryKV());
  const clock = { now: Date.UTC(2026, 10, 15, 18) };
  const metro = makeMetronomeHandler(repo, () => clock.now);
  const song = await repo.createSong({
    title: "Song", artist: "Band", sourceUrl: null, originalKey: "C", bandKey: "C", capo: 0, content: "", bpm: null, beatsPerBar: null,
  });
  const put = async (body: unknown) =>
    ((await (await metro(req("PUT", `/api/metronome/${song.id}`, body))).json()) as MetroAnswer).session as MetroSession;
  const putAnswer = async (body: unknown) =>
    (await (await metro(req("PUT", `/api/metronome/${song.id}`, body))).json()) as MetroAnswer;
  const get = async () => ((await (await metro(req("GET", `/api/metronome/${song.id}`))).json()) as MetroAnswer).session;
  /** A joined phone's check: it also marks the session seen. */
  const check = async () =>
    ((await (await metro(req("GET", `/api/metronome/${song.id}?seen=1`))).json()) as MetroAnswer).session;
  return { repo, clock, put, putAnswer, get, check, id: song.id };
}

describe("H5: two phones change it at the same moment", () => {
  it("H5: Stop for everyone sent at the same moment as a tempo change wins; it ends stopped", async () => {
    const { clock, put, get } = await setup();
    await put({ bpm: 120, beatsPerBar: 4, running: true });
    clock.now += 10_000;
    // Two function invocations at once: both read the running session before either writes.
    const [stopAnswer, tempoAnswer] = await Promise.all([put({ running: false }), put({ bpm: 140 })]);
    console.log(`[H5] answers: stopper got running=${stopAnswer.running}; tempo phone got running=${tempoAnswer.running}`);
    expect((await get())!.running).toBe(false);
  });

  it("H5: two tempo changes at the same moment both apply, in arrival order", async () => {
    const { clock, put, get } = await setup();
    await put({ bpm: 120, beatsPerBar: 4, running: true });
    clock.now += 10_000;
    await Promise.all([put({ bpm: 130 }), put({ bpm: 140 })]);
    expect((await get())!.bpm).toBe(140);
  });

  it("H5: a beats-per-bar change and a tempo change at the same moment both apply", async () => {
    const { clock, put, get } = await setup();
    await put({ bpm: 120, beatsPerBar: 4, running: true });
    clock.now += 10_000;
    await Promise.all([put({ beatsPerBar: 3 }), put({ bpm: 140 })]);
    const s = (await get())!;
    expect({ bpm: s.bpm, beatsPerBar: s.beatsPerBar, running: s.running }).toEqual({ bpm: 140, beatsPerBar: 3, running: true });
  });

  it("H5: a conflict that outlasts the retries is a 409 with the latest session, and nothing is written", async () => {
    const kv = memoryKV();
    const repo = makeRepo({ ...kv, setTextIfMatch: async () => false }); // someone else always writes first
    const now = Date.UTC(2026, 10, 15, 18);
    const metro = makeMetronomeHandler(repo, () => now);
    const song = await repo.createSong({
      title: "Song", artist: "Band", sourceUrl: null, originalKey: "C", bandKey: "C", capo: 0, content: "", bpm: null, beatsPerBar: null,
    });
    await metro(req("PUT", `/api/metronome/${song.id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    const res = await metro(req("PUT", `/api/metronome/${song.id}`, { running: false }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { message: string; current: MetroSession };
    expect(body.current).toMatchObject({ bpm: 120, running: true });
    expect((await repo.getMetronome(song.id, now))!.running).toBe(true);
  });

  it("H5 regression: a stop and a tempo change one after the other leave it stopped, in either order", async () => {
    const a = await setup();
    await a.put({ bpm: 120, beatsPerBar: 4, running: true });
    await a.put({ running: false });
    await a.put({ bpm: 140 });
    expect((await a.get())!.running).toBe(false);
    const b = await setup();
    await b.put({ bpm: 120, beatsPerBar: 4, running: true });
    await b.put({ bpm: 140 });
    await b.put({ running: false });
    expect((await b.get())!.running).toBe(false);
  });
});

describe("H17: a running session nobody changes for 2 h", () => {
  it("H17: keeps running past 2 h while a joined phone checks it", async () => {
    const { clock, put, check } = await setup();
    await put({ bpm: 120, beatsPerBar: 4, running: true });
    // A joined phone's checks mark the session seen; here sampled every 10 min.
    for (let t = 0; t < METRO_STALE_MS; t += 600_000) {
      clock.now += 600_000;
      await check();
    }
    clock.now += 1000;
    expect((await check())!.running).toBe(true);
  });

  // Replaces "BUG H17: pressing Start for everyone again at the same tempo doesn't keep it alive either". In the
  // decided design a session is kept alive by joined phones checking it (seen-at), not by pressing Start again.
  it("H17: pressing Start again doesn't keep it alive by itself; a joined phone's check does", async () => {
    const pressed = await setup();
    await pressed.put({ bpm: 120, beatsPerBar: 4, running: true });
    pressed.clock.now += METRO_STALE_MS - 60_000;
    await pressed.put({ bpm: 120, beatsPerBar: 4, running: true }); // same tempo: nothing changes
    pressed.clock.now += 120_000;
    expect((await pressed.get())!.running).toBe(false);

    const joined = await setup();
    await joined.put({ bpm: 120, beatsPerBar: 4, running: true });
    joined.clock.now += METRO_STALE_MS - 60_000;
    await joined.check();
    joined.clock.now += 120_000;
    expect((await joined.get())!.running).toBe(true);
  });
});

describe("H18: Start for everyone while it is already running", () => {
  it("H18: a start 'only if stopped' leaves a running session as it is (tempo, start, leader) and answers 'not applied'", async () => {
    const { clock, put, putAnswer, get } = await setup();
    const first = await put({ bpm: 120, beatsPerBar: 4, running: true, leader: "drummer" });
    clock.now += 3000;
    const answer = await putAnswer({ bpm: 96, beatsPerBar: 3, running: true, leader: "late-phone", onlyIfStopped: true });
    expect(answer.applied).toBe(false);
    expect(answer.session).toEqual(first);
    expect(await get()).toEqual(first);
  });

  it("H18: a start 'only if stopped' from stopped is applied, and the starter leads", async () => {
    const { clock, put, putAnswer } = await setup();
    await put({ bpm: 120, beatsPerBar: 4, running: true, leader: "drummer" });
    await put({ running: false });
    clock.now += 3000;
    const answer = await putAnswer({ bpm: 96, beatsPerBar: 3, running: true, leader: "late-phone", onlyIfStopped: true });
    expect(answer.applied).toBe(true);
    expect(answer.session).toMatchObject({ bpm: 96, beatsPerBar: 3, running: true, leader: "late-phone", startAt: clock.now + LEAD_MS });
  });

  it("H18: a start 'only if stopped' over a forgotten (stale) session is applied", async () => {
    const { clock, put, putAnswer } = await setup();
    await put({ bpm: 120, beatsPerBar: 4, running: true, leader: "drummer" });
    clock.now += METRO_STALE_MS + 1000;
    const answer = await putAnswer({ bpm: 96, beatsPerBar: 3, running: true, leader: "late-phone", onlyIfStopped: true });
    expect(answer.applied).toBe(true);
    expect(answer.session).toMatchObject({ bpm: 96, running: true, leader: "late-phone" });
  });

  it("H18: two 'only if stopped' starts at the same moment: one is applied, the other gets it as 'not applied'", async () => {
    const { putAnswer, get } = await setup();
    const [a, b] = await Promise.all([
      putAnswer({ bpm: 120, beatsPerBar: 4, running: true, leader: "a", onlyIfStopped: true }),
      putAnswer({ bpm: 96, beatsPerBar: 3, running: true, leader: "b", onlyIfStopped: true }),
    ]);
    expect([a.applied, b.applied].sort()).toEqual([false, true]);
    const won = a.applied ? a : b;
    expect((a.applied ? b : a).session).toEqual(won.session);
    expect(await get()).toEqual(won.session);
  });
});

describe("H20: the service worker never answers the metronome from a cache", () => {
  const origin = "https://band.example";
  it.each([
    ["GET", "/api/time"],
    ["GET", "/api/metronome/abc"],
    ["PUT", "/api/metronome/abc"],
  ])("refuted: %s %s passes straight to the network", (method, path) => {
    expect(routeFor(method, new URL(origin + path), false, origin)).toBe("pass");
  });
});
