import { useCallback, useEffect, useRef, useState } from "react";

/** RDR-7: the toolbar hides itself this long after the last interaction. */
export const AUTO_HIDE_MS = 3000;

/**
 * Visible on start; hides after `delayMs` of no activity unless `pinned`
 * (a panel is open, or the keyboard focus / mouse is on the toolbar).
 */
export function useAutoHide(pinned: boolean, delayMs = AUTO_HIDE_MS) {
  const [visible, setVisible] = useState(true);
  const [activity, setActivity] = useState(0);
  const lastBump = useRef(0);

  useEffect(() => {
    if (!visible || pinned) return;
    const t = window.setTimeout(() => setVisible(false), delayMs);
    return () => window.clearTimeout(t);
  }, [visible, pinned, activity, delayMs]);

  /** Show and restart the timer (throttled, so mousemove is cheap). */
  const show = useCallback(() => {
    setVisible(true);
    const now = Date.now();
    if (now - lastBump.current > 250) {
      lastBump.current = now;
      setActivity((a) => a + 1);
    }
  }, []);

  const toggle = useCallback(() => {
    setVisible((v) => !v);
    setActivity((a) => a + 1);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  return { visible, show, hide, toggle };
}
