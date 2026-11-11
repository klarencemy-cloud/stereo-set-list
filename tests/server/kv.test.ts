import { describe, expect, it, vi } from "vitest";

vi.mock("@netlify/blobs", () => ({ getStore: vi.fn(() => ({})) }));

import { getStore } from "@netlify/blobs";
import { blobsKV } from "../../netlify/functions/lib/kv";

describe("blobsKV", () => {
  it("opens the band store with strong consistency so writes read back at once", () => {
    blobsKV();
    expect(getStore).toHaveBeenCalledWith({ name: "band", consistency: "strong" });
  });
});
