# PageTurn — notes for Claude Code

PDF flipbook reader PWA with Google Drive. **`PRD.md` is the spec**: requirement IDs (DRV-*, LIB-*, RDR-*, PRG-*, OFF-*) and the six build phases live there. Build one phase at a time, commit at the end of each phase (`Phase N: …`), then stop for review.

## Stack

- TypeScript, Vite 8, React **18.3** (pinned: react-pageflip 2.0.3 predates React 19), react-router-dom 7 (library mode, `BrowserRouter`)
- `pdfjs-dist` 6: loaded lazily in `src/lib/pdf/loader.ts` together with its worker (`?url` import). Never import pdf.js from the initial bundle.
- `react-pageflip` 2.0.3 over `page-flip` 2.0.7; only ever used through `src/components/FlipBook.tsx`
- Zustand for state (`src/store/`), Tailwind CSS v4 via `@tailwindcss/vite` (theme tokens in `src/index.css` `@theme`)
- Vitest + Testing Library (jsdom) for unit/component tests; Playwright (Chromium: `desktop-chrome`, `pixel-7`) for e2e
- Planned per PRD: Dexie (Phase 2), GIS + Picker + Drive REST over `fetch` (Phase 3), `@use-gesture/react` + `vite-plugin-pwa` (Phase 4)

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:5173 (strict port; OAuth origin depends on it) |
| `npm run build` | `tsc --noEmit` type check, then `vite build` |
| `npm test` | Vitest unit + component tests (`tests/unit`) |
| `npm run test:e2e` | Playwright; builds and serves `vite preview` on :4173 itself |
| `npm run fixtures` | Regenerates `tests/fixtures/*.pdf` (no deps) |

Before calling a phase done: `npm run build`, `npm test` and `npm run test:e2e` must all pass.
First Playwright run on a machine: `npx playwright install chromium`.

## Layout

```
src/app/         route screens (LibraryPage, ReaderPage; Settings/Privacy later)
src/components/  FlipBook (react-pageflip wrapper), PdfPage (one canvas page)
src/lib/         pure logic: layout.ts, input.ts, files.ts; pdf/ (loader, renderPage)
src/lib/session.ts  Phase-1 in-memory book store → replaced by Dexie in Phase 2
src/store/       Zustand stores
src/types/       hand-written .d.ts (page-flip ships no types)
tests/unit/      *.test.ts(x)    tests/e2e/  *.spec.ts    tests/fixtures/  sample PDFs
```

## Conventions

- Keep decisions pure and unit-tested in `src/lib/` (layout choice, key/tap mapping, labels); components stay thin.
- Name tests after requirement IDs (e.g. `"RDR-3: …"`) so acceptance criteria map to evidence.
- Page indexes: page-flip and the reader store use **0-based** indexes; anything user-facing or persisted (`Progress.page`) is **1-based**. In a spread the cover is alone, then `[1,2]`, `[3,4]`… (`spreadLeftIndex`).
- Book ids: Drive fileId, or `local:` + SHA-256 of the bytes.
- Accessibility: icon buttons need `aria-label`; touch targets ≥ 44 px (`btn-primary`, `icon-btn`); page changes announced via the `aria-live` region.
- Secrets: Google values come from `VITE_GOOGLE_*` in `.env.local` (git-ignored); keep `.env.example` in sync. Never store Google tokens in localStorage.
- OAuth scopes: only `drive.file`, `drive.appdata` (Phase 6) and `openid email profile`.

## page-flip / react-pageflip gotchas (handled in FlipBook.tsx; keep them)

- react-pageflip never calls `destroy()`; FlipBook destroys the instance on remount/unmount.
- It binds event handlers once, so callbacks go through refs. `renderOnlyPageLengthChange` is on, so pages never receive new props: `PdfPage` reads everything from `PageContext` and the reader store.
- Layout (RDR-2) is ours, not page-flip's: container width is set explicitly, `usePortrait` only in single layout, and the book remounts (`key`) on layout/size change, restarting at the current page.
- `flipPrev()` is a no-op in portrait when `disableFlipByClick` is on (library bug), so `patchProgrammaticFlips` lifts the flag during programmatic flips.
- In portrait a released drag only completes at the screen edge (library bug), so `patchPortraitDragRelease` completes it past mid-page.
- page-flip ignores turns while animating; `FlipBook` queues one pending turn.
- page-flip calls `preventDefault` on touchstart, so no `click` events fire on the book: tap zones use pointer events and run one tick later, only if the book is still idle (avoids double flips on corner taps).
- PRD fallback if react-pageflip becomes untenable: wrap `page-flip` directly (~80 lines).
