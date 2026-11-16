import type { PDFDocumentProxy } from "pdfjs-dist";

export interface RenderHandle<T> {
  promise: Promise<T>;
  cancel(): void;
}

export class RenderCancelled extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "RenderCancelled";
  }
}

/**
 * RDR-1/RDR-5: draw one page into a NEW canvas sized `cssWidth` CSS px at the given
 * pixel ratio. The canvas is only shown once complete, so no blank frames.
 * Rejects with RenderCancelled if cancelled.
 */
export function renderPageCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  cssWidth: number,
  pixelRatio: number,
): RenderHandle<HTMLCanvasElement> {
  let cancelled = false;
  let task: { cancel(): void } | null = null;
  const canvas = document.createElement("canvas");

  const promise = (async () => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) throw new RenderCancelled();
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth * pixelRatio) / base.width });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const renderTask = page.render({ canvas, viewport });
    task = renderTask;
    try {
      await renderTask.promise;
    } catch (err) {
      canvas.width = canvas.height = 0;
      if ((err as { name?: string }).name === "RenderingCancelledException") throw new RenderCancelled();
      throw err;
    }
    if (cancelled) {
      canvas.width = canvas.height = 0;
      throw new RenderCancelled();
    }
    return canvas;
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

/** Release a canvas's backing store promptly (iOS Safari keeps it otherwise). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.remove();
  canvas.width = canvas.height = 0;
}
