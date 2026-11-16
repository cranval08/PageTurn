import { create } from "zustand";
import type { Layout } from "../lib/layout";

interface ReaderState {
  /** 0-based index of the current page (the left page of a spread). */
  pageIndex: number;
  layout: Layout;
  pageCount: number;
  /** A flip or drag is in progress (RDR-5: crisp rendering waits until it settles). */
  flipping: boolean;
  /** Zoom level once pinching/scrolling has stopped; drives re-rendering at higher resolution. */
  settledZoom: number;
  setPageIndex(index: number): void;
  setLayout(layout: Layout): void;
  setPageCount(count: number): void;
  setFlipping(flipping: boolean): void;
  setSettledZoom(zoom: number): void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  pageIndex: 0,
  layout: "single",
  pageCount: 0,
  flipping: false,
  settledZoom: 1,
  setPageIndex: (pageIndex) => set({ pageIndex }),
  setLayout: (layout) => set({ layout }),
  setPageCount: (pageCount) => set({ pageCount }),
  setFlipping: (flipping) => set({ flipping }),
  setSettledZoom: (settledZoom) => set({ settledZoom }),
}));
