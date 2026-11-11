import { describe, expect, it } from "vitest";
import { markupFromPlainText, parseSheet, transposeContent } from "../../src/shared/sheet";

describe("parseSheet", () => {
  it("parses sections, chords, tab blocks and CRLF", () => {
    const src =
      "[Intro]\r\n[ch]G[/ch]   [ch]A7[/ch]   x2\r\n[tab][ch]C[/ch]    [ch]G[/ch]\r\nHello there[/tab]";
    expect(parseSheet(src)).toEqual([
      { kind: "section", label: "Intro" },
      {
        kind: "line",
        parts: [
          { type: "chord", chord: "G" },
          { type: "text", text: "   " },
          { type: "chord", chord: "A7" },
          { type: "text", text: "   x2" },
        ],
      },
      {
        kind: "line",
        parts: [
          { type: "chord", chord: "C" },
          { type: "text", text: "    " },
          { type: "chord", chord: "G" },
        ],
      },
      { kind: "line", parts: [{ type: "text", text: "Hello there" }] },
    ]);
  });

  it("does not treat a lone chord line as a section", () => {
    expect(parseSheet("[ch]G[/ch]")).toEqual([
      { kind: "line", parts: [{ type: "chord", chord: "G" }] },
    ]);
  });
});

describe("transposeContent", () => {
  it("keeps columns aligned when chords get longer", () => {
    expect(transposeContent("[ch]G[/ch]    [ch]C[/ch]", "G", "Bb")).toBe(
      "[ch]Bb[/ch]   [ch]Eb[/ch]",
    );
  });
  it("keeps columns aligned when chords get shorter", () => {
    expect(transposeContent("[ch]Bb[/ch]   [ch]Eb[/ch]", "Bb", "G")).toBe(
      "[ch]G[/ch]    [ch]C[/ch]",
    );
  });
  it("keeps at least one space between chords when they get longer", () => {
    const out = transposeContent("[ch]G[/ch] [ch]D[/ch] [ch]Em[/ch] [ch]C[/ch]", "G", "Bb");
    expect(out).toBe("[ch]Bb[/ch] [ch]F[/ch] [ch]Gm[/ch] [ch]Eb[/ch]");
    expect(out).not.toMatch(/\[\/ch\]\[ch\]/);
  });
  it("still closes up extra spaces down to one", () => {
    expect(transposeContent("[ch]G[/ch]  [ch]D[/ch]", "G", "Bb")).toBe("[ch]Bb[/ch] [ch]F[/ch]");
  });
  it("never adds trailing spaces", () => {
    expect(transposeContent("[ch]Bb[/ch]", "Bb", "G")).toBe("[ch]G[/ch]");
  });
  it("is unchanged for same key", () => {
    expect(transposeContent("[ch]G[/ch]", "G", "G")).toBe("[ch]G[/ch]");
  });
});

describe("markupFromPlainText", () => {
  it("wraps chords on chord lines only", () => {
    expect(markupFromPlainText("G      A7\nA day in the life")).toBe(
      "[ch]G[/ch]      [ch]A7[/ch]\nA day in the life",
    );
  });
  it("leaves repeat markers alone", () => {
    expect(markupFromPlainText("C  G  x2")).toBe("[ch]C[/ch]  [ch]G[/ch]  x2");
  });
  it("leaves section labels alone", () => {
    expect(markupFromPlainText("[Verse 1]")).toBe("[Verse 1]");
  });
  it("leaves lines without a real chord alone", () => {
    expect(markupFromPlainText("x2")).toBe("x2");
    expect(markupFromPlainText("| - |")).toBe("| - |");
  });
  it("leaves lyric lines alone", () => {
    expect(markupFromPlainText("Dead End Road")).toBe("Dead End Road");
  });
});
