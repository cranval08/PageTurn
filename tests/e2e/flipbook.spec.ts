import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

const FIXTURES = join(process.cwd(), "tests", "fixtures");
const SAMPLE = join(FIXTURES, "sample-50p.pdf");
const NOT_PDF = join(FIXTURES, "not-a-pdf.pdf");

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
}

const indicator = (page: Page) => page.getByTestId("page-indicator");

/** Bounding box of the visible book (page-flip's block). */
async function bookBox(page: Page) {
  const box = await page.locator(".stf__block").boundingBox();
  if (!box) throw new Error("book not visible");
  return box;
}

/**
 * Touch gesture through the Chrome DevTools Protocol (real touch events).
 * durationMs 0 = a flick (page-flip treats < 250 ms as a swipe); larger = a slow drag.
 */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
  holdMs = 0,
) {
  const cdp = await page.context().newCDPSession(page);
  const steps = durationMs === 0 ? 2 : 8;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    if (durationMs > 0) await page.waitForTimeout(durationMs / steps);
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("Phase 1: local PDF flipbook", () => {
  test("DRV-5/RDR-1: opening sample-50p.pdf shows page 1 within 2 s", async ({ page }) => {
    await page.goto("/");
    const started = Date.now();
    await page.getByTestId("file-input").setInputFiles(SAMPLE);
    await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible({ timeout: 2000 });
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "first-page-ms", description: String(elapsed) });
    expect(elapsed).toBeLessThan(2000);
    await expect(indicator(page)).toHaveText("1 / 50");
  });

  test("DRV-7 (basic): a non-PDF file shows a clear error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(NOT_PDF);
    await expect(page.getByRole("alert")).toContainText("is not a PDF");
    await expect(page).toHaveURL(/\/$/);
  });

  test("RDR-3: arrow keys, PageUp/PageDown and Space turn pages", async ({ page }, info) => {
    await openSample(page);
    const spread = info.project.name === "desktop-chrome";
    await page.keyboard.press("ArrowRight");
    await expect(indicator(page)).toHaveText(spread ? "2–3 / 50" : "2 / 50");
    await page.keyboard.press("PageDown");
    await expect(indicator(page)).toHaveText(spread ? "4–5 / 50" : "3 / 50");
    await page.keyboard.press(" ");
    await expect(indicator(page)).toHaveText(spread ? "6–7 / 50" : "4 / 50");
    await page.keyboard.press("PageUp");
    await expect(indicator(page)).toHaveText(spread ? "4–5 / 50" : "3 / 50");
    await page.keyboard.press("ArrowLeft");
    await expect(indicator(page)).toHaveText(spread ? "2–3 / 50" : "2 / 50");
    await expect(page.getByTestId("page-announcement")).toHaveText(spread ? "Pages 2 and 3 of 50" : "Page 2 of 50");
  });

  test("RDR-3: clicking the right/left 20% turns pages; centre toggles the bar", async ({ page, isMobile }) => {
    await openSample(page);
    const vp = page.viewportSize()!;
    const y = Math.round(vp.height / 2);
    const tap = (x: number) => (isMobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

    await tap(Math.round(vp.width * 0.93));
    await expect(indicator(page)).not.toHaveText("1 / 50");
    const afterNext = await indicator(page).textContent();
    await page.waitForTimeout(800); // let the flip animation settle

    await tap(Math.round(vp.width * 0.07));
    await expect(indicator(page)).toHaveText("1 / 50");
    expect(afterNext).toMatch(/^2(–3)? \/ 50$/);
    await page.waitForTimeout(800);

    // The bar may already have auto-hidden (RDR-7), so check that a centre tap flips its state.
    const bar = page.getByTestId("top-bar");
    const before = await bar.getAttribute("data-visible");
    const after = before === "true" ? "false" : "true";
    await tap(Math.round(vp.width / 2));
    await expect(bar).toHaveAttribute("data-visible", after);
    await page.waitForTimeout(400); // further apart than a double-tap (which zooms)
    await tap(Math.round(vp.width / 2));
    await expect(bar).toHaveAttribute("data-visible", before!);
    await expect(page.getByTestId("stage")).toHaveAttribute("data-zoom", "100");
  });

  test("RDR-3: dragging the bottom-right corner turns the page", async ({ page, isMobile }) => {
    await openSample(page);
    const box = await bookBox(page);
    const from = { x: box.x + box.width - 4, y: box.y + box.height - 4 };
    // Release short of the screen edge: in portrait, past mid-page must complete the turn.
    const to = { x: box.x + (isMobile ? box.width * 0.3 : 20), y: box.y + box.height - 20 };
    if (isMobile) {
      // Press on the corner, then pull slowly (page-flip starts a fold 250 ms after touch-down).
      await touchDrag(page, from, to, 600, 300);
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 20 });
      await page.mouse.up();
    }
    await expect(indicator(page)).toHaveText(/^2(–3)? \/ 50$/);
  });

  test("RDR-3: a quick swipe turns pages on touch", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch-only");
    await openSample(page);
    const box = await bookBox(page);
    const y = box.y + box.height / 2;
    await touchDrag(page, { x: box.x + box.width * 0.8, y }, { x: box.x + box.width * 0.2, y }, 0);
    await expect(indicator(page)).toHaveText("2 / 50");
    await page.waitForTimeout(800);
    await touchDrag(page, { x: box.x + box.width * 0.2, y }, { x: box.x + box.width * 0.8, y }, 0);
    await expect(indicator(page)).toHaveText("1 / 50");
  });

  test("RDR-2: resizing below 900 px switches spread → single and keeps the page", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chrome", "desktop resize");
    await openSample(page);
    await expect(page.locator(".pt-book")).toHaveAttribute("data-layout", "spread");
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(700);
    }
    await expect(indicator(page)).toHaveText("6–7 / 50");

    await page.setViewportSize({ width: 899, height: 800 });
    await expect(page.locator(".pt-book")).toHaveAttribute("data-layout", "single");
    await expect(indicator(page)).toHaveText("6 / 50");
    await expect(page.locator('[data-page="6"][data-rendered="true"]')).toBeVisible();
    // The visible page really is page 6, not just the label.
    const p6 = await page.locator('[data-page="6"]').boundingBox();
    expect(p6 && p6.width > 100).toBeTruthy();

    // Turning still works after the remount, and switching back keeps the page.
    await page.keyboard.press("ArrowRight");
    await expect(indicator(page)).toHaveText("7 / 50");
    await page.waitForTimeout(700);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(".pt-book")).toHaveAttribute("data-layout", "spread");
    await expect(indicator(page)).toHaveText("6–7 / 50");
  });
});
