import { describe, expect, it } from "vitest";
import { memoryKV } from "../../netlify/functions/lib/kv";
import { ConflictError, LIMITS, makeRepo, NotFoundError, ValidationError } from "../../netlify/functions/lib/repo";
import type { SongInput } from "../../src/shared/types";
import { songMatchKey, songsByMatchKey } from "../../src/shared/playlist";

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

  it("listSongs says whether each song has chords yet", async () => {
    const repo = makeRepo(memoryKV());
    await repo.createSong(song({ title: "Empty", content: "  \n " }));
    await repo.createSong(song({ title: "Full" }));
    const list = await repo.listSongs();
    expect(list.map((s) => [s.title, s.hasChords])).toEqual([["Empty", false], ["Full", true]]);
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

  it("saves a song with no key yet, and then it has no band key either", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(song({ originalKey: "", bandKey: "Em" }));
    expect(s).toMatchObject({ originalKey: "", bandKey: "" });
    const u = await repo.updateSong(s.id, { title: "Renamed" });
    expect(u).toMatchObject({ title: "Renamed", originalKey: "", bandKey: "" });
  });

  it("rejects bad keys, types and sizes", async () => {
    const repo = makeRepo(memoryKV());
    const bad: Partial<Record<keyof SongInput, unknown>>[] = [
      { originalKey: "H" },
      { bandKey: "Emaj" },
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
    const g = await repo.createGig({ name: "Pub", date: "2026-12-01", songIds: [s.id] } as never);
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
    const g = await repo.createGig({ name: "Pub", date: "2026-12-01", songIds: [a.id, b.id] } as never);
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
    expect(u).toEqual({ id: g.id, name: "Club", date: "2026-12-01", setlist: [], songIds: [], updatedAt: expect.any(String) });
  });

  it("lists newest date first", async () => {
    const repo = makeRepo(memoryKV());
    await repo.createGig({ name: "Nov", date: "2026-11-20" });
    await repo.createGig({ name: "Dec", date: "2026-12-01" });
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

describe("gig setlists", () => {
  async function withSongs() {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const a = await repo.createSong(song({ title: "A" }));
    const b = await repo.createSong(song({ title: "B" }));
    return { kv, repo, a, b };
  }

  it("reads a legacy gig that only has songIds as a setlist (get and list)", async () => {
    const { kv, repo, a, b } = await withSongs();
    await kv.setText("gigs/x", JSON.stringify({ id: "x", name: "Pub", date: "2026-12-01", songIds: [a.id, b.id] }));
    const expected = [{ type: "song", songId: a.id }, { type: "song", songId: b.id }];
    const got = await repo.getGig("x");
    expect(got!.setlist).toEqual(expected);
    expect(got!.songIds).toEqual([a.id, b.id]);
    const listed = (await repo.listGigs()).find((g) => g.id === "x")!;
    expect(listed.setlist).toEqual(expected);
    expect(listed.songIds).toEqual([a.id, b.id]);
  });

  it("leaves missing songs out of a gig the same way in get and list", async () => {
    const { kv, repo, a, b } = await withSongs();
    // A gig still pointing at a deleted song, e.g. saved from a stale page after the delete.
    const stored = {
      id: "x",
      name: "Pub",
      date: "2026-12-01",
      setlist: [
        { type: "song", songId: a.id },
        { type: "song", songId: "gone" },
        { type: "break", id: "k1", label: "Set 2" },
        { type: "song", songId: b.id, note: "segue" },
      ],
    };
    await kv.setText("gigs/x", JSON.stringify(stored));
    const expected = [stored.setlist[0], stored.setlist[2], stored.setlist[3]];
    const got = await repo.getGig("x");
    expect(got!.setlist).toEqual(expected);
    expect(got!.songIds).toEqual([a.id, b.id]);
    const listed = (await repo.listGigs()).find((g) => g.id === "x")!;
    expect(listed).toEqual(got);
  });

  it("round-trips notes and breaks, trimming notes and dropping empty ones", async () => {
    const { repo, a, b } = await withSongs();
    const g = await repo.createGig({ name: "Pub", date: "2026-12-01" });
    expect(g.setlist).toEqual([]);
    await repo.updateGig(g.id, {
      setlist: [
        { type: "song", songId: a.id, note: "  count-in  " },
        { type: "break", id: "k1", label: " Set 2 " },
        { type: "song", songId: b.id, note: "   " },
      ],
    });
    const got = await repo.getGig(g.id);
    expect(got!.setlist).toEqual([
      { type: "song", songId: a.id, note: "count-in" },
      { type: "break", id: "k1", label: "Set 2" },
      { type: "song", songId: b.id },
    ]);
    expect(got!.songIds).toEqual([a.id, b.id]);
  });

  it("an old client writing only songIds keeps notes, applies the order and drops breaks", async () => {
    const { repo, a, b } = await withSongs();
    const g = await repo.createGig({
      name: "Pub",
      date: "2026-12-01",
      setlist: [
        { type: "song", songId: a.id, note: "keep me" },
        { type: "break", id: "k1", label: "Set 2" },
        { type: "song", songId: b.id },
      ],
    });
    const u = await repo.updateGig(g.id, { songIds: [b.id, a.id] } as never);
    expect(u.setlist).toEqual([
      { type: "song", songId: b.id },
      { type: "song", songId: a.id, note: "keep me" },
    ]);
    expect(u.songIds).toEqual([b.id, a.id]);
  });

  it("still creates a gig from songIds like before", async () => {
    const { repo, a } = await withSongs();
    const g = await repo.createGig({ name: "Pub", date: "2026-12-01", songIds: [a.id] } as never);
    expect(g.setlist).toEqual([{ type: "song", songId: a.id }]);
  });

  it("rejects bad setlists", async () => {
    const { repo } = await withSongs();
    const g = await repo.createGig({ name: "Pub", date: "2026-12-01" });
    const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "song", songId: `s${i}` }));
    const bad: [unknown, string?][] = [
      ["nope"],
      [[{ type: "intermission" }]],
      [[{ type: "song", songId: "a" }, { type: "song", songId: "a" }], "a song can only be in the setlist once"],
      [songs(101)],
      [[...songs(100), ...Array.from({ length: 51 }, (_, i) => ({ type: "break", id: `b${i}`, label: "x" }))]],
      [[{ type: "song", songId: "a", note: "x".repeat(201) }]],
      [[{ type: "song", songId: "a", note: 5 }]],
      [[{ type: "song", songId: 5 }]],
      [[{ type: "break", id: "k", label: "   " }], "break label is required"],
      [[{ type: "break", id: "k", label: "x".repeat(101) }]],
      [[{ type: "break", id: 5, label: "Set 2" }]],
      [[{ type: "break", id: "k", label: "A" }, { type: "break", id: "k", label: "B" }]],
      [[null]],
    ];
    for (const [setlist, message] of bad) {
      const p = repo.updateGig(g.id, { setlist } as never);
      await expect(p).rejects.toBeInstanceOf(ValidationError);
      if (message) await expect(p).rejects.toThrow(message);
    }
    await expect(repo.createGig({ name: "x", date: "2026-12-01", setlist: "no" } as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("strips unknown keys from items", async () => {
    const { repo, a } = await withSongs();
    const g = await repo.createGig({
      name: "Pub",
      date: "2026-12-01",
      setlist: [
        { type: "song", songId: a.id, junk: 1 },
        { type: "break", id: "k", label: "Set 2", junk: 2 },
      ] as never,
    });
    expect(g.setlist).toEqual([{ type: "song", songId: a.id }, { type: "break", id: "k", label: "Set 2" }]);
  });

  it("deleteSong removes the song item but keeps the breaks", async () => {
    const { repo, a, b } = await withSongs();
    const g = await repo.createGig({
      name: "Pub",
      date: "2026-12-01",
      setlist: [
        { type: "song", songId: a.id },
        { type: "break", id: "k", label: "Set 2" },
        { type: "song", songId: b.id },
      ],
    });
    await repo.deleteSong(a.id);
    const got = await repo.getGig(g.id);
    expect(got!.setlist).toEqual([{ type: "break", id: "k", label: "Set 2" }, { type: "song", songId: b.id }]);
    expect(got!.songIds).toEqual([b.id]);
  });

  it("deleteSong also fixes a legacy gig", async () => {
    const { kv, repo, a, b } = await withSongs();
    await kv.setText("gigs/x", JSON.stringify({ id: "x", name: "Pub", date: "2026-12-01", songIds: [a.id, b.id] }));
    await repo.deleteSong(a.id);
    expect((await repo.getGig("x"))!.songIds).toEqual([b.id]);
  });

  it("getGig drops songs deleted straight from the KV from setlist and songIds", async () => {
    const { kv, repo, a, b } = await withSongs();
    const g = await repo.createGig({
      name: "Pub",
      date: "2026-12-01",
      setlist: [
        { type: "song", songId: a.id },
        { type: "break", id: "k", label: "Set 2" },
        { type: "song", songId: b.id },
      ],
    });
    await kv.delete(`songs/${a.id}`);
    const got = await repo.getGig(g.id);
    expect(got!.songIds).toEqual([b.id]);
    expect(got!.setlist).toEqual([{ type: "break", id: "k", label: "Set 2" }, { type: "song", songId: b.id }]);
  });
});

describe("original songs", () => {
  async function upload(repo: ReturnType<typeof makeRepo>, title = "Demo", size = 10) {
    const t = await repo.createTrack({ title, size });
    for (let n = 0; n < t.parts; n++) await repo.putTrackPart(t.id, n, bytes(Math.min(size, 3_145_728)));
    return (await repo.getTrack(t.id))!;
  }

  it("creates a linked song when the last part is uploaded", async () => {
    const repo = makeRepo(memoryKV());
    const t = await upload(repo);
    expect(t.songId).toBeTruthy();
    const s = await repo.getSong(t.songId!);
    expect(s).toMatchObject({
      title: "Demo", trackId: t.id, content: "", originalKey: "", bandKey: "", artist: "", capo: 0, sourceUrl: null,
    });
    expect((await repo.listSongs()).map((x) => x.id)).toContain(s!.id);
  });

  it("lets an original song be saved without a key", async () => {
    const repo = makeRepo(memoryKV());
    const t = await upload(repo);
    const s = await repo.updateSong(t.songId!, { content: "[ch]G[/ch]", originalKey: "", bandKey: "" });
    expect(s).toMatchObject({ content: "[ch]G[/ch]", originalKey: "", bandKey: "" });
  });

  it("fills in the band key when an original song first gets a key", async () => {
    const repo = makeRepo(memoryKV());
    const t = await upload(repo);
    const s = await repo.updateSong(t.songId!, { originalKey: "G" });
    expect(s).toMatchObject({ originalKey: "G", bandKey: "G" });
  });

  it("clears the band key when an original song's key is removed", async () => {
    const repo = makeRepo(memoryKV());
    const t = await upload(repo);
    await repo.updateSong(t.songId!, { originalKey: "G", bandKey: "A" });
    const s = await repo.updateSong(t.songId!, { originalKey: "", bandKey: "A" });
    expect(s).toMatchObject({ originalKey: "", bandKey: "" });
  });

  it("lets a song that is not an original drop its key too", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(song());
    expect(await repo.updateSong(s.id, { originalKey: "" })).toMatchObject({ originalKey: "", bandKey: "" });
  });

  it("does not create a song while the upload is unfinished", async () => {
    const repo = makeRepo(memoryKV());
    const t = await repo.createTrack({ title: "Demo", size: 7_000_000 });
    await repo.putTrackPart(t.id, 0, bytes(3_145_728));
    expect(await repo.listSongs()).toEqual([]);
    await expect(repo.linkTrackSong(t.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("linkTrackSong is idempotent", async () => {
    const repo = makeRepo(memoryKV());
    const t = await upload(repo);
    const a = await repo.linkTrackSong(t.id);
    const b = await repo.linkTrackSong(t.id);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(t.songId);
    expect(await repo.listSongs()).toHaveLength(1);
  });

  it("deleteSong keeps the song if cleanup fails, so deleting again finishes", async () => {
    const kv = memoryKV();
    let failAudio = true;
    const flaky = {
      ...kv,
      delete: async (k: string) => {
        if (failAudio && k.startsWith("audio/")) throw new Error("timeout");
        return kv.delete(k);
      },
    };
    const repo = makeRepo(flaky);
    const t = await upload(repo);
    await expect(repo.deleteSong(t.songId!)).rejects.toThrow("timeout");
    expect(await repo.getSong(t.songId!)).not.toBeNull();
    failAudio = false;
    await repo.deleteSong(t.songId!);
    expect(await repo.getSong(t.songId!)).toBeNull();
    expect(await repo.getTrack(t.id)).toBeNull();
  });

  it("overlapping linkTrackSong calls make one song, not two", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const t = await upload(repo);
    // Simulate the race: the track has not recorded its song yet when both calls read it.
    await kv.setText(`tracks/${t.id}`, JSON.stringify({ ...(await repo.getTrack(t.id)), songId: undefined }));
    await kv.delete(`songs/${t.songId}`);
    const [a, b] = await Promise.all([repo.linkTrackSong(t.id), repo.linkTrackSong(t.id)]);
    expect(a.id).toBe(b.id);
    expect(await repo.listSongs()).toHaveLength(1);
    expect((await repo.getTrack(t.id))!.songId).toBe(a.id);
  });

  it("linkTrackSong links a legacy track without a song", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const legacy = { id: "old", title: "Old", size: 5, parts: 1, uploadedParts: 1, createdAt: "x" };
    await kv.setText("tracks/old", JSON.stringify(legacy));
    const s = await repo.linkTrackSong("old");
    expect(s).toMatchObject({ title: "Old", trackId: "old" });
    expect((await repo.getTrack("old"))!.songId).toBe(s.id);
    await expect(repo.linkTrackSong("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("relinks if the linked song was removed", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const t = await upload(repo);
    await kv.delete(`songs/${t.songId}`);
    const s = await repo.linkTrackSong(t.id);
    expect(s.id).not.toBe(t.songId);
    expect((await repo.getTrack(t.id))!.songId).toBe(s.id);
  });

  it("renaming a track renames its song", async () => {
    const repo = makeRepo(memoryKV());
    const t = await upload(repo);
    await repo.renameTrack(t.id, " New ");
    expect((await repo.getSong(t.songId!))!.title).toBe("New");
  });

  it("rejects track titles longer than the song title limit", async () => {
    const repo = makeRepo(memoryKV());
    const long = "x".repeat(LIMITS.title + 1);
    await expect(repo.createTrack({ title: long, size: 5 })).rejects.toBeInstanceOf(ValidationError);
    const t = await upload(repo);
    await expect(repo.renameTrack(t.id, long)).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.getSong(t.songId!))!.title).toBe("Demo");
  });

  it("changing an original song's title renames its track", async () => {
    const repo = makeRepo(memoryKV());
    const t = await upload(repo);
    await repo.updateSong(t.songId!, { content: "[C]la" });
    expect((await repo.getTrack(t.id))!.title).toBe("Demo");
    await repo.updateSong(t.songId!, { title: "Newer" });
    expect((await repo.getTrack(t.id))!.title).toBe("Newer");
    expect((await repo.getSong(t.songId!))!.trackId).toBe(t.id);
  });

  it("deleting a track deletes its song and removes it from setlists", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const t = await upload(repo);
    const gig = await repo.createGig({ name: "G", date: "2026-01-01", setlist: [{ type: "song", songId: t.songId! }] });
    await repo.deleteTrack(t.id);
    expect(await repo.getSong(t.songId!)).toBeNull();
    expect((await repo.getGig(gig.id))!.setlist).toEqual([]);
    expect(await kv.list(`audio/${t.id}/`)).toEqual([]);
  });

  it("deleteTrack keeps the track if cleanup fails, so deleting again finishes", async () => {
    const kv = memoryKV();
    let failSong = true;
    const flaky = {
      ...kv,
      delete: async (k: string) => {
        if (failSong && k.startsWith("songs/")) throw new Error("timeout");
        return kv.delete(k);
      },
    };
    const repo = makeRepo(flaky);
    const t = await upload(repo);
    const gig = await repo.createGig({ name: "G", date: "2026-01-01", setlist: [{ type: "song", songId: t.songId! }] });
    await expect(repo.deleteTrack(t.id)).rejects.toThrow("timeout");
    expect(await repo.getTrack(t.id)).not.toBeNull();
    failSong = false;
    await repo.deleteTrack(t.id);
    expect(await repo.getTrack(t.id)).toBeNull();
    expect(await repo.getSong(t.songId!)).toBeNull();
    expect(await kv.list(`audio/${t.id}/`)).toEqual([]);
    const stored = JSON.parse((await kv.getText(`gigs/${gig.id}`))!);
    expect(stored.setlist).toEqual([]);
  });

  // Fails the Nth write or delete once, then works again. Lets a test break a multi-step
  // delete at every possible step, not just the one a hand-written failure happens to pick.
  function failOnce(kv: ReturnType<typeof memoryKV>, n: number) {
    let count = 0;
    const tick = () => {
      if (++count === n) throw new Error("timeout");
    };
    const kvFail = {
      ...kv,
      setText: async (k: string, v: string) => (tick(), kv.setText(k, v)),
      setTextIfMatch: async (k: string, v: string, etag: string) => (tick(), kv.setTextIfMatch(k, v, etag)),
      setBytes: async (k: string, v: ArrayBuffer) => (tick(), kv.setBytes(k, v)),
      delete: async (k: string) => (tick(), kv.delete(k)),
    };
    return { kv: kvFail, steps: () => count };
  }

  for (const which of ["deleteTrack", "deleteSong"] as const) {
    it(`${which}: a failure at any step can be finished by deleting again`, async () => {
      for (let n = 1; ; n++) {
        const kv = memoryKV();
        const setup = makeRepo(kv);
        const t = await upload(setup, "Demo", 3_145_728 + 10); // two audio parts
        const gig = await setup.createGig({ name: "G", date: "2026-01-01", setlist: [{ type: "song", songId: t.songId! }] });
        const flaky = failOnce(kv, n);
        const repo = makeRepo(flaky.kv);
        const del = () => (which === "deleteTrack" ? repo.deleteTrack(t.id) : repo.deleteSong(t.songId!));
        let failed = false;
        try {
          await del();
        } catch {
          failed = true;
        }
        if (!failed) break; // n is past the last step: every step has been tried
        await del();
        expect(await kv.getText(`songs/${t.songId}`)).toBeNull();
        expect(await kv.getText(`tracks/${t.id}`)).toBeNull();
        expect(await kv.list(`audio/${t.id}/`)).toEqual([]);
        expect(JSON.parse((await kv.getText(`gigs/${gig.id}`))!).setlist).toEqual([]);
        expect(n).toBeLessThan(20);
      }
    });
  }

  it("deleting an original song deletes its track and audio", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const t = await upload(repo);
    await repo.deleteSong(t.songId!);
    expect(await repo.getTrack(t.id)).toBeNull();
    expect(await repo.listTracks()).toEqual([]);
    expect(await kv.list(`audio/${t.id}/`)).toEqual([]);
  });

  it("clients cannot set trackId", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong({ ...song(), trackId: "x" } as unknown as SongInput);
    expect(s.trackId).toBeUndefined();
    const u = await repo.updateSong(s.id, { trackId: "y" } as unknown as Partial<SongInput>);
    expect(u.trackId).toBeUndefined();
  });
});

describe("importSongs", () => {
  it("reuses matching songs, creates the rest empty, and keeps playlist order", async () => {
    const repo = makeRepo(memoryKV());
    const existing = await repo.createSong(song());
    const out = await repo.importSongs([
      { title: "wonderwall ", artist: "OASIS" },
      { title: "Yellow", artist: "Coldplay" },
      { title: "Yellow", artist: "coldplay" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(existing.id);
    expect(out[0].content).toBe(existing.content);
    expect(out[1]).toMatchObject({
      title: "Yellow", artist: "Coldplay", originalKey: "", bandKey: "", capo: 0, content: "", sourceUrl: null,
    });
    expect(await repo.listSongs()).toHaveLength(2);
  });

  it("is safe to call again: the second call reuses the songs the first one made", async () => {
    const repo = makeRepo(memoryKV());
    const tracks = [{ title: "Yellow", artist: "Coldplay" }, { title: "Creep", artist: "Radiohead" }];
    const first = await repo.importSongs(tracks);
    const second = await repo.importSongs(tracks);
    expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(await repo.listSongs()).toHaveLength(2);
  });

  it("picks the same copy of a duplicate song as songsByMatchKey, whatever the storage order", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    const base = { ...song(), id: "", updatedAt: "x" };
    // Stored so the larger id comes first in storage order.
    await kv.setText("songs/b", JSON.stringify({ ...base, id: "b" }));
    await kv.setText("songs/a", JSON.stringify({ ...base, id: "a" }));
    const listed = await repo.listSongs();
    const [picked] = await repo.importSongs([{ title: "Wonderwall", artist: "Oasis" }]);
    expect(picked.id).toBe("a");
    expect(picked.id).toBe(songsByMatchKey(listed).get(songMatchKey("Wonderwall", "Oasis"))!.id);
  });

  it("trims titles and artists", async () => {
    const repo = makeRepo(memoryKV());
    const [s] = await repo.importSongs([{ title: "  Yellow ", artist: " Coldplay  " }]);
    expect(s).toMatchObject({ title: "Yellow", artist: "Coldplay" });
  });

  it("rejects bad input", async () => {
    const repo = makeRepo(memoryKV());
    const many = Array.from({ length: LIMITS.gigSongs + 1 }, (_, i) => ({ title: `Song ${i}`, artist: "" }));
    for (const bad of [
      "x",
      undefined,
      many,
      [{ title: "  ", artist: "" }],
      [{ title: "x".repeat(LIMITS.title + 1), artist: "" }],
      [{ title: "A", artist: 5 }],
      [null],
    ]) {
      await expect(repo.importSongs(bad)).rejects.toThrow(ValidationError);
    }
    expect(await repo.listSongs()).toHaveLength(0);
  });
});

describe("versions (lost-update protection)", () => {
  /** Runs `meanwhile` once, right after the next tagged read of `key`: a bandmate saving in between. */
  function interleave(kv: ReturnType<typeof memoryKV>, key: string, meanwhile: () => Promise<unknown>) {
    let armed = true;
    return {
      ...kv,
      getTextTagged: async (k: string) => {
        const got = await kv.getTextTagged(k);
        if (armed && k === key) {
          armed = false;
          await meanwhile();
        }
        return got;
      },
    };
  }

  it("updateSong saves when baseVersion matches and moves the version on", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(song());
    const u = await repo.updateSong(s.id, { bandKey: "Gm", baseVersion: s.updatedAt });
    expect(u.bandKey).toBe("Gm");
    expect(u.updatedAt > s.updatedAt).toBe(true);
  });

  it("two saves in the same millisecond still get different versions", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(song());
    const a = await repo.updateSong(s.id, { capo: 1 });
    const b = await repo.updateSong(s.id, { capo: 2 });
    expect(new Set([s.updatedAt, a.updatedAt, b.updatedAt]).size).toBe(3);
  });

  it("updateSong refuses an out-of-date baseVersion and keeps the newer save", async () => {
    const repo = makeRepo(memoryKV());
    const s = await repo.createSong(song());
    await repo.updateSong(s.id, { bandKey: "Am", baseVersion: s.updatedAt }); // a bandmate transposes
    const err = await repo.updateSong(s.id, { title: "Mine", bandKey: "Em", baseVersion: s.updatedAt }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).current).toMatchObject({ id: s.id, bandKey: "Am", title: "Wonderwall" });
    expect((await repo.getSong(s.id))!.bandKey).toBe("Am");
  });

  it("a record stored before versions existed matches any baseVersion", async () => {
    const kv = memoryKV();
    const repo = makeRepo(kv);
    await kv.setText("gigs/old", JSON.stringify({ id: "old", name: "Old", date: "2025-01-01", songIds: [] }));
    expect((await repo.getGig("old"))!.updatedAt).toBeUndefined();
    const u = await repo.updateGig("old", { name: "Renamed", baseVersion: "anything" });
    expect(u.name).toBe("Renamed");
    expect(u.updatedAt).toBeTruthy();
  });

  it("updateGig refuses an out-of-date baseVersion; current is the gig as getGig shows it", async () => {
    const repo = makeRepo(memoryKV());
    const a = await repo.createSong(song({ title: "A" }));
    const g = await repo.createGig({ name: "G", date: "2026-01-01", setlist: [{ type: "song", songId: a.id }] });
    await repo.updateGig(g.id, { setlist: [], baseVersion: g.updatedAt });
    const err = await repo
      .updateGig(g.id, { setlist: [{ type: "song", songId: a.id }], baseVersion: g.updatedAt })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).current).toEqual(await repo.getGig(g.id));
    expect((await repo.getGig(g.id))!.setlist).toEqual([]);
  });

  it("a save that lands between our read and write is not lost (no baseVersion: re-applied on top)", async () => {
    const base = memoryKV();
    const setup = makeRepo(base);
    const s = await setup.createSong(song());
    const kv = interleave(base, `songs/${s.id}`, () => setup.updateSong(s.id, { bandKey: "Am" }));
    await makeRepo(kv).updateSong(s.id, { capo: 3 });
    expect(await setup.getSong(s.id)).toMatchObject({ bandKey: "Am", capo: 3 });
  });

  it("a save that lands between our read and write is a conflict when we sent a baseVersion", async () => {
    const base = memoryKV();
    const setup = makeRepo(base);
    const g = await setup.createGig({ name: "G", date: "2026-01-01" });
    const kv = interleave(base, `gigs/${g.id}`, () => setup.updateGig(g.id, { name: "Theirs" }));
    await expect(makeRepo(kv).updateGig(g.id, { name: "Mine", baseVersion: g.updatedAt })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await setup.getGig(g.id))!.name).toBe("Theirs");
  });

  it("deleting a song from setlists doesn't undo a setlist edit made at the same moment", async () => {
    const base = memoryKV();
    const setup = makeRepo(base);
    const a = await setup.createSong(song({ title: "A" }));
    const b = await setup.createSong(song({ title: "B" }));
    const g = await setup.createGig({ name: "G", date: "2026-01-01", setlist: [{ type: "song", songId: a.id }] });
    const kv = interleave(base, `gigs/${g.id}`, () =>
      setup.updateGig(g.id, { setlist: [{ type: "song", songId: a.id }, { type: "song", songId: b.id }] }),
    );
    await makeRepo(kv).deleteSong(a.id);
    expect((await setup.getGig(g.id))!.songIds).toEqual([b.id]);
  });

  it("renaming a track doesn't undo a song edit made at the same moment", async () => {
    const base = memoryKV();
    const setup = makeRepo(base);
    const t = await setup.createTrack({ title: "Demo", size: 5 });
    await setup.putTrackPart(t.id, 0, bytes(5));
    const songId = (await setup.getTrack(t.id))!.songId!;
    const kv = interleave(base, `songs/${songId}`, () => setup.updateSong(songId, { content: "[C]la" }));
    await makeRepo(kv).renameTrack(t.id, "New");
    expect(await setup.getSong(songId)).toMatchObject({ title: "New", content: "[C]la" });
  });
});
