// Service worker entry, built to dist/sw.js. It must import only from ./strategy so the
// build emits one self-contained file (a classic worker cannot import modules).
import {
  API_CACHE,
  FRESH_HEADER,
  NETWORK_TIMEOUT_MS,
  SHELL_CACHE,
  SHELL_KEY,
  cacheFirst,
  invalidationKeys,
  networkFirst,
  routeFor,
  saveShell,
} from "./strategy";

// A narrow view of the worker globals we use; the "webworker" lib clashes with "DOM" in one tsconfig.
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(r: Promise<Response>): void;
}
const sw = self as unknown as {
  location: Location;
  addEventListener(type: "install" | "activate", fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", fn: (e: FetchEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
};

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // Fetch "/" rather than "/index.html": a host may redirect the latter, and a
      // redirected response can't be used to answer a page navigation.
      const res = await fetch("/", { cache: "no-store" });
      if (res.ok) await saveShell(res, shell, (url) => fetch(url));
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, API_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("stereo-set-") && !keep.has(name)) await caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const route = routeFor(req.method, url, req.mode === "navigate", sw.location.origin);
  if (route === "pass") return;
  if (route === "mutate") {
    // A saved change makes the saved copies of that item and its list out of date.
    event.respondWith(
      fetch(req).then(async (res) => {
        if (res.ok) {
          const cache = await caches.open(API_CACHE);
          await Promise.all(invalidationKeys(url).map((key) => cache.delete(key)));
        }
        return res;
      }),
    );
    return;
  }
  const cacheName = route === "api" ? API_CACHE : SHELL_CACHE;
  event.respondWith(
    caches.open(cacheName).then((cache) => {
      if (route === "asset") return cacheFirst(url.pathname, cache, () => fetch(req));
      if (route === "api") {
        const timeout = req.headers.has(FRESH_HEADER) ? Infinity : NETWORK_TIMEOUT_MS;
        return networkFirst(url.pathname, cache, () => fetch(req), timeout);
      }
      // A new app page replaces the saved one only after its scripts are saved, in the background.
      return networkFirst(SHELL_KEY, cache, () => fetch(req), NETWORK_TIMEOUT_MS, async (res) => {
        event.waitUntil(saveShell(res, cache, (asset) => fetch(asset)).catch(() => {}));
      });
    }),
  );
});
