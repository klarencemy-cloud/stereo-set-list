import type { Song, SongSummary } from "./types";

/** A song as it appears in lists: no sheet, just whether it has one. Every list goes through this. */
export function toSongSummary({ content, ...rest }: Song): SongSummary {
  return { ...rest, hasChords: content.trim() !== "" };
}
