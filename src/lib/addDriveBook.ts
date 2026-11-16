import { saveBook } from "./db/books";
import type { Book } from "./db/schema";
import { isPdfBytes, NotPdfError, titleFromFileName } from "./files";
import { downloadDriveFile, getDriveFile } from "./google/drive";
import { PDF_MIME, type PickedFile } from "./google/picker";
import { renderCover } from "./pdf/cover";
import { openPdf } from "./pdf/loader";

export type ImportStage = "downloading" | "processing";

/**
 * DRV-3/DRV-7: download a picked Drive file with drive.file access, check it is a
 * real, openable PDF, render its cover and store it. The book id is the Drive fileId.
 * Throws NotPdfError, PdfOpenError, DriveError.
 */
export async function importDriveFile(
  picked: PickedFile,
  token: string,
  onProgress: (stage: ImportStage, loaded: number, total: number) => void,
): Promise<Book> {
  if (picked.mimeType !== PDF_MIME) throw new NotPdfError(picked.name);
  const meta = await getDriveFile(picked.id, token);
  if (meta.mimeType !== PDF_MIME) throw new NotPdfError(meta.name);

  const total = meta.sizeBytes ?? picked.sizeBytes ?? 0;
  onProgress("downloading", 0, total);
  const blob = await downloadDriveFile(meta.id, token, {
    expectedBytes: total,
    onProgress: (loaded, t) => onProgress("downloading", loaded, t),
  });

  onProgress("processing", blob.size, blob.size);
  const bytes = await blob.arrayBuffer();
  if (!isPdfBytes(new Uint8Array(bytes))) throw new NotPdfError(meta.name);

  const doc = await openPdf(bytes.slice(0)); // pdf.js may transfer (detach) its buffer
  try {
    const coverDataUrl = await renderCover(doc);
    return await saveBook({
      id: meta.id,
      source: "drive",
      title: titleFromFileName(meta.name),
      pageCount: doc.numPages,
      sizeBytes: blob.size,
      coverDataUrl,
      driveModifiedTime: meta.modifiedTime,
      data: new Blob([bytes], { type: PDF_MIME }),
    });
  } finally {
    void doc.loadingTask.destroy();
  }
}
