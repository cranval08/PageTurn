// Lighthouse accessibility audit (Phase 4 acceptance: score >= 90 on every screen).
// Run with `npm run lighthouse` (builds first). Uses Playwright's Chromium.
//
// Lighthouse 12+ removed the PWA category; installability is checked in
// tests/e2e/pwa.spec.ts with Chrome's own Page.getInstallabilityErrors.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const PORT = 4174;
const ORIGIN = `http://localhost:${PORT}`;
const MIN_SCORE = 90;
const SAMPLE = join(process.cwd(), "tests", "fixtures", "sample-50p.pdf");

async function waitForServer(url, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not start at ${url}`);
}

/** Add the sample book in a persistent profile so the reader can be audited. */
async function seedProfile(profileDir) {
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: true, serviceWorkers: "block" });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(ORIGIN);
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await page.locator('[data-page="1"][data-rendered="true"]').waitFor();
  const readerUrl = page.url();
  await ctx.close();
  return readerUrl;
}

const scratchProfiles = [];

/**
 * Each audit gets its own copy of the profile. On Windows chrome.kill() returns
 * before Chrome has exited, and a second Chrome on the same profile hands off to
 * the dying one (and lighthouse connects to a dead port).
 */
function copyProfile(source) {
  const dir = mkdtempSync(join(tmpdir(), "pageturn-lh-run-"));
  cpSync(source, dir, { recursive: true, filter: (src) => !/(Singleton\w*|lockfile|DevToolsActivePort)$/.test(src) });
  scratchProfiles.push(dir);
  return dir;
}

async function audit(url, profileDir, formFactor) {
  const chrome = await chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    userDataDir: copyProfile(profileDir),
    chromeFlags: ["--headless=new", "--no-sandbox"],
    maxConnectionRetries: 100, // a fresh Windows profile can take a while to start
  });
  try {
    const desktop = formFactor === "desktop";
    const result = await lighthouse(url, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["accessibility"],
      disableStorageReset: true, // keep the seeded book
      formFactor,
      screenEmulation: desktop
        ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
        : { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    });
    const lhr = result.lhr;
    const failed = Object.values(lhr.audits)
      .filter((a) => a.score === 0 && a.scoreDisplayMode === "binary")
      .map((a) => a.id);
    return { score: Math.round(lhr.categories.accessibility.score * 100), failed };
  } finally {
    await chrome.kill();
  }
}

const server = spawn("npx", ["vite", "preview", "--outDir", "dist", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "ignore",
});
const emptyProfile = mkdtempSync(join(tmpdir(), "pageturn-lh-empty-"));
const bookProfile = mkdtempSync(join(tmpdir(), "pageturn-lh-book-"));
let exitCode = 0;
try {
  await waitForServer(ORIGIN);
  const readerUrl = await seedProfile(bookProfile);
  // Sanity check: a copied profile really opens the book (so the Reader audit isn't "Book not found").
  {
    const ctx = await chromium.launchPersistentContext(copyProfile(bookProfile), { headless: true, serviceWorkers: "block" });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(readerUrl);
    await page.locator('[data-page="1"][data-quality="high"]').waitFor({ timeout: 15_000 });
    await ctx.close();
    console.log("Seeded profile verified: the reader shows the sample book.");
  }
  const pages = [
    { name: "Library (empty)", url: `${ORIGIN}/`, profile: emptyProfile },
    { name: "Library (1 book)", url: `${ORIGIN}/`, profile: bookProfile },
    { name: "Reader", url: readerUrl, profile: bookProfile },
    { name: "Settings", url: `${ORIGIN}/settings`, profile: bookProfile },
  ];
  const rows = [];
  for (const p of pages) {
    for (const formFactor of ["mobile", "desktop"]) {
      const { score, failed } = await audit(p.url, p.profile, formFactor);
      rows.push({ page: p.name, formFactor, score, failed: failed.join(", ") || "—" });
      if (score < MIN_SCORE) exitCode = 1;
    }
  }
  console.table(rows);
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/lighthouse-accessibility.json", JSON.stringify(rows, null, 2));
  console.log(exitCode ? `FAIL: a score is below ${MIN_SCORE}` : `PASS: every accessibility score is >= ${MIN_SCORE}`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  server.kill();
  for (const dir of [emptyProfile, bookProfile, ...scratchProfiles]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Chrome may still hold a lock on Windows */
    }
  }
}
process.exit(exitCode);
