import type { PDFDocumentProxy } from "pdfjs-dist";

export interface RenderHandle {
  promise: Promise<void>;
  cancel(): void;
}

/**
 * RDR-1: draw one page into `canvas` so it fills `cssWidth` CSS px at the given
 * pixel ratio. Draws offscreen first so the visible canvas never flashes blank.
 */
export function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  pixelRatio: number,
): RenderHandle {
  let cancelled = false;
  let task: { cancel(): void } | null = null;

  const promise = (async () => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) return;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth * pixelRatio) / base.width });
    const scratch = document.createElement("canvas");
    scratch.width = Math.floor(viewport.width);
    scratch.height = Math.floor(viewport.height);
    const renderTask = page.render({ canvas: scratch, viewport });
    task = renderTask;
    try {
      await renderTask.promise;
    } catch (err) {
      if ((err as { name?: string }).name === "RenderingCancelledException") return;
      throw err;
    }
    if (cancelled) return;
    canvas.width = scratch.width;
    canvas.height = scratch.height;
    canvas.getContext("2d")?.drawImage(scratch, 0, 0);
    scratch.width = scratch.height = 0; // release the scratch bitmap
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}
