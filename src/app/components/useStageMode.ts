import { useEffect, useRef, useState } from "react";

function exitFullscreen(): void {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      void Promise.resolve(document.exitFullscreen()).catch(() => {});
    }
  } catch {
    // Fullscreen isn't available here; nothing to undo.
  }
}

/**
 * Stage mode: while `on`, `document.body` has the class `stage` (CSS hides the top bar and bottom nav) and the
 * browser is asked for fullscreen where it supports that. Without fullscreen support it still works, just
 * without the browser chrome going away.
 */
export function useStageMode(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(false);
  // True once this hook has successfully asked for fullscreen, so we only react to leaving it.
  const enteredFullscreen = useRef(false);

  useEffect(() => {
    if (!on) return;
    document.body.classList.add("stage");
    return () => document.body.classList.remove("stage");
  }, [on]);

  useEffect(() => {
    function onFullscreenChange() {
      if (enteredFullscreen.current && !document.fullscreenElement) {
        enteredFullscreen.current = false;
        setOn(false);
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (enteredFullscreen.current) exitFullscreen();
    };
  }, []);

  function toggle() {
    if (on) {
      enteredFullscreen.current = false;
      exitFullscreen();
      setOn(false);
      return;
    }
    setOn(true);
    try {
      const el = document.documentElement;
      if (typeof el.requestFullscreen === "function") {
        enteredFullscreen.current = true;
        void Promise.resolve(el.requestFullscreen()).catch(() => {
          enteredFullscreen.current = false;
        });
      }
    } catch {
      enteredFullscreen.current = false;
    }
  }

  return { on, toggle };
}
