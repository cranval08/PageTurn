// Generates deterministic test PDFs in tests/fixtures (no dependencies).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(outDir, { recursive: true });

function buildPdf(pageCount) {
  const objects = []; // index i => object number i + 1
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let n = 1; n <= pageCount; n++) {
    const lines = [
      `BT /F1 48 Tf 72 680 Td (Page ${n}) Tj ET`,
      `BT /F1 14 Tf 72 640 Td (PageTurn test fixture - ${pageCount} pages) Tj ET`,
      ...Array.from({ length: 20 }, (_, i) =>
        `BT /F1 11 Tf 72 ${600 - i * 22} Td (Line ${i + 1} of page ${n}. The quick brown fox jumps over the lazy dog.) Tj ET`),
      `BT /F1 12 Tf 290 40 Td (${n}) Tj ET`,
    ].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(lines)} >>\nstream\n${lines}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pageCount} >>`;

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

writeFileSync(join(outDir, "sample-50p.pdf"), buildPdf(50));
writeFileSync(join(outDir, "not-a-pdf.pdf"), "This is plain text pretending to be a PDF.\n");
console.log("Fixtures written to", outDir);
