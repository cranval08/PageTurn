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
writeFileSync(join(outDir, "not-a-pdf.pdf"), "This is plain text pretending to be a PDF.\n");
console.log("Fixtures written to", outDir);
