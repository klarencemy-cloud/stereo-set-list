/** One track from a playlist (Spotify or a pasted list), before it becomes a song. */
export interface PlaylistTrack {
  title: string;
  artist: string;
}

/** What reading a Spotify playlist returns. */
export interface PlaylistResult {
  name: string;
  tracks: PlaylistTrack[];
  /** Spotify's page shows at most this many tracks; a full page may mean more were left out. */
  truncated: boolean;
}

/** Most tracks Spotify's public playlist page shows. */
export const SPOTIFY_PAGE_TRACKS = 100;

const normaliseForMatch = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Two songs are "the same" when their titles and artists match ignoring case and extra spaces.
 * Look songs up by this key through `songsByMatchKey`, so the server and client pick the same song.
 */
export function songMatchKey(title: string, artist: string): string {
  return `${normaliseForMatch(title)}\u0000${normaliseForMatch(artist)}`;
}

/**
 * Songs by match key. When several songs share a key, the one with the smallest id wins, whatever
 * order they come in. Used by both the server (reuse-or-create) and the client (the "in Songs"
 * marker), so the two always agree on which song a track matches.
 */
export function songsByMatchKey<T extends { id: string; title: string; artist: string }>(songs: T[]): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const s of songs) {
    const k = songMatchKey(s.title, s.artist);
    const cur = byKey.get(k);
    if (!cur || s.id < cur.id) byKey.set(k, s);
  }
  return byKey;
}

/** Keeps the first of any tracks that match each other. */
export function uniqueTracks(tracks: PlaylistTrack[]): PlaylistTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const k = songMatchKey(t.title, t.artist);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Reads a pasted list, one "Title - Artist" per line (split on the last " - " or " – "). */
export function parseTrackList(text: string): PlaylistTrack[] {
  const out: PlaylistTrack[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const at = Math.max(line.lastIndexOf(" - "), line.lastIndexOf(" – "));
    if (at === -1) out.push({ title: line, artist: "" });
    else out.push({ title: line.slice(0, at).trim(), artist: line.slice(at + 3).trim() });
  }
  return out;
}
