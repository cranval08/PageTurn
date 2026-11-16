import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

const SAMPLE = join(process.cwd(), "tests", "fixtures", "sample-50p.pdf");
const indicator = (page: Page) => page.getByTestId("page-indicator");

async function addSample(page: Page) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/read\//);
  await expect(indicator(page)).toHaveText(/^1 \/ 50$/);
}

/** Press → until the indicator starts with `target` (works for single and spread). */
async function readTo(page: Page, target: number) {
  for (let i = 0; i < 60; i++) {
    const text = (await indicator(page).textContent()) ?? "";
    if (text.startsWith(`${target} `) || text.startsWith(`${target}–`)) return;
    await page.keyboard.press("ArrowRight");
    await expect(indicator(page)).not.toHaveText(text);
  }
  throw new Error(`never reached page ${target}`);
}

/** Count rows in an IndexedDB store directly (bypasses the app). */
function countRows(page: Page, store: string) {
  return page.evaluate(
    (storeName) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("pageturn");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(storeName).objectStore(storeName).count();
          req.onsuccess = () => {
            resolve(req.result);
            open.result.close();
          };
        };
      }),
    store,
  );
}

test.describe("Phase 2: library, storage and progress", () => {
  test("PRG-1: a book read to page 20 reopens on page 20 after a full reload", async ({ page }, info) => {
    const spread = info.project.name === "desktop-chrome";
    await addSample(page);
    await readTo(page, 20);
    const expected = spread ? "20–21 / 50" : "20 / 50";
    await expect(indicator(page)).toHaveText(expected);
    await page.waitForTimeout(700); // past the 500 ms debounce

    // Full reload straight into the reader.
    await page.reload();
    await expect(indicator(page)).toHaveText(expected);
    await expect(page.locator('[data-page="20"][data-rendered="true"]')).toBeVisible();

    // Close the book, reload the library, reopen from the card.
    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar;
    await page.reload();
    const card = page.getByTestId("book-card");
    await expect(card.getByTestId("book-progress")).toHaveText("p. 20 of 50 · 40%");
    await card.getByRole("button", { name: /^Open sample-50p/ }).click();
    await expect(indicator(page)).toHaveText(expected);
  });

  test("PRG-1: leaving within the debounce window still saves the page", async ({ page }) => {
    await addSample(page);
    await readTo(page, 4);
    const text = await indicator(page).textContent();
    const expected = `p. ${text!.split(/[ –]/)[0]} of 50`;
    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar; // flushes immediately
    // The library waits for the flushed write, so it never shows a stale page…
    await expect(page.getByTestId("book-progress")).toContainText(expected);
    // …and the write is durable.
    await page.reload();
    await expect(page.getByTestId("book-progress")).toContainText(expected);
  });

  test("PRG-1: reloading straight after a page turn keeps that page", async ({ page }) => {
    await addSample(page);
    await readTo(page, 6); // a left-hand page in both single and spread layouts
    const text = await indicator(page).textContent();
    await page.reload(); // well inside the 500 ms save delay
    await expect(indicator(page)).toHaveText(text!);
  });

  test("LIB-3/OFF-1: removing a book frees its blob (storage figure in settings)", async ({ page }) => {
    await addSample(page);
    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar;
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByTestId("storage-used")).toHaveText("111 KB used by 1 book");
    expect(await countRows(page, "files")).toBe(1);

    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar;
    await page.getByRole("button", { name: /More actions for sample-50p/ }).click();
    await page.getByRole("menuitem", { name: "Remove from library" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Remove from library?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("heading", { name: /your library is empty/i })).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByTestId("storage-used")).toHaveText("0 B used by 0 books");
    expect(await countRows(page, "files")).toBe(0);
    expect(await countRows(page, "books")).toBe(0);
    expect(await countRows(page, "progress")).toBe(0);
  });

  test("LIB-3: cancelling the confirm keeps the book", async ({ page }) => {
    await addSample(page);
    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar;
    await page.getByRole("button", { name: /More actions for sample-50p/ }).click();
    await page.getByRole("menuitem", { name: "Remove from library" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByTestId("book-card")).toHaveCount(1);
  });

  test("OFF-1: clear cache keeps the library and progress, and the book reopens after re-adding", async ({ page }) => {
    await addSample(page);
    await readTo(page, 6);
    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar;
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Clear cache" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clear cache" }).click();
    await expect(page.getByTestId("storage-used")).toHaveText("0 B used by 0 books");

    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar;
    const card = page.getByTestId("book-card");
    await expect(card).toContainText("Not on this device");
    await card.getByRole("button", { name: /^Open sample-50p/ }).click();
    await expect(page.getByRole("alert")).toContainText("was cleared from this device");

    // Re-adding the same file restores it at the saved page.
    await page.getByTestId("file-input").setInputFiles(SAMPLE);
    await expect(indicator(page)).toHaveText(/^6(–7)? \/ 50$/);
  });

  test("LIB-1: library with 30 books loads in under 500 ms", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /your library is empty/i })).toBeVisible();
    // Seed 30 books with realistic ~300 px JPEG covers directly into IndexedDB.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const canvas = document.createElement("canvas");
          canvas.width = 300;
          canvas.height = 388;
          const ctx = canvas.getContext("2d")!;
          const open = indexedDB.open("pageturn");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(["books", "progress"], "readwrite");
            for (let i = 1; i <= 30; i++) {
              ctx.fillStyle = `hsl(${i * 12} 40% 85%)`;
              ctx.fillRect(0, 0, 300, 388);
              ctx.fillStyle = "#222";
              ctx.font = "28px serif";
              for (let l = 0; l < 12; l++) ctx.fillText(`Book ${i} line ${l} lorem ipsum`, 16, 60 + l * 26);
              tx.objectStore("books").put({
                id: `local:seed${i}`,
                source: i % 3 ? "local" : "drive",
                title: `Seeded book number ${i} with a fairly long title`,
                pageCount: 300,
                sizeBytes: 1_000_000,
                coverDataUrl: canvas.toDataURL("image/jpeg", 0.8),
                addedAt: i,
                lastOpenedAt: i,
              });
              tx.objectStore("progress").put({ bookId: `local:seed${i}`, page: i * 10, updatedAt: i, bookmarks: [] });
            }
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );

    await page.reload();
    await expect(page.getByTestId("book-card")).toHaveCount(30);
    const readyMs = await page.evaluate(() => performance.getEntriesByName("library-ready")[0]?.startTime ?? -1);
    test.info().annotations.push({ type: "library-ready-ms", description: String(Math.round(readyMs)) });
    expect(readyMs).toBeGreaterThan(0);
    expect(readyMs).toBeLessThan(500);
    await expect(page.getByTestId("continue-card")).toHaveCount(3);
    await expect(page.getByTestId("continue-card").first()).toContainText("Seeded book number 30");
  });

  test("RDR-2: the layout setting overrides Auto", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chrome", "desktop viewport");
    await page.goto("/settings");
    await page.getByRole("radio", { name: /Single/ }).check();
    await page.getByRole("link", { name: "Back to library" }).press("Enter") // focus shows the auto-hidden toolbar;
    await page.getByTestId("file-input").setInputFiles(SAMPLE);
    await expect(page.locator(".pt-book")).toHaveAttribute("data-layout", "single");
    // Persisted across reloads.
    await page.reload();
    await expect(page.locator(".pt-book")).toHaveAttribute("data-layout", "single");
  });
});
