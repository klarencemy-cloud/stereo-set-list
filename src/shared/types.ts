export interface Song {
  id: string;
  title: string;
  artist: string;
  sourceUrl: string | null;
  originalKey: string;
  bandKey: string;
  capo: number;
  content: string;
  /** The mp3 of an original song. Set by the server only; missing on regular songs. */
  trackId?: string | null;
  updatedAt: string;
}
export type SongInput = Omit<Song, "id" | "updatedAt" | "trackId">;
/** What the song list returns: everything except the chord sheet. */
export type SongSummary = Omit<Song, "content">;

export type SetlistItem =
  | { type: "song"; songId: string; note?: string }
  | { type: "break"; id: string; label: string };

export interface Gig {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  setlist: SetlistItem[];
  /** Derived from `setlist`, read-only. Kept so offline copies and older clients keep working. */
  songIds: string[];
}
export interface GigInput {
  name: string;
  date: string;
  setlist?: SetlistItem[];
}

export interface Track {
  id: string;
  title: string;
  size: number;
  parts: number;
  uploadedParts: number;
  /** The song page for this recording. Missing on tracks uploaded before songs were linked. */
  songId?: string | null;
  createdAt: string;
}

export type ImportedSong = Omit<SongInput, "bandKey">;

/** Audio is uploaded in chunks of at most this many bytes. */
export const CHUNK_SIZE = 3_145_728;
/** Largest accepted audio file. */
export const MAX_AUDIO_BYTES = 26_214_400;
