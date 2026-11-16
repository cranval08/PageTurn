import { beforeEach, describe, expect, it, vi } from "vitest";

const drive = vi.hoisted(() => ({ getDriveFile: vi.fn(), downloadDriveFile: vi.fn() }));
vi.mock("../../src/lib/google/drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/google/drive")>()),
  ...drive,
}));
const pdf = vi.hoisted(() => ({ openPdf: vi.fn() }));
vi.mock("../../src/lib/pdf/loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/pdf/loader")>()),
  ...pdf,
}));
vi.mock("../../src/lib/pdf/cover", () => ({ renderCover: vi.fn(async () => "data:image/jpeg;base64,AA") }));
const saveBook = vi.hoisted(() => vi.fn(async (b: unknown) => b));
vi.mock("../../src/lib/db/books", () => ({ saveBook }));

import { importDriveFile } from "../../src/lib/addDriveBook";
import { NotPdfError } from "../../src/lib/files";
import { PdfOpenError } from "../../src/lib/pdf/loader";

const picked = { id: "f1", name: "Notes.pdf", mimeType: "application/pdf" };
const bytes = (text: string) => new Blob([text], { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  drive.getDriveFile.mockResolvedValue({ id: "f1", name: "Notes.pdf", mimeType: "application/pdf", sizeBytes: 9, modifiedTime: "2026-11-01T00:00:00Z" });
  drive.downloadDriveFile.mockResolvedValue(bytes("%PDF-1.7 x"));
  pdf.openPdf.mockResolvedValue({ numPages: 12, loadingTask: { destroy: vi.fn() } });
});

describe("importDriveFile (DRV-3, DRV-7)", () => {
  it("stores a Drive book under its fileId with modifiedTime", async () => {
    await importDriveFile(picked, "tok", () => {});
    expect(saveBook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1", source: "drive", title: "Notes", pageCount: 12, driveModifiedTime: "2026-11-01T00:00:00Z" }),
    );
  });

  it("rejects a non-PDF before downloading it", async () => {
    await expect(importDriveFile({ ...picked, mimeType: "image/png", name: "pic.png" }, "tok", () => {})).rejects.toBeInstanceOf(NotPdfError);
    expect(drive.downloadDriveFile).not.toHaveBeenCalled();
  });

  it("rejects bytes that are not a PDF even if Drive says application/pdf", async () => {
    drive.downloadDriveFile.mockResolvedValue(bytes("<html>not a pdf</html>"));
    await expect(importDriveFile(picked, "tok", () => {})).rejects.toBeInstanceOf(NotPdfError);
    expect(saveBook).not.toHaveBeenCalled();
  });

  it("surfaces password-protected and corrupt PDFs as PdfOpenError", async () => {
    pdf.openPdf.mockRejectedValue(new PdfOpenError("This PDF is password-protected.", "password"));
    await expect(importDriveFile(picked, "tok", () => {})).rejects.toMatchObject({ kind: "password" });
    expect(saveBook).not.toHaveBeenCalled();
  });
});
