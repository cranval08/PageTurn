import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPdf } from "../../scripts/pdf-builder.mjs";

const SAMPLE = join(process.cwd(), "tests", "fixtures", "sample-50p.pdf");
const indicator = (page: Page) => page.getByTestId("page-indicator");
const stage = (page: Page) => page.getByTestId("stage");
const zoomOf = async (page: Page) => Number(await stage(page).getAttribute("data-zoom"));

async function openPdf(page: Page, path = SAMPLE) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(path);
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
}

async function cdpTouch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number }[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
}

/** Two-finger pinch around `c`, finger distance from → to. */
async function pinch(page: Page, c: { x: number; y: number }, from: number, to: number) {
  const touch = await cdpTouch(page);
  const pts = (d: number) => [
    { x: c.x - d / 2, y: c.y },
    { x: c.x + d / 2, y: c.y },
  ];
  await touch("touchStart", pts(from));
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(16);
    await touch("touchMove", pts(from + ((to - from) * i) / 10));
  }
  await touch("touchEnd", []);
}

/** One-finger flick from → to (well inside page-flip's 250 ms swipe window). */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const touch = await cdpTouch(page);
  await touch("touchStart", [from]);
  for (let i = 1; i <= 3; i++) {
    await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / 3, y: from.y + ((to.y - from.y) * i) / 3 }]);
  }
  await touch("touchEnd", []);
}

const transformOf = (page: Page) => page.getByTestId("zoom-transform").evaluate((el) => (el as HTMLElement).style.transform);

test.describe("Phase 4: reader polish", () => {
  test("RDR-6: pinch-zoom to 200%, then a swipe pans the page and does not turn it", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch");
    await openPdf(page);
    const vp = page.viewportSize()!;
    const c = { x: vp.width / 2, y: vp.height / 2 };

    await pinch(page, c, 100, 200);
    await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(190);
    expect(await zoomOf(page)).toBeLessThanOrEqual(210);
    await expect(page.getByRole("button", { name: "Reset zoom" })).toBeVisible();
    const before = await transformOf(page);

    // A fast horizontal swipe that would turn the page at 100%.
    await swipe(page, { x: vp.width * 0.8, y: c.y }, { x: vp.width * 0.2, y: c.y });
    await page.waitForTimeout(800);
    await expect(indicator(page)).toHaveText("1 / 50"); // not turned
    expect(await transformOf(page)).not.toBe(before); // panned
    expect(await zoomOf(page)).toBeGreaterThanOrEqual(190);

    await page.getByRole("button", { name: "Reset zoom" }).click();
    await expect.poll(() => zoomOf(page)).toBe(100);
    // Back at 100%, the same swipe turns the page again.
    await swipe(page, { x: vp.width * 0.8, y: c.y }, { x: vp.width * 0.2, y: c.y });
    await expect(indicator(page)).toHaveText("2 / 50");
  });

  test("RDR-6: double-tap the centre zooms to 200%, double-tap again resets", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch");
    await openPdf(page);
    const vp = page.viewportSize()!;
    const tapCentre = () => page.touchscreen.tap(vp.width / 2, vp.height / 2);
    await tapCentre();
    await tapCentre();
    await expect.poll(() => zoomOf(page)).toBe(200);
    await tapCentre();
    await tapCentre();
    await expect.poll(() => zoomOf(page)).toBe(100);
  });

  test("RDR-6: Ctrl+scroll and the +/− buttons zoom 100–400%; zoomed drags pan; turning resets zoom", async ({ page, isMobile }) => {
    test.skip(isMobile, "mouse");
    await openPdf(page);
    const vp = page.viewportSize()!;
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.keyboard.down("Control");
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -40);
    await page.keyboard.up("Control");
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(150);

    // Buttons, clamped at 400%.
    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    await zoomIn.focus(); // shows the toolbar
    const level = page.getByTestId("zoom-level");
    // The buttons and readout follow the settled zoom (250 ms), so click until it reads 400%.
    for (let i = 0; i < 12 && (await level.textContent()) !== "400%"; i++) {
      await zoomIn.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    await expect(level).toHaveText("400%");
    await expect(zoomIn).toBeDisabled();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(page.getByTestId("zoom-level")).toHaveText("350%");

    // Dragging while zoomed pans and never turns.
    const before = await transformOf(page);
    await page.mouse.move(vp.width * 0.8, vp.height / 2);
    await page.mouse.down();
    await page.mouse.move(vp.width * 0.2, vp.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(indicator(page)).toHaveText("1 / 50");
    expect(await transformOf(page)).not.toBe(before);

    // A keyboard turn leaves zoom.
    await page.keyboard.press("ArrowRight");
    await expect(indicator(page)).toHaveText("2–3 / 50");
    await expect.poll(() => zoomOf(page)).toBe(100);
  });

  test("RDR-7: the toolbar hides after 3 s, reappears on centre tap and on keyboard focus", async ({ page, isMobile }) => {
    await openPdf(page);
    const bar = page.getByTestId("top-bar");
    await expect(bar).toHaveAttribute("data-visible", "true");
    await expect(bar).toHaveAttribute("data-visible", "false", { timeout: 4500 });
    const vp = page.viewportSize()!;
    if (isMobile) await page.touchscreen.tap(vp.width / 2, vp.height / 2);
    else await page.mouse.click(vp.width / 2, vp.height / 2);
    await expect(bar).toHaveAttribute("data-visible", "true");
    await expect(bar).toHaveAttribute("data-visible", "false", { timeout: 4500 });
    await page.keyboard.press("Tab");
    await expect(bar).toHaveAttribute("data-visible", "true");
    for (const name of ["Back to library", "Reading settings"]) {
      await expect(page.getByRole(name === "Back to library" ? "link" : "button", { name })).toBeAttached();
    }
  });

  test("RDR-9: tap the page indicator and type a page number", async ({ page }, info) => {
    await openPdf(page);
    await indicator(page).focus();
    await indicator(page).click();
    const input = page.getByRole("spinbutton");
    await input.fill("60");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Enter a page from 1 to 50.");
    await input.fill("30");
    await input.press("Enter");
    await expect(indicator(page)).toHaveText(info.project.name === "desktop-chrome" ? "30–31 / 50" : "30 / 50");
    await expect(page.locator('[data-page="30"][data-rendered="true"]')).toBeVisible();
  });

  test("RDR-4: reduced motion turns the animation off by default; Slide and None turn instantly", async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPdf(page);
    await expect(page.locator(".pt-book")).toHaveAttribute("data-animation", "none");
    await expect(stage(page)).toHaveAttribute("data-swipe-to-turn", "true");

    await page.keyboard.press("ArrowRight");
    await expect(indicator(page)).toHaveText(isMobile ? "2 / 50" : "2–3 / 50", { timeout: 300 });

    // Swipe still turns pages with page-flip's gestures off (touch: ZoomLayer swipe).
    if (isMobile) {
      const vp = page.viewportSize()!;
      await swipe(page, { x: vp.width * 0.8, y: vp.height / 2 }, { x: vp.width * 0.2, y: vp.height / 2 });
      await expect(indicator(page)).toHaveText("3 / 50");
    }

    await page.getByRole("button", { name: "Reading settings" }).focus();
    await page.getByRole("button", { name: "Reading settings" }).click();
    const sheet = page.getByTestId("reader-settings");
    await expect(sheet.getByRole("radio", { name: "None" })).toBeChecked();
    await sheet.getByText("Slide", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.locator(".pt-book")).toHaveAttribute("data-animation", "slide");
    const before = await indicator(page).textContent();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".pt-book")).toHaveAttribute("data-slide", "next");
    await expect(indicator(page)).not.toHaveText(before!);
  });

  test("RDR-5: pages render low-res first, then sharp once settled; neighbours stay low-res", async ({ page }) => {
    // Record every quality change of page 1 from the start.
    await page.addInitScript(() => {
      const w = window as unknown as { __q: string[] };
      w.__q = [];
      new MutationObserver((records) => {
        for (const r of records) {
          const el = r.target as HTMLElement;
          if (el.dataset.page === "1" && el.dataset.quality !== "none") w.__q.push(el.dataset.quality!);
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-quality"] });
    });
    await openPdf(page);
    const page1 = page.locator('[data-page="1"]');
    await expect(page1).toHaveAttribute("data-quality", "high");
    expect(await page.evaluate(() => (window as unknown as { __q: string[] }).__q)).toEqual(["low", "high"]);

    const dims = await page1.evaluate((el) => {
      const c = el.querySelector("canvas")!;
      return { css: el.getBoundingClientRect().width, px: c.width, dpr: window.devicePixelRatio };
    });
    expect(Math.abs(dims.px - dims.css * dims.dpr)).toBeLessThanOrEqual(2);

    // Page 3 is a neighbour (in the render window, not on screen): low-res only, 0.5 px per CSS px.
    const neighbour = page.locator('[data-page="3"]');
    await expect(neighbour).toHaveAttribute("data-quality", "low");
    const px = await neighbour.evaluate((el) => el.querySelector("canvas")!.width);
    expect(Math.abs(px - dims.css * 0.5)).toBeLessThanOrEqual(2);
  });

  test("Memory: never more than 6 rendered pages while reading", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPdf(page);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowRight");
      const counts = await page.evaluate(() => ({
        canvases: document.querySelectorAll("canvas").length,
        rendered: document.querySelectorAll('[data-rendered="true"]').length,
      }));
      expect(counts.canvases).toBeLessThanOrEqual(6);
      expect(counts.rendered).toBeLessThanOrEqual(6);
    }
  });

  test("Memory: a 1,000-page PDF pages through end to end on a phone without the tab reloading", async ({ page, isMobile }, info) => {
    test.skip(!isMobile, "phone");
    test.setTimeout(300_000);
    const dir = info.outputPath();
    mkdirSync(dir, { recursive: true });
    const big = join(dir, "book-1000p.pdf");
    writeFileSync(big, buildPdf(1000));

    let crashed = false;
    page.on("crash", () => (crashed = true));
    await page.emulateMedia({ reducedMotion: "reduce" }); // instant turns keep the test fast
    await openPdf(page, big);
    await expect(indicator(page)).toHaveText("1 / 1000");
    await page.evaluate(() => ((window as unknown as { __sameTab: boolean }).__sameTab = true));

    let peakCanvases = 0;
    for (let i = 2; i <= 1000; i++) {
      await page.keyboard.press("ArrowRight");
      if (i % 50 === 0 || i === 1000) {
        await expect(indicator(page)).toHaveText(`${i} / 1000`);
        const canvases = await page.evaluate(() => document.querySelectorAll("canvas").length);
        peakCanvases = Math.max(peakCanvases, canvases);
        expect(canvases).toBeLessThanOrEqual(6);
      }
    }
    await expect(page.locator('[data-page="1000"]')).toHaveAttribute("data-quality", "high");
    expect(crashed).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { __sameTab?: boolean }).__sameTab)).toBe(true); // no reload
    const heapMb = await page.evaluate(() => {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return m ? Math.round(m.usedJSHeapSize / 1048576) : -1;
    });
    info.annotations.push({ type: "1000p", description: `peak canvases ${peakCanvases}, JS heap ${heapMb} MB` });
  });
});
