import { describe, expect, it, vi } from "vitest";

const store = {
  getWithMetadata: vi.fn(),
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

  it("refuses to hand out a value without an etag rather than write unconditionally", async () => {
    store.getWithMetadata.mockResolvedValueOnce({ data: "v1", etag: undefined, metadata: {} });
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
});
