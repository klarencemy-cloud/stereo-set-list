/**
 * A song's original recording on Spotify, stored as its track id. Used by the client (the edit form
 * and the song page's player), the server (validation) and the playlist reader, so all three accept
 * the same links.
 */

/** Spotify track ids are 22 base-62 characters. */
const TRACK_ID = /^[A-Za-z0-9]{22}$/;

export function isSpotifyTrackId(v: unknown): v is string {
  return typeof v === "string" && TRACK_ID.test(v);
}

/**
 * The track id from a Spotify track link (open.spotify.com/track/…, including share links with
 * ?si=, intl-xx links and embed links) or a spotify:track: URI. Null for anything else, including
 * album, playlist and artist links.
 */
export function spotifyTrackIdFrom(input: string): string | null {
  const s = input.trim();
  const uri = s.match(/^spotify:track:([^:]+)$/);
  if (uri) return isSpotifyTrackId(uri[1]) ? uri[1] : null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "open.spotify.com") return null;
  const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/|embed\/)?track\/([^/]+)\/?$/i);
  return m && isSpotifyTrackId(m[1]) ? m[1] : null;
}

/** The track's page: on a phone it opens the Spotify app. */
export const spotifyTrackUrl = (id: string) => `https://open.spotify.com/track/${id}`;

/** Spotify's embedded player for the track. */
export const spotifyEmbedUrl = (id: string) => `https://open.spotify.com/embed/track/${id}`;
