import { useState } from "react";

export const SPEEDS = [0.5, 1, 1.5, 2, 3] as const;
export const DEFAULT_SPEED = 1;

export function speedKey(songId: string): string {
  return `stereo-set:scroll-speed:${songId}`;
}

function readSaved(songId: string): number {
  try {
    const n = Number(localStorage.getItem(speedKey(songId)));
    if ((SPEEDS as readonly number[]).includes(n)) return n;
  } catch {
    // Storage blocked (private mode): fall back to the default.
  }
  return DEFAULT_SPEED;
}

/**
 * Autoscroll speed for one song, remembered on this device (the right speed depends on the screen and text size,
 * so it is not shared with the band). SongPage is reused when moving between songs, so when `songId` changes the
 * new song's saved speed is returned in that same render: a song never scrolls at the previous song's speed.
 */
export function useSongSpeed(songId: string): { speed: number; cycle: () => void } {
  const [state, setState] = useState(() => ({ songId, speed: readSaved(songId) }));
  let current = state;
  if (state.songId !== songId) {
    current = { songId, speed: readSaved(songId) };
    setState(current);
  }

  function cycle() {
    const idx = (SPEEDS as readonly number[]).indexOf(current.speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setState({ songId, speed: next });
    try {
      localStorage.setItem(speedKey(songId), String(next));
    } catch {
      // Not saved, but the change still applies for this visit.
    }
  }

  return { speed: current.speed, cycle };
}
