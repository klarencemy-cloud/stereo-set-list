import { describe, expect, it } from "vitest";
import { fromSongIds, itemKey, moveItem, reorderByKeys, setlistOf, songIdsOf } from "../../src/shared/setlist";
import type { SetlistItem } from "../../src/shared/types";

const song = (songId: string, note?: string): SetlistItem =>
  note ? { type: "song", songId, note } : { type: "song", songId };
const brk = (id: string, label: string): SetlistItem => ({ type: "break", id, label });

describe("setlistOf", () => {
  it("builds song items from a legacy songIds-only gig", () => {
    expect(setlistOf({ songIds: ["a", "b"] })).toEqual([song("a"), song("b")]);
  });

  it("prefers setlist when it is present", () => {
    const setlist = [song("b"), brk("x", "Set 2")];
    expect(setlistOf({ songIds: ["a"], setlist })).toEqual(setlist);
  });

  it("is empty for a gig with neither", () => {
    expect(setlistOf({})).toEqual([]);
  });
});

describe("songIdsOf / itemKey", () => {
  it("lists only songs, in order", () => {
    expect(songIdsOf([song("a"), brk("x", "Set 2"), song("b")])).toEqual(["a", "b"]);
  });

  it("keys items by kind and id", () => {
    expect(itemKey(song("a"))).toBe("song:a");
    expect(itemKey(brk("x", "Set 2"))).toBe("break:x");
  });
});

describe("fromSongIds", () => {
  it("applies the new order, keeps notes of kept songs and drops breaks", () => {
    const previous = [song("a", "x"), brk("k", "Set 2"), song("b")];
    expect(fromSongIds(["b", "a"], previous)).toEqual([song("b"), song("a", "x")]);
  });

  it("drops songs that are not in the new list", () => {
    expect(fromSongIds(["b"], [song("a", "x"), song("b")])).toEqual([song("b")]);
  });
});

describe("moveItem", () => {
  it("moves one item without changing the input", () => {
    const input = [1, 2, 3];
    expect(moveItem(input, 0, 2)).toEqual([2, 3, 1]);
    expect(input).toEqual([1, 2, 3]);
  });

  it("returns the same order for an out-of-range move", () => {
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
});

describe("reorderByKeys", () => {
  const a = song("a");
  const b = song("b");
  const k = brk("k1", "Set 2");

  it("moves the active item to where the over item is", () => {
    expect(reorderByKeys([a, k, b], "song:b", "song:a")).toEqual([b, a, k]);
    expect(reorderByKeys([a, k, b], "song:a", "break:k1")).toEqual([k, a, b]);
  });

  it("returns null when nothing moves or a key is unknown", () => {
    expect(reorderByKeys([a, k, b], "song:a", "song:a")).toBeNull();
    expect(reorderByKeys([a, k, b], "song:zzz", "song:a")).toBeNull();
    expect(reorderByKeys([a, k, b], "song:a", "break:nope")).toBeNull();
  });
});
