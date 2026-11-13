import type { SetlistItem } from "./types";

/** The setlist of a gig, reading legacy gigs that only have `songIds`. */
export function setlistOf(gig: { songIds?: string[]; setlist?: SetlistItem[] }): SetlistItem[] {
  if (Array.isArray(gig.setlist)) return gig.setlist;
  return (gig.songIds ?? []).map((songId) => ({ type: "song", songId }));
}

export function songIdsOf(items: SetlistItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) if (item.type === "song") ids.push(item.songId);
  return ids;
}

/**
 * Rebuilds a setlist from a bare list of song ids (what an old client sends): that order,
 * each kept song's note preserved, breaks dropped.
 */
export function fromSongIds(songIds: string[], previous: SetlistItem[]): SetlistItem[] {
  const notes = new Map<string, string>();
  for (const item of previous) if (item.type === "song" && item.note) notes.set(item.songId, item.note);
  return songIds.map((songId): SetlistItem => {
    const note = notes.get(songId);
    return note ? { type: "song", songId, note } : { type: "song", songId };
  });
}

/** A copy of `items` with the element at `from` moved to `to`. Out-of-range moves change nothing. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function itemKey(item: SetlistItem): string {
  return item.type === "song" ? `song:${item.songId}` : `break:${item.id}`;
}

/** Drag-and-drop result: `activeKey` takes the place of `overKey`. Null if nothing moved or a key is unknown. */
export function reorderByKeys(items: SetlistItem[], activeKey: string, overKey: string): SetlistItem[] | null {
  const keys = items.map(itemKey);
  const from = keys.indexOf(activeKey);
  const to = keys.indexOf(overKey);
  if (from === -1 || to === -1 || from === to) return null;
  return moveItem(items, from, to);
}
