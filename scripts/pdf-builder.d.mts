/** Build a simple N-page text PDF (optionally marked password-protected). */
export function buildPdf(pageCount: number, options?: { encrypted?: boolean }): Buffer;
