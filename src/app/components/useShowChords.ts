import { useState } from "react";

export const SHOW_CHORDS_KEY = "stereo-set:show-chords";

function readSaved(): boolean {
  try {
    return localStorage.getItem(SHOW_CHORDS_KEY) !== "off";
  } catch {
    // Storage blocked (private mode): chords on, the default.
    return true;
  }
}

/** Whether song sheets show chords (or lyrics only) on this device, remembered for every song. */
export function useShowChords(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(readSaved);
  function toggle() {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(SHOW_CHORDS_KEY, next ? "on" : "off");
    } catch {
      // Not saved, but the change still applies for this visit.
    }
  }
  return { on, toggle };
}
