import { create } from "zustand";

interface ReaderState {
  /** 0-based index of the current page (the left page of a spread). */
  pageIndex: number;
  setPageIndex(index: number): void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  pageIndex: 0,
  setPageIndex: (pageIndex) => set({ pageIndex }),
}));

/** Pages within this many indexes of the current page keep a canvas (Phase 4 tightens this to an LRU). */
export const RENDER_WINDOW = 3;

export function isInRenderWindow(index: number, current: number): boolean {
  return Math.abs(index - current) <= RENDER_WINDOW;
}
