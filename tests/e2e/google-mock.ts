import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";

// Fake Google Identity Services, gapi/Picker, Drive v3 and userinfo for E2E.
// Control them from tests via page.evaluate on window.__gis / window.__picker,
// and server-side via the returned DriveMock.

const GIS_MOCK = `
window.__gis = window.__gis || { requests: [], config: null, mode: "grant", expiresIn: 3600, revoked: [] };
window.google = window.google || {};
window.google.accounts = { oauth2: {
  initTokenClient(cfg) {
    window.__gis.config = { client_id: cfg.client_id, scope: cfg.scope };
    return { requestAccessToken(o) {
      const g = window.__gis; g.requests.push(o || {});
      const n = g.requests.length;
      setTimeout(() => {
        if (g.mode === "popup_closed") return cfg.error_callback && cfg.error_callback({ type: "popup_closed" });
        if (g.mode === "popup_blocked") return cfg.error_callback && cfg.error_callback({ type: "popup_failed_to_open" });
        if (g.mode === "denied") return cfg.callback({ error: "access_denied" });
        cfg.callback({ access_token: "tok" + n, expires_in: g.expiresIn, scope: cfg.scope, token_type: "Bearer" });
      }, 20);
    } };
  },
  hasGrantedAllScopes(r, ...s) { return s.every((x) => (r.scope || "").split(" ").includes(x)); },
  revoke(t, done) { window.__gis.revoked.push(t); done && done(); },
} };
`;

const GAPI_MOCK = `
window.__picker = window.__picker || { docs: [], built: null, opened: 0 };
window.google = window.google || {};
window.gapi = { load(name, o) { setTimeout(o.callback, 10); } };
class DocsView {
  constructor(id) { this.o = { id }; }
  setMimeTypes(m) { this.o.mime = m; return this; }
  setOwnedByMe(v) { this.o.ownedByMe = v; return this; }
  setIncludeFolders() { return this; }
  setLabel(l) { this.o.label = l; return this; }
}
class PickerBuilder {
  constructor() { this.s = { views: [], features: [] }; }
  setAppId(a) { this.s.appId = a; return this; }
  setOAuthToken(t) { this.s.token = t; return this; }
  setDeveloperKey(k) { this.s.key = k; return this; }
  enableFeature(f) { this.s.features.push(f); return this; }
  setTitle() { return this; }
  setOrigin() { return this; }
  addView(v) { this.s.views.push(v.o); return this; }
  setCallback(cb) { this.cb = cb; return this; }
  build() {
    const cb = this.cb, s = this.s;
    return {
      setVisible() {
        const p = window.__picker; p.built = s; p.opened++;
        setTimeout(() => cb({ action: "loaded" }), 5);
        setTimeout(() => cb(p.docs.length ? { action: "picked", docs: p.docs } : { action: "cancel" }), 30);
      },
      dispose() {},
    };
  }
}
window.google.picker = { DocsView, PickerBuilder, ViewId: { DOCS: "all" },
  Feature: { MULTISELECT_ENABLED: "multiselectEnabled" },
  Action: { PICKED: "picked", CANCEL: "cancel", LOADED: "loaded" } };
`;

const FIXTURES = join(process.cwd(), "tests", "fixtures");
export const fixture = (name: string) => readFileSync(join(FIXTURES, name));

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export interface DriveFileMock {
  name: string;
  mimeType: string;
  body: Buffer;
  /** Respond with this HTTP status to downloads (alt=media) this many times. */
  failDownloads?: { status: number; times: number };
}

export interface DriveMock {
  files: Map<string, DriveFileMock>;
  /** Tokens Drive treats as revoked/expired (401). */
  rejectedTokens: Set<string>;
  downloads: string[];
}

export const USER = { name: "Test Student", email: "student@example.com", picture: "https://lh3.googleusercontent.com/a/test-avatar" };

export async function mockGoogle(page: Page): Promise<DriveMock> {
  const drive: DriveMock = { files: new Map(), rejectedTokens: new Set(), downloads: [] };

  // Block anything Google we don't explicitly mock, so no test reaches the network.
  for (const host of ["https://accounts.google.com/**", "https://apis.google.com/**", "https://www.googleapis.com/**", "https://*.googleusercontent.com/**"]) {
    await page.route(host, (route) => route.abort("blockedbyclient"));
  }
  await page.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body: GIS_MOCK }));
  await page.route("https://apis.google.com/js/api.js", (r) => r.fulfill({ contentType: "text/javascript", body: GAPI_MOCK }));
  await page.route("https://lh3.googleusercontent.com/**", (r) => r.fulfill({ contentType: "image/png", body: PNG_1PX }));

  const authorized = (route: Route) => {
    const header = route.request().headers()["authorization"] ?? "";
    const token = header.replace(/^Bearer /, "");
    return /^tok\d+$/.test(token) && !drive.rejectedTokens.has(token);
  };

  await page.route("https://www.googleapis.com/oauth2/v3/userinfo", (route) =>
    authorized(route) ? route.fulfill({ json: USER }) : route.fulfill({ status: 401, json: { error: "invalid_token" } }),
  );

  await page.route("https://www.googleapis.com/drive/v3/files/**", (route) => {
    if (!authorized(route)) return route.fulfill({ status: 401, json: { error: { code: 401 } } });
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split("/files/")[1]);
    const file = drive.files.get(id);
    if (!file) return route.fulfill({ status: 404, json: { error: { code: 404 } } });
    if (url.searchParams.get("alt") === "media") {
      drive.downloads.push(id);
      if (file.failDownloads && file.failDownloads.times > 0) {
        file.failDownloads.times--;
        return route.fulfill({ status: file.failDownloads.status, body: "" });
      }
      return route.fulfill({ body: file.body, headers: { "Content-Type": file.mimeType, "Content-Length": String(file.body.length) } });
    }
    return route.fulfill({
      json: { id, name: file.name, mimeType: file.mimeType, size: String(file.body.length), modifiedTime: "2026-11-10T09:00:00.000Z" },
    });
  });

  return drive;
}

/** Files the mock Picker returns on the next open. */
export function setPicked(page: Page, docs: { id: string; name: string; mimeType?: string }[]) {
  return page.evaluate((d) => {
    const w = window as unknown as { __picker?: { docs: unknown[]; built: null; opened: number } };
    w.__picker ??= { docs: [], built: null, opened: 0 };
    w.__picker.docs = d.map((x) => ({ mimeType: "application/pdf", ...x }));
  }, docs);
}

export function setGis(page: Page, patch: { mode?: string; expiresIn?: number }) {
  return page.evaluate((p) => {
    const w = window as unknown as { __gis?: Record<string, unknown> };
    w.__gis ??= { requests: [], config: null, mode: "grant", expiresIn: 3600, revoked: [] };
    Object.assign(w.__gis, p);
  }, patch);
}

export function gisState(page: Page) {
  return page.evaluate(() => (window as unknown as { __gis: { requests: unknown[]; config: unknown; revoked: string[] } }).__gis);
}

export function pickerState(page: Page) {
  return page.evaluate(() => (window as unknown as { __picker: { built: unknown; opened: number } }).__picker);
}
