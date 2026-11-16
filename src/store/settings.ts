import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Settings } from "../lib/db/schema";
import { idbStateStorage } from "../lib/db/settingsStorage";

export const DEFAULT_SETTINGS: Settings = {
  layout: "auto",
  theme: "light",
  animation: "curl",
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
