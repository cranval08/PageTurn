import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { appDataProgress, fixture, mockGoogle, setGis, setPicked, type DriveMock } from "./google-mock";

const PDF = "application/pdf";
const indicator = (page: Page) => page.getByTestId("page-indicator");

/** Collect Content-Security-Policy violations reported by the browser. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

async function waitForGis(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __gis?: { config: unknown } }).__gis?.config));
}

/** Sign in (as part of the Drive action), pick one PDF; it opens straight away. */
async function importFromDrive(page: Page, id: string, name: string) {
  await page.goto("/");
  await waitForGis(page);
  await setPicked(page, [{ id, name }]);
  await page.getByRole("button", { name: "+ Add book" }).click();
  await page.getByRole("menuitem", { name: "From Google Drive" }).click();
  await expect(page).toHaveURL(new RegExp(`/read/${id}$`));
  await expect(page.locator('[data-rendered="true"]').filter({ visible: true }).first()).toBeVisible(); // the book is open
}

async function goToPage(page: Page, n: number) {
  await indicator(page).focus();
  await indicator(page).click();
  await page.getByRole("spinbutton").fill(String(n));
  await page.getByRole("spinbutton").press("Enter");
  await expect(page.locator(`[data-page="${n}"][data-quality="high"]`)).toBeVisible();
}

test.describe("Phase 6: cross-device sync (PRG-2)", () => {
  let drive: DriveMock;

  test.beforeEach(async ({ page }) => {
    drive = await mockGoogle(page);
    drive.files.set("bio-1", { name: "Biology notes.pdf", mimeType: PDF, body: fixture("sample-50p.pdf") });
  });

  test("reading to page 50 on a laptop, then opening the same Drive book on a phone, lands on page 50", async ({ page, browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "drives its own laptop and phone");
    const laptopCsp = watchCsp(page);

    // Laptop: add from Drive, read to page 50, bookmark it, go back to the library.
    await importFromDrive(page, "bio-1", "Biology notes.pdf");
    await goToPage(page, 50);
    await page.getByRole("button", { name: "Bookmark this page", exact: true }).focus();
    await page.getByRole("button", { name: "Bookmark this page", exact: true }).press("Enter");
    await expect(page.getByRole("button", { name: "Remove bookmark from this page" })).toBeAttached();
    await page.getByRole("link", { name: "Back to library" }).press("Enter");
    await expect.poll(() => appDataProgress(drive)?.books["bio-1"]).toMatchObject({ page: 50, bookmarks: [50] });

    // Phone: a separate device (own storage) with the same Google account.
    const phone = await browser.newContext({ ...devices["Pixel 7"], baseURL, serviceWorkers: "block" });
    try {
      const phonePage = await phone.newPage();
      const phoneCsp = watchCsp(phonePage);
      await mockGoogle(phonePage, drive);
      await importFromDrive(phonePage, "bio-1", "Biology notes.pdf");
      await expect(indicator(phonePage)).toHaveText("50 / 50");
      await expect(phonePage.locator('[data-page="50"][data-rendered="true"]')).toBeVisible();
      await expect(phonePage.getByRole("button", { name: "Remove bookmark from this page" })).toBeAttached();

      // Back on the phone's library: the card shows the synced progress.
      await phonePage.getByRole("link", { name: "Back to library" }).press("Enter");
      await expect(phonePage.getByTestId("book-card")).toContainText("p. 50 of 50");
      expect(phoneCsp).toEqual([]);
    } finally {
      await phone.close();
    }
    expect(laptopCsp).toEqual([]);
    // One progress file, created once and then updated.
    expect([...drive.appData.values()].filter((f) => f.name === "progress.json")).toHaveLength(1);
  });

  test("Sync now in Settings pulls newer progress from another device into the library", async ({ page }) => {
    await importFromDrive(page, "bio-1", "Biology notes.pdf");
    await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
    await page.getByRole("link", { name: "Back to library" }).press("Enter");
    await expect(page.getByTestId("book-card")).toContainText("Not started");

    // Another device read to page 30 later.
    const file = [...drive.appData.values()].find((f) => f.name === "progress.json");
    const books = file ? JSON.parse(file.body).books : {};
    books["bio-1"] = { page: 30, updatedAt: Date.now() + 60_000, bookmarks: [12] };
    if (file) file.body = JSON.stringify({ version: 1, books });
    else drive.appData.set("seeded", { name: "progress.json", body: JSON.stringify({ version: 1, books }), createdTime: "2026-01-01T00:00:00Z" });

    await page.getByRole("link", { name: "Settings" }).click();
    const status = page.getByTestId("sync-status");
    await expect(status).toContainText(/Last synced|Not synced yet/);
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(status).toHaveText("Last synced just now");
    await page.getByRole("link", { name: "Back to library" }).click();
    await expect(page.getByTestId("book-card")).toContainText("p. 30 of 50");

    await page.getByRole("button", { name: /^Open Biology notes/ }).click();
    await expect(indicator(page)).toHaveText(/^30/);
  });

  test("an open reader that hasn't turned yet follows newer progress; one that has turned keeps its page", async ({ page }) => {
    await importFromDrive(page, "bio-1", "Biology notes.pdf");
    await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
    const seed = (p: number, bookmarks: number[] = []) => {
      const books = appDataProgress(drive)?.books ?? {};
      books["bio-1"] = { page: p, updatedAt: Date.now() + 60_000, bookmarks };
      const existing = [...drive.appData.values()].find((f) => f.name === "progress.json");
      if (existing) existing.body = JSON.stringify({ version: 1, books });
      else drive.appData.set("seeded", { name: "progress.json", body: JSON.stringify({ version: 1, books }), createdTime: "2026-01-01T00:00:00Z" });
    };
    // Another device read on. The network coming back triggers a sync.
    seed(21, [20, 21]); // in a spread the bookmark is the left page
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator('[data-page="21"][data-rendered="true"]')).toBeVisible();
    await expect(indicator(page)).toHaveText(/^2[01]/);
    await expect(page.getByRole("button", { name: "Remove bookmark from this page" })).toBeAttached();

    // Now the reader turns a page itself: later syncs update bookmarks but never yank the page.
    await page.keyboard.press("ArrowRight");
    await expect(indicator(page)).not.toHaveText(/^2[01]/);
    const before = await indicator(page).textContent();
    seed(40);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(1_000); // let the sync run; the page must not move
    await expect(indicator(page)).toHaveText(before ?? "");
  });

  test("signing in without the app-folder permission leaves sync off and says so", async ({ page }) => {
    await page.goto("/");
    await waitForGis(page);
    // Granular consent: the user unticks PageTurn's app-folder box.
    await setGis(page, { scope: "https://www.googleapis.com/auth/drive.file openid email profile" });
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await expect(page.getByText("Test Student")).toBeVisible();
    await expect(page.getByTestId("sync-status")).toContainText("Sync is off");
    await expect(page.getByRole("button", { name: "Turn on sync" })).toBeVisible();
    expect(drive.appDataWrites).toEqual([]);

    // Turning it on asks Google again; this time the box stays ticked.
    await setGis(page, { scope: "" });
    await page.getByRole("button", { name: "Turn on sync" }).click();
    await expect(page.getByTestId("sync-status")).toHaveText(/Last synced just now|Not synced yet/);
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
  });
});

test.describe("Phase 6: privacy page and security policy", () => {
  test("the privacy page explains scopes, storage and revoking, and is linked from the library and settings", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page).toHaveTitle("Privacy · PageTurn");
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    for (const text of ["drive.file", "drive.appdata", "openid, email, profile", "progress.json", "never saved in browser storage"]) {
      await expect(main).toContainText(text);
    }
    await expect(page.getByRole("link", { name: "myaccount.google.com/permissions" })).toHaveAttribute("href", "https://myaccount.google.com/permissions");

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto("/settings");
    await page.getByRole("link", { name: /Privacy/ }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });

  test("a direct visit to /privacy works (OAuth consent screen link)", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  });

  test("the built app ships a strict CSP and runs under it", async ({ page }) => {
    const violations = watchCsp(page);
    await page.goto("/");
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // Inline script is blocked (proves the policy is enforced, not just present).
    const ran = await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__inlineRan = true";
      document.head.append(s);
      return Boolean((window as unknown as { __inlineRan?: boolean }).__inlineRan);
    });
    expect(ran).toBe(false);
    violations.length = 0;
    await page.getByTestId("file-input").setInputFiles({ name: "sample.pdf", mimeType: PDF, buffer: fixture("sample-50p.pdf") });
    await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
    expect(violations).toEqual([]);
  });
});
