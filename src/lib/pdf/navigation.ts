import type { PDFDocumentProxy } from "./loader";

/** The parts of PDFDocumentProxy navigation needs (lets unit tests use a fake). */
export type NavDoc = Pick<PDFDocumentProxy, "getDestination" | "getPageIndex" | "getOutline" | "getPage">;

/**
 * RDR-10/RDR-12: turn a PDF destination (named string or explicit array) into a
 * 0-based page index, or null if it can't be resolved.
 */
export async function destToPageIndex(doc: NavDoc, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const target = explicit[0];
    if (typeof target === "number" && Number.isInteger(target)) return target; // some writers use a page number
    if (target && typeof target === "object" && "num" in target) {
      return await doc.getPageIndex(target as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
    }
    return null;
  } catch {
    return null;
  }
}

/** Only these schemes may open from a PDF (never javascript:, data:, file:…). */
export function safeExternalUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export interface OutlineNode {
  title: string;
  /** 0-based target page, if the entry points inside the document. */
  pageIndex: number | null;
  /** Safe external URL, if the entry is a web link. */
  url: string | null;
  children: OutlineNode[];
}

interface RawOutlineItem {
  title: string;
  dest: unknown;
  url?: string | null;
  items: RawOutlineItem[];
}

/** RDR-10: the PDF's table of contents with page numbers resolved ([] if it has none). */
export async function loadOutline(doc: NavDoc): Promise<OutlineNode[]> {
  const raw = ((await doc.getOutline()) ?? []) as unknown as RawOutlineItem[];
  const convert = async (items: RawOutlineItem[]): Promise<OutlineNode[]> =>
    Promise.all(
      items.map(async (item) => ({
        title: item.title?.trim() || "Untitled section",
        pageIndex: item.dest ? await destToPageIndex(doc, item.dest) : null,
        url: safeExternalUrl(item.url),
        children: await convert(item.items ?? []),
      })),
    );
  return convert(raw);
}

export type PageLink =
  | { kind: "internal"; pageIndex: number; rect: LinkRect }
  | { kind: "external"; url: string; rect: LinkRect };

/** Position in CSS px within the rendered page. */
export interface LinkRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RawAnnotation {
  subtype: string;
  rect: number[];
  dest?: unknown;
  url?: string;
}

/** RDR-12: the link annotations of one page, positioned for a page `cssWidth` px wide. */
export async function loadPageLinks(doc: NavDoc, pageNumber: number, cssWidth: number): Promise<PageLink[]> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: cssWidth / base.width });
  const annotations = (await page.getAnnotations({ intent: "display" })) as RawAnnotation[];
  const links: PageLink[] = [];
  for (const a of annotations) {
    if (a.subtype !== "Link" || !Array.isArray(a.rect)) continue;
    // pdf.js 6 has no convertToViewportRectangle: convert the two corners.
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as [number, number];
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as [number, number];
    const rect = {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
    if (a.dest !== undefined && a.dest !== null) {
      const pageIndex = await destToPageIndex(doc, a.dest);
      if (pageIndex !== null) links.push({ kind: "internal", pageIndex, rect });
    } else {
      const url = safeExternalUrl(a.url);
      if (url) links.push({ kind: "external", url, rect });
    }
  }
  return links;
}
