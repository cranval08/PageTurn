# PageTurn

Read PDFs as a book. PageTurn is an installable web app (PWA) that opens PDFs from Google Drive or your device and shows them with realistic page turns: two-page spreads on wide screens, single pages on phones. It remembers where you stopped in every book.

No backend, no database, no analytics: everything runs and is stored in your browser.

> **Status:** Phases 1–4 of 6 done (MVP: local flipbook, library and progress, Google Drive, reader polish and offline install). See [`PRD.md`](PRD.md) for the full spec and roadmap.

## Features

### Available now

- Sign in with Google and pick one or more PDFs from Google Drive (Recent, My Drive, Shared with me), with download progress for large files
- Open a PDF from your device with the file picker or by dragging it onto the page (no sign-in needed)
- Library of covers with reading progress ("p. 84 of 312 · 27%"), a Continue reading strip, and Remove from library
- Reopens every book at the page where you stopped; books are saved on the device and open without internet
- Zoom 100–400% by pinch, double-tap, Ctrl/Cmd + scroll or the +/− buttons; while zoomed, swipes pan instead of turning
- Toolbar that hides itself after 3 seconds (tap the centre to bring it back), Go to page, full screen
- Page turn animation: Curl, Slide or None (None by default if your device asks for reduced motion)
- Sharp pages: a quick low-resolution render first, then a crisp one; only a few pages are kept in memory, so even 1,000-page PDFs stay smooth
- Installable app that works offline: the app and every book you've opened load without internet
- Settings: page layout (Auto / Single / Spread), page turn, storage used, Clear cache, Google account and Sign out
- Page-curl animation with page shadow, rendered sharply with pdf.js
- Two-page spread on landscape screens at least 900 px wide, single page otherwise; switches live on resize or rotate and keeps your page
- Turn pages by swiping, dragging a corner, tapping the left or right 20% of the screen, or with the Arrow keys, PageUp/PageDown and Space (Shift+Space goes back)
- Page changes are announced to screen readers

### Coming next

| Phase | Adds |
| --- | --- |
| 5 | Page scrubber, table of contents, thumbnails, PDF links, light/sepia/dark themes, bookmarks, library search |
| 6 | Sync progress across devices through Google Drive, privacy page, deployment |

## Getting started

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and choose **Open from this device**.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the dev server on http://localhost:5173 |
| `npm run build` | Type-checks and builds the production bundle into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm test` | Runs unit and component tests (Vitest) |
| `npm run test:e2e` | Builds the app with fake Google keys into `dist-e2e/` and runs end-to-end tests (Playwright, desktop Chrome and Pixel 7). Google is fully mocked; test real Drive by hand. |
| `npm run fixtures` | Regenerates the test PDFs in `tests/fixtures/` |
| `npm run lighthouse` | Builds the app and runs a Lighthouse accessibility audit of every screen (fails below 90) |
| `npm run icons` | Regenerates the app icons in `public/icons/` |

Before running the end-to-end tests for the first time, install the browser:

```bash
npx playwright install chromium
```

## Installing the app

PageTurn is a Progressive Web App. Once it's served over HTTPS (or on localhost):

- **Android (Chrome):** menu ⋮ → *Install app* (or *Add to Home screen*).
- **iPhone / iPad (Safari):** Share → *Add to Home Screen*. Installing also stops iOS from clearing your saved books after weeks without use.
- **Desktop (Chrome / Edge):** the install icon at the right of the address bar.

The installed app and every book you've opened work offline. When a new version is available, PageTurn shows a *Reload* button instead of restarting while you read.

## Google Cloud setup (for Google Drive)

Opening files from Google Drive needs your own Google Cloud credentials. This is a one-time setup:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Drive API** and the **Google Picker API**.
2. Configure the **OAuth consent screen**: user type External, publishing status Testing, and add yourself as a test user.
3. Create an **OAuth client ID** of type *Web application*. Under Authorized JavaScript origins, add `http://localhost:5173` and your production URL.
4. Create an **API key** and restrict it to the Google Picker API and to your HTTP referrers (`http://localhost:5173/*` and your production URL).
5. Copy `.env.example` to `.env.local` and fill in the values:

   ```bash
   VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   VITE_GOOGLE_API_KEY=your-picker-api-key
   VITE_GOOGLE_APP_ID=your-cloud-project-number
   ```

   `VITE_GOOGLE_APP_ID` is the numeric project number (Cloud Console → project settings), which the Picker needs for the `drive.file` scope.

`.env.local` is git-ignored. Never commit it. Restart `npm run dev` after changing it. Without these values PageTurn still works with PDFs from your device; the Drive options are hidden.

While the consent screen is in Testing mode, only the test users you added can sign in. If sign-in does nothing, allow pop-ups for the site.

The client ID and API key end up in the browser bundle; that is normal for a browser app and why the API key must be restricted to the Picker API and your referrers.

### Permissions PageTurn asks for

PageTurn only requests non-sensitive scopes:

| Scope | Why |
| --- | --- |
| `drive.file` | Download only the PDFs you pick in the Google Picker. PageTurn cannot see the rest of your Drive. |
| `drive.appdata` | (Phase 6) Store reading progress in a hidden app folder so it syncs across devices |
| `openid email profile` | Show your name and avatar when signed in |

You can revoke access at any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Tech stack

- TypeScript, React 18, Vite, React Router
- [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) in a Web Worker, loaded on demand
- [StPageFlip](https://github.com/Nodlik/StPageFlip) via `react-pageflip` for the page-turn effect
- Dexie (IndexedDB) for books, progress and settings
- Google Identity Services, Google Picker and the Drive REST API over `fetch` (no Google client library)
- Zustand for state, Tailwind CSS for styling
- Vitest and Testing Library for unit tests, Playwright for end-to-end tests

## Project structure

```
src/
  app/          screens: LibraryPage, ReaderPage, SettingsPage
  components/   FlipBook (page-flip wrapper), PdfPage (one rendered page)
  lib/          layout and input logic, file handling, db/ (IndexedDB via Dexie),
                google/ (sign-in, Picker, Drive), pdf/ (loader, renderer, covers)
  store/        Zustand stores
  types/        type declarations for untyped packages
tests/
  unit/         Vitest unit and component tests
  e2e/          Playwright end-to-end tests
  fixtures/     sample PDFs (generated by scripts/make-fixtures.mjs)
```

## Privacy

Your PDFs never leave your device and Google. PageTurn has no server and collects no analytics. Google sign-in tokens are kept in memory only, never in browser storage.
