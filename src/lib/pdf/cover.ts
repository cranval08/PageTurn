import type { PDFDocumentProxy } from "./loader";
import { releaseCanvas, renderPageCanvas } from "./renderPage";

export const COVER_WIDTH = 300;

/** LIB-1: page 1 thumbnail (~300 px wide) as a JPEG data URL. */
export async function renderCover(doc: PDFDocumentProxy, width = COVER_WIDTH): Promise<string> {
  const canvas = await renderPageCanvas(doc, 1, width, 1).promise;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Pages are drawn on a transparent canvas; give the JPEG a white background.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const url = canvas.toDataURL("image/jpeg", 0.8);
  releaseCanvas(canvas);
  return url;
}
