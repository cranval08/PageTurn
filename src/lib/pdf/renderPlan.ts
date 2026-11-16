import { spreadLeftIndex, type Layout } from "../layout";

export type Quality = "none" | "low" | "high";

/** Memory NFR: current spread ± 2 pages, never more than this many rendered pages. */
export const MAX_RENDERED_PAGES = 6;
export const WINDOW_RADIUS = 2;
/** Low-res first pass (RDR-5): fast to draw, light on memory. */
export const LOW_PIXEL_RATIO = 0.5;
/** Cap one canvas at ~8 MP (≈32 MB) so zooming never exhausts a phone's memory. */
export const MAX_CANVAS_PIXELS = 8 * 1024 * 1024;

/** 0-based indexes on screen now: one page, or a spread (cover alone, then pairs). */
export function visiblePages(index: number, layout: Layout, pageCount: number): number[] {
  if (pageCount <= 0) return [];
  const clamp = (i: number) => Math.min(Math.max(i, 0), pageCount - 1);
  if (layout === "single") return [clamp(index)];
  const left = spreadLeftIndex(clamp(index));
  return left === 0 || left + 1 >= pageCount ? [left] : [left, left + 1];
}

/** Pages that may hold a canvas: the visible ones ± WINDOW_RADIUS, at most MAX_RENDERED_PAGES. */
export function renderWindow(index: number, layout: Layout, pageCount: number): number[] {
  const visible = visiblePages(index, layout, pageCount);
  if (visible.length === 0) return [];
  const first = Math.max(0, visible[0] - WINDOW_RADIUS);
  const last = Math.min(pageCount - 1, visible[visible.length - 1] + WINDOW_RADIUS);
  const pages: number[] = [];
  for (let i = first; i <= last; i++) pages.push(i);
  return pages.slice(0, MAX_RENDERED_PAGES);
}

/**
 * RDR-5: visible pages render crisp once the flip has settled; during a flip and
 * for neighbours a low-res pass is enough; everything else is released.
 */
export function desiredQuality(page: number, index: number, layout: Layout, pageCount: number, settled: boolean): Quality {
  if (visiblePages(index, layout, pageCount).includes(page)) return settled ? "high" : "low";
  return renderWindow(index, layout, pageCount).includes(page) ? "low" : "none";
}

/** Canvas pixels per CSS pixel for a quality, honouring zoom but capped by MAX_CANVAS_PIXELS. */
export function renderPixelRatio(quality: Quality, devicePixelRatio: number, zoom: number, cssWidth: number, cssHeight: number): number {
  if (quality === "low") return LOW_PIXEL_RATIO;
  const wanted = Math.max(1, devicePixelRatio) * Math.max(1, zoom);
  const cap = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssWidth * cssHeight));
  return Math.max(LOW_PIXEL_RATIO, Math.min(wanted, cap));
}
