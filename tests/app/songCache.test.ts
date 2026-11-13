import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { getSong: vi.fn(), getGig: vi.fn(), listSongs: vi.fn() } };
});

import { api, ApiError } from "../../src/app/api";
import {
  CACHE_TTL_MS,
  clearSongCache,
  loadSetlist,
  loadSong,
  peekSong,
  prefetchSong,
  rememberSong,
} from "../../src/app/songCache";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const song = (id: string, bandKey = "A") => ({
  id, title: id, artist: "X", sourceUrl: null, originalKey: "A", bandKey, capo: 0, content: "", updatedAt: "x",
});

beforeEach(() => {
  clearSongCache();
  Object.values(mocked).forEach((f) => f.mockReset());
  mocked.getSong.mockImplementation(async (id: string) => song(id));
});
afterEach(() => vi.useRealTimers());

describe("songCache", () => {
  it("keeps entries for 60 seconds", () => {
    expect(CACHE_TTL_MS).toBe(60_000);
  });

  it("fetches a song once for two loads", async () => {
    const [a, b] = await Promise.all([loadSong("s1"), loadSong("s1")]);
    await loadSong("s1");
    expect(a).toEqual(song("s1"));
    expect(b).toEqual(song("s1"));
    expect(mocked.getSong).toHaveBeenCalledTimes(1);
  });

  it("peekSong is empty until the song arrives", async () => {
    const p = loadSong("s1");
    expect(peekSong("s1")).toBeUndefined();
    await p;
    expect(peekSong("s1")).toEqual(song("s1"));
  });

  it("retries after a failed load", async () => {
    mocked.getSong.mockRejectedValueOnce(new ApiError(0, "offline"));
    await expect(loadSong("s1")).rejects.toThrow("offline");
    expect(peekSong("s1")).toBeUndefined();
    await expect(loadSong("s1")).resolves.toEqual(song("s1"));
    expect(mocked.getSong).toHaveBeenCalledTimes(2);
  });

  it("prefetchSong swallows errors", async () => {
    mocked.getSong.mockRejectedValueOnce(new ApiError(0, "offline"));
    prefetchSong("s1");
    await Promise.resolve();
    await Promise.resolve();
    expect(peekSong("s1")).toBeUndefined();
  });

  it("refetches after 60 seconds", async () => {
    vi.useFakeTimers();
    await loadSong("s1");
    vi.advanceTimersByTime(60_001);
    expect(peekSong("s1")).toBeUndefined();
    await loadSong("s1");
    expect(mocked.getSong).toHaveBeenCalledTimes(2);
  });

  it("rememberSong replaces the cached copy", async () => {
    await loadSong("s1");
    rememberSong(song("s1", "Bb"));
    expect(peekSong("s1")?.bandKey).toBe("Bb");
    expect((await loadSong("s1")).bandKey).toBe("Bb");
    expect(mocked.getSong).toHaveBeenCalledTimes(1);
  });

  it("loadSetlist drops deleted songs and is fetched once", async () => {
    mocked.getGig.mockResolvedValue({ id: "g1", name: "G", date: "2026-12-20", songIds: ["a", "gone", "b"] });
    mocked.listSongs.mockResolvedValue([song("a"), song("b")]);
    expect((await loadSetlist("g1")).ids).toEqual(["a", "b"]);
    expect((await loadSetlist("g1")).ids).toEqual(["a", "b"]);
    expect(mocked.getGig).toHaveBeenCalledTimes(1);
    expect(mocked.listSongs).toHaveBeenCalledTimes(1);
  });

  it("loadSetlist returns the notes by song id, and skips breaks", async () => {
    mocked.getGig.mockResolvedValue({
      id: "g1",
      name: "G",
      date: "2026-12-20",
      songIds: ["s1", "s2"],
      setlist: [
        { type: "song", songId: "s1", note: "Klarence count-in" },
        { type: "break", id: "k", label: "Set 2" },
        { type: "song", songId: "s2" },
        { type: "song", songId: "gone", note: "lost" },
      ],
    });
    mocked.listSongs.mockResolvedValue([song("s1"), song("s2")]);
    expect(await loadSetlist("g1")).toEqual({ ids: ["s1", "s2"], notes: { s1: "Klarence count-in" } });
  });

  it("loadSetlist works with a legacy gig that only has songIds", async () => {
    mocked.getGig.mockResolvedValue({ id: "g1", name: "G", date: "2026-12-20", songIds: ["a"] });
    mocked.listSongs.mockResolvedValue([song("a")]);
    expect(await loadSetlist("g1")).toEqual({ ids: ["a"], notes: {} });
  });

  it("loadSetlist retries after a failure", async () => {
    mocked.getGig.mockRejectedValueOnce(new ApiError(0, "offline"));
    mocked.getGig.mockResolvedValue({ id: "g1", name: "G", date: "2026-12-20", songIds: ["a"] });
    mocked.listSongs.mockResolvedValue([song("a")]);
    await expect(loadSetlist("g1")).rejects.toThrow("offline");
    expect((await loadSetlist("g1")).ids).toEqual(["a"]);
  });

  it("clearSongCache forgets everything", async () => {
    mocked.getGig.mockResolvedValue({ id: "g1", name: "G", date: "2026-12-20", songIds: [] });
    mocked.listSongs.mockResolvedValue([]);
    await loadSong("s1");
    await loadSetlist("g1");
    clearSongCache();
    expect(peekSong("s1")).toBeUndefined();
    await loadSong("s1");
    await loadSetlist("g1");
    expect(mocked.getSong).toHaveBeenCalledTimes(2);
    expect(mocked.getGig).toHaveBeenCalledTimes(2);
  });
});
