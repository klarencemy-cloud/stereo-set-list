import { isTabLine, lyricsOnly, parseSheet, transposeContent } from "./sheet";
import type { SheetLine, SheetPart } from "./sheet";
import type { Song } from "./types";

type Line = Extract<SheetLine, { kind: "line" }>;

/**
 * A piece of a chord line with the lyric under it. A long pair wraps between segments, never inside one, so the
 * chord and lyric lines break at the same word and every chord stays over its word.
 */
export interface PrintSegment {
  chord: SheetPart[];
  lyric: string;
}

/** A plain line, or a chord line joined to the lyric line under it (`lyric` false when there is none). */
export type PrintRow =
  | { kind: "line"; parts: SheetPart[] }
  | { kind: "pair"; lyric: boolean; segments: PrintSegment[] };

/** A run of lines under one section label (null for lines before the first label), printed without a page break. */
export interface PrintBlock {
  label: string | null;
  rows: PrintRow[];
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

/** What a print editor is printing, which names the PDF it saves. */
export type PrintFile = { kind: "floor" | "gigLyrics" | "songLyrics"; name: string };

export function printFileName({ kind, name }: PrintFile): string {
  const what = kind === "floor" ? "Floor sheet" : kind === "gigLyrics" ? "Lyric sheets" : "Lyric sheet";
  return `${name} – ${what}`;
}

function plainOf(parts: SheetPart[]): string {
  return parts.map((p) => (p.type === "chord" ? p.chord : p.text)).join("");
}

function hasChord(line: SheetLine): boolean {
  return line.kind === "line" && line.parts.some((p) => p.type === "chord");
}

/** The parts that fall in columns [start, end). Cuts never land inside a chord, so a chord is never split. */
function sliceParts(parts: SheetPart[], start: number, end: number): SheetPart[] {
  const out: SheetPart[] = [];
  let pos = 0;
  for (const p of parts) {
    const len = p.type === "chord" ? p.chord.length : p.text.length;
    if (p.type === "chord") {
      if (pos >= start && pos < end) out.push(p);
    } else {
      const from = Math.max(pos, start);
      const to = Math.min(pos + len, end);
      if (to > from) out.push({ type: "text", text: p.text.slice(from - pos, to - pos) });
    }
    pos += len;
  }
  return out;
}

/** Cuts a chord line and its lyric into segments, each starting where a lyric word (or, past the lyric, a chord) starts. */
function pairOf(chordLine: Line, lyric: string | null): PrintRow {
  const top = plainOf(chordLine.parts);
  const words = lyric ?? "";
  const len = Math.max(top.length, words.length);
  const isMark = (i: number) => i < top.length && top[i] !== " ";
  const cuts = [0];
  for (let i = 1; i < len; i++) {
    // Never cut through a chord (or a mark like x2) on the chord line.
    if (isMark(i - 1) && isMark(i)) continue;
    const starts = i < words.length ? words[i - 1] === " " && words[i] !== " " : isMark(i) && !isMark(i - 1);
    if (starts) cuts.push(i);
  }
  cuts.push(len);
  const segments: PrintSegment[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [start, end] = [cuts[k], cuts[k + 1]];
    segments.push({ chord: sliceParts(chordLine.parts, start, end), lyric: words.slice(start, end) });
  }
  return { kind: "pair", lyric: lyric !== null, segments };
}

/** A line of words that can sit under a chord line: not blank, not a chord line, not guitar tab. */
function isLyric(line: SheetLine | undefined): line is Line {
  if (line === undefined || line.kind !== "line" || hasChord(line)) return false;
  return plainOf(line.parts).trim() !== "" && !isTabLine(line);
}

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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === "section") {
      blocks.push({ label: line.label, rows: [] });
      continue;
    }
    if (blocks.length === 0) blocks.push({ label: null, rows: [] });
    const rows = blocks[blocks.length - 1].rows;
    if (!hasChord(line)) {
      rows.push({ kind: "line", parts: line.parts });
      continue;
    }
    const next = lines[i + 1];
    if (isLyric(next)) {
      rows.push(pairOf(line, plainOf(next.parts)));
      i++;
    } else {
      rows.push(pairOf(line, null));
    }
  }
  return { ...base, empty: false, blocks };
}
