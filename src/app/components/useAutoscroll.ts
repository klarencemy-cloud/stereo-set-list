import { useEffect } from "react";

/** Scrolls the window down at 20 px/s x speed while running, and holds a screen wake lock if supported. */
export function useAutoscroll(speed: number, running: boolean): void {
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const step = (now: number) => {
      carry += ((now - last) / 1000) * 20 * speed;
      last = now;
      const whole = Math.floor(carry);
      if (whole >= 1) {
        window.scrollBy(0, whole);
        carry -= whole;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [speed, running]);

  useEffect(() => {
    if (!running) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock) {
      nav.wakeLock.request("screen").then(
        (l) => {
          if (cancelled) l.release().catch(() => {});
          else lock = l;
        },
        () => {},
      );
    }
    return () => {
      cancelled = true;
      if (lock) lock.release().catch(() => {});
    };
  }, [running]);
}
