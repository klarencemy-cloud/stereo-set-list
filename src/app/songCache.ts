import { api, onChange } from "./api";
import { setlistOf } from "../shared/setlist";
import type { Song } from "../shared/types";

/** Cached songs and setlists are refetched after this long, so other band members' edits show up. */
export const CACHE_TTL_MS = 60_000;

interface Entry<T> {
  at: number;
  promise: Promise<T>;
  value?: T;
}

export interface LoadedSetlist {
  /** Song ids in setlist order, skipping songs deleted after they were added. */
  ids: string[];
  /** The gig's note for a song, by song id. */
  notes: Record<string, string>;
}

const songs = new Map<string, Entry<Song>>();
const setlists = new Map<string, Entry<LoadedSetlist>>();

// api.ts reports every successful change; forget exactly what it made stale. Pages don't clear
// this cache themselves, so a new feature that saves through api.ts can't forget to.
onChange((change) => {
  forget(songs, change.songs);
  forget(setlists, change.setlists);
});

function forget<T>(map: Map<string, Entry<T>>, keys: string[] | "all" | undefined) {
  if (keys === "all") map.clear();
  else for (const k of keys ?? []) map.delete(k);
}

function fresh<T>(entry: Entry<T> | undefined): entry is Entry<T> {
  return !!entry && Date.now() - entry.at <= CACHE_TTL_MS;
}

function load<T>(map: Map<string, Entry<T>>, key: string, fetch: () => Promise<T>): Promise<T> {
  const existing = map.get(key);
  if (fresh(existing)) return existing.promise;
  const entry: Entry<T> = { at: Date.now(), promise: fetch() };
  entry.promise.then(
    (value) => {
      entry.value = value;
    },
    () => {
      // A failed load must not stick: the next call tries again.
      if (map.get(key) === entry) map.delete(key);
    },
  );
  map.set(key, entry);
  return entry.promise;
}

export function loadSong(id: string): Promise<Song> {
  return load(songs, id, () => api.getSong(id));
}

/** The song, if it has already arrived and is still fresh. */
export function peekSong(id: string): Song | undefined {
  const entry = songs.get(id);
  return fresh(entry) ? entry.value : undefined;
}

export function prefetchSong(id: string): void {
  loadSong(id).catch(() => {});
}

export function rememberSong(song: Song): void {
  songs.set(song.id, { at: Date.now(), promise: Promise.resolve(song), value: song });
}

/** The gig's songs in order (and their notes), skipping songs deleted after they were added. */
export function loadSetlist(gigId: string): Promise<LoadedSetlist> {
  return load(setlists, gigId, async () => {
    const [gig, all] = await Promise.all([api.getGig(gigId), api.listSongs()]);
    const exists = new Set(all.map((s) => s.id));
    const ids: string[] = [];
    const notes: Record<string, string> = {};
    // setlistOf also reads gigs cached before breaks and notes existed (songIds only).
    for (const item of setlistOf(gig)) {
      if (item.type !== "song" || !exists.has(item.songId)) continue;
      ids.push(item.songId);
      if (item.note) notes[item.songId] = item.note;
    }
    return { ids, notes };
  });
}

export function clearSongCache(): void {
  songs.clear();
  setlists.clear();
}
