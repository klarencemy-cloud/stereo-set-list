import { api } from "./api";

export const NOT_READY = "Offline mode is still setting up. Reload the page and try again.";

/** Starts the offline service worker. Only in a production build: in dev it would cache Vite's modules. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) {
    // Dev serves HTML at /sw.js, so a worker left over from an earlier production build on this
    // address can never update and keeps answering from stale saved copies. Remove it.
    void removeLeftoverWorkers();
    return;
  }
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Offline mode is a bonus; the site works without it.
  });
}

async function removeLeftoverWorkers(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length === 0) return;
    await Promise.all(regs.map((r) => r.unregister()));
    for (const name of await caches.keys()) {
      if (name.startsWith("stereo-set-")) await caches.delete(name);
    }
    // The page is still controlled by the old worker until it reloads.
    window.location.reload();
  } catch {
    // Nothing to clean up, or the browser refused: dev still works.
  }
}

export function canSaveOffline(): boolean {
  return "serviceWorker" in navigator;
}

/**
 * Loads everything a gig needs so the service worker keeps a copy: the gig list, the gig,
 * the song list and each song in the setlist. Songs load one at a time, since signal at a
 * venue is often weak.
 */
export async function saveGigForOffline(gigId: string): Promise<{ saved: number; total: number }> {
  if (!navigator.serviceWorker?.controller) throw new Error(NOT_READY);
  // Ask the browser not to clear the saved copies when space runs low (ignored if refused).
  navigator.storage?.persist?.().catch(() => {});
  const [, gig, all] = await Promise.all([api.listGigs(), api.getGig(gigId), api.listSongs()]);
  const exists = new Set(all.map((s) => s.id));
  const ids = gig.songIds.filter((sid) => exists.has(sid));
  let saved = 0;
  for (const id of ids) {
    try {
      await api.getSong(id);
      saved++;
    } catch {
      // Counted as not saved; the user can try again.
    }
  }
  return { saved, total: ids.length };
}
