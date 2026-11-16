import { createContext, forwardRef, useContext, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdf/loader";
import { renderPageToCanvas } from "../lib/pdf/renderPage";
import { isInRenderWindow, useReaderStore } from "../store/reader";

export interface PageContextValue {
  doc: PDFDocumentProxy;
  width: number;
  height: number;
  pixelRatio: number;
}

export const PageContext = createContext<PageContextValue | null>(null);

interface PdfPageProps {
  index: number;
}

/**
 * One book page. react-pageflip moves this element into its own DOM, so it must
 * forward its ref and read everything it needs from context or the store
 * (the flip component does not pass new props to existing pages).
 */
export const PdfPage = forwardRef<HTMLDivElement, PdfPageProps>(function PdfPage({ index }, ref) {
  const ctx = useContext(PageContext);
  const near = useReaderStore((s) => isInRenderWindow(index, s.pageIndex));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !ctx || !canvas) return;
    setRendered(false);
    const handle = renderPageToCanvas(ctx.doc, index + 1, canvas, ctx.width, ctx.pixelRatio);
    handle.promise.then(
      () => setRendered(true),
      (err) => console.error(`Failed to render page ${index + 1}`, err),
    );
    return () => {
      handle.cancel();
      canvas.width = canvas.height = 0; // free the bitmap promptly (iOS Safari)
    };
  }, [near, ctx, index]);

  return (
    <div ref={ref} className="pt-page bg-white" data-page={index + 1}>
      {near && (
        <canvas
          ref={canvasRef}
          className="pt-page-canvas"
          data-rendered={rendered ? "true" : "false"}
          aria-label={`Page ${index + 1}`}
          role="img"
        />
      )}
      {!rendered && (
        <div className="pt-page-skeleton" aria-hidden="true">
          <div className="pt-spinner" />
        </div>
      )}
    </div>
  );
});
