import { expect, test } from "@playwright/test";

const FILE = "/third-party-licenses.txt";

test.describe("Licences: third-party notices ship with the app", () => {
  test("Settings links to the licences, which include StPageFlip's MIT notice", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "Open-source licenses" }).click();
    await expect(page).toHaveURL(new RegExp(`${FILE.replace(/\./g, "\\.")}$`));
    const body = page.locator("body");
    await expect(body).toContainText("page-flip 2.0.7 (MIT)");
    await expect(body).toContainText("https://github.com/Nodlik/StPageFlip");
    await expect(body).toContainText("Copyright (c) 2020 Nodlik");
    await expect(body).toContainText("react-pageflip 2.0.3 (MIT)");
    await expect(body).toContainText("The above copyright notice and this permission notice shall be included");
  });

  test("the privacy page links to the licences", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("link", { name: "open-source licenses" })).toHaveAttribute("href", FILE);
  });

  test("every shipped library is listed, including the service worker's Workbox modules", async ({ request }) => {
    const res = await request.get(FILE);
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toMatch(/^text\/plain/);
    const text = await res.text();
    for (const name of ["react", "react-dom", "react-router", "zustand", "dexie", "pdfjs-dist", "@use-gesture/react", "tailwindcss", "workbox-window"]) {
      expect(text, name).toMatch(new RegExp(`^${name.replace("/", "\\/")} \\d`, "m"));
    }
    expect(text).toContain("--- /pdfjs/wasm/LICENSE_OPENJPEG ---");

    // vite-plugin-pwa bundles Workbox modules into workbox-<hash>.js; each must be in EXTRA_PACKAGES.
    const sw = await (await request.get("/sw.js")).text();
    const runtime = /workbox-[0-9a-f]+/.exec(sw)?.[0];
    expect(runtime).toBeTruthy();
    const modules = new Set((await (await request.get(`/${runtime}.js`)).text()).match(/workbox:[a-z-]+:/g));
    expect(modules.size).toBeGreaterThan(0);
    for (const m of modules) expect(text, m).toMatch(new RegExp(`^workbox-${m.split(":")[1]} \\d`, "m"));
  });
});
