// Renders the PageTurn icon (SVG) to the PNG sizes the web manifest and iOS need.
// Uses Playwright's Chromium, so no image library is required: `node scripts/make-icons.mjs`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const ACCENT = "#1F5F5B";
const PAPER = "#F6F4EF";
const SHADE = "#D9D3C4";

/** An open book with a curling page. `inset` shrinks the artwork (maskable safe zone). */
function iconSvg({ radius, inset }) {
  const s = 1 - inset;
  const lines = (side) =>
    [-70, -35, 0, 35]
      .map((y) => {
        const x1 = side * 40;
        const x2 = side * 135;
        return `<path d="M${x1} ${y} C ${side * 80} ${y - 14} ${side * 110} ${y - 14} ${x2} ${y - 8}" stroke="${ACCENT}" stroke-opacity="0.35" stroke-width="9" stroke-linecap="round" fill="none"/>`;
      })
      .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${ACCENT}"/>
  <g transform="translate(256 262) scale(${s})">
    <path d="M-10 -128 C -64 -160 -140 -160 -186 -136 L -186 132 C -140 110 -64 110 -10 140 Z" fill="${PAPER}"/>
    <path d="M10 -128 C 64 -160 140 -160 186 -136 L 186 70 L 120 132 C 84 120 44 124 10 140 Z" fill="${PAPER}"/>
    <path d="M186 70 L 120 132 C 128 104 150 82 186 70 Z" fill="${SHADE}"/>
    ${lines(-1)}${lines(1)}
  </g>
</svg>`;
}

const anySvg = iconSvg({ radius: 112, inset: 0.08 });
const fullBleedSvg = iconSvg({ radius: 0, inset: 0.08 });
const maskableSvg = iconSvg({ radius: 0, inset: 0.28 }); // artwork inside the 80% safe circle

writeFileSync(join(outDir, "icon.svg"), anySvg);

const targets = [
  { file: "icon-192.png", svg: anySvg, size: 192 },
  { file: "icon-512.png", svg: anySvg, size: 512 },
  { file: "icon-maskable-512.png", svg: maskableSvg, size: 512 },
  { file: "apple-touch-icon.png", svg: fullBleedSvg, size: 180 }, // iOS rounds corners itself
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${t.svg.replace("<svg ", `<svg width="${t.size}" height="${t.size}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(outDir, t.file), omitBackground: true });
}
await browser.close();
console.log("Icons written to", outDir);
