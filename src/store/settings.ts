import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Settings } from "../lib/db/schema";
import { idbStateStorage } from "../lib/db/settingsStorage";

/** RDR-4: page-turn animation is off by default when the OS asks for reduced motion. */
export function defaultAnimation(prefersReducedMotion: boolean): Settings["animation"] {
  return prefersReducedMotion ? "none" : "curl";
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const DEFAULT_SETTINGS: Settings = {
  layout: "auto",
  theme: "light",
  animation: defaultAnimation(prefersReducedMotion()),
  sound: false,
};

interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void;
}

/** Reader settings, persisted to IndexedDB (kv table, key "settings"). */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
    }),
    {
      name: "settings",
      version: 1,
      storage: createJSONStorage(() => idbStateStorage),
      partialize: ({ layout, theme, animation, sound }): Settings => ({ layout, theme, animation, sound }),
    },
  ),
);
