import { describe, expect, it } from "vitest";
import { memoryKV } from "../../netlify/functions/lib/kv";
import { makeRepo, METRO_STALE_MS, NotFoundError } from "../../netlify/functions/lib/repo";
import { makeMetronomeHandler } from "../../netlify/functions/metronome";
import { makeTimeHandler } from "../../netlify/functions/time";
import { makeSongsHandler } from "../../netlify/functions/songs";
import type { SongInput } from "../../src/shared/types";

const U = "http://localhost";
const req = (method: string, path: string, body?: unknown) =>
  new Request(U + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const songBody: SongInput = {
  title: "Song", artist: "Band", sourceUrl: null, originalKey: "C", bandKey: "C", capo: 0, content: "", bpm: null, beatsPerBar: null,
};

async function setup() {
  const kv = memoryKV();
  const repo = makeRepo(kv);
  const clock = { now: 1_000_000 };
  const metro = makeMetronomeHandler(repo, () => clock.now);
  const songs = makeSongsHandler(repo);
  const song = await repo.createSong(songBody);
  return { kv, repo, clock, metro, songs, id: song.id };
}

describe("time API", () => {
  it("returns the server clock, never cached", async () => {
    const handler = makeTimeHandler(() => 12345);
    const res = await handler(req("GET", "/api/time"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ now: 12345 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("only answers GET", async () => {
    expect((await makeTimeHandler(() => 1)(req("POST", "/api/time", {}))).status).toBe(405);
  });
});

describe("metronome API", () => {
  it("has no session until someone starts one", async () => {
    const { metro, id } = await setup();
    const res = await metro(req("GET", `/api/metronome/${id}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("starts 2 s ahead on the server clock, and everyone reads the same session", async () => {
    const { metro, id } = await setup();
    const put = await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    expect(put.status).toBe(200);
    const started = await put.json();
    expect(started).toMatchObject({ bpm: 120, beatsPerBar: 4, startAt: 1_002_000, running: true });
    expect(await (await metro(req("GET", `/api/metronome/${id}`))).json()).toEqual(started);
  });

  it("puts a tempo change on the next bar line and stops on request", async () => {
    const { metro, clock, id } = await setup();
    await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    clock.now = 1_010_100; // bars of 2000 ms from 1 002 000; now + lead = 1 012 100
    const changed = await (await metro(req("PUT", `/api/metronome/${id}`, { bpm: 90 }))).json();
    expect(changed).toMatchObject({ bpm: 90, beatsPerBar: 4, startAt: 1_014_000, running: true });
    const stopped = await (await metro(req("PUT", `/api/metronome/${id}`, { running: false }))).json();
    expect(stopped).toMatchObject({ running: false, bpm: 90 });
  });

  it.each([
    [{}],
    [{ bpm: 29 }],
    [{ bpm: 301 }],
    [{ bpm: 100.5 }],
    [{ bpm: "100" }],
    [{ beatsPerBar: 8 }],
    [{ running: "yes" }],
    [{ running: true, leader: 5 }],
    [{ running: true, leader: "" }],
    [{ running: true, leader: "x".repeat(65) }],
    [{ leader: "phone-a" }],
  ])("refuses %o", async (body) => {
    const { metro, id } = await setup();
    await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    const res = await metro(req("PUT", `/api/metronome/${id}`, body));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBeTruthy();
  });

  it("keeps the leader that started it, and everyone reads it", async () => {
    const { metro, clock, id } = await setup();
    const put = await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true, leader: "phone-a" }));
    expect(await put.json()).toMatchObject({ leader: "phone-a" });
    clock.now += 5000;
    const changed = await (await metro(req("PUT", `/api/metronome/${id}`, { bpm: 90 }))).json();
    expect(changed.leader).toBe("phone-a");
    expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).leader).toBe("phone-a");
  });

  it("reads a session stored before leaders existed, or with a bad leader, as having none", async () => {
    const { kv, metro, repo, id } = await setup();
    const base = { bpm: 120, beatsPerBar: 4, startAt: 1_002_000, running: true, updatedAt: new Date(1_000_000).toISOString() };
    for (const stored of [base, { ...base, leader: 42 }, { ...base, leader: "x".repeat(500) }, { ...base, extra: "junk" }]) {
      await kv.setText(`metronome/${id}`, JSON.stringify(stored));
      const got = await (await metro(req("GET", `/api/metronome/${id}`))).json();
      expect(got).toEqual(base);
      // Every read path agrees: a change read back through setMetronome is normalised the same way.
      const set = await repo.setMetronome(id, { beatsPerBar: 4 }, 1_000_100);
      expect(set).toEqual(base);
    }
  });

  it("needs a tempo to start the first session (no made-up default)", async () => {
    const { metro, id } = await setup();
    const res = await metro(req("PUT", `/api/metronome/${id}`, { running: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/bpm/);
  });

  it("stopping when nothing is running changes nothing", async () => {
    const { metro, id } = await setup();
    const res = await metro(req("PUT", `/api/metronome/${id}`, { running: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("404 for a song that doesn't exist, for bad paths and 405 for other methods", async () => {
    const { metro, id } = await setup();
    expect((await metro(req("GET", "/api/metronome/nope"))).status).toBe(404);
    expect((await metro(req("PUT", "/api/metronome/nope", { bpm: 100, beatsPerBar: 4, running: true }))).status).toBe(404);
    expect((await metro(req("GET", "/api/metronome"))).status).toBe(404);
    expect((await metro(req("GET", `/api/metronome/${id}/x`))).status).toBe(404);
    expect((await metro(req("DELETE", `/api/metronome/${id}`))).status).toBe(405);
  });

  it("deleting the song deletes its session", async () => {
    const { metro, songs, kv, id } = await setup();
    await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    expect(await kv.getText(`metronome/${id}`)).not.toBeNull();
    expect((await songs(req("DELETE", `/api/songs/${id}`))).status).toBe(204);
    expect(await kv.getText(`metronome/${id}`)).toBeNull();
  });

  it("deleting a recording deletes its song's session", async () => {
    const { kv, repo, clock } = await setup();
    const t = await repo.createTrack({ title: "Demo", size: 10 });
    await repo.putTrackPart(t.id, 0, new Uint8Array(10).buffer as ArrayBuffer);
    const songId = (await repo.getTrack(t.id))!.songId!;
    await repo.setMetronome(songId, { bpm: 100, beatsPerBar: 4, running: true }, clock.now);
    await repo.deleteTrack(t.id);
    expect(await kv.getText(`metronome/${songId}`)).toBeNull();
  });

  it("reads only the session when there is one", async () => {
    const kv = memoryKV();
    const reads: string[] = [];
    const counted = { ...kv, getText: async (k: string) => (reads.push(k), kv.getText(k)) };
    const repo = makeRepo(counted);
    const song = await repo.createSong(songBody);
    await repo.setMetronome(song.id, { bpm: 120, beatsPerBar: 4, running: true }, 1_000_000);
    reads.length = 0;
    expect(await repo.getMetronome(song.id, 1_000_500)).toMatchObject({ bpm: 120 });
    expect(reads).toEqual([`metronome/${song.id}`]);
  });

  it("still says 404 for an unknown song and null for a song with no session", async () => {
    const { repo, id } = await setup();
    await expect(repo.getMetronome("nope", 1)).rejects.toThrow(NotFoundError);
    expect(await repo.getMetronome(id, 1)).toBeNull();
  });

  it("reads a running session nobody touched for METRO_STALE_MS as stopped", async () => {
    const { metro, clock, id } = await setup();
    await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    clock.now += METRO_STALE_MS - 1;
    expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(true);
    clock.now += 2;
    expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(false);
    // A tempo change on a forgotten session doesn't restart it; Start does, from now.
    expect((await (await metro(req("PUT", `/api/metronome/${id}`, { bpm: 80 }))).json()).running).toBe(false);
    const restarted = await (await metro(req("PUT", `/api/metronome/${id}`, { running: true }))).json();
    expect(restarted).toMatchObject({ running: true, bpm: 80, startAt: clock.now + 2000 });
  });

  it("treats a session nobody changed for 2 hours as stopped", async () => {
    const { metro, clock, id } = await setup();
    await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    clock.now += 2 * 60 * 60 * 1000 - 1;
    expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(true);
    clock.now += 2;
    expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(false);
  });

  it("restarts the 2 hours on every change", async () => {
    const { metro, clock, id } = await setup();
    await metro(req("PUT", `/api/metronome/${id}`, { bpm: 120, beatsPerBar: 4, running: true }));
    clock.now += 90 * 60 * 1000;
    await metro(req("PUT", `/api/metronome/${id}`, { bpm: 100 }));
    clock.now += 90 * 60 * 1000;
    expect((await (await metro(req("GET", `/api/metronome/${id}`))).json()).running).toBe(true);
  });
});
