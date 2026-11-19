import { useEffect } from "react";

/** A held screen wake lock. `addEventListener` is optional so a partial implementation can't throw. */
interface Sentinel {
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
}

/** Holds a screen wake lock while `active`, if the browser supports it. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let lock: Sentinel | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };
    const acquire = () => {
      if (!nav.wakeLock) return;
      nav.wakeLock.request("screen").then(
        (l) => {
          if (cancelled) {
            l.release().catch(() => {});
            return;
          }
          if (lock) lock.release().catch(() => {});
          lock = l;
          // The phone can drop it while the page is visible (a battery saver, a system dialog): ask again, silently.
          // Hidden, it is asked again on return instead. A refusal shows nothing: the screen dimming says enough.
          l.addEventListener?.("release", () => {
            if (cancelled || lock !== l) return;
            lock = null;
            if (document.visibilityState === "visible") acquire();
          });
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
