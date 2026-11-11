import { CHUNK_SIZE, MAX_AUDIO_BYTES } from "../../../src/shared/types";
import type { Gig, GigInput, Song, SongInput, Track } from "../../../src/shared/types";
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

  function checkGig(g: GigInput) {
    if (!g.name || !g.name.trim()) throw new ValidationError("name is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) throw new ValidationError("date must be YYYY-MM-DD");
    if (!Array.isArray(g.songIds)) throw new ValidationError("songIds must be a list");
  }

  return {
    async listSongs(): Promise<Song[]> {
      const songs = await readAll<Song>("songs/");
      return songs.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    },
    getSong,
    async createSong(input: SongInput): Promise<Song> {
      if (!input.title || !input.title.trim()) throw new ValidationError("title is required");
      const song: Song = { ...input, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
      await writeJson(`songs/${song.id}`, song);
      return song;
    },
    async updateSong(id: string, patch: Partial<SongInput>): Promise<Song> {
      const cur = await getSong(id);
      if (!cur) throw new NotFoundError("song not found");
      const next: Song = { ...cur, ...patch, id, updatedAt: new Date().toISOString() };
      if (!next.title || !next.title.trim()) throw new ValidationError("title is required");
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
      checkGig(input);
      const gig: Gig = { name: input.name, date: input.date, songIds: input.songIds, id: crypto.randomUUID() };
      await writeJson(`gigs/${gig.id}`, gig);
      return gig;
    },
    async updateGig(id: string, patch: Partial<GigInput>): Promise<Gig> {
      const cur = await readJson<Gig>(`gigs/${id}`);
      if (!cur) throw new NotFoundError("gig not found");
      const next: Gig = { ...cur, ...patch, id };
      checkGig(next);
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
