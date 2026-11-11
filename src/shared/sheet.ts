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
