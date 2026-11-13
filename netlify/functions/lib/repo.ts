import { CHUNK_SIZE, MAX_AUDIO_BYTES } from "../../../src/shared/types";
import type { Gig, GigInput, SetlistItem, Song, SongInput, SongSummary, Track } from "../../../src/shared/types";
import { fromSongIds, setlistOf, songIdsOf } from "../../../src/shared/setlist";
import { isValidKey } from "../../../src/shared/transpose";
import type { KV } from "./kv";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export const LIMITS = {
  title: 200,
  artist: 200,
  sourceUrl: 500,
  content: 100_000,
  gigName: 200,
  gigSongs: 100,
  setlistItems: 150,
  note: 200,
  breakLabel: 100,
} as const;

const SONG_FIELDS = ["title", "artist", "sourceUrl", "originalKey", "bandKey", "capo", "content"] as const;

function checkString(field: string, v: unknown, max: number): string {
  if (typeof v !== "string") throw new ValidationError(`${field} must be text`);
  if (v.length > max) throw new ValidationError(`${field} is too long (max ${max} characters)`);
  return v;
}

function checkSongField(field: (typeof SONG_FIELDS)[number], v: unknown): unknown {
  switch (field) {
    case "title":
      if (typeof v === "string" && !v.trim()) throw new ValidationError("title is required");
      return checkString(field, v, LIMITS.title);
    case "artist":
      return checkString(field, v, LIMITS.artist);
    case "content":
      return checkString(field, v, LIMITS.content);
    case "sourceUrl":
      return v === null ? null : checkString(field, v, LIMITS.sourceUrl);
    case "originalKey":
    case "bandKey":
      // "" means "no key yet"; withKeys decides whether the song may have no key.
      if (typeof v !== "string" || (v !== "" && !isValidKey(v))) {
        throw new ValidationError(`${field} must be a key like C, F#m or Bb`);
      }
      return v;
    case "capo":
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 12) {
        throw new ValidationError("capo must be a whole number from 0 to 12");
      }
      return v;
  }
}

/** Copies only known song fields, validating each. With `partial`, missing fields are skipped. */
function cleanSong(input: unknown, partial: boolean): Partial<SongInput> {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of SONG_FIELDS) {
    if (!(f in src)) {
      if (partial) continue;
      throw new ValidationError(`${f} is required`);
    }
    out[f] = checkSongField(f, src[f]);
  }
  return out as Partial<SongInput>;
}

/**
 * Makes the two keys agree. Only an original song (one with a track) may have no key, since nobody
 * has worked it out yet; then the band key is empty too. A song that gets a key but no band key
 * starts in its original key.
 */
function withKeys<T extends Pick<Song, "originalKey" | "bandKey" | "trackId">>(song: T): T {
  if (song.originalKey === "") {
    if (!song.trackId) throw new ValidationError("originalKey must be a key like C, F#m or Bb");
    return { ...song, bandKey: "" };
  }
  return song.bandKey === "" ? { ...song, bandKey: song.originalKey } : song;
}

function checkSongIds(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new ValidationError("songIds must be a list of song ids");
  }
  if (v.length > LIMITS.gigSongs) throw new ValidationError(`a setlist can hold at most ${LIMITS.gigSongs} songs`);
  return [...v];
}

function checkSetlist(v: unknown): SetlistItem[] {
  if (!Array.isArray(v)) throw new ValidationError("setlist must be a list");
  if (v.length > LIMITS.setlistItems) {
    throw new ValidationError(`a setlist can hold at most ${LIMITS.setlistItems} items`);
  }
  const out: SetlistItem[] = [];
  const songIds = new Set<string>();
  const breakIds = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) throw new ValidationError("setlist items must be songs or breaks");
    const item = raw as Record<string, unknown>;
    if (item.type === "song") {
      if (typeof item.songId !== "string" || !item.songId) throw new ValidationError("songId must be a song id");
      if (songIds.has(item.songId)) throw new ValidationError("a song can only be in the setlist once");
      songIds.add(item.songId);
      if (songIds.size > LIMITS.gigSongs) {
        throw new ValidationError(`a setlist can hold at most ${LIMITS.gigSongs} songs`);
      }
      const clean: SetlistItem = { type: "song", songId: item.songId };
      if (item.note !== undefined && item.note !== null) {
        const note = checkString("note", item.note, LIMITS.note).trim();
        if (note) clean.note = note;
      }
      out.push(clean);
    } else if (item.type === "break") {
      if (typeof item.id !== "string" || !item.id) throw new ValidationError("break id must be text");
      if (breakIds.has(item.id)) throw new ValidationError("break ids must be unique");
      breakIds.add(item.id);
      if (typeof item.label === "string" && !item.label.trim()) throw new ValidationError("break label is required");
      const label = checkString("break label", item.label, LIMITS.breakLabel).trim();
      out.push({ type: "break", id: item.id, label });
    } else {
      throw new ValidationError("setlist items must be songs or breaks");
    }
  }
  return out;
}

function checkGigField(field: "name" | "date", v: unknown): string {
  switch (field) {
    case "name":
      if (typeof v === "string" && !v.trim()) throw new ValidationError("name is required");
      return checkString(field, v, LIMITS.gigName);
    case "date":
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new ValidationError("date must be YYYY-MM-DD");
      }
      return v;
  }
}

/**
 * Copies only known gig fields, validating each. With `partial`, missing fields are skipped.
 * A write with `songIds` instead of `setlist` (an old client) rebuilds the setlist from `current`.
 */
function cleanGig(input: unknown, partial: boolean, current: SetlistItem[] = []): Partial<GigInput> {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: Partial<GigInput> = {};
  for (const f of ["name", "date"] as const) {
    if (!(f in src)) {
      if (partial) continue;
      throw new ValidationError(`${f} is required`);
    }
    out[f] = checkGigField(f, src[f]);
  }
  if ("setlist" in src) out.setlist = checkSetlist(src.setlist);
  else if ("songIds" in src) out.setlist = fromSongIds(checkSongIds(src.songIds), current);
  else if (!partial) out.setlist = [];
  return out;
}

type StoredGig = { id: string; name: string; date: string; setlist?: SetlistItem[]; songIds?: string[] };

function toGig(stored: StoredGig): Gig {
  const setlist = setlistOf(stored);
  return { id: stored.id, name: stored.name, date: stored.date, setlist, songIds: songIdsOf(setlist) };
}

export function makeRepo(kv: KV) {
  async function readJson<T>(key: string): Promise<T | null> {
    const t = await kv.getText(key);
    return t === null ? null : (JSON.parse(t) as T);
  }
  async function writeJson(key: string, v: unknown) {
    await kv.setText(key, JSON.stringify(v));
  }
  async function readAll<T>(prefix: string): Promise<T[]> {
    const keys = await kv.list(prefix);
    const all: (T | null)[] = await Promise.all(keys.map((k) => readJson<T>(k)));
    return all.filter((x) => x !== null) as T[];
  }

  const getSong = (id: string) => readJson<Song>(`songs/${id}`);
  const getTrack = (id: string) => readJson<Track>(`tracks/${id}`);

  /** Takes a song out of every setlist (the song record itself is deleted by the caller). */
  async function removeSongFromGigs(id: string) {
    for (const g of await readAll<StoredGig>("gigs/")) {
      const items = setlistOf(g);
      if (songIdsOf(items).includes(id)) {
        const setlist = items.filter((item) => item.type === "break" || item.songId !== id);
        await writeJson(`gigs/${g.id}`, { id: g.id, name: g.name, date: g.date, setlist });
      }
    }
  }

  async function removeTrackData(id: string) {
    for (const k of await kv.list(`audio/${id}/`)) await kv.delete(k);
    await kv.delete(`tracks/${id}`);
  }

  /** The song page for a finished track; creates it on first use. Safe to call again. */
  async function linkTrackSong(trackId: string): Promise<Song> {
    const t = await getTrack(trackId);
    if (!t) throw new NotFoundError("track not found");
    if (t.uploadedParts !== t.parts) throw new ValidationError("upload is not finished");
    if (t.songId) {
      const existing = await getSong(t.songId);
      if (existing) return existing;
    }
    // First link uses the track's own id as the song id, so two overlapping calls (a retried
    // last part, or the Tracks page opening it) write the same record instead of making two.
    // Only re-linking after the song was removed gets a fresh id, so stale gig references stay dead.
    if (!t.songId) {
      const existing = await getSong(t.id);
      if (existing && existing.trackId === t.id) {
        const fresh = (await getTrack(t.id)) ?? t;
        if (fresh.songId !== existing.id) await writeJson(`tracks/${t.id}`, { ...fresh, songId: existing.id });
        return existing;
      }
    }
    const song: Song = {
      id: t.songId ? crypto.randomUUID() : t.id,
      title: t.title,
      artist: "",
      sourceUrl: null,
      // Nobody has said what key the recording is in yet.
      originalKey: "",
      bandKey: "",
      capo: 0,
      content: "",
      trackId: t.id,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(`songs/${song.id}`, song);
    // Re-read so a concurrent part upload's newer fields aren't overwritten with our stale copy.
    const latest = (await getTrack(t.id)) ?? t;
    await writeJson(`tracks/${t.id}`, { ...latest, songId: song.id });
    return song;
  }

  /** Drops setlist songs that no longer exist (e.g. a stale page saved a gig after a song was deleted). */
  function withoutMissingSongs(gig: Gig, exists: (songId: string) => boolean): Gig {
    const setlist = gig.setlist.filter((item) => item.type === "break" || exists(item.songId));
    return { ...gig, setlist, songIds: songIdsOf(setlist) };
  }

  async function getGig(id: string): Promise<Gig | null> {
    const stored = await readJson<StoredGig>(`gigs/${id}`);
    if (!stored) return null;
    const gig = toGig(stored);
    const exists = new Map<string, boolean>();
    await Promise.all(
      songIdsOf(gig.setlist).map(async (sid) => exists.set(sid, (await kv.getText(`songs/${sid}`)) !== null)),
    );
    return withoutMissingSongs(gig, (sid) => exists.get(sid) === true);
  }

  return {
    async listSongs(): Promise<SongSummary[]> {
      const songs = await readAll<Song>("songs/");
      return songs
        .map(({ content: _content, ...summary }) => summary)
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    },
    getSong,
    getTrack,
    linkTrackSong,
    async createSong(input: SongInput): Promise<Song> {
      const clean = cleanSong(input, false) as SongInput;
      const song: Song = withKeys({ ...clean, id: crypto.randomUUID(), updatedAt: new Date().toISOString() });
      await writeJson(`songs/${song.id}`, song);
      return song;
    },
    async updateSong(id: string, patch: Partial<SongInput>): Promise<Song> {
      const cur = await getSong(id);
      if (!cur) throw new NotFoundError("song not found");
      const clean = cleanSong(patch, true);
      const next: Song = withKeys({ ...cur, ...clean, id, updatedAt: new Date().toISOString() });
      await writeJson(`songs/${id}`, next);
      if (clean.title !== undefined && cur.trackId) {
        const t = await getTrack(cur.trackId);
        if (t) await writeJson(`tracks/${t.id}`, { ...t, title: clean.title });
      }
      return next;
    },
    async deleteSong(id: string): Promise<void> {
      const cur = await getSong(id);
      if (!cur) throw new NotFoundError("song not found");
      // Clean up everything that points at the song first and delete the record last, so a failure
      // part-way leaves the song in place and deleting again simply finishes the job.
      await removeSongFromGigs(id);
      if (cur.trackId) {
        const t = await getTrack(cur.trackId);
        if (t && t.songId === id) await removeTrackData(t.id);
      }
      await kv.delete(`songs/${id}`);
    },

    async listGigs(): Promise<Gig[]> {
      const [stored, songKeys] = await Promise.all([readAll<StoredGig>("gigs/"), kv.list("songs/")]);
      // One listing of song keys covers every gig, instead of a lookup per song per gig.
      const songs = new Set(songKeys);
      return stored
        .map((g) => withoutMissingSongs(toGig(g), (sid) => songs.has(`songs/${sid}`)))
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    getGig,
    async createGig(input: GigInput): Promise<Gig> {
      const clean = cleanGig(input, false);
      const stored = { id: crypto.randomUUID(), name: clean.name!, date: clean.date!, setlist: clean.setlist! };
      await writeJson(`gigs/${stored.id}`, stored);
      return toGig(stored);
    },
    async updateGig(id: string, patch: Partial<GigInput>): Promise<Gig> {
      const cur = await readJson<StoredGig>(`gigs/${id}`);
      if (!cur) throw new NotFoundError("gig not found");
      const clean = cleanGig(patch, true, setlistOf(cur));
      const next = {
        id,
        name: clean.name ?? cur.name,
        date: clean.date ?? cur.date,
        setlist: clean.setlist ?? setlistOf(cur),
      };
      await writeJson(`gigs/${id}`, next);
      return toGig(next);
    },
    async deleteGig(id: string): Promise<void> {
      if ((await kv.getText(`gigs/${id}`)) === null) throw new NotFoundError("gig not found");
      await kv.delete(`gigs/${id}`);
    },

    async listTracks(): Promise<Track[]> {
      const tracks = await readAll<Track>("tracks/");
      return tracks
        .filter((t) => t.uploadedParts === t.parts)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async createTrack(input: { title: string; size: number }): Promise<Track> {
      if (!input.title || !input.title.trim()) throw new ValidationError("title is required");
      checkString("title", input.title, LIMITS.title);
      if (!Number.isFinite(input.size) || input.size <= 0) throw new ValidationError("size must be positive");
      if (input.size > MAX_AUDIO_BYTES) throw new ValidationError("file is too large (max 25 MB)");
      const track: Track = {
        id: crypto.randomUUID(),
        title: input.title,
        size: input.size,
        parts: Math.ceil(input.size / CHUNK_SIZE),
        uploadedParts: 0,
        createdAt: new Date().toISOString(),
      };
      await writeJson(`tracks/${track.id}`, track);
      return track;
    },
    async renameTrack(id: string, title: string): Promise<Track> {
      if (typeof title !== "string" || !title.trim()) throw new ValidationError("title is required");
      const clean = checkString("title", title.trim(), LIMITS.title);
      const t = await getTrack(id);
      if (!t) throw new NotFoundError("track not found");
      const next: Track = { ...t, title: clean };
      // Song first: it's the title people see, so a failure after this still shows the right name.
      const song = t.songId ? await getSong(t.songId) : null;
      if (song) await writeJson(`songs/${song.id}`, { ...song, title: clean, updatedAt: new Date().toISOString() });
      await writeJson(`tracks/${id}`, next);
      return next;
    },
    /** Deletes uploads that never finished and are older than `maxAgeMs`. Returns how many were removed. */
    async purgeAbandonedTracks(maxAgeMs: number, now: number = Date.now()): Promise<number> {
      let removed = 0;
      for (const t of await readAll<Track>("tracks/")) {
        if (t.uploadedParts === t.parts) continue;
        if (now - Date.parse(t.createdAt) < maxAgeMs) continue;
        for (const k of await kv.list(`audio/${t.id}/`)) await kv.delete(k);
        await kv.delete(`tracks/${t.id}`);
        removed++;
      }
      return removed;
    },
    async putTrackPart(id: string, n: number, bytes: ArrayBuffer): Promise<void> {
      const t = await readJson<Track>(`tracks/${id}`);
      if (!t) throw new NotFoundError("track not found");
      if (!Number.isInteger(n) || n < 0 || n >= t.parts) throw new ValidationError("part number out of range");
      if (bytes.byteLength > CHUNK_SIZE) throw new ValidationError("part is too large");
      const key = `audio/${id}/${n}`;
      await kv.setBytes(key, bytes);
      const uploadedParts = (await kv.list(`audio/${id}/`)).length;
      // Re-read so a songId written by a concurrent call isn't dropped.
      const latest = (await readJson<Track>(`tracks/${id}`)) ?? t;
      await writeJson(`tracks/${id}`, { ...latest, uploadedParts });
      // The last part just landed: the recording becomes a song (also appears in the Songs list).
      if (uploadedParts === t.parts) await linkTrackSong(id);
    },
    async getTrackPart(id: string, n: number): Promise<ArrayBuffer | null> {
      return kv.getBytes(`audio/${id}/${n}`);
    },
    async deleteTrack(id: string): Promise<void> {
      const t = await getTrack(id);
      if (!t) throw new NotFoundError("track not found");
      await removeTrackData(id);
      if (t.songId && (await getSong(t.songId))) {
        await kv.delete(`songs/${t.songId}`);
        await removeSongFromGigs(t.songId);
      }
    },
  };
}

export type Repo = ReturnType<typeof makeRepo>;
