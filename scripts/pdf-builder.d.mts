export interface OutlineItem {
  title: string;
  page: number;
  children?: OutlineItem[];
}
export interface LinkSpec {
  text: string;
  x: number;
  y: number;
  /** 1-based target page for an internal link. */
  toPage?: number;
  uri?: string;
}
export interface BuildOptions {
  encrypted?: boolean;
  outline?: OutlineItem[];
  links?: Record<number, LinkSpec[]>;
  /** Replaces the "PageTurn test fixture - N pages" line. */
  label?: string;
}
/** Build a simple N-page text PDF, optionally with an outline, links, or marked password-protected. */
export function buildPdf(pageCount: number, options?: BuildOptions): Buffer;
