import { useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";

export const UNSAVED_MESSAGE = "You have unsaved changes. Leave without saving?";

/**
 * Warns before leaving a page that has unsaved changes: `window.confirm` for in-app navigation, and the browser's
 * own prompt (`beforeunload`) for reload or close. Must be used inside a data router.
 * Call `allowNavigation()` just before navigating away on purpose (after a successful save or delete). The allowance
 * covers only the next navigation; after that, the warning is back on.
 */
export function useUnsavedChanges(when: boolean): { allowNavigation: () => void } {
  const allowRef = useRef(false);
  const blocker = useBlocker(() => {
    if (allowRef.current) {
      allowRef.current = false;
      return false;
    }
    return when;
  });

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(UNSAVED_MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!when) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Some browsers only show their prompt when returnValue is set.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [when]);

  return {
    allowNavigation: () => {
      allowRef.current = true;
    },
  };
}
