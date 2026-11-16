import { expect, test, type Page } from "@playwright/test";
import { cjkPdf, scannedJpxPdf } from "./pdf-samples";

async function openBuffer(page: Page, name: string, buffer: Buffer) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/pdf", buffer });
  await expect(page.locator('[data-page="1"][data-quality="high"]')).toBeVisible();
}

/** Count inked pixels in horizontal bands of page 1's canvas (fractions of its height). */
function inkIn(page: Page, bands: Record<string, [number, number]>, test: "dark" | "grey" = "dark") {
  return page.locator('[data-page="1"] canvas').evaluate(
    (c: HTMLCanvasElement, { bands, test }) => {
      const ctx = c.getContext("2d")!;
      const out: Record<string, number> = {};
      for (const [name, [y0, y1]] of Object.entries(bands)) {
        const d = ctx.getImageData(0, Math.floor(c.height * y0), c.width, Math.max(1, Math.floor(c.height * (y1 - y0)))).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
          if (a < 128) continue;
          if (test === "dark" ? r < 128 : r > 100 && r < 160 && Math.abs(r - g) < 6 && Math.abs(g - b) < 6) n++;
        }
        out[name] = n;
      }
      return out;
    },
    { bands, test },
  );
}

test.describe("pdf.js runtime resources (missing-pages bug)", () => {
  test("CJK text that needs a predefined CMap is drawn", async ({ page }) => {
    await openBuffer(page, "cjk.pdf", cjkPdf());
    const ink = await inkIn(page, { latin: [0.05, 0.15], cjk: [0.3, 0.47] });
    expect(ink.latin).toBeGreaterThan(100);
    expect(ink.cjk).toBeGreaterThan(500); // was 0 before cMapUrl was set
  });

  test("a scanned page (JPEG 2000 image) is drawn", async ({ page }) => {
    await openBuffer(page, "scan.pdf", scannedJpxPdf());
    // The image covers PDF y 300–600 of 792 → ~24–62% from the top of the page.
    const grey = await inkIn(page, { image: [0.3, 0.55], above: [0.02, 0.2] }, "grey");
    expect(grey.image).toBeGreaterThan(1000); // decoded grey pixels (blank white before wasmUrl was set)
    expect(grey.above).toBe(0);
  });

  test("the decoders, character maps and fonts are served", async ({ request }) => {
    for (const path of [
      "/pdfjs/wasm/openjpeg.wasm",
      "/pdfjs/wasm/jbig2.wasm",
      "/pdfjs/wasm/qcms_bg.wasm",
      "/pdfjs/cmaps/UniGB-UCS2-H.bcmap",
      "/pdfjs/standard_fonts/FoxitSerif.pfb",
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect((await res.body()).length, path).toBeGreaterThan(100);
    }
    expect((await request.get("/pdfjs/wasm/openjpeg.wasm")).headers()["content-type"]).toContain("wasm");
    // PDF JavaScript is deliberately not shipped (unknown paths fall back to the app's HTML).
    const quickjs = await request.get("/pdfjs/wasm/quickjs-eval.wasm");
    expect(quickjs.headers()["content-type"] ?? "").not.toContain("wasm");
  });
});

test.describe("pdf.js resources offline (OFF-1/OFF-2)", () => {
  test.use({ serviceWorkers: "allow" });

  test("scanned and CJK books opened once still render offline", async ({ page, context }) => {
    await openBuffer(page, "cjk.pdf", cjkPdf()); // CMap fetched online → runtime-cached
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    // The image decoders are precached at install (no need to have opened a scanned book).
    expect(await page.evaluate(async () => Boolean(await caches.match("/pdfjs/wasm/openjpeg.wasm", { ignoreSearch: true })))).toBe(true);
    await page.getByRole("button", { name: /^Open cjk/ }).click();
    await expect(page.locator('[data-page="1"][data-quality="high"]')).toBeVisible(); // CMap now cached by the SW

    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: scannedJpxPdf() });
    await expect(page.locator('[data-page="1"][data-quality="high"]')).toBeVisible();

    await context.setOffline(true);
    try {
      await page.goto("/");
      await page.getByRole("button", { name: /^Open cjk/ }).click();
      await expect(page.locator('[data-page="1"][data-quality="high"]')).toBeVisible();
      expect((await inkIn(page, { cjk: [0.3, 0.47] })).cjk).toBeGreaterThan(500);
      await page.goto("/");
      await page.getByRole("button", { name: /^Open scan/ }).click();
      await expect(page.locator('[data-page="1"][data-quality="high"]')).toBeVisible();
      expect((await inkIn(page, { image: [0.3, 0.55] }, "grey")).image).toBeGreaterThan(1000);
    } finally {
      await context.setOffline(false);
    }
  });
});
