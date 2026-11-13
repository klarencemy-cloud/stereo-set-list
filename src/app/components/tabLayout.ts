import type { SheetLine, SheetPart } from "../../shared/sheet";

type Line = Extract<SheetLine, { kind: "line" }>;

const TAB_LINE_RE = /^[a-gA-G][#b]?\|.*-/;

function plainOf(line: Line): string {
  return line.parts.map((p) => (p.type === "chord" ? p.chord : p.text)).join("");
}

/** A guitar-string row such as `e|--0--2--|`. Chord rows and lyrics never match. */
export function isTabLine(line: SheetLine): line is Line {
  return line.kind === "line" && line.parts.every((p) => p.type === "text") && TAB_LINE_RE.test(plainOf(line));
}

/** The parts that fall in columns [start, end). A chord belongs to the piece it starts in. */
function sliceParts(parts: SheetPart[], start: number, end: number): SheetPart[] {
  const out: SheetPart[] = [];
  let pos = 0;
  for (const p of parts) {
    if (p.type === "chord") {
      if (pos >= start && pos < end) out.push(p);
      pos += p.chord.length;
    } else {
      const from = Math.max(pos, start);
      const to = Math.min(pos + p.text.length, end);
      if (to > from) out.push({ type: "text", text: p.text.slice(from - pos, to - pos) });
      pos += p.text.length;
    }
  }
  return out;
}

/**
 * Wraps each guitar-tab block (the six string rows plus the chord row above them) to `cols` columns the way
 * Ultimate Guitar does: first piece of all six strings, then the next piece of all six, so the strings stay
 * stacked. Every other line is returned untouched.
 */
export function layoutTabs(lines: SheetLine[], cols: number): SheetLine[] {
  if (!Number.isFinite(cols) || cols < 1) return lines;
  const width = Math.floor(cols);
  const out: SheetLine[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTabLine(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    let j = i;
    while (j < lines.length && isTabLine(lines[j])) j++;
    const strings = lines.slice(i, j) as Line[];
    i = j;
    const prev = out[out.length - 1];
    const header = prev && prev.kind === "line" && prev.parts.some((p) => p.type === "chord") ? prev : null;
    if (strings.length < 2) {
      out.push(...strings);
      continue;
    }
    const longest = Math.max(...strings.map((s) => plainOf(s).length), header ? plainOf(header).length : 0);
    if (longest <= width) {
      out.push(...strings);
      continue;
    }
    if (header) out.pop();
    for (let start = 0; start < longest; start += width) {
      const end = start + width;
      if (header) {
        const parts = sliceParts(header.parts, start, end);
        if (parts.some((p) => p.type === "chord")) out.push({ kind: "line", parts });
      }
      for (const s of strings) {
        const text = plainOf(s).slice(start, end);
        if (text.length > 0) out.push({ kind: "line", parts: [{ type: "text", text }] });
      }
    }
  }
  return out;
}
