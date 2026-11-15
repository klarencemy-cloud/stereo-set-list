import { isChord, prefersFlats, semitonesBetween, transposeChord } from "./transpose";

export type SheetPart = { type: "text"; text: string } | { type: "chord"; chord: string };
export type SheetLine =
  | { kind: "section"; label: string }
  | { kind: "line"; parts: SheetPart[] };

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;

function parseLine(line: string): SheetPart[] {
  const parts: SheetPart[] = [];
  const re = /\[ch\](.*?)\[\/ch\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push({ type: "text", text: line.slice(last, m.index) });
    parts.push({ type: "chord", chord: m[1] });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ type: "text", text: line.slice(last) });
  return parts;
}

export function parseSheet(content: string): SheetLine[] {
  const lines = content.replace(/\r\n?/g, "\n").replace(/\[\/?tab\]/g, "").split("\n");
  return lines.map((line): SheetLine => {
    const s = SECTION_RE.exec(line);
    if (s && s[1] !== "ch" && s[1] !== "/ch") return { kind: "section", label: s[1] };
    return { kind: "line", parts: parseLine(line) };
  });
}

export function transposeContent(content: string, fromKey: string, toKey: string): string {
  const semitones = semitonesBetween(fromKey, toKey);
  const useFlats = prefersFlats(toKey);
  return content
    .split("\n")
    .map((line) =>
      line.replace(
        /\[ch\](.*?)\[\/ch\]( *)/g,
        (match: string, chord: string, spaces: string, offset: number) => {
          const next = transposeChord(chord, semitones, useFlats);
          const delta = next.length - chord.length;
          let pad = spaces;
          // Never remove the last space, or neighbouring chords would merge.
          if (delta > 0) pad = spaces.slice(Math.min(delta, Math.max(spaces.length - 1, 0)));
          else if (delta < 0 && line.slice(offset + match.length).replace(/\r$/, "").length > 0) {
            pad = spaces + " ".repeat(-delta);
          }
          return `[ch]${next}[/ch]${pad}`;
        },
      ),
    )
    .join("\n");
}

function isFillerToken(token: string): boolean {
  return /^x\d+$/i.test(token) || token === "|" || token === "-";
}

export function markupFromPlainText(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const tokens = line.split(/\s+/).filter((t) => t.length > 0);
      const isChordLine =
        tokens.some(isChord) && tokens.every((t) => isChord(t) || isFillerToken(t));
      if (!isChordLine) return line;
      return line.replace(/\S+/g, (t) => (isChord(t) ? `[ch]${t}[/ch]` : t));
    })
    .join("\n");
}

/**
 * Re-applies an edit made in the plain-text view to the stored markup. Lines the user did not change keep
 * their original markup (inline chords, [tab] tags); only changed or new lines go through markupFromPlainText.
 */
export function mergeEditedText(originalMarkup: string, editedPlain: string): string {
  const origLines = originalMarkup.replace(/\r\n?/g, "\n").split("\n");
  const origPlain = origLines.map((l) => plainTextFromMarkup(l));
  const edited = editedPlain.replace(/\r\n?/g, "\n").split("\n");
  const n = origPlain.length;
  const m = edited.length;
  // Longest common subsequence of unchanged lines.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = origPlain[i] === edited[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && origPlain[i] === edited[j]) {
      out.push(origLines[i]);
      i++;
      j++;
    } else if (i < n && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      out.push(markupFromPlainText(edited[j]));
      j++;
    }
  }
  return out.join("\n");
}

type Line = Extract<SheetLine, { kind: "line" }>;

const TAB_LINE_RE = /^[a-gA-G][#b]?\|.*-/;
/** Repeat marks and bar lines that sit on a chord line: x2, (x4), |, ||, -, /, %. */
const CHORD_FILLER_RE = /^(\(?x\d+\)?|\|+|-+|\/+|%)$/i;

function plainOfLine(line: Line): string {
  return line.parts.map((p) => (p.type === "chord" ? p.chord : p.text)).join("");
}

/** A guitar-string row such as `e|--0--2--|`. Chord rows and lyrics never match. */
export function isTabLine(line: SheetLine): line is Line {
  return line.kind === "line" && isTabRow(line);
}

function isTabRow(line: Line): boolean {
  return line.parts.every((p) => p.type === "text") && TAB_LINE_RE.test(plainOfLine(line));
}

function isBlank(line: SheetLine): boolean {
  return line.kind === "line" && line.parts.every((p) => p.type === "text" && p.text.trim() === "");
}

/**
 * The sheet with the chords taken out, for singing from or printing. Chord-only lines and tab rows go, inline
 * chords are cut from mixed lines, and the blank space left behind closes up: at most one blank line in a row,
 * none at the start or end, none straight after a section label. Every section label stays, even one whose body
 * was all chords, so "[Instrumental]" still shows.
 */
export function lyricsOnly(lines: SheetLine[]): SheetLine[] {
  const kept: SheetLine[] = [];
  for (const line of lines) {
    if (line.kind === "section") {
      kept.push(line);
      continue;
    }
    if (isTabRow(line)) continue;
    if (!line.parts.some((p) => p.type === "chord")) {
      kept.push(line);
      continue;
    }
    const text = line.parts.map((p) => (p.type === "text" ? p.text : " ")).join("");
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.every((w) => CHORD_FILLER_RE.test(w))) continue;
    kept.push({ kind: "line", parts: [{ type: "text", text: words.join(" ") }] });
  }
  const out: SheetLine[] = [];
  for (const line of kept) {
    if (isBlank(line)) {
      const prev = out[out.length - 1];
      if (!prev || prev.kind === "section" || isBlank(prev)) continue;
      out.push({ kind: "line", parts: [] });
    } else {
      out.push(line);
    }
  }
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
  return out;
}

/** The reverse of markupFromPlainText: strips [ch]/[tab] tags, leaves [Section] lines alone. */
export function plainTextFromMarkup(markup: string): string {
  return markup
    .replace(/\r\n?/g, "\n")
    .replace(/\[\/?tab\]/g, "")
    .replace(/\[ch\](.*?)\[\/ch\]/g, "$1");
}
