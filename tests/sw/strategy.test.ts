import { describe, it, expect, vi, afterEach } from "vitest";
import {
  API_CACHE,
  NETWORK_TIMEOUT_MS,
  SHELL_CACHE,
  SHELL_KEY,
  FRESH_HEADER,
  assetUrlsFromHtml,
  cacheFirst,
  invalidationKeys,
  saveShell,
  networkFirst,
  routeFor,
  staleAfterTrackChange,
  type CacheLike,
} from "../../src/sw/strategy";

const ORIGIN = "https://stereo-set.netlify.app";
const u = (path: string) => new URL(path, ORIGIN);

function fakeCache(initial: Record<string, string> = {}) {
  const store = new Map<string, Response>(Object.entries(initial).map(([k, v]) => [k, new Response(v)]));
  const cache: CacheLike = {
    match: async (key) => store.get(key)?.clone(),
    put: async (key, res) => {
      store.set(key, res);
    },
  };
  return { cache, store };
}

afterEach(() => vi.useRealTimers());

describe("constants", () => {
  it("names the caches and the timeout", () => {
    expect(SHELL_CACHE).toBe("stereo-set-shell-v1");
    expect(API_CACHE).toBe("stereo-set-api-v1");
    expect(NETWORK_TIMEOUT_MS).toBe(4000);
    expect(SHELL_KEY).toBe("/index.html");
  });
});

describe("routeFor", () => {
  it.each([
    ["GET", "/api/songs", false, "api"],
    ["GET", "/api/songs/s1", false, "api"],
    ["GET", "/api/gigs", false, "api"],
    ["GET", "/api/gigs/g1", false, "api"],
    ["PUT", "/api/songs/s1", false, "mutate"],
    ["POST", "/api/gigs", false, "mutate"],
    ["DELETE", "/api/gigs/g1", false, "mutate"],
    ["POST", "/api/songs", false, "mutate"],
    ["PUT", "/api/tracks/t1", false, "mutate"],
    ["DELETE", "/api/tracks/t1", false, "mutate"],
    ["POST", "/api/tracks/t1/song", false, "mutate"],
    ["PUT", "/api/tracks/t1/parts/2", false, "mutate"],
    ["POST", "/api/tracks", false, "pass"],
    ["POST", "/api/import", false, "pass"],
    ["GET", "/api/tracks/t1/parts/0", true, "pass"],
    ["GET", "/api/songs", true, "api"],
    ["GET", "/api/tracks", false, "pass"],
    ["GET", "/api/tracks/t1/parts/0", false, "pass"],
    ["GET", "/api/import", false, "pass"],
    ["GET", "/api/songs/s1/extra", false, "pass"],
    ["GET", "/assets/index-abc.js", false, "asset"],
    ["GET", "/songs/s1", true, "navigate"],
    ["GET", "/", true, "navigate"],
    ["GET", "/manifest.webmanifest", false, "pass"],
  ] as const)("%s %s (navigation: %s) → %s", (method, path, nav, expected) => {
    expect(routeFor(method, u(path), nav, ORIGIN)).toBe(expected);
  });

  it("passes other origins through", () => {
    expect(routeFor("GET", new URL("https://other.example/api/songs"), false, ORIGIN)).toBe("pass");
    expect(routeFor("GET", new URL("https://other.example/x"), true, ORIGIN)).toBe("pass");
  });
});

describe("cacheFirst", () => {
  it("returns a cached copy without loading", async () => {
    const { cache } = fakeCache({ "/assets/a.js": "cached" });
    const load = vi.fn(async () => new Response("net"));
    expect(await (await cacheFirst("/assets/a.js", cache, load)).text()).toBe("cached");
    expect(load).not.toHaveBeenCalled();
  });

  it("loads, stores and returns on a miss", async () => {
    const { cache, store } = fakeCache();
    const res = await cacheFirst("/assets/a.js", cache, async () => new Response("net"));
    expect(await res.text()).toBe("net");
    expect(await store.get("/assets/a.js")!.text()).toBe("net");
  });

  it("does not store an error response", async () => {
    const { cache, store } = fakeCache();
    const res = await cacheFirst("/assets/a.js", cache, async () => new Response("no", { status: 500 }));
    expect(res.status).toBe(500);
    expect(store.has("/assets/a.js")).toBe(false);
  });
});

describe("networkFirst", () => {
  it("returns and stores a fresh response", async () => {
    const { cache, store } = fakeCache({ "/api/songs": "old" });
    const res = await networkFirst("/api/songs", cache, async () => new Response("new"));
    expect(await res.text()).toBe("new");
    await Promise.resolve();
    expect(await store.get("/api/songs")!.clone().text()).toBe("new");
  });

  it("returns a server error without replacing the saved copy", async () => {
    const { cache, store } = fakeCache({ "/api/songs": "old" });
    const res = await networkFirst("/api/songs", cache, async () => new Response("boom", { status: 500 }));
    expect(res.status).toBe(500);
    expect(await store.get("/api/songs")!.clone().text()).toBe("old");
  });

  it("falls back to the saved copy when the network fails", async () => {
    const { cache } = fakeCache({ "/api/songs": "old" });
    const res = await networkFirst("/api/songs", cache, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await res.text()).toBe("old");
  });

  it("rejects when the network fails and nothing is saved", async () => {
    const { cache } = fakeCache();
    await expect(
      networkFirst("/api/songs", cache, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow("Failed to fetch");
  });

  it("uses the saved copy after 4 seconds of no answer", async () => {
    vi.useFakeTimers();
    const { cache } = fakeCache({ "/api/songs": "old" });
    const pending = networkFirst("/api/songs", cache, () => new Promise<Response>(() => {}));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await (await pending).text()).toBe("old");
  });

  it("keeps waiting for a slow network when nothing is saved", async () => {
    vi.useFakeTimers();
    const { cache } = fakeCache();
    const pending = networkFirst(
      "/api/songs",
      cache,
      () => new Promise<Response>((r) => setTimeout(() => r(new Response("slow")), 10_000)),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await (await pending).text()).toBe("slow");
  });
});

describe("assetUrlsFromHtml", () => {
  it("finds the built script and stylesheet", () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-a1.js"></script>' +
      '<link rel="stylesheet" crossorigin href="/assets/index-b2.css">' +
      '<link rel="manifest" href="/manifest.webmanifest">' +
      '<link rel="modulepreload" href="/assets/index-a1.js">';
    expect(assetUrlsFromHtml(html)).toEqual(["/assets/index-a1.js", "/assets/index-b2.css"]);
  });
});

describe("invalidationKeys", () => {
  it("drops the item and its list after a change", () => {
    expect(invalidationKeys(u("/api/songs/s1"))).toEqual(["/api/songs/s1", "/api/songs"]);
    expect(invalidationKeys(u("/api/gigs/g1"))).toEqual(["/api/gigs/g1", "/api/gigs"]);
    expect(invalidationKeys(u("/api/gigs"))).toEqual(["/api/gigs"]);
    expect(invalidationKeys(u("/api/tracks/t1"))).toEqual([]);
  });

  it("drops saved songs when a track is renamed, and gigs too when one is deleted", () => {
    const saved = ["/api/songs", "/api/songs/s1", "/api/gigs", "/api/gigs/g1"];
    expect(staleAfterTrackChange("PUT", u("/api/tracks/t1"), saved)).toEqual(["/api/songs", "/api/songs/s1"]);
    expect(staleAfterTrackChange("DELETE", u("/api/tracks/t1"), saved)).toEqual(saved);
    expect(staleAfterTrackChange("PUT", u("/api/songs/s1"), saved)).toEqual([]);
  });
});

describe("networkFirst options", () => {
  it("with no timeout, waits for a slow network even when a copy is saved", async () => {
    vi.useFakeTimers();
    const { cache } = fakeCache({ "/api/songs/s1": "old" });
    const pending = networkFirst(
      "/api/songs/s1",
      cache,
      () => new Promise<Response>((r) => setTimeout(() => r(new Response("fresh")), 10_000)),
      Infinity,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await (await pending).text()).toBe("fresh");
  });

  it("with no timeout, still falls back when the network fails", async () => {
    const { cache } = fakeCache({ "/api/songs/s1": "old" });
    const res = await networkFirst(
      "/api/songs/s1",
      cache,
      async () => {
        throw new TypeError("Failed to fetch");
      },
      Infinity,
    );
    expect(await res.text()).toBe("old");
  });

  it("hands a good response to a custom save instead of storing it", async () => {
    const { cache, store } = fakeCache();
    const save = vi.fn(async () => {});
    const res = await networkFirst("/index.html", cache, async () => new Response("page"), 4000, save);
    expect(await res.text()).toBe("page");
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.has("/index.html")).toBe(false);
  });

  it("names the header that asks for a fresh copy", () => {
    expect(FRESH_HEADER).toBe("X-Fresh");
  });
});

describe("saveShell", () => {
  const html = (js: string) =>
    new Response(`<script type="module" src="/assets/${js}"></script>`, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });

  it("stores a new page only once its scripts are saved", async () => {
    const { cache, store } = fakeCache({ "/index.html": "old page" });
    const loadAsset = vi.fn(async () => {
      expect(await store.get("/index.html")!.clone().text()).toBe("old page");
      return new Response("js");
    });
    await saveShell(html("main-new.js"), cache, loadAsset);
    expect(loadAsset).toHaveBeenCalledWith("/assets/main-new.js");
    expect(await store.get("/assets/main-new.js")!.text()).toBe("js");
    expect(await store.get("/index.html")!.text()).toContain("main-new.js");
  });

  it("does not download scripts it already has", async () => {
    const { cache } = fakeCache({ "/assets/main-a.js": "js" });
    const loadAsset = vi.fn(async () => new Response("js"));
    await saveShell(html("main-a.js"), cache, loadAsset);
    expect(loadAsset).not.toHaveBeenCalled();
  });

  it("keeps the old page when a script can't be saved", async () => {
    const { cache, store } = fakeCache({ "/index.html": "old page" });
    await expect(
      saveShell(html("main-new.js"), cache, async () => new Response("", { status: 404 })),
    ).rejects.toThrow();
    expect(await store.get("/index.html")!.text()).toBe("old page");
  });

  it("ignores a response that is not a web page", async () => {
    const { cache, store } = fakeCache({ "/index.html": "old page" });
    await saveShell(new Response("png", { headers: { "Content-Type": "image/png" } }), cache, vi.fn());
    expect(await store.get("/index.html")!.text()).toBe("old page");
  });
});
