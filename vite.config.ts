/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { pdfjsAssets } from "./scripts/pdfjs-assets.mjs";
import { cspMeta } from "./scripts/csp.mjs";

export default defineConfig({
  plugins: [
    pdfjsAssets(), // pdf.js decoders, CMaps and fonts → public/pdfjs (see scripts/pdfjs-assets.mjs)
    cspMeta(), // Security NFR: CSP <meta> in production builds (see scripts/csp.mjs)
    react(),
    tailwindcss(),
    // OFF-2 (service worker caches the app shell) and OFF-3 (installable PWA).
    VitePWA({
      registerType: "prompt", // never reload under a reader mid-book; offer "Reload" instead
      injectRegister: false, // registered in src/pwa.ts
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "PageTurn",
        short_name: "PageTurn",
        description: "Read PDFs from Google Drive or your device as a book, with realistic page turns.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#F6F4EF",
        theme_color: "#F6F4EF",
        categories: ["books", "education", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell + lazily loaded chunks + the pdf.js worker (.mjs), so books open offline.
        // Also precache the image decoders (~420 KB): scanned books must render offline.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,webmanifest}", "pdfjs/wasm/*.wasm", "pdfjs/iccs/*.icc"],
        // The no-WebAssembly fallbacks are large and only used by very old browsers.
        globIgnores: ["pdfjs/**/*.js"],
        // CMaps and standard fonts (2.3 MB in all) are cached the first time a book needs them.
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/pdfjs/"),
            handler: "CacheFirst",
            options: { cacheName: "pdfjs-assets", expiration: { maxEntries: 300 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        // Google scripts/APIs are cross-origin and never cached (always fresh, need network).
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
