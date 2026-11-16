import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPdfBytes, NotPdfError, readLocalPdf, titleFromFileName } from "../../src/lib/files";
import { toPdfOpenError } from "../../src/lib/pdf/loader";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name));
const asFile = (bytes: Uint8Array, name: string) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

describe("isPdfBytes", () => {
  it("recognises the PDF header", () => {
    expect(isPdfBytes(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(isPdfBytes(fixture("sample-50p.pdf"))).toBe(true);
  });

  it("rejects other content", () => {
    expect(isPdfBytes(fixture("not-a-pdf.pdf"))).toBe(false);
    expect(isPdfBytes(new Uint8Array())).toBe(false);
  });
});

describe("readLocalPdf (DRV-5)", () => {
  it("builds a stable local: + SHA-256 id and a title", async () => {
    const bytes = fixture("sample-50p.pdf");
    const a = await readLocalPdf(asFile(bytes, "Lecture_Notes.pdf"));
    const b = await readLocalPdf(asFile(bytes, "renamed.pdf"));
    expect(a.id).toMatch(/^local:[0-9a-f]{64}$/);
    expect(a.id).toBe(b.id);
    expect(a.title).toBe("Lecture Notes");
    expect(a.sizeBytes).toBe(bytes.byteLength);
    expect(a.data.type).toBe("application/pdf");
  });

  it("rejects a file that is not a PDF, even with a .pdf name", async () => {
    await expect(readLocalPdf(asFile(fixture("not-a-pdf.pdf"), "fake.pdf"))).rejects.toBeInstanceOf(NotPdfError);
  });
});

describe("titleFromFileName", () => {
  it("strips the extension and underscores", () => {
    expect(titleFromFileName("Calculus_Ch1.PDF")).toBe("Calculus Ch1");
    expect(titleFromFileName(".pdf")).toBe("Untitled");
  });
});

describe("toPdfOpenError", () => {
  it("maps pdf.js errors to friendly kinds", () => {
    expect(toPdfOpenError({ name: "PasswordException" }).kind).toBe("password");
    expect(toPdfOpenError({ name: "InvalidPDFException" }).kind).toBe("invalid");
    expect(toPdfOpenError(new Error("boom")).kind).toBe("unknown");
  });
});

describe("pdfResourceOptions (blank-pages fix)", () => {
  it("points pdf.js at the site-root resources, never relative to the current page", async () => {
    const { pdfResourceOptions } = await import("../../src/lib/pdf/loader");
    const o = pdfResourceOptions("https://pageturn.example", "/");
    expect(o).toEqual({
      wasmUrl: "https://pageturn.example/pdfjs/wasm/",
      cMapUrl: "https://pageturn.example/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "https://pageturn.example/pdfjs/standard_fonts/",
      iccUrl: "https://pageturn.example/pdfjs/iccs/",
      enableScripting: false,
    });
    // Defaults use the origin, so /read/<book> still resolves to /pdfjs/…
    window.history.pushState({}, "", "/read/local%3Aabc");
    expect(pdfResourceOptions().cMapUrl).toBe(`${location.origin}/pdfjs/cmaps/`);
  });
});
