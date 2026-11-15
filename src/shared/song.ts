import type { Song, SongSummary } from "./types";

/** A song as it appears in lists: no sheet, just whether it has one. Every list goes through this. */
export function toSongSummary({ content, ...rest }: Song): SongSummary {
  return { ...rest, hasChords: content.trim() !== "" };
}

/**
 * The song's tempo, unknown as null. Copies saved before the fields existed (offline, or an older
 * server) have them missing; this reads that as unknown too.
 */
export function songTempo(song: Pick<Song, "bpm" | "beatsPerBar">): { bpm: number | null; beatsPerBar: number | null } {
  return { bpm: song.bpm ?? null, beatsPerBar: song.beatsPerBar ?? null };
}
