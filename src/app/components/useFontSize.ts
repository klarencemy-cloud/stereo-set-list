import { useState } from "react";

export const FONT_SIZES = [13, 15, 17, 20, 24, 28] as const;
export const DEFAULT_FONT_SIZE = 15;
export const FONT_SIZE_KEY = "stereo-set:sheet-font-size";

function readSaved(): number {
  try {
    const n = Number(localStorage.getItem(FONT_SIZE_KEY));
    if ((FONT_SIZES as readonly number[]).includes(n)) return n;
  } catch {
    // Storage blocked (private mode): fall back to the default.
  }
  return DEFAULT_FONT_SIZE;
}

/** The chord sheet's text size on this device, remembered between visits. */
export function useFontSize(): {
  size: number;
  smaller: () => void;
  bigger: () => void;
  canShrink: boolean;
  canGrow: boolean;
} {
  const [size, setSize] = useState(readSaved);
  const idx = (FONT_SIZES as readonly number[]).indexOf(size);

  function step(delta: number) {
    const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, idx + delta))];
    setSize(next);
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(next));
    } catch {
      // Not saved, but the change still applies for this visit.
    }
  }

  return {
    size,
    smaller: () => step(-1),
    bigger: () => step(1),
    canShrink: idx > 0,
    canGrow: idx < FONT_SIZES.length - 1,
  };
}
