import { CHUNK_SIZE, MAX_AUDIO_BYTES } from "../../../src/shared/types";
import type { Gig, GigInput, Song, SongInput, SongSummary, Track } from "../../../src/shared/types";
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
} as const;

const SONG_FIELDS = ["title", "artist", "sourceUrl", "originalKey", "bandKey", "capo", "content"] as const;
const GIG_FIELDS = ["name", "date", "songIds"] as const;

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
      if (typeof v !== "string" || !isValidKey(v)) {
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

function checkGigField(field: (typeof GIG_FIELDS)[number], v: unknown): unknown {
  switch (field) {
    case "name":
      if (typeof v === "string" && !v.trim()) throw new ValidationError("name is required");
      return checkString(field, v, LIMITS.gigName);
    case "date":
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new ValidationError("date must be YYYY-MM-DD");
      }
      return v;
    case "songIds":
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        throw new ValidationError("songIds must be a list of song ids");
      }
      if (v.length > LIMITS.gigSongs) throw new ValidationError(`a setlist can hold at most ${LIMITS.gigSongs} songs`);
      return [...v];
  }
}

function cleanGig(input: unknown, partial: boolean): Partial<GigInput> {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of GIG_FIELDS) {
    if (!(f in src)) {
      if (partial) continue;
      throw new ValidationError(`${f} is required`);
    }
    out[f] = checkGigField(f, src[f]);
  }
  return out as Partial<GigInput>;
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

  async function getGig(id: string): Promise<Gig | null> {
    const g = await readJson<Gig>(`gigs/${id}`);
    if (!g) return null;
    const present = await Promise.all(
      g.songIds.map(async (sid) => ((await kv.getText(`songs/${sid}`)) !== null ? sid : null)),
    );
    return { ...g, songIds: present.filter((x): x is string => x !== null) };
  }

  return {
    async listSongs(): Promise<SongSummary[]> {
      const songs = await readAll<Song>("songs/");
      return songs
        .map(({ content: _content, ...summary }) => summary)
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    },
    getSong,
    async createSong(input: SongInput): Promise<Song> {
      const clean = cleanSong(input, false) as SongInput;
      const song: Song = { ...clean, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
      await writeJson(`songs/${song.id}`, song);
      return song;
    },
    async updateSong(id: string, patch: Partial<SongInput>): Promise<Song> {
      const cur = await getSong(id);
      if (!cur) throw new NotFoundError("song not found");
      const next: Song = { ...cur, ...cleanSong(patch, true), id, updatedAt: new Date().toISOString() };
      await writeJson(`songs/${id}`, next);
      return next;
    },
    async deleteSong(id: string): Promise<void> {
      if (!(await getSong(id))) throw new NotFoundError("song not found");
      await kv.delete(`songs/${id}`);
      const gigs = await readAll<Gig>("gigs/");
      for (const g of gigs) {
        if (g.songIds.includes(id)) {
          await writeJson(`gigs/${g.id}`, { ...g, songIds: g.songIds.filter((s) => s !== id) });
        }
      }
    },

    async listGigs(): Promise<Gig[]> {
      const gigs = await readAll<Gig>("gigs/");
      return gigs.sort((a, b) => b.date.localeCompare(a.date));
    },
    getGig,
    async createGig(input: GigInput): Promise<Gig> {
      const clean = cleanGig(input, false) as GigInput;
      const gig: Gig = { name: clean.name, date: clean.date, songIds: clean.songIds, id: crypto.randomUUID() };
      await writeJson(`gigs/${gig.id}`, gig);
      return gig;
    },
    async updateGig(id: string, patch: Partial<GigInput>): Promise<Gig> {
      const cur = await readJson<Gig>(`gigs/${id}`);
      if (!cur) throw new NotFoundError("gig not found");
      const next: Gig = { ...cur, ...cleanGig(patch, true), id };
      await writeJson(`gigs/${id}`, next);
      return next;
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
      const t = await readJson<Track>(`tracks/${id}`);
      if (!t) throw new NotFoundError("track not found");
      const next: Track = { ...t, title: title.trim() };
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
      await writeJson(`tracks/${id}`, { ...t, uploadedParts });
    },
    async getTrackPart(id: string, n: number): Promise<ArrayBuffer | null> {
      return kv.getBytes(`audio/${id}/${n}`);
    },
    async deleteTrack(id: string): Promise<void> {
      if ((await kv.getText(`tracks/${id}`)) === null) throw new NotFoundError("track not found");
      for (const k of await kv.list(`audio/${id}/`)) await kv.delete(k);
      await kv.delete(`tracks/${id}`);
    },
  };
}

export type Repo = ReturnType<typeof makeRepo>;
