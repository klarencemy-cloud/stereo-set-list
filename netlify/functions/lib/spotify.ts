import { SPOTIFY_PAGE_TRACKS, type PlaylistResult, type PlaylistTrack } from "../../../src/shared/playlist";

/**
 * Reads a public Spotify playlist from its embed page, which needs no Spotify account or API key.
 * (Spotify's Web API now needs a Premium developer and a signed-in user, which this site doesn't have.)
 * The page may change without notice, so every failure ends in "paste the track list instead".
 */

export type PlaylistErrorCode = "not_spotify" | "blocked" | "parse" | "empty";

export class PlaylistError extends Error {
  constructor(public code: PlaylistErrorCode) {
    super(code);
    this.name = "PlaylistError";
  }
}

/** Give up on Spotify well before the function's own time limit. */
const FETCH_TIMEOUT_MS = 7000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ID = /^[A-Za-z0-9]{1,64}$/;

/** The playlist id from an open.spotify.com playlist link or a spotify:playlist: URI, or null. */
export function playlistIdFrom(input: string): string | null {
  const s = input.trim();
  const uri = s.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (uri) return ID.test(uri[1]) ? uri[1] : null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "open.spotify.com") return null;
  // /playlist/{id}, /intl-xx/playlist/{id}, /embed/playlist/{id}
  const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/|embed\/)?playlist\/([^/]+)\/?$/i);
  return m && ID.test(m[1]) ? m[1] : null;
}

/** The first object anywhere in the page data that carries a trackList: the playlist itself. */
function findEntity(v: unknown, depth = 0): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || depth > 12) return null;
  if (!Array.isArray(v) && Array.isArray((v as Record<string, unknown>).trackList)) return v as Record<string, unknown>;
  for (const child of Object.values(v)) {
    const found = findEntity(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseSpotifyEmbedHtml(html: string): PlaylistResult {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new PlaylistError("parse");
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new PlaylistError("parse");
  }
  const entity = findEntity(data);
  if (!entity) throw new PlaylistError("parse");
  const list = entity.trackList as unknown[];
  const tracks: PlaylistTrack[] = [];
  for (const raw of list) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const title = typeof t.title === "string" ? t.title.trim() : "";
    if (!title) continue;
    tracks.push({ title, artist: typeof t.subtitle === "string" ? t.subtitle.trim() : "" });
  }
  if (tracks.length === 0) throw new PlaylistError("empty");
  const name = typeof entity.name === "string" ? entity.name : typeof entity.title === "string" ? entity.title : "";
  return { name, tracks, truncated: list.length >= SPOTIFY_PAGE_TRACKS };
}

export async function importPlaylist(url: string, fetchFn: typeof fetch = fetch): Promise<PlaylistResult> {
  const id = playlistIdFrom(url);
  if (!id) throw new PlaylistError("not_spotify");
  let res: Response;
  let html: string;
  try {
    // The URL is built here from a checked id, so following Spotify's own redirects is safe.
    res = await fetchFn(`https://open.spotify.com/embed/playlist/${id}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new PlaylistError("blocked");
    html = await res.text();
  } catch {
    throw new PlaylistError("blocked");
  }
  return parseSpotifyEmbedHtml(html);
}
