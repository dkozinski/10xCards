import { useCallback, useEffect, useRef } from "react";

// While `active`, leaving the page (closing the tab, reloading, following a link)
// shows the browser's native "Leave site?" prompt; its text cannot be customised.
// disarm() drops the listener at once, for a navigation the page itself starts
// after the work is saved: waiting for the next render would still prompt.
export function useUnsavedChangesGuard(active: boolean): { disarm: () => void } {
  const removeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    const remove = () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    removeRef.current = remove;
    return () => {
      remove();
      removeRef.current = null;
    };
  }, [active]);

  const disarm = useCallback(() => {
    removeRef.current?.();
    removeRef.current = null;
  }, []);

  return { disarm };
}
