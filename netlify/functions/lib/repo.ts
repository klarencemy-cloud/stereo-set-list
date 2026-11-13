import { CHUNK_SIZE, MAX_AUDIO_BYTES } from "../../../src/shared/types";
import type { BaseVersion, Gig, GigInput, SetlistItem, Song, SongInput, SongSummary, Track } from "../../../src/shared/types";
import { fromSongIds, setlistOf, songIdsOf } from "../../../src/shared/setlist";
import { toSongSummary } from "../../../src/shared/song";
import { isValidKey } from "../../../src/shared/transpose";
import { songMatchKey, songsByMatchKey, uniqueTracks, type PlaylistTrack } from "../../../src/shared/playlist";
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

/** The record changed since the client loaded it. `current` is what is stored now. */
export class ConflictError extends Error {
  current: unknown;
  constructor(message: string, current: unknown) {
    super(message);
    this.name = "ConflictError";
    this.current = current;
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
 * Makes the two keys agree. A song may have no key yet (an original nobody has worked out, or a
 * song imported from a playlist before its chords); then the band key is empty too. A song that
 * gets a key but no band key starts in its original key.
 */
function withKeys<T extends Pick<Song, "originalKey" | "bandKey">>(song: T): T {
  if (song.originalKey === "") return { ...song, bandKey: "" };
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

/** The version the client loaded (its `updatedAt`), if it sent one. Empty means it doesn't know one. */
function checkBaseVersion(input: unknown): string | undefined {
  const v = ((input ?? {}) as Record<string, unknown>).baseVersion;
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ValidationError("baseVersion must be text");
  return v;
}

/**
 * Stops a save made from an out-of-date copy. A record stored before versions existed has no
 * version yet, so any base matches it; a client that sends no base skips the check (older clients).
 */
function checkVersion(stored: string | undefined, base: string | undefined, what: string, current: unknown) {
  if (base !== undefined && stored && stored !== base) {
    throw new ConflictError(`Someone else changed this ${what}. Reload to see their changes.`, current);
  }
}

/** A new updatedAt, always later than `prev`, so two saves in the same millisecond still differ. */
function nextStamp(prev?: string): string {
  const now = Date.now();
  const p = prev ? Date.parse(prev) : NaN;
  return new Date(Number.isFinite(p) && p >= now ? p + 1 : now).toISOString();
}

/** Checks a playlist's track list before anything is written. */
function checkTracks(v: unknown): PlaylistTrack[] {
  if (!Array.isArray(v)) throw new ValidationError("tracks must be a list");
  if (v.length > LIMITS.gigSongs) throw new ValidationError(`a playlist import can hold at most ${LIMITS.gigSongs} songs`);
  return v.map((t) => {
    if (!t || typeof t !== "object") throw new ValidationError("each track needs a title and an artist");
    const { title, artist } = t as Record<string, unknown>;
    const cleanTitle = checkString("title", title, LIMITS.title).trim();
    if (!cleanTitle) throw new ValidationError("title is required");
    return { title: cleanTitle, artist: checkString("artist", artist, LIMITS.artist).trim() };
  });
}

/** A new song nobody has filled in yet. */
function blankSong({ id, title, artist, trackId }: { id: string; title: string; artist: string; trackId?: string }): Song {
  return {
    id,
    title,
    artist,
    sourceUrl: null,
    // Nobody has said what key it is in yet: leave it empty rather than invent one.
    originalKey: "",
    bandKey: "",
    capo: 0,
    content: "",
    ...(trackId !== undefined ? { trackId } : {}),
    updatedAt: new Date().toISOString(),
  };
}

type StoredGig = {
  id: string;
  name: string;
  date: string;
  setlist?: SetlistItem[];
  songIds?: string[];
  /** Missing on gigs saved before versions existed. */
  updatedAt?: string;
};

function toGig(stored: StoredGig): Gig {
  const setlist = setlistOf(stored);
  return {
    id: stored.id,
    name: stored.name,
    date: stored.date,
    setlist,
    songIds: songIdsOf(setlist),
    ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  };
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

  /**
   * Read, change, write, without losing someone else's write in between: the write only lands if
   * the record is unchanged since it was read (an atomic etag check in Blobs), otherwise it reads
   * again and re-applies `change`. `change` returns null to leave the record alone, or throws to stop.
   * Resolves null when the record doesn't exist.
   */
  async function modify<T>(key: string, change: (cur: T) => T | null): Promise<T | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const got = await kv.getTextTagged(key);
      if (!got) return null;
      const cur = JSON.parse(got.value) as T;
      const next = change(cur);
      if (next === null) return cur;
      if (await kv.setTextIfMatch(key, JSON.stringify(next), got.etag)) return next;
    }
    throw new Error(`${key} kept changing while saving`);
  }

  const getSong = (id: string) => readJson<Song>(`songs/${id}`);
  const getTrack = (id: string) => readJson<Track>(`tracks/${id}`);

  /** Takes a song out of every setlist (the song record itself is deleted by the caller). */
  async function removeSongFromGigs(id: string) {
    for (const found of await readAll<StoredGig>("gigs/")) {
      if (!songIdsOf(setlistOf(found)).includes(id)) continue;
      // Checked again inside modify: the gig may have been edited since the listing.
      await modify<StoredGig>(`gigs/${found.id}`, (g) => {
        const items = setlistOf(g);
        if (!songIdsOf(items).includes(id)) return null;
        const setlist = items.filter((item) => item.type === "break" || item.songId !== id);
        return { id: g.id, name: g.name, date: g.date, setlist, updatedAt: nextStamp(g.updatedAt) };
      });
    }
  }

  /**
   * Deletes a song and/or its recording. Everything that points at them goes first and the record
   * named by `last` goes last, so a failure part-way leaves that record in place and deleting it
   * again simply finishes the job (the caller looks it up again and gets the same ids).
   */
  async function deleteSongAndTrack(songId: string | null, trackId: string | null, last: "song" | "track") {
    if (songId) await removeSongFromGigs(songId);
    if (trackId) for (const k of await kv.list(`audio/${trackId}/`)) await kv.delete(k);
    const song = songId ? [`songs/${songId}`] : [];
    const track = trackId ? [`tracks/${trackId}`] : [];
    for (const k of last === "song" ? [...track, ...song] : [...song, ...track]) await kv.delete(k);
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
    const song = blankSong({ id: t.songId ? crypto.randomUUID() : t.id, title: t.title, artist: "", trackId: t.id });
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
        .map(toSongSummary)
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
    /**
     * Turns a playlist into songs: a track matching an existing song (same title and artist,
     * ignoring case and spacing) reuses it; the rest become songs with no key or chords yet.
     * Returns one song per distinct track, in playlist order. Safe to repeat.
     */
    async importSongs(input: unknown): Promise<Song[]> {
      const tracks = uniqueTracks(checkTracks(input));
      const byKey = songsByMatchKey(await readAll<Song>("songs/"));
      const out: Song[] = [];
      for (const t of tracks) {
        const found = byKey.get(songMatchKey(t.title, t.artist));
        if (found) {
          out.push(found);
          continue;
        }
        const song = blankSong({ id: crypto.randomUUID(), title: t.title, artist: t.artist });
        await writeJson(`songs/${song.id}`, song);
        out.push(song);
      }
      return out;
    },
    /** With `baseVersion` (the `updatedAt` the client loaded), refuses to save over someone else's change. */
    async updateSong(id: string, patch: Partial<SongInput> & BaseVersion): Promise<Song> {
      const clean = cleanSong(patch, true);
      const base = checkBaseVersion(patch);
      const next = await modify<Song>(`songs/${id}`, (cur) => {
        checkVersion(cur.updatedAt, base, "song", cur);
        return withKeys({ ...cur, ...clean, id, updatedAt: nextStamp(cur.updatedAt) });
      });
      if (!next) throw new NotFoundError("song not found");
      if (clean.title !== undefined && next.trackId) {
        const t = await getTrack(next.trackId);
        if (t) await writeJson(`tracks/${t.id}`, { ...t, title: clean.title });
      }
      return next;
    },
    async deleteSong(id: string): Promise<void> {
      const cur = await getSong(id);
      if (!cur) throw new NotFoundError("song not found");
      const t = cur.trackId ? await getTrack(cur.trackId) : null;
      await deleteSongAndTrack(id, t && t.songId === id ? t.id : null, "song");
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
      const stored: StoredGig = {
        id: crypto.randomUUID(),
        name: clean.name!,
        date: clean.date!,
        setlist: clean.setlist!,
        updatedAt: nextStamp(),
      };
      await writeJson(`gigs/${stored.id}`, stored);
      return toGig(stored);
    },
    /** With `baseVersion` (the `updatedAt` the client loaded), refuses to save over someone else's change. */
    async updateGig(id: string, patch: Partial<GigInput> & BaseVersion): Promise<Gig> {
      const base = checkBaseVersion(patch);
      let next: StoredGig | null;
      try {
        next = await modify<StoredGig>(`gigs/${id}`, (cur) => {
          checkVersion(cur.updatedAt, base, "gig", null);
          const clean = cleanGig(patch, true, setlistOf(cur));
          return {
            id,
            name: clean.name ?? cur.name,
            date: clean.date ?? cur.date,
            setlist: clean.setlist ?? setlistOf(cur),
            updatedAt: nextStamp(cur.updatedAt),
          };
        });
      } catch (e) {
        // Send back the gig the way getGig shows it, so a reload and a conflict can't disagree.
        if (e instanceof ConflictError) throw new ConflictError(e.message, await getGig(id));
        throw e;
      }
      if (!next) throw new NotFoundError("gig not found");
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
      if (t.songId) {
        await modify<Song>(`songs/${t.songId}`, (song) => ({ ...song, title: clean, updatedAt: nextStamp(song.updatedAt) }));
      }
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
      const song = t.songId ? await getSong(t.songId) : null;
      await deleteSongAndTrack(song ? song.id : null, id, "track");
    },
  };
}

export type Repo = ReturnType<typeof makeRepo>;
