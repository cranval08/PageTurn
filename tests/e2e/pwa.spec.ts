import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

const SAMPLE = join(process.cwd(), "tests", "fixtures", "sample-50p.pdf");

async function addSample(page: Page) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
}

test.describe("Phase 4: installable, offline PWA", () => {
  test.use({ serviceWorkers: "allow" });

  test("OFF-3: Chrome reports the app as installable, with a complete manifest", async ({ page, isMobile }) => {
    test.skip(isMobile, "installability is checked once, on desktop Chrome");
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const cdp = await page.context().newCDPSession(page);

    // Lighthouse 12+ no longer has a PWA category; this is the check Chrome itself
    // runs before offering "Install app" (DevTools → Application → Manifest).
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    expect(installabilityErrors).toEqual([]);

    const res = await page.request.get("/manifest.webmanifest");
    const manifest = await res.json();
    expect(manifest).toMatchObject({ name: "PageTurn", short_name: "PageTurn", display: "standalone", start_url: "/" });
    const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);

    // iOS home screen.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  });

  test("OFF-2: the app opens offline, shows cached books, and they read offline", async ({ page, context }, info) => {
    await addSample(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.goto("/"); // a navigation after install, so the service worker controls the page
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    try {
      await page.reload();
      const card = page.getByTestId("book-card");
      await expect(card).toHaveCount(1);
      await expect(card).toContainText("sample-50p");
      await card.getByRole("button", { name: /^Open sample-50p/ }).click();
      await expect(page.locator('[data-page="1"][data-quality="high"]')).toBeVisible();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("page-indicator")).toHaveText(info.project.name === "desktop-chrome" ? "2–3 / 50" : "2 / 50");

      // A deep link loads offline too (navigation fallback to the cached app shell).
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe("Accessibility (WCAG 2.1 AA, axe)", () => {
  const check = async (page: Page, label: string) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = results.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(summary).toEqual([]);
  };

  test("library, settings and reader (with toolbar, sheet and go-to-page) have no violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /your library is empty/i })).toBeVisible();
    await check(page, "empty library");

    await addSample(page);
    await page.getByRole("button", { name: "Reading settings" }).focus(); // shows the toolbar
    await check(page, "reader");

    await page.getByRole("button", { name: "Reading settings" }).click();
    await expect(page.getByTestId("reader-settings")).toBeVisible();
    await check(page, "reader settings sheet");
    await page.keyboard.press("Escape");

    await page.getByTestId("page-indicator").focus();
    await page.getByTestId("page-indicator").click();
    await page.getByRole("spinbutton").fill("999");
    await page.getByRole("spinbutton").press("Enter");
    await expect(page.getByRole("alert")).toBeVisible();
    await check(page, "go to page (with error)");

    await page.getByRole("link", { name: "Back to library" }).press("Enter");
    await expect(page.getByTestId("book-card")).toHaveCount(1);
    await check(page, "library with a book");

    await page.getByRole("button", { name: /More actions for sample-50p/ }).click();
    await check(page, "book menu");
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await check(page, "settings");
  });
});
