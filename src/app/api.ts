import type { PlaylistResult, PlaylistTrack } from "../shared/playlist";
import type { Gig, GigInput, ImportedSong, Song, SongInput, SongSummary, Track } from "../shared/types";

export class ApiError extends Error {
  status: number;
  /** On a 409 (someone else saved first): the record as it is stored now. */
  current?: unknown;
  constructor(status: number, message: string, current?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.current = current;
  }
}

/** The stored record from a 409, i.e. someone else changed it since this page loaded it; else null. */
export function conflictOf<T>(e: unknown): T | null {
  return e instanceof ApiError && e.status === 409 && e.current ? (e.current as T) : null;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  if (!res.ok) {
    let message = `Something went wrong (${res.status})`;
    let current: unknown;
    try {
      const body = await res.json();
      if (body && typeof body.message === "string") message = body.message;
      if (body && typeof body.current === "object") current = body.current;
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message, current);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

// Tells the offline service worker to wait for the server rather than answer from its saved
// copy after a timeout. Same value as FRESH_HEADER in src/sw/strategy.ts (not imported, so the
// worker build stays a single file; tests/app/api.test.ts checks they match).
const FRESH_HEADER = "X-Fresh";

function send(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** What a change on the server made stale: song ids and gig ids (their setlists), or "all". */
export interface Change {
  songs?: string[] | "all";
  setlists?: string[] | "all";
}

const listeners = new Set<(change: Change) => void>();

/**
 * Tells a client-side cache (songCache) what each successful change made stale, so pages never
 * have to remember to clear it. Returns a function that stops listening.
 */
export function onChange(listener: (change: Change) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runs a change and then tells the listeners what it touched. */
async function changing<T>(change: Change | ((result: T) => Change), run: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (e) {
    // A conflict means the saved copy is out of date too.
    if (e instanceof ApiError && e.status === 409 && typeof change !== "function") {
      for (const l of listeners) l(change);
    }
    throw e;
  }
  const touched = typeof change === "function" ? change(result) : change;
  for (const l of listeners) l(touched);
  return result;
}

export const api = {
  listSongs: () => json<SongSummary[]>("/api/songs"),
  getSong: (id: string, opts?: { fresh?: boolean }) =>
    json<Song>(`/api/songs/${id}`, opts?.fresh ? { headers: { [FRESH_HEADER]: "1" } } : undefined),
  // New songs aren't in anything cached yet, so creating one makes nothing stale.
  createSong: (input: SongInput) => json<Song>("/api/songs", send("POST", input)),
  importSongs: (tracks: PlaylistTrack[]) => json<Song[]>("/api/songs/batch", send("POST", { tracks })),
  /** `baseVersion`: the `updatedAt` this page loaded. The server refuses (409) if the song changed since. */
  updateSong: (id: string, patch: Partial<SongInput>, baseVersion?: string) =>
    changing({ songs: [id] }, () => json<Song>(`/api/songs/${id}`, send("PUT", { ...patch, baseVersion }))),
  // The server also takes the song out of every setlist.
  deleteSong: (id: string): Promise<void> =>
    changing({ songs: [id], setlists: "all" }, async () => {
      await request(`/api/songs/${id}`, { method: "DELETE" });
    }),

  listGigs: () => json<Gig[]>("/api/gigs"),
  getGig: (id: string) => json<Gig>(`/api/gigs/${id}`),
  createGig: (input: GigInput) => json<Gig>("/api/gigs", send("POST", input)),
  /** `baseVersion`: the `updatedAt` this page loaded. The server refuses (409) if the gig changed since. */
  updateGig: (id: string, patch: Partial<GigInput>, baseVersion?: string) =>
    changing({ setlists: [id] }, () => json<Gig>(`/api/gigs/${id}`, send("PUT", { ...patch, baseVersion }))),
  deleteGig: (id: string): Promise<void> =>
    changing({ setlists: [id] }, async () => {
      await request(`/api/gigs/${id}`, { method: "DELETE" });
    }),

  listTracks: () => json<Track[]>("/api/tracks"),
  getTrack: (id: string) => json<Track>(`/api/tracks/${id}`),
  linkTrackSong: (id: string) => json<Song>(`/api/tracks/${id}/song`, { method: "POST" }),
  createTrack: (title: string, size: number) => json<Track>("/api/tracks", send("POST", { title, size })),
  // The server renames the linked song too.
  updateTrack: (id: string, title: string) =>
    changing(
      (t: Track) => ({ songs: t.songId ? [t.songId] : [] }),
      () => json<Track>(`/api/tracks/${id}`, send("PUT", { title })),
    ),
  putTrackPart: async (id: string, n: number, bytes: Blob | ArrayBuffer): Promise<void> => {
    await request(`/api/tracks/${id}/parts/${n}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
  },
  getTrackPart: async (id: string, n: number): Promise<ArrayBuffer> =>
    (await request(`/api/tracks/${id}/parts/${n}`)).arrayBuffer(),
  // The server also deletes the linked song (whose id isn't known here) and takes it out of setlists.
  deleteTrack: (id: string): Promise<void> =>
    changing({ songs: "all", setlists: "all" }, async () => {
      await request(`/api/tracks/${id}`, { method: "DELETE" });
    }),

  importSong: (url: string) => json<ImportedSong>("/api/import", send("POST", { url })),
  readPlaylist: (url: string) => json<PlaylistResult>("/api/playlist", send("POST", { url })),
};
