// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, CSP_DIRECTIVES, cspMeta } from "../../scripts/csp.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** `public/_headers` blocks → { "/path": { Header: value } }. */
function parseHeadersFile(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) out[line.trim()] = current = {};
    else if (current) {
      const i = line.indexOf(":");
      current[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

describe("Security NFR: Content-Security-Policy", () => {
  const csp = contentSecurityPolicy();

  it("allows WebAssembly for the pdf.js decoders but never eval or inline scripts", () => {
    const script = CSP_DIRECTIVES["script-src"];
    expect(script).toContain("'wasm-unsafe-eval'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("only allows this site and Google hosts", () => {
    const hosts = Object.values(CSP_DIRECTIVES)
      .flat()
      .filter((v) => v.startsWith("https://"))
      .map((v) => new URL(v.replace("*.", "x.")).hostname.replace(/^x\./, ""));
    for (const host of hosts) expect(host).toMatch(/(^|\.)(google\.com|googleapis\.com|gstatic\.com|googleusercontent\.com)$/);
  });

  it("covers every Google endpoint the app calls", async () => {
    const config = await import("../../src/lib/google/config");
    const allowed = (directive: string, url: string) => CSP_DIRECTIVES[directive].some((src) => url.startsWith(src) || src === new URL(url).origin);
    expect(allowed("script-src", config.GIS_SCRIPT_URL)).toBe(true);
    expect(allowed("script-src", config.GAPI_SCRIPT_URL)).toBe(true);
    for (const url of [config.DRIVE_API, config.DRIVE_UPLOAD_API, config.USERINFO_URL]) expect(allowed("connect-src", url)).toBe(true);
  });

  it("is placed right after <meta charset> in the built index.html", () => {
    const plugin = cspMeta() as unknown as { apply: string; transformIndexHtml(html: string): string };
    expect(plugin.apply).toBe("build");
    const html = plugin.transformIndexHtml(read("index.html"));
    expect(html).toMatch(/<meta charset="UTF-8" \/>\s*<meta http-equiv="Content-Security-Policy" content="default-src 'self';/);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
  });
});

describe("Deploy config: Netlify/Cloudflare (_headers) and Vercel stay identical", () => {
  const netlify = parseHeadersFile(read("public/_headers"));
  const vercel = JSON.parse(read("vercel.json")) as {
    outputDirectory: string;
    buildCommand: string;
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const toNetlifyPath = (source: string) => (source === "/(.*)" ? "/*" : source.replace("(.*)", "*"));

  it("sends the same headers for the same paths", () => {
    const fromVercel = Object.fromEntries(
      vercel.headers.map((h) => [toNetlifyPath(h.source), Object.fromEntries(h.headers.map((x) => [x.key, x.value]))]),
    );
    expect(fromVercel).toEqual(netlify);
  });

  it("blocks framing, sniffing and keeps Google sign-in popups working", () => {
    const all = netlify["/*"];
    expect(all["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(all["X-Content-Type-Options"]).toBe("nosniff");
    expect(all["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
  });

  it("never caches the service worker or index.html; fingerprinted assets forever", () => {
    expect(netlify["/sw.js"]["Cache-Control"]).toBe("no-cache");
    expect(netlify["/index.html"]["Cache-Control"]).toBe("no-cache");
    expect(netlify["/assets/*"]["Cache-Control"]).toContain("immutable");
  });

  it("serves index.html for app routes (/read/…, /settings, /privacy)", () => {
    expect(read("public/_redirects")).toMatch(/^\/\*\s+\/index\.html\s+200$/m);
    expect(vercel.rewrites).toEqual([{ source: "/(.*)", destination: "/index.html" }]);
    expect(vercel.outputDirectory).toBe("dist");
    expect(vercel.buildCommand).toBe("npm run build");
    expect(read("netlify.toml")).toMatch(/publish = "dist"/);
  });
});
