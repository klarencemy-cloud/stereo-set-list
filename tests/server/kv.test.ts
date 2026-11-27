import { describe, expect, it, vi } from "vitest";

const store = {
  getWithMetadata: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  set: vi.fn(),
};
vi.mock("@netlify/blobs", () => ({ getStore: vi.fn(() => store) }));

import { getStore } from "@netlify/blobs";
import { blobsKV, memoryKV } from "../../netlify/functions/lib/kv";

describe("blobsKV", () => {
  it("opens the band store with strong consistency so writes read back at once", () => {
    blobsKV();
    expect(getStore).toHaveBeenCalledWith({ name: "band", consistency: "strong" });
  });

  it("writes conditionally with the etag it read", async () => {
    store.getWithMetadata.mockResolvedValueOnce({ data: "v1", etag: '"e1"', metadata: {} });
    store.set.mockResolvedValueOnce({ modified: false });
    const kv = blobsKV();
    expect(await kv.getTextTagged("songs/a")).toEqual({ value: "v1", etag: '"e1"' });
    expect(await kv.setTextIfMatch("songs/a", "v2", '"e1"')).toBe(false);
    expect(store.set).toHaveBeenCalledWith("songs/a", "v2", { onlyIfMatch: '"e1"' });
  });

  it("creates only when nothing is stored yet", async () => {
    store.set.mockResolvedValueOnce({ modified: false });
    expect(await blobsKV().setTextIfNew("metronome/a", "v")).toBe(false);
    expect(store.set).toHaveBeenCalledWith("metronome/a", "v", { onlyIfNew: true });
  });

  it("takes the etag from the listing when a read has none (the local netlify dev store)", async () => {
    store.getWithMetadata.mockResolvedValueOnce({ data: "v1", etag: undefined, metadata: {} });
    store.list.mockResolvedValueOnce({ blobs: [{ key: "songs/ab", etag: '"other"' }, { key: "songs/a", etag: '"e2"' }], directories: [] });
    store.get.mockResolvedValueOnce("v2");
    // The value is read after the etag, so a write in between leaves the etag stale, never wrong.
    expect(await blobsKV().getTextTagged("songs/a")).toEqual({ value: "v2", etag: '"e2"' });
    expect(store.list).toHaveBeenCalledWith({ prefix: "songs/a" });
  });

  it("refuses to hand out a value without an etag rather than write unconditionally", async () => {
    store.getWithMetadata.mockResolvedValueOnce({ data: "v1", etag: undefined, metadata: {} });
    store.list.mockResolvedValueOnce({ blobs: [], directories: [] });
    await expect(blobsKV().getTextTagged("songs/a")).rejects.toThrow(/etag/);
  });
});

describe("memoryKV conditional writes", () => {
  it("writes only while the etag still matches", async () => {
    const kv = memoryKV();
    expect(await kv.getTextTagged("k")).toBeNull();
    await kv.setText("k", "a");
    const first = (await kv.getTextTagged("k"))!;
    expect(await kv.setTextIfMatch("k", "b", first.etag)).toBe(true);
    expect(await kv.setTextIfMatch("k", "c", first.etag)).toBe(false);
    expect(await kv.getText("k")).toBe("b");
    await kv.delete("k");
    expect(await kv.setTextIfMatch("k", "d", first.etag)).toBe(false);
    expect(await kv.getText("k")).toBeNull();
  });

  it("creates only while nothing is stored", async () => {
    const kv = memoryKV();
    expect(await kv.setTextIfNew("k", "a")).toBe(true);
    expect(await kv.setTextIfNew("k", "b")).toBe(false);
    expect(await kv.getText("k")).toBe("a");
  });
});
