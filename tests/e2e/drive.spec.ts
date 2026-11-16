import { expect, test, type Page } from "@playwright/test";
import { fixture, gisState, mockGoogle, pickerState, setGis, setPicked, USER, type DriveMock } from "./google-mock";

const PDF = "application/pdf";
let drive: DriveMock;

test.beforeEach(async ({ page }) => {
  drive = await mockGoogle(page);
  drive.files.set("bio-1", { name: "Biology notes.pdf", mimeType: PDF, body: fixture("sample-50p.pdf") });
  drive.files.set("hist-2", { name: "History reader.pdf", mimeType: PDF, body: fixture("sample-50p.pdf") });
  await page.goto("/");
  // GIS loads when the library opens, so the popup can open straight from a click.
  await page.waitForFunction(() => Boolean((window as unknown as { __gis?: { config: unknown } }).__gis?.config));
});

async function signIn(page: Page) {
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByTestId("account-button")).toBeVisible();
}

async function openDrive(page: Page) {
  await page.getByRole("button", { name: "+ Add book" }).click();
  await page.getByRole("menuitem", { name: "From Google Drive" }).click();
}

const panel = (page: Page) => page.getByTestId("import-panel");

test.describe("Phase 3: Google sign-in and Drive", () => {
  test("DRV-1: sign in shows name and avatar; sign out returns to signed out", async ({ page }) => {
    await signIn(page);
    const config = (await gisState(page)).config as { client_id: string; scope: string };
    expect(config.client_id).toBe("e2e-test-client.apps.googleusercontent.com");
    // Acceptance: only drive.file and profile scopes are requested.
    expect(config.scope).toBe("https://www.googleapis.com/auth/drive.file openid email profile");

    await page.getByTestId("account-button").click();
    await expect(page.getByTestId("account-name")).toHaveText(USER.name);
    await expect(page.getByRole("menu", { name: "Account" })).toContainText(USER.email);
    await expect(page.getByTestId("account-button").locator("img")).toHaveAttribute("src", USER.picture);

    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    expect((await gisState(page)).revoked).toEqual(["tok1"]);
    // Token memory only: nothing Google-ish in web storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain("tok1");
  });

  test("DRV-2/DRV-3: sign in, pick 2 PDFs from Drive, both appear in the library and open", async ({ page }) => {
    await setPicked(page, [
      { id: "bio-1", name: "Biology notes.pdf" },
      { id: "hist-2", name: "History reader.pdf" },
    ]);
    await openDrive(page); // signs in as part of the first Drive action
    await expect(page.getByTestId("account-button")).toBeVisible();
    await expect(panel(page)).toContainText("Added 2 of 2 books");

    const built = (await pickerState(page)).built as { appId: string; key: string; token: string; features: string[]; views: { mime: string; label: string }[] };
    expect(built).toMatchObject({ appId: "111111111111", key: "e2e-test-api-key", token: "tok1", features: ["multiselectEnabled"] });
    expect(built.views.map((v) => v.label)).toEqual(["Recent", "My Drive", "Shared with me"]);
    expect(built.views.every((v) => v.mime === PDF)).toBe(true);
    expect(drive.downloads.sort()).toEqual(["bio-1", "hist-2"]);

    const cards = page.getByTestId("book-card");
    await expect(cards).toHaveCount(2);
    await expect(page.getByText("From Google Drive").first()).toBeAttached();

    for (const title of ["Biology notes", "History reader"]) {
      await page.getByRole("button", { name: new RegExp(`^Open ${title}`) }).click();
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByTestId("page-indicator")).toHaveText("1 / 50");
      await expect(page.locator('[data-page="1"] canvas[data-rendered="true"]')).toBeVisible();
      await page.getByRole("link", { name: "Back to library" }).click();
    }
  });

  test("DRV-2: picking a single PDF opens it straight away", async ({ page }) => {
    await signIn(page);
    await setPicked(page, [{ id: "bio-1", name: "Biology notes.pdf" }]);
    await openDrive(page);
    await expect(page).toHaveURL(/\/read\/bio-1$/);
    await expect(page.getByTestId("page-indicator")).toHaveText("1 / 50");
  });

  test("DRV-7: non-PDF, fake, corrupt and password-protected files show clear errors without a crash", async ({ page }) => {
    drive.files.set("img-1", { name: "photo.png", mimeType: "image/png", body: Buffer.from("png") });
    drive.files.set("fake-1", { name: "fake.pdf", mimeType: PDF, body: fixture("not-a-pdf.pdf") });
    drive.files.set("bad-1", { name: "broken.pdf", mimeType: PDF, body: fixture("corrupt.pdf") });
    drive.files.set("pw-1", { name: "locked.pdf", mimeType: PDF, body: fixture("password-protected.pdf") });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await signIn(page);
    await setPicked(page, [
      { id: "img-1", name: "photo.png", mimeType: "image/png" },
      { id: "fake-1", name: "fake.pdf" },
      { id: "bad-1", name: "broken.pdf" },
      { id: "pw-1", name: "locked.pdf" },
      { id: "bio-1", name: "Biology notes.pdf" },
    ]);
    await openDrive(page);
    await expect(panel(page)).toContainText("Added 1 of 5 books");

    const item = (name: string) => panel(page).getByTestId("import-item").filter({ hasText: name });
    await expect(item("photo.png")).toContainText('"photo.png" is not a PDF');
    await expect(item("fake.pdf")).toContainText('"fake.pdf" is not a PDF');
    await expect(item("broken.pdf")).toContainText("damaged or isn't a valid PDF");
    await expect(item("locked.pdf")).toContainText("password-protected");
    await expect(item("Biology notes.pdf")).toHaveAttribute("data-status", "done");
    expect(drive.downloads).not.toContain("img-1"); // rejected before downloading

    await expect(page.getByTestId("book-card")).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("DRV-4: an expired token is refreshed on the next Drive action", async ({ page }) => {
    await setGis(page, { expiresIn: 1 }); // already inside the refresh window
    await signIn(page);
    await setGis(page, { expiresIn: 3600 });
    await setPicked(page, [{ id: "bio-1", name: "Biology notes.pdf" }]);
    await openDrive(page);
    await expect(page).toHaveURL(/\/read\/bio-1$/);
    const gis = await gisState(page);
    expect(gis.requests).toEqual([{ prompt: "" }, { prompt: "", login_hint: USER.email }]);
    expect(((await pickerState(page)).built as { token: string }).token).toBe("tok2");
  });

  test("DRV-4: if the refresh fails, it asks to sign in again and recovers", async ({ page }) => {
    await setGis(page, { expiresIn: 1 });
    await signIn(page);
    await setGis(page, { mode: "popup_closed" });
    await openDrive(page);
    const banner = page.getByRole("alert").filter({ hasText: "Your books are safe" });
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("account-button")).toBeVisible(); // still shows who you are

    await setGis(page, { mode: "grant", expiresIn: 3600 });
    await banner.getByRole("button", { name: "Sign in again" }).click();
    await expect(banner).toBeHidden();
    await setPicked(page, [{ id: "bio-1", name: "Biology notes.pdf" }]);
    await openDrive(page);
    await expect(page).toHaveURL(/\/read\/bio-1$/);
  });

  test("DRV-4: Drive rejecting the token mid-import offers Sign in & retry", async ({ page }) => {
    await signIn(page);
    drive.rejectedTokens.add("tok1"); // e.g. revoked elsewhere
    await setPicked(page, [
      { id: "bio-1", name: "Biology notes.pdf" },
      { id: "hist-2", name: "History reader.pdf" },
    ]);
    await openDrive(page);
    await expect(panel(page)).toContainText("Added 0 of 2 books");
    await expect(page.getByRole("alert").filter({ hasText: "Your books are safe" })).toBeVisible();

    await panel(page).getByRole("button", { name: "Sign in & retry" }).first().click();
    await expect(panel(page).getByTestId("import-item").first()).toHaveAttribute("data-status", "done");
    await panel(page).getByRole("button", { name: "Sign in & retry" }).click();
    await expect(page.getByTestId("book-card")).toHaveCount(2);
  });

  test("Reliability: a failed download shows Retry, which recovers", async ({ page }) => {
    drive.files.get("bio-1")!.failDownloads = { status: 503, times: 1 };
    await signIn(page);
    await setPicked(page, [{ id: "bio-1", name: "Biology notes.pdf" }]);
    await openDrive(page);
    const item = panel(page).getByTestId("import-item");
    await expect(item).toContainText("Google Drive had a problem");
    await item.getByRole("button", { name: "Retry" }).click();
    await expect(page).toHaveURL(/\/read\/bio-1$/);
  });

  test("Library header fits the screen (no sideways scroll), signed out and in", async ({ page }) => {
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const width = page.viewportSize()!.width;
    expect(await overflow()).toBe(0);
    expect(await page.evaluate(() => window.innerWidth)).toBe(width);
    await signIn(page);
    expect(await overflow()).toBe(0);
    expect(await page.evaluate(() => window.innerWidth)).toBe(width);
  });

  test("DRV-1: a closed sign-in popup shows a clear message and no crash", async ({ page }) => {
    await setGis(page, { mode: "popup_closed" });
    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await expect(page.getByRole("alert")).toContainText("sign-in window was closed");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
  });
});
