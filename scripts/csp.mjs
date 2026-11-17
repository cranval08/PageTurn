// Security NFR: strict Content-Security-Policy allowing only this site and the
// Google endpoints PageTurn uses. The single source of truth: injected as a
// <meta> into index.html at build time (works on every static host, and the e2e
// suite runs against it). Not applied by the dev server (Vite's HMR needs inline code).
//
// Headers a <meta> can't set (frame-ancestors, nosniff, …) are in public/_headers
// (Netlify, Cloudflare Pages) and vercel.json, kept identical by a unit test.

export const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  // pdf.js image decoders are WebAssembly. GIS and gapi/Picker load from Google.
  "script-src": ["'self'", "'wasm-unsafe-eval'", "https://accounts.google.com/gsi/client", "https://apis.google.com", "https://www.gstatic.com"],
  // Google's sign-in and Picker inject inline styles.
  "style-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style"],
  // data: covers and thumbnails, blob: canvases; avatars come from googleusercontent.com.
  "img-src": ["'self'", "data:", "blob:", "https://*.googleusercontent.com", "https://*.gstatic.com"],
  "font-src": ["'self'", "data:"],
  // Drive REST (files, downloads, app-folder uploads), userinfo, GIS.
  "connect-src": ["'self'", "https://www.googleapis.com", "https://accounts.google.com/gsi/"],
  // GIS iframe and the Google Picker.
  "frame-src": ["https://accounts.google.com/gsi/", "https://docs.google.com", "https://drive.google.com", "https://content.googleapis.com"],
  // pdf.js worker and the service worker.
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

export function contentSecurityPolicy(directives = CSP_DIRECTIVES) {
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

/** Vite plugin: add the CSP <meta> to index.html in production builds. */
export function cspMeta() {
  return {
    name: "pageturn-csp",
    apply: "build",
    // Right after <meta charset> (which must stay in the first 1024 bytes), before any script or style.
    transformIndexHtml(html) {
      const charset = /<meta charset="[^"]*"\s*\/?>/i;
      if (!charset.test(html)) throw new Error("index.html needs <meta charset> for the CSP to be placed after it");
      const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy()}" />`;
      return html.replace(charset, (m) => `${m}\n    ${meta}`);
    },
  };
}
