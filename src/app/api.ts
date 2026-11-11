import type { Gig, GigInput, ImportedSong, Song, SongInput, SongSummary, Track } from "../shared/types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
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
    try {
      const body = await res.json();
      if (body && typeof body.message === "string") message = body.message;
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

function send(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  listSongs: () => json<SongSummary[]>("/api/songs"),
  getSong: (id: string) => json<Song>(`/api/songs/${id}`),
  createSong: (input: SongInput) => json<Song>("/api/songs", send("POST", input)),
  updateSong: (id: string, patch: Partial<SongInput>) => json<Song>(`/api/songs/${id}`, send("PUT", patch)),
  deleteSong: async (id: string): Promise<void> => {
    await request(`/api/songs/${id}`, { method: "DELETE" });
  },

  listGigs: () => json<Gig[]>("/api/gigs"),
  getGig: (id: string) => json<Gig>(`/api/gigs/${id}`),
  createGig: (input: GigInput) => json<Gig>("/api/gigs", send("POST", input)),
  updateGig: (id: string, patch: Partial<GigInput>) => json<Gig>(`/api/gigs/${id}`, send("PUT", patch)),
  deleteGig: async (id: string): Promise<void> => {
    await request(`/api/gigs/${id}`, { method: "DELETE" });
  },

  listTracks: () => json<Track[]>("/api/tracks"),
  createTrack: (title: string, size: number) => json<Track>("/api/tracks", send("POST", { title, size })),
  putTrackPart: async (id: string, n: number, bytes: Blob | ArrayBuffer): Promise<void> => {
    await request(`/api/tracks/${id}/parts/${n}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
  },
  getTrackPart: async (id: string, n: number): Promise<ArrayBuffer> =>
    (await request(`/api/tracks/${id}/parts/${n}`)).arrayBuffer(),
  deleteTrack: async (id: string): Promise<void> => {
    await request(`/api/tracks/${id}`, { method: "DELETE" });
  },

  importSong: (url: string) => json<ImportedSong>("/api/import", send("POST", { url })),
};
