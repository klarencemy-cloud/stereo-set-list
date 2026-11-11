import { describe, expect, it, vi } from "vitest";
import { memoryKV } from "../../netlify/functions/lib/kv";
import { makeRepo } from "../../netlify/functions/lib/repo";
import { makeSongsHandler } from "../../netlify/functions/songs";
import { makeGigsHandler } from "../../netlify/functions/gigs";
import { makeTracksHandler } from "../../netlify/functions/tracks";

const U = "http://localhost";
const jsonReq = (method: string, path: string, body?: unknown) =>
  new Request(U + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const songBody = {
  title: "Wonderwall", artist: "Oasis", sourceUrl: null, originalKey: "F#m", bandKey: "F#m", capo: 2, content: "[Em]Today",
};

function setup() {
  const repo = makeRepo(memoryKV());
  return { songs: makeSongsHandler(repo), gigs: makeGigsHandler(repo), tracks: makeTracksHandler(repo) };
}

describe("songs API", () => {
  it("creates, updates, gets, lists and deletes", async () => {
    const { songs } = setup();
    const created = await songs(jsonReq("POST", "/api/songs", songBody));
    expect(created.status).toBe(201);
    const song = await created.json();
    expect(song.id).toBeTruthy();

    const put = await songs(jsonReq("PUT", `/api/songs/${song.id}`, { bandKey: "A" }));
    expect(put.status).toBe(200);
    expect((await put.json()).bandKey).toBe("A");

    expect((await (await songs(jsonReq("GET", `/api/songs/${song.id}`))).json()).bandKey).toBe("A");
    expect((await (await songs(jsonReq("GET", "/api/songs"))).json()).length).toBe(1);
    expect((await songs(jsonReq("DELETE", `/api/songs/${song.id}`))).status).toBe(204);
    expect((await songs(jsonReq("GET", `/api/songs/${song.id}`))).status).toBe(404);
  });

  it("404 for unknown id, 400 for invalid, 400 for bad JSON, 405 for bad method", async () => {
    const { songs } = setup();
    expect((await songs(jsonReq("GET", "/api/songs/nope"))).status).toBe(404);
    expect((await songs(jsonReq("PUT", "/api/songs/nope", { bandKey: "A" }))).status).toBe(404);
    const bad = await songs(jsonReq("POST", "/api/songs", { ...songBody, title: " " }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toBeTruthy();
    const broken = await songs(new Request(U + "/api/songs", { method: "POST", body: "{nope" }));
    expect(broken.status).toBe(400);
    expect((await songs(jsonReq("PATCH", "/api/songs"))).status).toBe(405);
  });
});

describe("gigs API", () => {
  it("creates and gets a gig", async () => {
    const { gigs } = setup();
    const res = await gigs(jsonReq("POST", "/api/gigs", { name: "Pub", date: "2026-12-01", songIds: [] }));
    expect(res.status).toBe(201);
    const g = await res.json();
    expect((await gigs(jsonReq("GET", `/api/gigs/${g.id}`))).status).toBe(200);
    expect((await gigs(jsonReq("POST", "/api/gigs", { name: "x", date: "bad", songIds: [] }))).status).toBe(400);
    expect((await gigs(jsonReq("DELETE", `/api/gigs/${g.id}`))).status).toBe(204);
    expect((await gigs(jsonReq("GET", `/api/gigs/${g.id}`))).status).toBe(404);
  });
});

describe("tracks API", () => {
  it("rejects oversize tracks", async () => {
    const { tracks } = setup();
    const res = await tracks(jsonReq("POST", "/api/tracks", { title: "Big", size: 30_000_000 }));
    expect(res.status).toBe(400);
  });

  it("round-trips a part as raw bytes", async () => {
    const { tracks } = setup();
    const created = await tracks(jsonReq("POST", "/api/tracks", { title: "Demo", size: 5 }));
    expect(created.status).toBe(201);
    const t = await created.json();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const put = await tracks(new Request(`${U}/api/tracks/${t.id}/parts/0`, { method: "PUT", body: bytes }));
    expect(put.status).toBe(204);
    const got = await tracks(jsonReq("GET", `/api/tracks/${t.id}/parts/0`));
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("audio/mpeg");
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect((await tracks(jsonReq("GET", `/api/tracks/${t.id}/parts/9`))).status).toBe(404);
    expect((await (await tracks(jsonReq("GET", "/api/tracks"))).json()).length).toBe(1);
    expect((await tracks(jsonReq("DELETE", `/api/tracks/${t.id}`))).status).toBe(204);
  });
});

describe("error handling", () => {
  it("returns 400 for non-object JSON bodies", async () => {
    const { songs } = setup();
    for (const body of ["null", "5", '"x"', "[]"]) {
      const res = await songs(new Request(U + "/api/songs", { method: "POST", body }));
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBeTruthy();
    }
  });

  it("returns a JSON 500 for unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = { listSongs: async () => { throw new Error("boom"); } } as unknown as ReturnType<typeof makeRepo>;
    const res = await makeSongsHandler(repo)(jsonReq("GET", "/api/songs"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Something went wrong" });
    spy.mockRestore();
  });
});
