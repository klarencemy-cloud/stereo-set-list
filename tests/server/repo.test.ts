import { describe, expect, it } from "vitest";
import { memoryKV } from "../../netlify/functions/lib/kv";
import { makeRepo, NotFoundError, ValidationError } from "../../netlify/functions/lib/repo";
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

  it("listSongs returns summaries without content", async () => {
    const repo = makeRepo(memoryKV());
    await repo.createSong(song());
    const [s] = await repo.listSongs();
    expect(s).not.toHaveProperty("content");
    expect(s).toMatchObject({ title: "Wonderwall", artist: "Oasis", bandKey: "Em" });
  });

  it("keeps only known fields", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong({ ...song(), extra: "x", id: "forced" } as unknown as SongInput);
    expect(s).not.toHaveProperty("extra");
    expect(s.id).not.toBe("forced");
    const u = await repo.updateSong(s.id, { bandKey: "Am", junk: 1 } as unknown as Partial<SongInput>);
    expect(u).not.toHaveProperty("junk");
    expect(u.bandKey).toBe("Am");
  });

  it("rejects bad keys, types and sizes", async () => {
    const repo = makeRepo(memoryKV());
    const bad: Partial<Record<keyof SongInput, unknown>>[] = [
      { originalKey: "H" },
      { bandKey: "Emaj" },
      { originalKey: "" },
      { capo: 13 },
      { capo: 1.5 },
      { capo: "2" },
      { title: 5 },
      { artist: null },
      { sourceUrl: 7 },
      { title: "x".repeat(201) },
      { artist: "x".repeat(201) },
      { sourceUrl: "https://x/" + "a".repeat(500) },
      { content: "x".repeat(100_001) },
    ];
    for (const over of bad) {
      await expect(repo.createSong({ ...song(), ...over } as SongInput), JSON.stringify(over).slice(0, 40))
        .rejects.toBeInstanceOf(ValidationError);
    }
    const missing = song() as Partial<SongInput>;
    delete missing.content;
    await expect(repo.createSong(missing as SongInput)).rejects.toBeInstanceOf(ValidationError);

    const s = await repo.createSong(song());
    for (const over of bad) {
      await expect(repo.updateSong(s.id, over as Partial<SongInput>)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(repo.updateSong(s.id, { bandKey: undefined })).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.getSong(s.id))!.bandKey).toBe("Em");
  });

  it("accepts edge values", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(
      song({ title: "x".repeat(200), capo: 12, originalKey: "F#m", bandKey: "Bb", content: "x".repeat(100_000) }),
    );
    expect(s.capo).toBe(12);
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

  it("validates gig fields", async () => {
    const repo = makeRepo(memoryKV());
    const ok = { name: "Pub", date: "2026-12-01", songIds: [] as string[] };
    const bad: Record<string, unknown>[] = [
      { name: "x".repeat(201) },
      { name: 5 },
      { date: "2026-1-01" },
      { date: 20261201 },
      { songIds: [1] },
      { songIds: "a" },
      { songIds: Array.from({ length: 101 }, (_, i) => `s${i}`) },
    ];
    for (const over of bad) {
      await expect(repo.createGig({ ...ok, ...over } as never)).rejects.toBeInstanceOf(ValidationError);
    }
    const g = await repo.createGig({ ...ok, extra: 1 } as never);
    expect(g).not.toHaveProperty("extra");
    for (const over of bad) {
      await expect(repo.updateGig(g.id, over as never)).rejects.toBeInstanceOf(ValidationError);
    }
    const u = await repo.updateGig(g.id, { name: "Club", junk: 2 } as never);
    expect(u).toEqual({ id: g.id, name: "Club", date: "2026-12-01", songIds: [] });
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

  it("renames a track, trimming the title", async () => {
    const repo = makeRepo(memoryKV());
    const t = await repo.createTrack({ title: "Demo", size: 10 });
    await repo.putTrackPart(t.id, 0, bytes(10));
    const renamed = await repo.renameTrack(t.id, "  Better Name ");
    expect(renamed.title).toBe("Better Name");
    expect(renamed).toMatchObject({ id: t.id, size: 10, parts: 1, uploadedParts: 1, createdAt: t.createdAt });
    expect((await repo.listTracks())[0].title).toBe("Better Name");
  });

  it("rename rejects an empty title and a missing track", async () => {
    const repo = makeRepo(memoryKV());
    const t = await repo.createTrack({ title: "Demo", size: 10 });
    await expect(repo.renameTrack(t.id, "   ")).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.renameTrack(t.id, 5 as unknown as string)).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.renameTrack("nope", "X")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("purges unfinished uploads older than the limit, keeping recent and finished ones", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const DAY = 24 * 60 * 60 * 1000;
    const stale = await repo.createTrack({ title: "Stale", size: 7_000_000 });
    await repo.putTrackPart(stale.id, 0, bytes(100));
    const done = await repo.createTrack({ title: "Done", size: 10 });
    await repo.putTrackPart(done.id, 0, bytes(10));
    const later = Date.now() + 2 * DAY;
    // A fresh unfinished upload (created "now" relative to `later`) must survive.
    const recent = { ...(await repo.createTrack({ title: "Recent", size: 7_000_000 })) };
    await kv.setText(`tracks/${recent.id}`, JSON.stringify({ ...recent, createdAt: new Date(later - 1000).toISOString() }));

    expect(await repo.purgeAbandonedTracks(DAY, later)).toBe(1);

    expect(await kv.getText(`tracks/${stale.id}`)).toBeNull();
    expect(await kv.list(`audio/${stale.id}/`)).toEqual([]);
    expect(await kv.getText(`tracks/${recent.id}`)).not.toBeNull();
    expect((await repo.listTracks()).map((x) => x.id)).toEqual([done.id]);
    expect(await kv.list(`audio/${done.id}/`)).toHaveLength(1);
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
