import { describe, expect, it } from "vitest";
import { songTempo, toSongSummary } from "../../src/shared/song";
import type { Song } from "../../src/shared/types";

const song: Song = {
  id: "s", title: "T", artist: "A", sourceUrl: null, originalKey: "", bandKey: "", capo: 0, content: "", bpm: null, beatsPerBar: null, updatedAt: "x",
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

describe("songTempo", () => {
  it("reads a missing tempo (an older offline copy) as unknown", () => {
    expect(songTempo({} as Pick<Song, "bpm" | "beatsPerBar">)).toEqual({ bpm: null, beatsPerBar: null });
  });
  it("passes a known tempo through", () => {
    expect(songTempo({ bpm: 100, beatsPerBar: 6 })).toEqual({ bpm: 100, beatsPerBar: 6 });
  });
});
