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
  /** RDR-14: bookmarked pages (1-based, sorted). */
  bookmarks: number[];
  /** RDR-12: jump to a 0-based page (set by the reader; used by in-page links). */
  navigate: (pageIndex: number) => void;
  setPageIndex(index: number): void;
  setLayout(layout: Layout): void;
  setPageCount(count: number): void;
  setFlipping(flipping: boolean): void;
  setSettledZoom(zoom: number): void;
  setBookmarks(bookmarks: number[]): void;
  setNavigate(navigate: (pageIndex: number) => void): void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  pageIndex: 0,
  layout: "single",
  pageCount: 0,
  flipping: false,
  settledZoom: 1,
  bookmarks: [],
  navigate: () => {},
  setPageIndex: (pageIndex) => set({ pageIndex }),
  setLayout: (layout) => set({ layout }),
  setPageCount: (pageCount) => set({ pageCount }),
  setFlipping: (flipping) => set({ flipping }),
  setSettledZoom: (settledZoom) => set({ settledZoom }),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  setNavigate: (navigate) => set({ navigate }),
}));
