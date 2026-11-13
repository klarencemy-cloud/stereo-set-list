import { useEffect } from "react";

/** Scrolls the window down at 20 px/s x speed while running. */
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
}
