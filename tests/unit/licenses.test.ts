// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLicensesText, dependencyClosure, EXTRA_PACKAGES, LICENSES_FILE, packageNameFromId, thirdPartyLicenses } from "../../scripts/licenses.mjs";

describe("Licences: third-party notices", () => {
  it("maps bundled module ids to their npm package, ignoring the app's own code", () => {
    expect(packageNameFromId("/app/node_modules/page-flip/dist/js/page-flip.module.js")).toBe("page-flip");
    expect(packageNameFromId(String.raw`C:\app\node_modules\@use-gesture\react\dist\index.js`)).toBe("@use-gesture/react");
    expect(packageNameFromId("/app/node_modules/a/node_modules/b/index.js?commonjs-es-import")).toBe("b");
    expect(packageNameFromId("\0vite/preload-helper.js")).toBe("vite");
    expect(packageNameFromId("/app/src/components/FlipBook.tsx")).toBeNull();
  });

  it("includes StPageFlip's MIT copyright and permission notice, and Apache NOTICE files", () => {
    const text = buildLicensesText(["react-pageflip", "page-flip", "dexie", ...EXTRA_PACKAGES]);
    expect(text).toContain("page-flip 2.0.7 (MIT)");
    expect(text).toContain("https://github.com/Nodlik/StPageFlip");
    expect(text).toContain("Copyright (c) 2020 Nodlik");
    expect(text).toContain("The above copyright notice and this permission notice shall be included");
    expect(text).toContain("react-pageflip 2.0.3 (MIT)");
    expect(text).toMatch(/dexie [\d.]+ \(Apache-2\.0\)/);
    expect(text).toMatch(/NOTICE:\s+Dexie\.js/);
    // Sorted by name, each listed once.
    expect(text.indexOf("page-flip 2.0.7")).toBeLessThan(text.indexOf("react-pageflip 2.0.3"));
    expect(text.split("page-flip 2.0.7 (MIT)")).toHaveLength(2);
  });

  it("fails the build when a shipped package has no licence file", () => {
    const dir = mkdtempSync(join(tmpdir(), "licenses-"));
    try {
      mkdirSync(join(dir, "node_modules", "nolicense"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "nolicense", "package.json"), JSON.stringify({ name: "nolicense", version: "1.0.0", license: "MIT" }));
      expect(() => buildLicensesText(["nolicense"], { from: dir })).toThrow(/no LICENSE file found for nolicense/);
      expect(() => buildLicensesText(["missing-pkg"], { from: dir })).toThrow(/not installed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the dev server serves the licences too, from the app's dependencies and theirs", () => {
    type Handler = (req: unknown, res: { setHeader(k: string, v: string): void; end(body: string): void }) => void;
    const routes: Record<string, Handler> = {};
    const plugin = thirdPartyLicenses() as unknown as { configureServer(s: unknown): void };
    plugin.configureServer({ middlewares: { use: (path: string, fn: Handler) => (routes[path] = fn) } });
    const headers: Record<string, string> = {};
    let body = "";
    routes[`/${LICENSES_FILE}`]({}, { setHeader: (k, v) => (headers[k] = v), end: (b) => (body = b) });
    expect(headers["Content-Type"]).toMatch(/^text\/plain/);
    expect(body).toContain("Copyright (c) 2020 Nodlik");
    // Transitive: react-dom brings scheduler, @use-gesture/react brings @use-gesture/core.
    expect(dependencyClosure()).toEqual(expect.arrayContaining(["page-flip", "react-pageflip", "scheduler", "@use-gesture/core", ...EXTRA_PACKAGES]));
  });

  it("the build emits the file from the bundle's modules", () => {
    const plugin = thirdPartyLicenses() as unknown as {
      generateBundle(this: { emitFile(f: { fileName: string; source: string }): void }, o: unknown, b: unknown): void;
    };
    const emitted: { fileName: string; source: string }[] = [];
    plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) }, {}, {
      "ReaderPage.js": { type: "chunk", moduleIds: ["/app/node_modules/page-flip/dist/js/page-flip.module.js", "/app/src/app/ReaderPage.tsx"] },
      "style.css": { type: "asset" },
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe(LICENSES_FILE);
    expect(emitted[0].source).toContain("page-flip 2.0.7 (MIT)");
    for (const name of EXTRA_PACKAGES) expect(emitted[0].source).toContain(`${name} `);
  });
});
