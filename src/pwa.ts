import { registerSW } from "virtual:pwa-register";
import { create } from "zustand";

interface PwaState {
  /** A new version is installed and waiting. */
  needRefresh: boolean;
  update(): void;
  dismiss(): void;
}

let updateServiceWorker: ((reload?: boolean) => Promise<void>) | null = null;

export const usePwa = create<PwaState>((set) => ({
  needRefresh: false,
  update: () => void updateServiceWorker?.(true),
  dismiss: () => set({ needRefresh: false }),
}));

/** OFF-2: register the service worker (production builds only). */
export function initPwa(): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
  });
}
