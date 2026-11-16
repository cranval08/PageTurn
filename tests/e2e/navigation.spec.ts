import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { buildPdf } from "../../scripts/pdf-builder.mjs";
import { fixture, mockGoogle, setPicked } from "./google-mock";

const FIXTURES = join(process.cwd(), "tests", "fixtures");
const OUTLINE = join(FIXTURES, "outline-links.pdf");
const SAMPLE = join(FIXTURES, "sample-50p.pdf");
const indicator = (page: Page) => page.getByTestId("page-indicator");
/** First (left) page number shown by the indicator, e.g. "14–15 / 20" → 14. */
const leftPage = async (page: Page) => Number.parseInt((await indicator(page).textContent()) ?? "", 10);
const endsWith = (text: string) => new RegExp(`${text}$`);

async function open(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page).toHaveURL(/\/read\//);
  await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
}

/** Toolbar buttons may be auto-hidden: focusing one shows the toolbar (as for keyboard users). */
async function toolbarButton(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await button.focus();
  return button;
}

async function goToPage(page: Page, n: number) {
  await indicator(page).focus();
  await indicator(page).click();
  await page.getByRole("spinbutton").fill(String(n));
  await page.getByRole("spinbutton").press("Enter");
  await expect(page.locator(`[data-page="${n}"][data-quality="high"]`)).toBeVisible();
}

/** Colour of one screen pixel, read from a real screenshot (so CSS filters are included). */
async function pixelAt(page: Page, x: number, y: number) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  }, png.toString("base64"));
}

test.describe("Phase 5: navigation and comfort", () => {
  test("RDR-10: a PDF with an outline shows it; tapping a chapter jumps to the right page", async ({ page }) => {
    await open(page, OUTLINE);
    await (await toolbarButton(page, "Contents")).click();
    const panel = page.getByTestId("outline-panel");
    const toc = panel.getByRole("navigation", { name: "Table of contents" });
    await expect(toc.getByRole("button")).toHaveText([
      "Chapter 1: Cells1",
      "Chapter 2: Genetics6",
      "2.1 DNA8",
      "2.2 RNA10",
      "Chapter 3: Evolution15",
    ]);
    await expect(toc.getByRole("button", { name: /Chapter 1/ })).toHaveAttribute("aria-current", "location");

    await toc.getByRole("button", { name: /Chapter 3: Evolution/ }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator('[data-page="15"][data-quality="high"]')).toBeVisible();
    await expect(indicator(page)).toContainText("15");

    // The current entry follows the page; nested sections jump too.
    await (await toolbarButton(page, "Contents")).click();
    await expect(toc.getByRole("button", { name: /Chapter 3/ })).toHaveAttribute("aria-current", "location");
    await toc.getByRole("button", { name: /2\.1 DNA/ }).click();
    await expect(page.locator('[data-page="8"][data-quality="high"]')).toBeVisible();
  });

  test("RDR-10: a PDF without an outline says so", async ({ page }) => {
    await open(page, SAMPLE);
    await (await toolbarButton(page, "Contents")).click();
    await expect(page.getByTestId("outline-panel")).toContainText("This PDF has no table of contents");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("outline-panel")).toBeHidden();
  });

  test("RDR-12: an internal link jumps to its page; an external link opens a new tab", async ({ page, context }) => {
    await context.route("https://example.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>Example</title>ok" }));
    await open(page, OUTLINE);
    await goToPage(page, 2);
    const internal = page.locator('[data-page="2"]').getByRole("button", { name: "Go to page 12" });
    await expect(internal).toBeVisible();
    await internal.click();
    await expect(page.locator('[data-page="12"][data-quality="high"]')).toBeVisible();
    await expect(indicator(page)).toContainText("12");

    await goToPage(page, 3);
    const external = page.locator('[data-page="3"]').getByRole("link", { name: "Open example.com in a new tab" });
    await expect(external).toHaveAttribute("href", "https://example.com/");
    await expect(external).toHaveAttribute("rel", "noopener noreferrer");
    const before = await indicator(page).textContent();
    const [popup] = await Promise.all([context.waitForEvent("page"), external.click()]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe("https://example.com/");
    await expect(indicator(page)).toHaveText(before!); // the book didn't turn
  });

  test("RDR-11: thumbnails render lazily, highlight the current page and jump on tap", async ({ page }) => {
    await open(page, SAMPLE);
    await goToPage(page, 20);
    await (await toolbarButton(page, "Page thumbnails")).click();
    const panel = page.getByTestId("thumbnail-panel");
    const current = panel.getByRole("button", { name: "Page 20", exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current.locator("canvas")).toBeVisible(); // scrolled into view and rendered
    const rendered = await panel.locator("canvas").count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(50); // lazy: not every page

    await panel.getByRole("button", { name: "Page 33", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator('[data-page="33"][data-quality="high"]')).toBeVisible();
    // Thumbnails are released with the panel (Memory NFR).
    expect(await page.evaluate(() => document.querySelectorAll("canvas").length)).toBeLessThanOrEqual(6);
  });

  test("RDR-8: the scrubber previews the page while dragging and jumps on release", async ({ page, isMobile }) => {
    await open(page, SAMPLE);
    const slider = page.getByTestId("scrubber");
    await slider.focus(); // shows the toolbar
    await page.keyboard.press("End");
    await expect(page.locator('[data-page="50"][data-quality="high"]')).toBeVisible();
    await page.keyboard.press("Home");
    await expect(indicator(page)).toHaveText("1 / 50");

    if (!isMobile) {
      const box = (await slider.boundingBox())!;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + 8, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, y, { steps: 10 });
      const preview = page.getByTestId("scrubber-preview");
      await expect(preview).toBeVisible();
      const previewPage = Number((await preview.textContent())!.replace("p. ", ""));
      expect(previewPage).toBeGreaterThan(20);
      await page.mouse.up();
      await expect(page.locator(`[data-page="${previewPage}"][data-quality="high"]`)).toBeVisible();
    }
  });

  test("RDR-13: dark and sepia apply to app chrome and page, dimming without inverting", async ({ page }) => {
    await open(page, SAMPLE);
    const pageBox = (await page.locator('[data-page="1"]').boundingBox())!;
    // A blank spot in the page margin (right-hand side, below the title).
    const spot = { x: Math.round(pageBox.x + pageBox.width * 0.9), y: Math.round(pageBox.y + pageBox.height * 0.25) };
    const light = await pixelAt(page, spot.x, spot.y);
    expect(Math.min(light.r, light.g, light.b)).toBeGreaterThan(240); // white paper

    for (const theme of ["Dark", "Sepia"] as const) {
      await (await toolbarButton(page, "Reading settings")).click();
      await page.getByTestId("reader-settings").getByText(theme, { exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
      const filter = await page.locator('[data-page="1"]').evaluate((el) => getComputedStyle(el).filter);
      expect(filter).not.toContain("invert");

      await page.mouse.move(0, 0);
      await page.waitForTimeout(250); // let the new styles paint
      const px = await pixelAt(page, spot.x, spot.y);
      const chrome = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      if (theme === "Dark") {
        expect(filter).toContain("brightness(0.72)");
        // Dimmed paper, not inverted (an inverted page would be near black).
        expect(px.r).toBeGreaterThan(140);
        expect(px.r).toBeLessThan(215);
        expect(chrome).toBe("rgb(27, 26, 24)");
      } else {
        // Warm cream paper: red clearly above blue, still light.
        expect(px.r - px.b).toBeGreaterThan(30);
        expect(px.r).toBeGreaterThan(200);
        expect(chrome).toBe("rgb(244, 236, 216)");
      }
    }

    // The theme is a setting: it persists and applies to every screen.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
    await page.getByRole("link", { name: "Back to library" }).press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  });

  test("RDR-13: no accessibility violations in Sepia and Dark", async ({ page }) => {
    await open(page, OUTLINE);
    for (const theme of ["Sepia", "Dark"] as const) {
      await (await toolbarButton(page, "Reading settings")).click();
      await page.getByTestId("reader-settings").getByText(theme, { exact: true }).click();
      await page.keyboard.press("Escape");
      const check = async (where: string) => {
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(r.violations.map((v) => `${theme} ${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      };
      await (await toolbarButton(page, "Contents")).click();
      await check("reader + contents");
      await page.keyboard.press("Escape");
      await (await toolbarButton(page, "Bookmarks")).click();
      await check("bookmarks");
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "Back to library" }).press("Enter");
      await expect(page.getByTestId("book-card")).toHaveCount(1);
      await check("library");
      await page.getByRole("link", { name: "Settings" }).click();
      await check("settings");
      await page.goBack();
      await page.getByRole("button", { name: /^Open outline-links/ }).click();
      await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
    }
  });

  test("RDR-14: bookmarks persist across reloads", async ({ page }) => {
    await open(page, SAMPLE);
    await goToPage(page, 5);
    const first = await leftPage(page);
    const toggle = page.getByTestId("bookmark-toggle");
    await toggle.focus();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-page="${first}"]`).getByTestId("bookmark-ribbon")).toBeAttached();

    await goToPage(page, 9);
    const second = await leftPage(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await (await toolbarButton(page, "Bookmarks")).click();
    const panel = page.getByTestId("bookmarks-panel");
    await panel.getByRole("button", { name: `Bookmark page ${second}` }).click();
    const marks = panel.getByRole("list", { name: "Bookmarked pages" }).getByRole("button", { name: /^Page \d+$/ });
    await expect(marks).toHaveText([endsWith(`Page ${first}`), endsWith(`Page ${second}`)]);

    await page.reload();
    await expect(page.locator(`[data-page="${second}"][data-rendered="true"]`)).toBeVisible();
    await expect(page.getByTestId("bookmark-toggle")).toHaveAttribute("aria-pressed", "true");
    await (await toolbarButton(page, "Bookmarks")).click();
    await expect(marks).toHaveText([endsWith(`Page ${first}`), endsWith(`Page ${second}`)]);

    await panel.getByRole("button", { name: `Remove bookmark on page ${second}` }).click();
    await panel.getByRole("button", { name: `Page ${first}`, exact: true }).click();
    await expect(page.locator(`[data-page="${first}"][data-quality="high"]`)).toBeVisible();
    await page.reload();
    await (await toolbarButton(page, "Bookmarks")).click();
    await expect(marks).toHaveText([endsWith(`Page ${first}`)]);
  });

  test("LIB-2: sort by last opened, title and date added; search by title", async ({ page }) => {
    const titles = ["Biology notes", "algebra 2", "Calculus 10"];
    for (const [i, title] of titles.entries()) {
      await open(page, { name: `${title}.pdf`, mimeType: "application/pdf", buffer: buildPdf(3 + i, { label: title }) });
      await page.getByRole("link", { name: "Back to library" }).press("Enter");
    }
    const cardTitles = () => page.getByTestId("book-card").getByRole("heading");
    await expect(cardTitles()).toHaveText(["Calculus 10", "algebra 2", "Biology notes"]); // last opened first

    await page.getByRole("button", { name: /^Open Biology notes/ }).click();
    await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
    await page.getByRole("link", { name: "Back to library" }).press("Enter");
    await expect(cardTitles()).toHaveText(["Biology notes", "Calculus 10", "algebra 2"]);

    const sort = page.getByLabel("Sort by");
    await sort.selectOption("title");
    await expect(cardTitles()).toHaveText(["algebra 2", "Biology notes", "Calculus 10"]);
    await sort.selectOption("added");
    await expect(cardTitles()).toHaveText(["Calculus 10", "algebra 2", "Biology notes"]);

    const search = page.getByLabel("Search by title");
    await search.fill("CALC");
    await expect(cardTitles()).toHaveText(["Calculus 10"]);
    await expect(page.getByTestId("library-count")).toHaveText("(1 of 3)");
    await expect(page.getByTestId("continue-card")).toHaveCount(0);
    await search.fill("physics");
    await expect(page.getByRole("status").filter({ hasText: 'No books match "physics"' })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(cardTitles()).toHaveCount(3);

    await page.reload(); // the sort choice is remembered on this device
    await expect(page.getByLabel("Sort by")).toHaveValue("added");
  });

  test("LIB-2: a book opened and closed straight away still counts as last opened", async ({ page }) => {
    for (const title of ["First book", "Second book"]) {
      await open(page, { name: `${title}.pdf`, mimeType: "application/pdf", buffer: buildPdf(2, { label: title }) });
      await page.getByRole("link", { name: "Back to library" }).press("Enter");
    }
    await page.getByRole("button", { name: /^Open First book/ }).click();
    await page.getByRole("link", { name: "Back to library" }).press("Enter"); // before the PDF finishes loading
    await expect(page.getByTestId("book-card").getByRole("heading")).toHaveText(["First book", "Second book"]);
  });
});

test.describe("Phase 5: Drive updates (DRV-6)", () => {
  const NEWER = "2026-11-15T12:00:00.000Z";

  async function importFromDrive(page: Page, id: string, name: string) {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as unknown as { __gis?: { config: unknown } }).__gis?.config));
    await setPicked(page, [{ id, name }]);
    await page.getByRole("button", { name: "+ Add book" }).click();
    await page.getByRole("menuitem", { name: "From Google Drive" }).click();
    await expect(page).toHaveURL(new RegExp(`/read/${id}$`));
    await expect(page.locator('[data-page="1"][data-rendered="true"]')).toBeVisible();
  }

  test("the card menu checks Drive and updates the book, keeping the page", async ({ page }) => {
    const drive = await mockGoogle(page);
    drive.files.set("bio-1", { name: "Biology notes.pdf", mimeType: "application/pdf", body: fixture("sample-50p.pdf") });
    await importFromDrive(page, "bio-1", "Biology notes.pdf");
    await goToPage(page, 4);
    const left = await leftPage(page);
    await page.getByRole("link", { name: "Back to library" }).press("Enter");

    // Same version: up to date.
    await page.getByRole("button", { name: /More actions for Biology notes/ }).click();
    await page.getByRole("menuitem", { name: "Check Drive for update" }).click();
    await expect(page.getByRole("alert")).toContainText('"Biology notes" is up to date.');

    // Drive now has a newer, 30-page version.
    drive.files.set("bio-1", { name: "Biology notes.pdf", mimeType: "application/pdf", body: buildPdf(30), modifiedTime: NEWER });
    await page.getByRole("button", { name: /More actions for Biology notes/ }).click();
    await page.getByRole("menuitem", { name: "Check Drive for update" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Update from Google Drive?" });
    await expect(dialog).toContainText("A newer version");
    await dialog.getByRole("button", { name: "Update" }).click();
    await expect(page.getByTestId("import-panel")).toContainText("Added 1 of 1 book");
    await expect(page).toHaveURL(/\/$/); // an update doesn't jump into the reader
    await expect(page.getByTestId("book-progress")).toHaveText(`p. ${left} of 30 · ${Math.round((left / 30) * 100)}%`);
  });

  test("opening a Drive book offers 'A newer version is in Drive — update?'", async ({ page }) => {
    const drive = await mockGoogle(page);
    drive.files.set("hist-2", { name: "History reader.pdf", mimeType: "application/pdf", body: fixture("sample-50p.pdf") });
    await importFromDrive(page, "hist-2", "History reader.pdf");
    await goToPage(page, 6);
    const left = await leftPage(page);
    await expect(page.getByTestId("update-banner")).toHaveCount(0);

    drive.files.set("hist-2", { name: "History reader.pdf", mimeType: "application/pdf", body: buildPdf(30), modifiedTime: NEWER });
    await page.getByRole("link", { name: "Back to library" }).press("Enter");
    await page.getByRole("button", { name: /^Open History reader/ }).click();
    const banner = page.getByTestId("update-banner");
    await expect(banner).toContainText("A newer version is in Drive. Update?");
    await banner.getByRole("button", { name: "Update" }).click();
    await expect(banner).toBeHidden();
    await expect(indicator(page)).toContainText("/ 30");
    expect(await leftPage(page)).toBe(left); // same page after the update
  });
});
