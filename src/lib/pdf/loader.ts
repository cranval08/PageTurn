import type { PDFDocumentProxy } from "pdfjs-dist";

export type { PDFDocumentProxy };

export type PdfErrorKind = "password" | "invalid" | "unknown";

export class PdfOpenError extends Error {
  readonly kind: PdfErrorKind;
  constructor(message: string, kind: PdfErrorKind) {
    super(message);
    this.name = "PdfOpenError";
    this.kind = kind;
  }
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads pdf.js and its worker on demand so they stay out of the initial bundle. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

export async function openPdf(data: Blob | ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  } catch (err) {
    throw toPdfOpenError(err);
  }
}

export function toPdfOpenError(err: unknown): PdfOpenError {
  const name = (err as { name?: string } | null)?.name;
  if (name === "PasswordException") {
    return new PdfOpenError("This PDF is password-protected. PageTurn can't open protected PDFs yet.", "password");
  }
  if (name === "InvalidPDFException" || name === "FormatError") {
    return new PdfOpenError("This file is damaged or isn't a valid PDF.", "invalid");
  }
  return new PdfOpenError("Something went wrong opening this PDF.", "unknown");
}
