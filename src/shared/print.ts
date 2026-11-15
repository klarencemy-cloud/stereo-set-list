import { lyricsOnly, parseSheet, transposeContent } from "./sheet";
import type { SheetLine } from "./sheet";
import type { Song } from "./types";

/** A run of lines under one section label (null for lines before the first label), printed without a page break. */
export interface PrintBlock {
  label: string | null;
  lines: Extract<SheetLine, { kind: "line" }>[];
}

export interface PrintableSong {
  id: string;
  title: string;
  /** "Artist · Key: A · Capo 2", leaving out whatever isn't known. */
  meta: string;
  /** True when the song has no lyrics or chords yet: print the title and say so. */
  empty: boolean;
  blocks: PrintBlock[];
}

export type PrintSource = Pick<Song, "id" | "title" | "artist" | "originalKey" | "bandKey" | "capo" | "content">;

/** One song laid out for the printed lyrics sheet, in the band key, with or without the chords. */
export function printableSong(song: PrintSource, withChords: boolean): PrintableSong {
  const meta = [song.artist, song.bandKey ? `Key: ${song.bandKey}` : "", song.capo > 0 ? `Capo ${song.capo}` : ""]
    .filter((s) => s)
    .join(" · ");
  const base = { id: song.id, title: song.title, meta };
  if (song.content.trim() === "") return { ...base, empty: true, blocks: [] };

  let content = song.content;
  try {
    content = transposeContent(song.content, song.originalKey, song.bandKey);
  } catch {
    // A key we can't read: print the sheet as written, the same as the song page shows it.
  }
  const parsed = parseSheet(content);
  const lines = withChords ? parsed : lyricsOnly(parsed);

  const blocks: PrintBlock[] = [];
  for (const line of lines) {
    if (line.kind === "section") blocks.push({ label: line.label, lines: [] });
    else {
      if (blocks.length === 0) blocks.push({ label: null, lines: [] });
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return { ...base, empty: false, blocks };
}
