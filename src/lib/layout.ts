export type LayoutMode = "auto" | "single" | "spread";
export type Layout = "single" | "spread";

/** RDR-2: spreads need a landscape viewport at least this wide. */
export const SPREAD_MIN_WIDTH = 900;
/** Below this width the book is full-bleed (0 px margin), otherwise 16 px. */
export const PHONE_MAX_WIDTH = 640;

export function chooseLayout(mode: LayoutMode, viewportWidth: number, viewportHeight: number): Layout {
  if (mode !== "auto") return mode;
  const landscape = viewportWidth > viewportHeight;
  return landscape && viewportWidth >= SPREAD_MIN_WIDTH ? "spread" : "single";
}

export function stageMargin(viewportWidth: number): number {
  return viewportWidth < PHONE_MAX_WIDTH ? 0 : 16;
}

/** Height of the reader's top and bottom bars (44 px controls + padding). */
export const BAR_HEIGHT = 60;

/**
 * Space kept free above and below the book. With a mouse, moving to a page corner
 * re-shows the toolbar, so on larger screens the book fits between the bars and
 * they never cover its corners. Phones stay full-bleed (bars overlay and auto-hide).
 */
export function chromeInset(viewportWidth: number): number {
  return viewportWidth < PHONE_MAX_WIDTH ? 0 : BAR_HEIGHT;
}

/**
 * In a spread the cover (index 0) sits alone on the right, then pairs [1,2], [3,4]…
 * Returns the left index of the spread that contains `index`.
 */
export function spreadLeftIndex(index: number): number {
  if (index <= 0) return 0;
  return index % 2 === 1 ? index : index - 1;
}

/** Human page label: "12–13 / 312" for a spread, "12 / 312" for a single page. */
export function pageLabel(index: number, pageCount: number, layout: Layout): string {
  if (layout === "spread") {
    const left = spreadLeftIndex(index);
    if (left > 0 && left + 1 < pageCount) return `${left + 1}–${left + 2} / ${pageCount}`;
    return `${left + 1} / ${pageCount}`;
  }
  return `${index + 1} / ${pageCount}`;
}

/** Screen-reader announcement (accessibility NFR). */
export function pageAnnouncement(index: number, pageCount: number, layout: Layout): string {
  if (layout === "spread") {
    const left = spreadLeftIndex(index);
    if (left > 0 && left + 1 < pageCount) return `Pages ${left + 1} and ${left + 2} of ${pageCount}`;
    return `Page ${left + 1} of ${pageCount}`;
  }
  return `Page ${index + 1} of ${pageCount}`;
}

export interface PageSize {
  width: number;
  height: number;
}

/**
 * Largest page size (integer CSS px) that fits the stage for the given layout.
 * `aspect` is page width / page height.
 */
export function fitPageSize(
  layout: Layout,
  stageWidth: number,
  stageHeight: number,
  aspect: number,
  margin: number,
): PageSize {
  const availW = Math.max(1, stageWidth - margin * 2);
  const availH = Math.max(1, stageHeight - margin * 2);
  const columns = layout === "spread" ? 2 : 1;
  const width = Math.min(availW / columns, availH * aspect);
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(width / aspect)),
  };
}
