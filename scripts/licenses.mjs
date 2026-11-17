// Third-party licence notices (MIT, Apache-2.0, BSD all require the notice to travel with copies).
// At build time this collects every npm package whose code ends up in the shipped JavaScript,
// plus the few that ship by other routes (see EXTRA_PACKAGES), and emits
// dist/third-party-licenses.txt with each package's LICENSE and NOTICE text.
// The pdf.js decoders, fonts and colour profiles in public/pdfjs/ keep their own LICENSE files
// next to them; their text is appended here too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const LICENSES_FILE = "third-party-licenses.txt";

/**
 * Packages that ship without passing through the app's module graph:
 * - pdfjs-dist: its worker is emitted as a file (`?url`), and its resources are copied to public/pdfjs
 * - tailwindcss: its base styles (preflight) are in the CSS
 * - workbox-*: vite-plugin-pwa bundles these into dist/workbox-*.js for the service worker
 *   (the e2e test "licences" checks this list against the built file)
 */
export const EXTRA_PACKAGES = [
  "pdfjs-dist",
  "tailwindcss",
  "workbox-core",
  "workbox-expiration",
  "workbox-precaching",
  "workbox-routing",
  "workbox-strategies",
];

/** Rollup module id → package name, or null for the app's own code. Handles scoped and nested packages. */
export function packageNameFromId(id) {
  const path = id.replace(/^\0/, "").split("?")[0].replace(/\\/g, "/");
  const i = path.lastIndexOf("/node_modules/");
  if (i < 0) return /^vite\//.test(path) ? "vite" : null; // \0vite/preload-helper, modulepreload polyfill
  const rest = path.slice(i + "/node_modules/".length).split("/");
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

const LICENSE_FILE = /^(licen[cs]e|copying)(\..*|[-_].*)?$/i;
const NOTICE_FILE = /^notice(\..*)?$/i;

function readPackage(name, from = root) {
  const dir = join(from, "node_modules", ...name.split("/"));
  if (!existsSync(join(dir, "package.json"))) throw new Error(`licences: package ${name} is not installed`);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const files = readdirSync(dir);
  const texts = (re) => files.filter((f) => re.test(f)).sort().map((f) => readFileSync(join(dir, f), "utf8").trim());
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return {
    name,
    version: pkg.version,
    license: typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "UNKNOWN",
    // Homepage and source repository (deduplicated), e.g. StPageFlip's GitHub page.
    urls: [...new Set([pkg.homepage, repo?.replace(/^git\+/, "").replace(/\.git$/, "")].filter(Boolean))],
    licenses: texts(LICENSE_FILE),
    notices: texts(NOTICE_FILE),
  };
}

const RULE = "=".repeat(78);

/** The full notices file for these package names. Throws if a package has no licence text. */
export function buildLicensesText(names, { from = root, assetsDir = join(from, "public", "pdfjs") } = {}) {
  const packages = [...new Set(names)].sort().map((n) => readPackage(n, from));
  const missing = packages.filter((p) => p.licenses.length === 0).map((p) => p.name);
  if (missing.length) throw new Error(`licences: no LICENSE file found for ${missing.join(", ")}`);

  const out = [
    "PageTurn uses the open-source software listed below. Thank you to its authors.",
    "Each entry gives the package, its version and licence, followed by the licence text",
    "(and NOTICE text, where the package has one) exactly as the package ships it.",
    "",
  ];
  for (const p of packages) {
    out.push(RULE, `${p.name} ${p.version} (${p.license})`, ...p.urls, RULE, "", ...p.licenses.flatMap((t) => [t, ""]));
    for (const n of p.notices) out.push("NOTICE:", "", n, "");
  }

  // pdf.js runtime resources (copied from pdfjs-dist into public/pdfjs by scripts/pdfjs-assets.mjs).
  if (existsSync(assetsDir)) {
    const assetLicenses = [];
    for (const dir of readdirSync(assetsDir).sort()) {
      const full = join(assetsDir, dir);
      if (!statSync(full).isDirectory()) continue;
      for (const f of readdirSync(full).sort()) {
        if (LICENSE_FILE.test(f)) assetLicenses.push([relative(join(from, "public"), join(full, f)).split(sep).join("/"), readFileSync(join(full, f), "utf8").trim()]);
      }
    }
    if (assetLicenses.length) {
      out.push(RULE, "pdf.js runtime resources (image decoders, character maps, fonts, colour profiles)", "Each licence below is also served next to the files it covers.", RULE, "");
      for (const [path, text] of assetLicenses) out.push(`--- /${path} ---`, "", text, "");
    }
  }
  return out.join("\n");
}

/** Vite plugin: emit dist/third-party-licenses.txt for the packages in the production bundle. */
export function thirdPartyLicenses() {
  return {
    name: "pageturn-third-party-licenses",
    apply: "build",
    generateBundle(_options, bundle) {
      const names = new Set(EXTRA_PACKAGES);
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        for (const id of item.moduleIds ?? Object.keys(item.modules ?? {})) {
          const name = packageNameFromId(id);
          if (name) names.add(name);
        }
      }
      this.emitFile({ type: "asset", fileName: LICENSES_FILE, source: buildLicensesText([...names]) });
    },
  };
}
