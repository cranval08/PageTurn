import { createContext, forwardRef, useContext, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdf/loader";
import type { PageCache } from "../lib/pdf/pageCache";
import { desiredQuality, LOW_PIXEL_RATIO, renderPixelRatio, type Quality } from "../lib/pdf/renderPlan";
import { RenderCancelled, renderPageCanvas, type RenderHandle } from "../lib/pdf/renderPage";
import { useReaderStore } from "../store/reader";

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

export const PageContext = createContext<PageContextValue | null>(null);

interface PdfPageProps {
  index: number;
}

/**
 * One book page. react-pageflip moves this element into its own DOM, so it must
 * forward its ref and read everything from context or the store (the flip
 * component does not pass new props to existing pages).
 *
 * RDR-5: shows a low-res render first, then a crisp one once the flip settles
 * (and again at higher resolution after zooming). Canvases live in the shared
 * PageCache and are attached to `host` imperatively.
 */
export const PdfPage = forwardRef<HTMLDivElement, PdfPageProps>(function PdfPage({ index }, ref) {
  const ctx = useContext(PageContext);
  const quality = useReaderStore((s) => desiredQuality(index, s.pageIndex, s.layout, s.pageCount, !s.flipping));
  const zoom = useReaderStore((s) => (quality === "high" ? s.settledZoom : 1));
  const hostRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Quality>("none");

  useEffect(() => {
    const host = hostRef.current;
    if (!ctx || !host) return;

    const show = (entry: CachedPage) => {
      entry.canvas.className = "pt-page-canvas";
      if (entry.canvas.parentElement !== host) host.replaceChildren(entry.canvas);
      setShown(entry.quality);
    };

    if (quality === "none") {
      host.replaceChildren(); // canvas stays in the LRU until evicted
      setShown("none");
      return;
    }

    const cached = ctx.cache.get(index);
    if (cached) show(cached);
    const needed = renderPixelRatio(quality, ctx.pixelRatio, zoom, ctx.width, ctx.height);
    if (cached && cached.pixelRatio >= needed - 0.01) return;

    let cancelled = false;
    const handles: RenderHandle<HTMLCanvasElement>[] = [];
    const renderAt = async (q: CachedPage["quality"], pixelRatio: number) => {
      const handle = renderPageCanvas(ctx.doc, index + 1, ctx.width, pixelRatio);
      handles.push(handle);
      const canvas = await handle.promise;
      const entry: CachedPage = { canvas, quality: q, pixelRatio };
      ctx.cache.set(index, entry);
      if (!cancelled) show(entry);
    };

    (async () => {
      try {
        // Nothing on screen yet (first open, or a jump): draw a quick low-res pass first.
        if (!cached && quality === "high") await renderAt("low", LOW_PIXEL_RATIO);
        if (!cancelled) await renderAt(quality, needed);
      } catch (err) {
        if (!(err instanceof RenderCancelled)) console.error(`Failed to render page ${index + 1}`, err);
      }
    })();

    return () => {
      cancelled = true;
      for (const h of handles) h.cancel();
    };
  }, [ctx, index, quality, zoom]);

  return (
    <div
      ref={ref}
      className="pt-page bg-white"
      data-page={index + 1}
      data-rendered={shown !== "none" ? "true" : "false"}
      data-quality={shown}
      role="img"
      aria-label={`Page ${index + 1}`}
    >
      <div ref={hostRef} className="pt-page-host" />
      {shown === "none" && (
        <div className="pt-page-skeleton" aria-hidden="true">
          <div className="pt-spinner" />
        </div>
      )}
    </div>
  );
});
