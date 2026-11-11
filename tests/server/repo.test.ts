import { describe, expect, it } from "vitest";
import { memoryKV } from "../../netlify/functions/lib/kv";
import { makeRepo, ValidationError } from "../../netlify/functions/lib/repo";
import type { SongInput } from "../../src/shared/types";

const song = (over: Partial<SongInput> = {}): SongInput => ({
  title: "Wonderwall",
  artist: "Oasis",
  sourceUrl: null,
  originalKey: "Em",
  bandKey: "Em",
  capo: 0,
  content: "[Em]Today is gonna be",
  ...over,
});

const bytes = (n: number) => new Uint8Array(n).buffer as ArrayBuffer;

describe("songs", () => {
  it("create, list, update bandKey, get", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(song());
    expect((await repo.listSongs()).map((x) => x.id)).toEqual([s.id]);
    await new Promise((r) => setTimeout(r, 5));
    const u = await repo.updateSong(s.id, { bandKey: "Gm" });
    const got = await repo.getSong(s.id);
    expect(got?.bandKey).toBe("Gm");
    expect(got!.updatedAt > s.updatedAt).toBe(true);
    expect(u.bandKey).toBe("Gm");
  });

  it("sorts by title case-insensitively", async () => {
    const repo = makeRepo(memoryKV());
    await repo.createSong(song({ title: "banana" }));
    await repo.createSong(song({ title: "Apple" }));
    await repo.createSong(song({ title: "cherry" }));
    expect((await repo.listSongs()).map((s) => s.title)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("returns null for missing, throws on missing mutation", async () => {
    const repo = makeRepo(memoryKV());
    expect(await repo.getSong("nope")).toBeNull();
    await expect(repo.updateSong("nope", {})).rejects.toThrow("not found");
  });
});

describe("gigs", () => {
  it("deleteSong removes the id from gigs", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(song());
    const g = await repo.createGig({ name: "Pub", date: "2026-12-01", songIds: [s.id] });
    await repo.deleteSong(s.id);
    const got = await repo.getGig(g.id);
    expect(got).not.toBeNull();
    expect(got!.songIds).toEqual([]);
  });

  it("getGig drops song ids removed straight from the KV", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const a = await repo.createSong(song({ title: "A" }));
    const b = await repo.createSong(song({ title: "B" }));
    const g = await repo.createGig({ name: "Pub", date: "2026-12-01", songIds: [a.id, b.id] });
    await kv.delete(`songs/${a.id}`);
    expect((await repo.getGig(g.id))!.songIds).toEqual([b.id]);
  });

  it("lists newest date first", async () => {
    const repo = makeRepo(memoryKV());
    await repo.createGig({ name: "Nov", date: "2026-11-20", songIds: [] });
    await repo.createGig({ name: "Dec", date: "2026-12-01", songIds: [] });
    expect((await repo.listGigs()).map((g) => g.date)).toEqual(["2026-12-01", "2026-11-20"]);
  });
});

describe("tracks", () => {
  it("only lists fully uploaded tracks and validates", async () => {
    const repo = makeRepo(memoryKV());
    const t = await repo.createTrack({ title: "Demo", size: 7_000_000 });
    expect(t.parts).toBe(3);
    await repo.putTrackPart(t.id, 0, bytes(3_145_728));
    await repo.putTrackPart(t.id, 1, bytes(3_145_728));
    expect(await repo.listTracks()).toEqual([]);
    await repo.putTrackPart(t.id, 2, bytes(100));
    expect((await repo.listTracks()).map((x) => x.id)).toEqual([t.id]);
    await expect(repo.putTrackPart(t.id, 3, bytes(1))).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.putTrackPart(t.id, 0, bytes(3_145_729))).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.createTrack({ title: "Big", size: 26_214_401 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("re-uploading a part does not double count; delete removes parts", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const t = await repo.createTrack({ title: "Demo", size: 10 });
    await repo.putTrackPart(t.id, 0, bytes(10));
    await repo.putTrackPart(t.id, 0, bytes(10));
    expect((await repo.listTracks())[0].uploadedParts).toBe(1);
    expect(await repo.getTrackPart(t.id, 0)).not.toBeNull();
    await repo.deleteTrack(t.id);
    expect(await repo.getTrackPart(t.id, 0)).toBeNull();
    expect(await kv.list("tracks/")).toEqual([]);
  });

  it("counts parts correctly when uploaded concurrently", async () => {
    const repo = makeRepo(memoryKV());
    const t = await repo.createTrack({ title: "Demo", size: 7_000_000 });
    await Promise.all([0, 1, 2].map((n) => repo.putTrackPart(t.id, n, bytes(100))));
    const tracks = await repo.listTracks();
    expect(tracks.map((x) => x.id)).toEqual([t.id]);
    expect(tracks[0].uploadedParts).toBe(3);
  });
});
