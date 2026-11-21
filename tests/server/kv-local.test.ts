import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobsKV } from "../../netlify/functions/lib/kv";

// The local Blobs server that `netlify dev` runs leaves the etag off reads; conditional writes must still work there.
describe("blobsKV on the local dev Blobs server", () => {
  let dir: string;
  let server: BlobsServer;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "blobs-"));
    server = new BlobsServer({ directory: dir, token: "t", port: 0 });
    const { port } = await server.start();
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(
      JSON.stringify({ siteID: "site", token: "t", edgeURL: `http://localhost:${port}`, uncachedEdgeURL: `http://localhost:${port}`, apiURL: `http://localhost:${port}` }),
    ).toString("base64");
  });

  afterAll(async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("writes only while the value is unchanged since it was read", async () => {
    const kv = blobsKV();
    expect(await kv.setTextIfNew("metronome/a", "v1")).toBe(true);
    const first = (await kv.getTextTagged("metronome/a"))!;
    expect(first.value).toBe("v1");
    expect(await kv.setTextIfMatch("metronome/a", "v2", first.etag)).toBe(true);
    expect(await kv.getText("metronome/a")).toBe("v2");
    expect(await kv.setTextIfMatch("metronome/a", "v3", first.etag)).toBe(false);
    expect(await kv.getText("metronome/a")).toBe("v2");
  });
});
