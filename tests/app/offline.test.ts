import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { listGigs: vi.fn(), getGig: vi.fn(), listSongs: vi.fn(), getSong: vi.fn() } };
});

import { api, ApiError } from "../../src/app/api";
import { NOT_READY, canSaveOffline, registerServiceWorker, saveGigForOffline } from "../../src/app/offline";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function mockServiceWorker(sw: object | undefined) {
  if (sw === undefined) delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  else Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
}

afterEach(() => {
  mockServiceWorker(undefined);
  vi.unstubAllEnvs();
});

describe("registerServiceWorker", () => {
  it("registers /sw.js in a production build", () => {
    vi.stubEnv("PROD", true);
    const register = vi.fn(async () => ({}));
    mockServiceWorker({ register });
    registerServiceWorker();
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("does not register during development", () => {
    vi.stubEnv("PROD", false);
    const register = vi.fn(async () => ({}));
    mockServiceWorker({ register });
    registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing when the browser has no service workers", () => {
    vi.stubEnv("PROD", true);
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("ignores a failed registration", async () => {
    vi.stubEnv("PROD", true);
    mockServiceWorker({ register: vi.fn(async () => Promise.reject(new Error("blocked"))) });
    registerServiceWorker();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("saveGigForOffline", () => {
  const summary = (id: string) => ({ id, title: id });
  beforeEach(() => {
    Object.values(mocked).forEach((f) => f.mockReset());
    mocked.listGigs.mockResolvedValue([]);
    mocked.getGig.mockResolvedValue({ id: "g1", name: "G", date: "2026-12-20", songIds: ["a", "gone", "b", "c"] });
    mocked.listSongs.mockResolvedValue([summary("a"), summary("b"), summary("c")]);
    mocked.getSong.mockImplementation(async (id: string) => ({ id }));
    mockServiceWorker({ register: vi.fn(), controller: {} });
  });

  it("says offline saving is possible only with service workers", () => {
    expect(canSaveOffline()).toBe(true);
    mockServiceWorker(undefined);
    expect(canSaveOffline()).toBe(false);
  });

  it("loads the gig list, the gig, the song list and every song in setlist order", async () => {
    expect(await saveGigForOffline("g1")).toEqual({ saved: 3, total: 3 });
    expect(mocked.listGigs).toHaveBeenCalledTimes(1);
    expect(mocked.getGig).toHaveBeenCalledWith("g1");
    expect(mocked.getSong.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  it("loads the songs one at a time", async () => {
    let inFlight = 0;
    let most = 0;
    mocked.getSong.mockImplementation(async (id: string) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { id };
    });
    await saveGigForOffline("g1");
    expect(most).toBe(1);
  });

  it("asks the browser to keep the saved copies", async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, "storage", { configurable: true, value: { persist } });
    try {
      await saveGigForOffline("g1");
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).storage;
    }
  });

  it("still saves when the browser refuses to keep storage", async () => {
    const persist = vi.fn(async () => Promise.reject(new Error("no")));
    Object.defineProperty(navigator, "storage", { configurable: true, value: { persist } });
    try {
      expect(await saveGigForOffline("g1")).toEqual({ saved: 3, total: 3 });
    } finally {
      delete (navigator as unknown as Record<string, unknown>).storage;
    }
  });

  it("counts songs that could not be saved", async () => {
    mocked.getSong.mockImplementation(async (id: string) => {
      if (id === "b") throw new ApiError(0, "offline");
      return { id };
    });
    expect(await saveGigForOffline("g1")).toEqual({ saved: 2, total: 3 });
  });

  it("fails when the gig itself cannot be loaded", async () => {
    mocked.getGig.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    await expect(saveGigForOffline("g1")).rejects.toThrow("Can't reach the server.");
    expect(mocked.getSong).not.toHaveBeenCalled();
  });

  it("refuses before the service worker controls the page", async () => {
    mockServiceWorker({ register: vi.fn(), controller: null });
    await expect(saveGigForOffline("g1")).rejects.toThrow(NOT_READY);
    expect(mocked.getGig).not.toHaveBeenCalled();
    expect(NOT_READY).toBe("Offline mode is still setting up. Reload the page and try again.");
  });
});
