import type { Plugin } from "vite";
export const PDFJS_ASSET_DIRS: string[];
export function copyPdfjsAssets(): string;
/** Vite plugin: copies pdf.js runtime assets into public/pdfjs before dev/build. */
export function pdfjsAssets(): Plugin;
