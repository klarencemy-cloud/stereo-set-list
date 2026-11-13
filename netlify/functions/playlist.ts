import type { Config } from "@netlify/functions";
import { PlaylistError, importPlaylist } from "./lib/spotify";
import { guard, json } from "./lib/http";

const UNREADABLE = "Couldn't read that playlist. Paste the track list instead.";
const MESSAGES = {
  not_spotify: "That link isn't a Spotify playlist",
  blocked: UNREADABLE,
  parse: UNREADABLE,
  empty: UNREADABLE,
} as const;

export default guard(async (req) => {
  // Not methodNotAllowed(): every error from this endpoint carries a `code`, so this one does too.
  if (req.method !== "POST") return json({ code: "method", message: "Method not allowed" }, 405);
  let url: unknown;
  try {
    url = ((await req.json()) as { url?: unknown })?.url;
  } catch {
    url = undefined;
  }
  try {
    return json(await importPlaylist(typeof url === "string" ? url : ""));
  } catch (e) {
    if (e instanceof PlaylistError) return json({ code: e.code, message: MESSAGES[e.code] }, 422);
    throw e;
  }
});

export const config: Config = { path: "/api/playlist" };
