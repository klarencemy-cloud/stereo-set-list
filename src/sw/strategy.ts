// Caching rules for the service worker, kept free of worker globals so they can be tested in Node.

export const SHELL_CACHE = "stereo-set-shell-v1";
export const API_CACHE = "stereo-set-api-v1";
/** How long to wait on a weak signal before showing the saved copy. */
export const NETWORK_TIMEOUT_MS = 4000;
/** Every page of the app is the same index.html, stored under this key. */
export const SHELL_KEY = "/index.html";
/** A request with this header waits for the server instead of falling back after a timeout. */
export const FRESH_HEADER = "X-Fresh";

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

export type Route = "asset" | "api" | "mutate" | "navigate" | "pass";

const CACHED_API = /^\/api\/(songs|gigs)(\/[^/]+)?$/;

export function routeFor(method: string, url: URL, isNavigation: boolean, origin: string): Route {
  if (url.origin !== origin) return "pass";
  // Songs and gigs only: tracks are large mp3s, and import goes to another site.
  const cachedApi = CACHED_API.test(url.pathname);
  if (method !== "GET") return cachedApi ? "mutate" : "pass";
  if (url.pathname.startsWith("/assets/")) return "asset";
  if (cachedApi) return "api";
  // Other /api/ paths opened in a tab (an mp3 part, say) are not the app page.
  return isNavigation && !url.pathname.startsWith("/api/") ? "navigate" : "pass";
}

/** Saved copies a successful change makes out of date: the item and its list. */
export function invalidationKeys(url: URL): string[] {
  const list = url.pathname.match(/^\/api\/(songs|gigs)/)![0];
  return url.pathname === list ? [list] : [url.pathname, list];
}

async function store(cache: CacheLike, key: string, res: Response): Promise<void> {
  if (!res.ok) return;
  try {
    await cache.put(key, res.clone());
  } catch {
    // Storage full or unavailable: still serve the response.
  }
}

/** For files whose names change on every build: once saved, they never change. */
export async function cacheFirst(key: string, cache: CacheLike, load: () => Promise<Response>): Promise<Response> {
  const saved = await cache.match(key);
  if (saved) return saved;
  const res = await load();
  await store(cache, key, res);
  return res;
}

/**
 * Fresh from the network when it answers in time; otherwise the saved copy.
 * With nothing saved, it keeps waiting on the network. `timeoutMs: Infinity` waits for the
 * network and uses the saved copy only if the network fails. `save`, if given, receives a
 * copy of each good response in place of storing it under `key`.
 */
export async function networkFirst(
  key: string,
  cache: CacheLike,
  load: () => Promise<Response>,
  timeoutMs: number = NETWORK_TIMEOUT_MS,
  save?: (res: Response) => Promise<void>,
): Promise<Response> {
  const net = load().then(async (res) => {
    if (save) {
      if (res.ok) await save(res.clone()).catch(() => {});
    } else {
      await store(cache, key, res);
    }
    return res;
  });
  net.catch(() => {}); // Handled below; avoid an unhandled rejection if we answer from the cache.

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    if (Number.isFinite(timeoutMs)) timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const first = await Promise.race([net, timedOut]);
    if (first !== "timeout") return first;
  } catch (e) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const saved = await cache.match(key);
  return saved ?? net;
}

/**
 * Saves a freshly loaded app page, but only once every script and stylesheet it needs is
 * saved too. Until then the previous page stays, so an offline start never gets a page
 * whose scripts are missing. Responses that are not HTML are ignored.
 */
export async function saveShell(
  res: Response,
  cache: CacheLike,
  loadAsset: (url: string) => Promise<Response>,
): Promise<void> {
  if (!(res.headers.get("Content-Type") ?? "").includes("text/html")) return;
  const html = await res.clone().text();
  for (const url of assetUrlsFromHtml(html)) {
    if (await cache.match(url)) continue;
    const asset = await loadAsset(url);
    if (!asset.ok) throw new Error(`Could not save ${url} (${asset.status})`);
    await cache.put(url, asset);
  }
  await cache.put(SHELL_KEY, res);
}

/** The built /assets/ files a page references, so they can be saved on install. */
export function assetUrlsFromHtml(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) found.add(m[1]);
  return [...found];
}
