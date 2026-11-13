import { describe, expect, it } from "vitest";
import { toSongSummary } from "../../src/shared/song";
import type { Song } from "../../src/shared/types";

const song: Song = {
  id: "s", title: "T", artist: "A", sourceUrl: null, originalKey: "", bandKey: "", capo: 0, content: "", updatedAt: "x",
};

describe("toSongSummary", () => {
  it("drops the sheet and says whether there is one", () => {
    const s = toSongSummary({ ...song, content: "[C]la" });
    expect(s).not.toHaveProperty("content");
    expect(s).toMatchObject({ id: "s", title: "T", hasChords: true });
  });
  it("treats a blank sheet as no chords", () => {
    expect(toSongSummary({ ...song, content: "  \n " }).hasChords).toBe(false);
  });
});
