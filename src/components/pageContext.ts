import { createContext } from "react";
import type { PDFDocumentProxy } from "../lib/pdf/loader";
import type { PageCache } from "../lib/pdf/pageCache";
import type { Quality } from "../lib/pdf/renderPlan";

export interface CachedPage {
  canvas: HTMLCanvasElement;
  quality: Exclude<Quality, "none">;
  pixelRatio: number;
}

export interface PageContextValue {
  doc: PDFDocumentProxy;
  width: number;
  height: number;
  /** Device pixel ratio (capped). */
  pixelRatio: number;
  /** Shared LRU of rendered canvases (max 6, Memory NFR). */
  cache: PageCache<number, CachedPage>;
}

/** Everything a page needs; react-pageflip never passes new props to existing pages. */
export const PageContext = createContext<PageContextValue | null>(null);
