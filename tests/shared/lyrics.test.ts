import { describe, expect, it } from "vitest";
import { lyricsOnly, parseSheet, type SheetLine } from "../../src/shared/sheet";

/** Lines as plain strings: sections as "[Label]", lines as their text, so expectations stay readable. */
function show(lines: SheetLine[]): string[] {
  return lines.map((l) =>
    l.kind === "section" ? `[${l.label}]` : l.parts.map((p) => (p.type === "chord" ? `<${p.chord}>` : p.text)).join(""),
  );
}

const lyrics = (content: string) => show(lyricsOnly(parseSheet(content)));

describe("lyricsOnly", () => {
  it("drops lines that hold only chords, so lyric lines sit together", () => {
    const src = "[Verse 1]\n[ch]G[/ch]     [ch]C[/ch]\nHello there\n[ch]D[/ch]\nGeneral Kenobi";
    expect(lyrics(src)).toEqual(["[Verse 1]", "Hello there", "General Kenobi"]);
  });

  it("treats repeat marks and bar lines on a chord line as chords-only", () => {
    const src = "[ch]G[/ch] | [ch]C[/ch] |  x2\n[ch]Am[/ch] - [ch]F[/ch] (x4)\nwords";
    expect(lyrics(src)).toEqual(["words"]);
  });

  it("removes inline chords from mixed lines and closes the gaps they leave", () => {
    const src = "[ch]G[/ch]Hello [ch]C[/ch]  world   [ch]D[/ch]";
    expect(lyrics(src)).toEqual(["Hello world"]);
  });

  it("keeps every section label, even when its body was all chords", () => {
    const src = "[Intro]\n[ch]G[/ch] [ch]C[/ch]\n\n[Verse 1]\nla la\n\n[Instrumental]\n[ch]Em[/ch] [ch]D[/ch]\n\n[Chorus]\nsing";
    // An emptied section is followed straight by the next label: no blank line after a label.
    expect(lyrics(src)).toEqual(["[Intro]", "[Verse 1]", "la la", "", "[Instrumental]", "[Chorus]", "sing"]);
  });

  it("collapses runs of blank lines to one and trims them at the start and end", () => {
    const src = "\n\nline one\n\n\n[ch]G[/ch]\n\nline two\n\n";
    expect(lyrics(src)).toEqual(["line one", "", "line two"]);
  });

  it("drops a blank line right after a section label", () => {
    expect(lyrics("[Chorus]\n\n[ch]G[/ch]\nsing it")).toEqual(["[Chorus]", "sing it"]);
  });

  it("drops guitar tab string rows", () => {
    const src = "[Riff]\ne|---0---|\nB|---1---|\nG|---0---|\nwords";
    expect(lyrics(src)).toEqual(["[Riff]", "words"]);
  });

  it("leaves lyric lines without chords exactly as written", () => {
    expect(lyrics("  indented   words  ")).toEqual(["  indented   words  "]);
  });

  it("returns nothing for empty content", () => {
    expect(lyricsOnly(parseSheet(""))).toEqual([]);
    expect(lyricsOnly([])).toEqual([]);
  });

  it("never returns a chord part", () => {
    const out = lyricsOnly(parseSheet("[ch]G[/ch]Hi [ch]C[/ch]there\n[ch]D[/ch]"));
    expect(out.every((l) => l.kind === "section" || l.parts.every((p) => p.type === "text"))).toBe(true);
  });
});
