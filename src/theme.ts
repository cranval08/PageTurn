import { useEffect } from "react";
import type { Settings } from "./lib/db/schema";
import { useSettings } from "./store/settings";

type Theme = Settings["theme"];

/** Browser UI colour per theme (status bar / title bar). */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#F6F4EF",
  sepia: "#F4ECD8",
  dark: "#1B1A18",
};

const MIRROR_KEY = "pageturn.theme";

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

/**
 * Settings load asynchronously from IndexedDB; apply the last theme straight away
 * from a localStorage mirror so a dark-theme reader never sees a white flash.
 */
export function applyThemeEarly(): void {
  try {
    const t = localStorage.getItem(MIRROR_KEY);
    if (t === "light" || t === "sepia" || t === "dark") applyTheme(t);
  } catch {
    /* storage blocked: settings will apply it moments later */
  }
}

/** RDR-13: keep <html data-theme> in sync with settings. */
export function ThemeSync() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(MIRROR_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return null;
}
