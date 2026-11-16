// Copies the resources pdf.js loads at runtime into public/pdfjs/ (git-ignored):
//   wasm/            JPEG 2000 (OpenJPEG), JBIG2 and colour-management (qcms) decoders —
//                    without them, scanned pages render blank
//   cmaps/           Adobe character maps — without them, CJK and other CMap-encoded text is missing
//   standard_fonts/  data for the 14 standard fonts when a PDF doesn't embed them
//   iccs/            colour profiles
// PDF JavaScript (quickjs) is deliberately left out: scripting is not enabled.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");

export const PDFJS_ASSET_DIRS = ["wasm", "cmaps", "standard_fonts", "iccs"];

export function copyPdfjsAssets() {
  if (!existsSync(source)) throw new Error("pdfjs-dist is not installed (run npm install)");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const dir of PDFJS_ASSET_DIRS) {
    cpSync(join(source, dir), join(target, dir), {
      recursive: true,
      filter: (src) => !/quickjs/i.test(src),
    });
  }
  return PDFJS_ASSET_DIRS.map((d) => `${d} (${readdirSync(join(target, d)).length} files)`).join(", ");
}

/** Vite plugin: copy before the dev server starts and before every build. */
export function pdfjsAssets() {
  return {
    name: "pageturn-pdfjs-assets",
    buildStart() {
      copyPdfjsAssets();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log("Copied pdf.js assets:", copyPdfjsAssets());
}
