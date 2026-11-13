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

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Two songs are "the same" when their titles and artists match ignoring case and extra spaces.
 * Used by both the server (reuse-or-create) and the client (the "in Songs" marker), so they agree.
 */
export function songMatchKey(title: string, artist: string): string {
  return `${norm(title)}\u0000${norm(artist)}`;
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
