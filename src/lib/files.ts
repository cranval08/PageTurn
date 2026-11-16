export class NotPdfError extends Error {
  constructor(fileName: string) {
    super(`"${fileName}" is not a PDF. PageTurn can only open PDF files.`);
    this.name = "NotPdfError";
  }
}

/** True when the first 1 KB contains the PDF header (pdf.js tolerates leading junk too). */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/_+/g, " ").trim();
  return base || "Untitled";
}

export interface LocalPdf {
  id: string;
  title: string;
  data: Blob;
  sizeBytes: number;
}

/** DRV-5: read a PDF from the device. Book id is "local:" + SHA-256 of the bytes. */
export async function readLocalPdf(file: File): Promise<LocalPdf> {
  const buffer = await file.arrayBuffer();
  if (!isPdfBytes(new Uint8Array(buffer))) throw new NotPdfError(file.name);
  return {
    id: `local:${await sha256Hex(buffer)}`,
    title: titleFromFileName(file.name),
    data: new Blob([buffer], { type: "application/pdf" }),
    sizeBytes: buffer.byteLength,
  };
}
