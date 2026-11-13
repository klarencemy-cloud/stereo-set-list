import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError, conflictOf } from "../../src/app/api";
import { clearSongCache, loadSetlist, peekSong, rememberSong } from "../../src/app/songCache";
import { FRESH_HEADER } from "../../src/sw/strategy";

afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("api.getSong", () => {
  it("asks the offline worker for a fresh copy when told to", async () => {
    const fetch = stubFetch();
    await api.getSong("s1", { fresh: true });
    const init = fetch.mock.calls[0][1]!;
    expect(new Headers(init.headers).get(FRESH_HEADER)).toBe("1");
  });

  it("sends no fresh header by default", async () => {
    const fetch = stubFetch();
    await api.getSong("s1");
    const init = fetch.mock.calls[0][1];
    expect(new Headers(init?.headers).get(FRESH_HEADER)).toBeNull();
  });
});

describe("baseVersion and conflicts", () => {
  it("sends baseVersion with updates, and leaves it out when there is none", async () => {
    const fetch = stubFetch();
    await api.updateSong("s1", { bandKey: "A" }, "v1");
    await api.updateGig("g1", { name: "N" }, "v2");
    await api.updateGig("g1", { name: "N" });
    const bodies = fetch.mock.calls.map((c) => JSON.parse(c[1]!.body as string));
    expect(bodies).toEqual([{ bandKey: "A", baseVersion: "v1" }, { name: "N", baseVersion: "v2" }, { name: "N" }]);
  });

  it("a 409 carries the stored record", async () => {
    const current = { id: "s1", bandKey: "Am" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Someone else changed this song.", current }), { status: 409 })));
    const err = await api.updateSong("s1", { bandKey: "A" }, "v1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Someone else changed this song.");
    expect(conflictOf(err)).toEqual(current);
    expect(conflictOf(new ApiError(500, "x"))).toBeNull();
  });
});

describe("mutations clear the song cache themselves", () => {
  const song = (id: string) => ({
    id, title: id, artist: "", sourceUrl: null, originalKey: "A", bandKey: "A", capo: 0, content: "", updatedAt: "v1",
  });
  const gig = (id: string) => ({ id, name: id, date: "2026-01-01", setlist: [], songIds: [] });

  /** Answers like the server; `status` makes every non-GET fail with that status. */
  function server(status = 200) {
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET" && status !== 200) {
        return new Response(JSON.stringify({ message: "no", current: song("s1") }), { status });
      }
      if (path === "/api/songs") return Response.json([song("s1"), song("s2")]);
      if (path.startsWith("/api/gigs/")) return Response.json(gig(path.split("/")[3]));
      if (path.startsWith("/api/tracks/")) return Response.json({ id: "t1", title: "T", songId: "s1" });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json(song(path.split("/")[3]));
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  /** Two cached songs and two cached setlists. */
  async function seed() {
    clearSongCache();
    rememberSong(song("s1"));
    rememberSong(song("s2"));
    await loadSetlist("g1");
    await loadSetlist("g2");
  }

  /** Which setlists the next load fetches again (i.e. were forgotten). */
  async function refetchedSetlists(fetch: ReturnType<typeof server>) {
    fetch.mockClear();
    await loadSetlist("g1");
    await loadSetlist("g2");
    return fetch.mock.calls.map((c) => c[0]).filter((p) => p.startsWith("/api/gigs/"));
  }

  it("updateSong forgets that song only", async () => {
    const fetch = server();
    await seed();
    await api.updateSong("s1", { bandKey: "B" }, "v1");
    expect(peekSong("s1")).toBeUndefined();
    expect(peekSong("s2")).toBeDefined();
    expect(await refetchedSetlists(fetch)).toEqual([]);
  });

  it("deleteSong forgets the song and every setlist (the server takes it out of them)", async () => {
    const fetch = server();
    await seed();
    await api.deleteSong("s1");
    expect(peekSong("s1")).toBeUndefined();
    expect(peekSong("s2")).toBeDefined();
    expect(await refetchedSetlists(fetch)).toEqual(["/api/gigs/g1", "/api/gigs/g2"]);
  });

  it("updateGig and deleteGig forget that gig's setlist only", async () => {
    const fetch = server();
    await seed();
    await api.updateGig("g1", { name: "N" }, "v1");
    expect(await refetchedSetlists(fetch)).toEqual(["/api/gigs/g1"]);
    await api.deleteGig("g2");
    expect(await refetchedSetlists(fetch)).toEqual(["/api/gigs/g2"]);
    expect(peekSong("s1")).toBeDefined();
  });

  it("renaming a track forgets its song; deleting one forgets everything", async () => {
    const fetch = server();
    await seed();
    await api.updateTrack("t1", "New");
    expect(peekSong("s1")).toBeUndefined();
    expect(peekSong("s2")).toBeDefined();
    await api.deleteTrack("t1");
    expect(peekSong("s2")).toBeUndefined();
    expect(await refetchedSetlists(fetch)).toEqual(["/api/gigs/g1", "/api/gigs/g2"]);
  });

  it("a failed save forgets nothing", async () => {
    const fetch = server(500);
    await seed();
    await expect(api.updateSong("s1", { bandKey: "B" })).rejects.toBeInstanceOf(ApiError);
    await expect(api.updateGig("g1", { name: "N" })).rejects.toBeInstanceOf(ApiError);
    expect(peekSong("s1")).toBeDefined();
    expect(await refetchedSetlists(fetch)).toEqual([]);
  });

  it("a conflict forgets the out-of-date copy", async () => {
    const fetch = server(409);
    await seed();
    await expect(api.updateSong("s1", { bandKey: "B" }, "old")).rejects.toBeInstanceOf(ApiError);
    expect(peekSong("s1")).toBeUndefined();
    await expect(api.updateGig("g1", { name: "N" }, "old")).rejects.toBeInstanceOf(ApiError);
    expect(await refetchedSetlists(fetch)).toEqual(["/api/gigs/g1"]);
  });
});
