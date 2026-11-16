# PageTurn — notes for Claude Code

PDF flipbook reader PWA with Google Drive. **`PRD.md` is the spec**: requirement IDs (DRV-*, LIB-*, RDR-*, PRG-*, OFF-*) and the six build phases live there. Build one phase at a time, commit at the end of each phase (`Phase N: …`), then stop for review.

## Stack

- TypeScript, Vite 8, React **18.3** (pinned: react-pageflip 2.0.3 predates React 19), react-router-dom 7 (library mode, `BrowserRouter`)
- `pdfjs-dist` 6: loaded lazily in `src/lib/pdf/loader.ts` together with its worker (`?url` import). Never import pdf.js from the initial bundle.
- pdf.js runtime resources: `scripts/pdfjs-assets.mjs` (a Vite plugin) copies `wasm` (OpenJPEG/JBIG2/qcms, no quickjs), `cmaps`, `standard_fonts`, `iccs` from pdfjs-dist into `public/pdfjs/` (git-ignored) on dev start and build. `openPdf` passes them via `pdfResourceOptions()`, resolved from the SITE ROOT (relative URLs break under /read/…). Without them scanned pages (JPEG 2000/JBIG2) render blank and CMap text (CJK) is silently missing. The SW precaches the .wasm/.icc files and runtime-caches the rest. Phase 6 CSP must allow `'wasm-unsafe-eval'` in script-src.
- `react-pageflip` 2.0.3 over `page-flip` 2.0.7; only ever used through `src/components/FlipBook.tsx`
- Zustand for state (`src/store/`), Tailwind CSS v4 via `@tailwindcss/vite` (theme tokens in `src/index.css` `@theme`)
- Vitest + Testing Library (jsdom) for unit/component tests; Playwright (Chromium: `desktop-chrome`, `pixel-7`) for e2e
- Dexie 4 (IndexedDB). Google: GIS token client + Picker (scripts loaded at runtime, typed in `src/types/google.d.ts`) + Drive v3 REST over `fetch`
- `@use-gesture/react` (zoom/pan/taps in `ZoomLayer`), `vite-plugin-pwa` (generateSW, `registerType: "prompt"`, registered in `src/pwa.ts`)
- Tooling: Lighthouse (accessibility only; PWA category no longer exists), `@axe-core/playwright`

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:5173 (strict port; OAuth origin depends on it) |
| `npm run build` | `tsc --noEmit` type check, then `vite build` |
| `npm test` | Vitest unit + component tests (`tests/unit`) |
| `npm run test:e2e` | Playwright; builds into `dist-e2e` with FAKE `VITE_GOOGLE_*` (see `playwright.config.ts`) and serves it on :4173 |
| `npm run fixtures` | Regenerates `tests/fixtures/*.pdf` (builder in `scripts/pdf-builder.mjs`, also used by e2e for the 1,000-page PDF) |
| `npm run lighthouse` | Builds, then Lighthouse accessibility on library/reader/settings, mobile + desktop; fails below 90 |
| `npm run icons` | Re-renders `public/icons/*.png` from the SVG in `scripts/make-icons.mjs` |

Before calling a phase done: `npm run build`, `npm test` and `npm run test:e2e` must all pass.
First Playwright run on a machine: `npx playwright install chromium`.

## Layout

```
src/app/         route screens (LibraryPage, ReaderPage; Settings/Privacy later)
src/components/  FlipBook (react-pageflip wrapper), PdfPage (one page; canvas from PageCache), ZoomLayer (all reader gestures),
                 Toolbar, GoToPage, ReaderSettingsSheet, BookCard, Menu, ImportPanel, …
src/lib/         pure logic: layout.ts, input.ts, files.ts; pdf/ (loader, renderPage)
src/lib/db/      Dexie: schema.ts (books, files, progress, kv), books.ts, progress.ts, settingsStorage.ts
src/lib/addBook.ts, addDriveBook.ts  validate → open → cover → save pipelines (device, Drive)
src/lib/google/  config (env, SCOPES), auth (GIS token, memory only), picker, drive (REST), scripts
src/store/       Zustand stores: reader (current page), settings (persisted to IndexedDB kv)
src/types/       hand-written .d.ts (page-flip ships no types)
tests/unit/      *.test.ts(x)    tests/e2e/  *.spec.ts    tests/fixtures/  sample PDFs
```

## Conventions

- Keep decisions pure and unit-tested in `src/lib/` (layout choice, key/tap mapping, labels); components stay thin.
- Name tests after requirement IDs (e.g. `"RDR-3: …"`) so acceptance criteria map to evidence.
- Page indexes: page-flip and the reader store use **0-based** indexes; anything user-facing or persisted (`Progress.page`) is **1-based**. In a spread the cover is alone, then `[1,2]`, `[3,4]`… (`spreadLeftIndex`).
- Book ids: Drive fileId, or `local:` + SHA-256 of the bytes.
- Storage (Dexie, DB `pageturn`): PDF bytes only in `files` so the library list never loads blobs; `removeBook` deletes book + file + progress in one transaction; "Clear cache" deletes `files` only (library and progress stay). Schema changes need a new `db.version(n)`.
- Progress (PRG-1): reader saves via a 500 ms debounce and flushes on unmount/pagehide/hidden; `loadLibrary` awaits `whenProgressSaved()` so it never reads a stale page.
- Dexie unit tests run in `// @vitest-environment node` with `fake-indexeddb/auto` (jsdom Blobs are not structured-cloneable). Component tests that touch Dexie import `fake-indexeddb/auto` and mock `src/lib/addBook` (no pdf.js/canvas in jsdom).
- Settings live in `useSettings`; only expose UI for settings whose behaviour exists (theme/animation/sound UI arrives with their phases).
- Accessibility: icon buttons need `aria-label`; touch targets ≥ 44 px (`btn-primary`, `icon-btn`); page changes announced via the `aria-live` region.
- Secrets: Google values come from `VITE_GOOGLE_*` in `.env.local` (git-ignored); keep `.env.example` in sync. Never store Google tokens in localStorage.
- OAuth scopes: only `drive.file`, `drive.appdata` (Phase 6) and `openid email profile`, defined once in `src/lib/google/config.ts` `SCOPES` (unit-tested).
- Google popups: `requestToken()` / `useAuth().driveToken()` / `signIn()` must be called synchronously inside a click (popup blockers). GIS is preloaded when the library mounts; the Picker script loads on first use.
- Token expiry (DRV-4): tokens are refreshed 60 s early; Drive 401 → `markExpired()` → "Sign in again" banner. Reading never needs a token, so the open book is never affected.
- E2E Google mocks live in `tests/e2e/google-mock.ts` (GIS, gapi/Picker, Drive, userinfo; all other Google hosts are blocked). Control via `setGis`, `setPicked`, and the returned `DriveMock`.
- Phone layout: nothing may overflow horizontally on a 412 px screen. Overflow widens the mobile layout viewport and broke the reader's page size once (see the "no sideways scroll" e2e test).
- Fixtures: `npm run fixtures` also makes `corrupt.pdf` and `password-protected.pdf` (Standard handler, non-empty user password).

## page-flip / react-pageflip gotchas (handled in FlipBook.tsx; keep them)

- react-pageflip never calls `destroy()`; FlipBook destroys the instance on remount/unmount.
- It binds event handlers once, so callbacks go through refs. `renderOnlyPageLengthChange` is on, so pages never receive new props: `PdfPage` reads everything from `PageContext` and the reader store.
- Layout (RDR-2) is ours, not page-flip's: container width is set explicitly, `usePortrait` only in single layout, and the book remounts (`key`) on layout/size change, restarting at the current page.
- `flipPrev()` is a no-op in portrait when `disableFlipByClick` is on (library bug), so `patchProgrammaticFlips` lifts the flag during programmatic flips.
- In portrait a released drag only completes at the screen edge (library bug), so `patchPortraitDragRelease` completes it past mid-page.
- page-flip ignores turns while animating; `FlipBook` queues one pending turn.
- page-flip calls `preventDefault` on touchstart, so no `click` events fire on the book: tap zones use pointer events and run one tick later, only if the book is still idle (avoids double flips on corner taps).
- PRD fallback if react-pageflip becomes untenable: wrap `page-flip` directly (~80 lines).
- Animation (RDR-4): `curl` = page-flip animates and owns drag/swipe. `slide`/`none` = page-flip input is OFF (`useMouseEvents=false`, remount via key), turns use `turnToNext/PrevPage`, ZoomLayer turns on swipe; slide adds a CSS animation (`data-slide`). Default `none` when the OS asks for reduced motion.

## Rendering, zoom and toolbar (Phase 4)

- Rendering (RDR-5, Memory NFR): `renderPlan.ts` decides per page: visible + settled → "high" (device px ratio × settled zoom, capped at 8 MP), visible while flipping or neighbour (± 2) → "low" (0.5 px/CSS px), otherwise none. Canvases live in one `PageCache` LRU (max 6) per document/size and are attached imperatively to `.pt-page-host`; eviction releases them. Pages expose `data-rendered` and `data-quality` (tests rely on these).
- ZoomLayer owns all reader gestures (taps, double-tap centre, pinch, Ctrl/Cmd+wheel, pan, swipe). When zoomed an overlay covers the book so page-flip gets no input; a 2-finger touchstart cancels page-flip's touch (`cancelUserInput`). Any page turn resets zoom.
- Toolbar (RDR-7): auto-hides after 3 s (`useAutoHide`), stays while go-to-page/settings are open; hidden bars stay focusable and focus shows them. Bar backgrounds are click-through. On screens ≥ 640 px the book fits between the bars (`chromeInset`), because mouse movement re-shows the bars over the page corners; phones stay full-bleed.
- E2E: service workers are BLOCKED by default (they bypass `page.route` mocks); `tests/e2e/pwa.spec.ts` opts in. Tests reach auto-hidden controls via the keyboard (`.press("Enter")`/`.focus()`), like a keyboard user.
- PWA: never auto-reload a reader; `UpdateToast` offers Reload. Precache includes the pdf.js worker (.mjs) so books open offline.

## Navigation, themes, bookmarks (Phase 5)

- Reader panels (contents, thumbnails, bookmarks, settings) all use `Panel` (right on desktop, bottom sheet on phones, Escape/outside closes, focus restored). One panel at a time; auto-hide waits while one is open.
- PDF navigation lives in `src/lib/pdf/navigation.ts`: `destToPageIndex` (named/explicit/numeric dests), `loadOutline`, `loadPageLinks`. External URLs must pass `safeExternalUrl` (http/https/mailto only). pdf.js 6 has no `convertToViewportRectangle`: convert two corners.
- In-page links are real `<button>`/`<a>` in `LinkLayer`; page-flip (`clickEventForward`) and ZoomLayer taps ignore `a, button, input` targets. When zoomed, ZoomLayer forwards taps to a `.pt-link` under the overlay. Links navigate via `useReaderStore().navigate`.
- Themes: colours are tokens in `src/index.css` (`paper, surface, stage, ink, ink-muted, accent, on-accent, danger`), overridden by `:root[data-theme=…]`. Never use `bg-white`/`text-white`/`black` utilities for UI (the PDF page itself stays white). Page look: `--page-filter` on `.pt-paper` (dark = brightness dim, never invert) plus `--page-tint` multiplied over `.pt-page` (sepia cream). `ThemeSync` + a localStorage mirror (`applyThemeEarly`) avoid a flash.
- Bookmarks: `Progress.bookmarks` (1-based, sorted), changed only via `toggleBookmark` (one transaction with the progress row). In a spread the bookmark is the left page.
- Progress safety net: on `pagehide`/hidden the reader also stashes the pending page in localStorage (`stashPendingProgress`); `applyPendingProgress()` folds it in on the next library/reader load. `markOpened` and progress writes are tracked so `loadLibrary` never reads stale data.
- Library sort is a per-device convenience in localStorage (`pageturn.librarySort`); search ignores case, accents and word order.
- DRV-6: `checkQuietly` runs on reader open only if a token is already in memory (no popups without a click); the card menu's "Check Drive for update" may sign in. Updating re-imports via `importDriveFile`, keeping progress and bookmarks.
- Fixture `outline-links.pdf` (outline + internal/external links) comes from `buildPdf` options `outline`, `links`, `label`. Beware `String.replace` with `$` in replacement strings when scripting edits (use split/join).
