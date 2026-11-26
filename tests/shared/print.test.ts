import { describe, expect, it } from "vitest";
import { printableSong, printFileName } from "../../src/shared/print";

const base = {
  id: "s1",
  title: "Song",
  artist: "The Band",
  originalKey: "G",
  bandKey: "A",
  capo: 0,
  content: "[Verse]\n[ch]G[/ch]   [ch]C[/ch]\nla la",
};

const chordsOf = (p: ReturnType<typeof printableSong>) =>
  p.blocks
    .flatMap((b) => b.rows.flatMap((r) => (r.kind === "line" ? r.parts : r.segments.flatMap((s) => s.chord))))
    .filter((x) => x.type === "chord");

describe("printableSong", () => {
  it("prints chords in the band key", () => {
    const p = printableSong(base, true);
    expect(chordsOf(p).map((c) => (c.type === "chord" ? c.chord : ""))).toEqual(["A", "D"]);
    expect(p.empty).toBe(false);
  });

  it("prints lyrics only, with the section labels", () => {
    const p = printableSong(base, false);
    expect(chordsOf(p)).toEqual([]);
    expect(p.blocks).toEqual([{ label: "Verse", rows: [{ kind: "line", parts: [{ type: "text", text: "la la" }] }] }]);
  });

  it("groups lines into blocks by section, with an unlabelled block for lines before the first label", () => {
    const p = printableSong({ ...base, content: "intro words\n[Chorus]\nsing\n[Bridge]\nhum" }, false);
    expect(p.blocks.map((b) => b.label)).toEqual([null, "Chorus", "Bridge"]);
  });

  it("shows the key and capo when known, and nothing made up when not", () => {
    expect(printableSong({ ...base, capo: 2 }, true).meta).toBe("The Band · Key: A · Capo 2");
    expect(printableSong({ ...base, artist: "", bandKey: "", originalKey: "" }, true).meta).toBe("");
  });

  it("falls back to the sheet as written when the key can't be read", () => {
    const p = printableSong({ ...base, originalKey: "", bandKey: "" }, true);
    expect(chordsOf(p).map((c) => (c.type === "chord" ? c.chord : ""))).toEqual(["G", "C"]);
  });

  it("marks a song with no content as empty, with no blocks", () => {
    const p = printableSong({ ...base, content: "  \n " }, true);
    expect(p.empty).toBe(true);
    expect(p.blocks).toEqual([]);
  });
});

describe("printableSong chord and lyric pairs", () => {
  const rowsOf = (content: string) =>
    printableSong({ ...base, originalKey: "", bandKey: "", content }, true).blocks[0].rows;
  const chord = (c: string) => ({ type: "chord", chord: c });
  const text = (t: string) => ({ type: "text", text: t });

  it("joins a chord line to the lyric under it, cut where a word starts so each chord stays over its word", () => {
    expect(rowsOf("[ch]G[/ch]     [ch]C[/ch]\nHello world there")).toEqual([
      {
        kind: "pair",
        lyric: true,
        segments: [
          { chord: [chord("G"), text("     ")], lyric: "Hello " },
          { chord: [chord("C")], lyric: "world " },
          { chord: [], lyric: "there" },
        ],
      },
    ]);
  });

  it("never cuts through a chord that runs over the start of the next word", () => {
    expect(rowsOf("[ch]Cmaj7[/ch]\nHi there")).toEqual([
      { kind: "pair", lyric: true, segments: [{ chord: [chord("Cmaj7")], lyric: "Hi there" }] },
    ]);
  });

  it("cuts a chord line with no lyric under it at each chord", () => {
    expect(rowsOf("[ch]G[/ch] [ch]C[/ch] [ch]D[/ch]\n\nsing")).toEqual([
      {
        kind: "pair",
        lyric: false,
        segments: [
          { chord: [chord("G"), text(" ")], lyric: "" },
          { chord: [chord("C"), text(" ")], lyric: "" },
          { chord: [chord("D")], lyric: "" },
        ],
      },
      { kind: "line", parts: [] },
      { kind: "line", parts: [text("sing")] },
    ]);
  });

  it("keeps cutting at word starts after the chords run out", () => {
    const rows = rowsOf("[ch]A[/ch]\none two three");
    expect(rows[0].kind === "pair" && rows[0].segments.map((s) => s.lyric)).toEqual(["one ", "two ", "three"]);
  });

  it("does not join a chord line to the guitar tab under it", () => {
    const rows = rowsOf("[ch]E[/ch]\ne|--0--|\nB|--1--|");
    expect(rows.map((r) => r.kind)).toEqual(["pair", "line", "line"]);
    expect(rows[0].kind === "pair" && rows[0].lyric).toBe(false);
  });

  it("prints lyrics only as plain lines, with no pairs", () => {
    const p = printableSong({ ...base, content: "[ch]G[/ch]\nHello world" }, false);
    expect(p.blocks[0].rows).toEqual([{ kind: "line", parts: [text("Hello world")] }]);
  });
});

describe("printFileName", () => {
  it("names the PDF after the gig or the song", () => {
    expect(printFileName({ kind: "floor", name: "Friday at Joe's" })).toBe("Friday at Joe's – Floor sheet");
    expect(printFileName({ kind: "gigLyrics", name: "Friday at Joe's" })).toBe("Friday at Joe's – Lyric sheets");
    expect(printFileName({ kind: "songLyrics", name: "Hey Jude" })).toBe("Hey Jude – Lyric sheet");
  });
});
