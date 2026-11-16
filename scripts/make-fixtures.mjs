// Generates deterministic test PDFs in tests/fixtures (no dependencies).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPdf } from "./pdf-builder.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "sample-50p.pdf"), buildPdf(50));
writeFileSync(join(outDir, "password-protected.pdf"), buildPdf(3, { encrypted: true }));
// Corrupt: a valid PDF header followed by garbage, with no objects or xref table.
writeFileSync(join(outDir, "corrupt.pdf"), `%PDF-1.4\n${"garbage ".repeat(200)}\n%%EOF\n`);
// RDR-10/RDR-12: a table of contents (with a nested chapter) and internal + external links.
writeFileSync(
  join(outDir, "outline-links.pdf"),
  buildPdf(20, {
    label: "Biology course reader",
    outline: [
      { title: "Chapter 1: Cells", page: 1 },
      {
        title: "Chapter 2: Genetics",
        page: 6,
        children: [
          { title: "2.1 DNA", page: 8 },
          { title: "2.2 RNA", page: 10 },
        ],
      },
      { title: "Chapter 3: Evolution", page: 15 },
    ],
    links: {
      2: [{ text: "See page 12 for diagrams", x: 300, y: 690, toPage: 12 }],
      3: [{ text: "Open example.com", x: 300, y: 690, uri: "https://example.com/" }],
    },
  }),
);
writeFileSync(join(outDir, "not-a-pdf.pdf"), "This is plain text pretending to be a PDF.\n");
console.log("Fixtures written to", outDir);
