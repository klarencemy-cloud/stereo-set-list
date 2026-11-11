export interface Song {
  id: string;
  title: string;
  artist: string;
  sourceUrl: string | null;
  originalKey: string;
  bandKey: string;
  capo: number;
  content: string;
  updatedAt: string;
}
export type SongInput = Omit<Song, "id" | "updatedAt">;
/** What the song list returns: everything except the chord sheet. */
export type SongSummary = Omit<Song, "content">;

export interface Gig {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  songIds: string[];
}
export type GigInput = Omit<Gig, "id">;

export interface Track {
  id: string;
  title: string;
  size: number;
  parts: number;
  uploadedParts: number;
  createdAt: string;
}

export type ImportedSong = Omit<SongInput, "bandKey">;

/** Audio is uploaded in chunks of at most this many bytes. */
export const CHUNK_SIZE = 3_145_728;
/** Largest accepted audio file. */
export const MAX_AUDIO_BYTES = 26_214_400;
