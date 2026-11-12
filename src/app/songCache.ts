import { api } from "./api";
import type { Song } from "../shared/types";

/** Cached songs and setlists are refetched after this long, so other band members' edits show up. */
export const CACHE_TTL_MS = 60_000;

interface Entry<T> {
  at: number;
  promise: Promise<T>;
  value?: T;
}

const songs = new Map<string, Entry<Song>>();
const setlists = new Map<string, Entry<string[]>>();

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

/** The gig's song ids, skipping songs deleted after they were added. */
export function loadSetlist(gigId: string): Promise<string[]> {
  return load(setlists, gigId, async () => {
    const [gig, all] = await Promise.all([api.getGig(gigId), api.listSongs()]);
    const exists = new Set(all.map((s) => s.id));
    return gig.songIds.filter((sid) => exists.has(sid));
  });
}

export function clearSongCache(): void {
  songs.clear();
  setlists.clear();
}
