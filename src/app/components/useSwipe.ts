import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export const SWIPE_MIN_PX = 60;
export const SWIPE_MAX_MS = 600;

/**
 * Calls onLeft when the finger moves left across the element (and onRight for right),
 * for a quick, mostly sideways swipe. Content that can still scroll sideways in that
 * direction scrolls instead, so wide chord lines stay readable.
 */
export function useSwipe(
  ref: RefObject<HTMLElement>,
  handlers: { onLeft?: () => void; onRight?: () => void },
): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  // No dependency list: the element may only appear after data loads, so re-check every render.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number; t: number; atLeftEdge: boolean; atRightEdge: boolean } | null = null;
    let multiTouch = false;

    const onStart = (e: TouchEvent) => {
      // A second finger means pinch-zoom, not a swipe: ignore the whole gesture.
      if (e.touches.length > 1) {
        multiTouch = true;
        start = null;
        return;
      }
      multiTouch = false;
      const t = e.touches[0];
      // Read the edges now: by touchend the drag itself may have scrolled the line to an edge.
      start = t
        ? {
            x: t.clientX,
            y: t.clientY,
            t: performance.now(),
            atLeftEdge: el.scrollLeft <= 0,
            atRightEdge: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
          }
        : null;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const s = start;
      start = null;
      if (!s || !t || multiTouch) return;
      // Zoomed in, a sideways drag pans the page; it must not change song.
      if ((window.visualViewport?.scale ?? 1) > 1.01) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= 2 * Math.abs(dy)) return;
      if (performance.now() - s.t > SWIPE_MAX_MS) return;
      if (dx < 0) {
        if (s.atRightEdge) latest.current.onLeft?.();
      } else if (s.atLeftEdge) {
        latest.current.onRight?.();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  });
}
