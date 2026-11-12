import { api } from "./api";

export const NOT_READY = "Offline mode is still setting up. Reload the page and try again.";

/** Starts the offline service worker. Only in a production build: in dev it would cache Vite's modules. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Offline mode is a bonus; the site works without it.
  });
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
