import { describe, expect, it } from "vitest";
import { printableSong } from "../../src/shared/print";

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
  p.blocks.flatMap((b) => b.lines.flatMap((l) => (l.kind === "line" ? l.parts : []))).filter((x) => x.type === "chord");

describe("printableSong", () => {
  it("prints chords in the band key", () => {
    const p = printableSong(base, true);
    expect(chordsOf(p).map((c) => (c.type === "chord" ? c.chord : ""))).toEqual(["A", "D"]);
    expect(p.empty).toBe(false);
  });

  it("prints lyrics only, with the section labels", () => {
    const p = printableSong(base, false);
    expect(chordsOf(p)).toEqual([]);
    expect(p.blocks).toEqual([{ label: "Verse", lines: [{ kind: "line", parts: [{ type: "text", text: "la la" }] }] }]);
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
