import { saveBook } from "./db/books";
import type { Book } from "./db/schema";
import { readLocalPdf } from "./files";
import { renderCover } from "./pdf/cover";
import { openPdf } from "./pdf/loader";

/**
 * DRV-5 + OFF-1: validate a PDF from the device, read its page count and cover,
 * and store it in IndexedDB. Throws NotPdfError or PdfOpenError.
 */
export async function addLocalBook(file: File): Promise<Book> {
  const pdf = await readLocalPdf(file);
  const doc = await openPdf(pdf.data);
  try {
    const coverDataUrl = await renderCover(doc);
    return await saveBook({
      id: pdf.id,
      source: "local",
      title: pdf.title,
      pageCount: doc.numPages,
      sizeBytes: pdf.sizeBytes,
      coverDataUrl,
      data: pdf.data,
    });
  } finally {
    void doc.loadingTask.destroy();
  }
}
