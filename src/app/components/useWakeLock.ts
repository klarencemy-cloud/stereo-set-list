import { useEffect } from "react";

/** Holds a screen wake lock while `active`, if the browser supports it. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    const acquire = () => {
      if (!nav.wakeLock) return;
      nav.wakeLock.request("screen").then(
        (l) => {
          if (cancelled) l.release().catch(() => {});
          else {
            if (lock) lock.release().catch(() => {});
            lock = l;
          }
        },
        () => {},
      );
    };
    // The browser drops the lock when the page is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, [active]);
}
