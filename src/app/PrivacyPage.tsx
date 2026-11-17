import { useEffect } from "react";
import { Link } from "react-router-dom";

/** Plain-language privacy policy (PRD screen 4; required for the Google OAuth consent screen). */
export default function PrivacyPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Privacy · PageTurn";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-4">
        <Link to="/" className="icon-btn" aria-label="Back to library">
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="font-serif text-2xl">Privacy</h1>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 pb-16 leading-relaxed">
        <p className="text-lg">
          PageTurn is a PDF reader that runs entirely in your browser. It has no server of its own, no accounts of its
          own, no ads and no analytics. Your books stay on your device and in your Google account.
        </p>

        <section aria-labelledby="stored-heading">
          <h2 id="stored-heading" className="font-serif text-xl">
            What is stored on your device
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>The PDFs you open, so they work without internet.</li>
            <li>Each book's title, cover picture, page count and size.</li>
            <li>Your reading progress (the page you're on) and bookmarks.</li>
            <li>Your reading settings, such as theme and page layout.</li>
          </ul>
          <p className="mt-3">
            This lives in your browser's storage for this site. You can delete the saved PDFs with <em>Clear cache</em> in
            Settings, remove a single book from the library, or clear the site's data in your browser.
          </p>
        </section>

        <section aria-labelledby="google-heading">
          <h2 id="google-heading" className="font-serif text-xl">
            Google sign-in and what PageTurn asks for
          </h2>
          <p className="mt-3">Signing in is optional; PDFs from your device work without it. If you sign in, PageTurn asks Google for:</p>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="font-medium">See and download only the Drive files you pick (drive.file)</dt>
              <dd className="text-ink-muted">
                PageTurn can open the PDFs you choose in the Google file picker, and nothing else in your Drive. It never
                changes, uploads or deletes your files.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Its own hidden app folder in your Drive (drive.appdata)</dt>
              <dd className="text-ink-muted">
                Used for one small file, <code>progress.json</code>, holding the page you're on and your bookmarks for each
                book, so your other devices open books where you stopped. It contains page numbers, bookmark pages, times and
                book identifiers (the Drive file ID, or a fingerprint of a PDF from your device), not titles or file contents.
                You can't see this folder in Drive, and no other app can read it.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Your name, email address and profile picture (openid, email, profile)</dt>
              <dd className="text-ink-muted">Shown in the app so you know which account is signed in. Not stored or shared.</dd>
            </div>
          </dl>
          <p className="mt-3">
            Your sign-in is kept in memory only while the app is open, never saved in browser storage. Signing out revokes
            PageTurn's access.
          </p>
        </section>

        <section aria-labelledby="share-heading">
          <h2 id="share-heading" className="font-serif text-xl">
            What is shared, and with whom
          </h2>
          <p className="mt-3">
            Nothing is sent to the makers of PageTurn or to anyone else. The app only talks to Google (to sign you in, show
            the file picker, download the files you pick and sync your progress) and to the website that serves the app.
            Google's handling of your data is covered by the{" "}
            <a className="text-accent underline underline-offset-2" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Google Privacy Policy
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="revoke-heading">
          <h2 id="revoke-heading" className="font-serif text-xl">
            Removing PageTurn's access
          </h2>
          <p className="mt-3">
            Sign out in Settings, or remove PageTurn at any time at{" "}
            <a
              className="text-accent underline underline-offset-2"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              myaccount.google.com/permissions
            </a>
            . To delete the synced progress file too, open Google Drive on the web, go to Settings → Manage apps, and choose
            Options → Delete hidden app data next to PageTurn. Books already saved on your device stay readable until you
            remove them.
          </p>
        </section>

        <p className="text-sm text-ink-muted">
          PageTurn is built with open-source software; see the{" "}
          <a className="text-accent underline underline-offset-2" href="/third-party-licenses.txt">
            open-source licenses
          </a>
          .
        </p>

        <p className="text-sm text-ink-muted">Last updated 17 November 2026.</p>

        <Link to="/" className="btn-secondary inline-flex">
          Back to library
        </Link>
      </main>
    </div>
  );
}
