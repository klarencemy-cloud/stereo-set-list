import { describe, expect, it } from "vitest";
import { parseTrackList, songMatchKey, songsByMatchKey, uniqueTracks } from "../../src/shared/playlist";

describe("songMatchKey", () => {
  it("matches ignoring case and extra spaces", () => {
    expect(songMatchKey("  Mr.  Brightside ", "The KILLERS")).toBe(songMatchKey("mr. brightside", "the killers"));
  });
  it("does not confuse title and artist", () => {
    expect(songMatchKey("A", "B")).not.toBe(songMatchKey("A B", ""));
  });
});

describe("songsByMatchKey", () => {
  it("picks the same song for duplicates whatever the input order", () => {
    const a = { id: "a", title: "Wonderwall", artist: "Oasis" };
    const b = { id: "b", title: "wonderwall ", artist: "OASIS" };
    const c = { id: "c", title: "Creep", artist: "Radiohead" };
    const k = songMatchKey("Wonderwall", "Oasis");
    expect(songsByMatchKey([a, b, c]).get(k)).toBe(a);
    expect(songsByMatchKey([c, b, a]).get(k)).toBe(a);
    expect(songsByMatchKey([b, a]).get(k)).toBe(a);
    expect(songsByMatchKey([a, b, c]).get(songMatchKey("creep", "radiohead"))).toBe(c);
  });
});

describe("parseTrackList", () => {
  it("parses Title - Artist lines, splitting on the last separator", () => {
    expect(parseTrackList("Song 2 - Live - Blur\n\n  Yellow – Coldplay  \nUntitled\n")).toEqual([
      { title: "Song 2 - Live", artist: "Blur" },
      { title: "Yellow", artist: "Coldplay" },
      { title: "Untitled", artist: "" },
    ]);
  });
  it("handles Windows line endings", () => {
    expect(parseTrackList("A - B\r\nC - D\r\n")).toEqual([
      { title: "A", artist: "B" },
      { title: "C", artist: "D" },
    ]);
  });
});

describe("uniqueTracks", () => {
  it("drops repeated tracks, keeping the first", () => {
    expect(
      uniqueTracks([{ title: "A", artist: "x" }, { title: "a ", artist: "X" }, { title: "B", artist: "x" }]),
    ).toEqual([{ title: "A", artist: "x" }, { title: "B", artist: "x" }]);
  });
});
