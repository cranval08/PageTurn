import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AccountButton } from "../components/AccountButton";
import { BookCard } from "../components/BookCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ImportPanel } from "../components/ImportPanel";
import { Menu } from "../components/Menu";
import { addLocalBook } from "../lib/addBook";
import { loadLibrary, removeBook, type LibraryData } from "../lib/db/books";
import type { Book } from "../lib/db/schema";
import { NotPdfError } from "../lib/files";
import { progressLabel, progressPercent } from "../lib/format";
import { AuthError, initAuth } from "../lib/google/auth";
import { isGoogleConfigured } from "../lib/google/config";
import { pickPdfs } from "../lib/google/picker";
import { checkForDriveUpdate } from "../lib/driveUpdates";
import { loadSort, saveSort, SORT_LABELS, sortAndFilter, type LibrarySort } from "../lib/librarySort";
import { PdfOpenError } from "../lib/pdf/loader";
import { useAuth } from "../store/auth";
import { useDriveImport } from "./useDriveImport";

/** Shown in the "Continue reading" strip once the library has more books than this. */
const CONTINUE_COUNT = 3;

export default function LibraryPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<Book | null>(null);
  const [updating, setUpdating] = useState<Book | null>(null);
  const [sort, setSort] = useState<LibrarySort>(loadSort);
  const [query, setQuery] = useState("");

  const [openingDrive, setOpeningDrive] = useState(false);
  const authStatus = useAuth((s) => s.status);
  const authError = useAuth((s) => s.error);

  const refresh = useCallback(async () => {
    setLibrary(await loadLibrary());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load Google Identity Services early so the sign-in popup can open straight from a click.
  useEffect(() => {
    if (isGoogleConfigured()) initAuth().catch(() => {});
  }, []);

  const imports = useDriveImport((added, autoOpen) => {
    void refresh();
    // One file picked and added: open it straight away (3-tap goal).
    if (autoOpen) navigate(`/read/${encodeURIComponent(added[0].id)}`);
  });

  /** DRV-2: sign in if needed, show the Picker, import what was picked. Called from a click. */
  const addFromDrive = () => {
    setMessage(null);
    useAuth.getState().clearError();
    if (!isGoogleConfigured()) {
      setMessage("Google Drive isn't set up. Add your Google keys to .env.local (see the README).");
      return;
    }
    const tokenPromise = useAuth.getState().driveToken(); // opens the popup synchronously if needed
    setOpeningDrive(true);
    tokenPromise
      .then(async (token) => {
        const files = await pickPdfs(token);
        if (files.length > 0) imports.start(files, token);
      })
      .catch((err) => {
        if (!(err instanceof AuthError)) setMessage(err instanceof Error ? err.message : "Couldn't open Google Drive.");
      })
      .finally(() => setOpeningDrive(false));
  };

  // Performance mark for the "library loads in under 500 ms" check.
  useEffect(() => {
    if (library) performance.mark("library-ready");
  }, [library]);

  const addFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setMessage(null);
      setBusy(true);
      try {
        const book = await addLocalBook(file);
        navigate(`/read/${encodeURIComponent(book.id)}`);
      } catch (err) {
        if (err instanceof NotPdfError || err instanceof PdfOpenError) setMessage(err.message);
        else {
          console.error(err);
          setMessage("Couldn't add that file. Try again.");
        }
      } finally {
        setBusy(false);
      }
    },
    [navigate],
  );

  const openBook = useCallback(
    (book: Book) => {
      if (library && !library.cached.has(book.id)) {
        if (book.source === "drive" && isGoogleConfigured()) {
          // Re-download on demand (PRD risk: storage eviction). Called from a click.
          setMessage(null);
          useAuth
            .getState()
            .driveToken()
            .then((token) => imports.start([{ id: book.id, name: `${book.title}.pdf`, mimeType: "application/pdf" }], token))
            .catch(() => {});
          return;
        }
        setMessage(
          book.source === "local"
            ? `"${book.title}" was cleared from this device. Add the same PDF again to keep reading where you left off.`
            : `"${book.title}" isn't downloaded on this device.`,
        );
        return;
      }
      navigate(`/read/${encodeURIComponent(book.id)}`);
    },
    [library, navigate, imports],
  );

  // Drag a PDF anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void addFile(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFile]);

  const pickFile = () => inputRef.current?.click();
  const books = library?.books ?? [];
  // LIB-2: the strip always shows the most recently opened; the grid follows sort + search.
  const recent = books.length > CONTINUE_COUNT && !query.trim() ? books.slice(0, CONTINUE_COUNT) : [];
  const shown = sortAndFilter(books, sort, query);

  /** DRV-6 from the card menu. Called from a click (may open the Google popup). */
  const checkUpdate = (book: Book) => {
    setMessage(null);
    useAuth
      .getState()
      .driveToken()
      .then((token) => checkForDriveUpdate(book, token))
      .then((remote) => {
        if (remote) setUpdating(book);
        else setMessage(`"${book.title}" is up to date.`);
      })
      .catch((err) => {
        if (!(err instanceof AuthError)) setMessage(err instanceof Error ? err.message : "Couldn't check Google Drive.");
      });
  };

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-4 sm:gap-2">
        <span className="min-w-0 flex-1 truncate font-serif text-xl font-semibold sm:text-2xl">PageTurn</span>
        <Link to="/settings" className="icon-btn" aria-label="Settings">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
        <Menu
          label="Add book"
          trigger={(props) => (
            <button {...props} type="button" className="btn-primary whitespace-nowrap" disabled={busy || openingDrive}>
              {busy || openingDrive ? "Adding…" : "+ Add book"}
            </button>
          )}
        >
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  addFromDrive();
                }}
              >
                From Google Drive
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  pickFile();
                }}
              >
                From this device
              </button>
            </>
          )}
        </Menu>
        <AccountButton />
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          data-testid="file-input"
          aria-label="Add a PDF from this device"
          tabIndex={-1}
          onChange={(e) => {
            void addFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16">
        {message && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
            <p className="flex-1">{message}</p>
            <button type="button" className="-my-2 -mr-2 icon-btn text-base" aria-label="Dismiss message" onClick={() => setMessage(null)}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}

        {authStatus === "expired" && (
          <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
            <p className="flex-1">Your Google session expired. Your books are safe; sign in again to add from Drive.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void useAuth.getState().driveToken().catch(() => {})}
            >
              Sign in again
            </button>
          </div>
        )}
        {authError && authStatus !== "expired" && (
          <div role="alert" className="mb-6 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
            <p className="flex-1">{authError}</p>
            <button type="button" className="-my-2 -mr-2 icon-btn text-base" aria-label="Dismiss message" onClick={() => useAuth.getState().clearError()}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}

        {library && books.length === 0 && (
          <EmptyState onPick={pickFile} onDrive={addFromDrive} busy={busy || openingDrive} />
        )}

        {recent.length > 0 && (
          <section aria-labelledby="continue-heading" className="mb-10">
            <h2 id="continue-heading" className="mb-3 font-serif text-xl">
              Continue reading
            </h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {recent.map((book) => {
                const page = library?.progress.get(book.id)?.page;
                return (
                  <li key={book.id}>
                    <button
                      type="button"
                      data-testid="continue-card"
                      className="flex w-full items-center gap-3 rounded-lg bg-surface p-2 text-left shadow-sm ring-1 ring-ink/10 hover:shadow-md"
                      onClick={() => openBook(book)}
                    >
                      <img src={book.coverDataUrl} alt="" className="pt-paper h-16 w-12 shrink-0 rounded-sm object-cover object-top shadow" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif">{book.title}</span>
                        <span className="block text-xs tabular-nums text-ink-muted">{progressLabel(page, book.pageCount)}</span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
                          <span className="block h-full bg-accent" style={{ width: `${page ? progressPercent(page, book.pageCount) : 0}%` }} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {books.length > 0 && (
          <section aria-labelledby="library-heading">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <h2 id="library-heading" className="mr-auto font-serif text-xl">
                Library{" "}
                <span className="text-base text-ink-muted" data-testid="library-count">
                  ({query.trim() ? `${shown.length} of ${books.length}` : books.length})
                </span>
              </h2>
              <label className="flex min-w-0 flex-1 flex-col text-sm sm:max-w-64 sm:flex-none">
                <span className="mb-1 text-ink-muted">Search by title</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. biology"
                  className="min-h-11 rounded-lg border border-ink/30 bg-surface px-3 text-base text-ink placeholder:text-ink-muted"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="mb-1 text-ink-muted">Sort by</span>
                <select
                  value={sort}
                  onChange={(e) => {
                    const v = e.target.value as LibrarySort;
                    setSort(v);
                    saveSort(v);
                  }}
                  className="min-h-11 rounded-lg border border-ink/30 bg-surface px-2 text-base text-ink"
                >
                  {(Object.keys(SORT_LABELS) as LibrarySort[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {shown.length === 0 && (
              <p className="py-8 text-center text-ink-muted" role="status">
                No books match "{query.trim()}".{" "}
                <button type="button" className="text-accent underline underline-offset-2" onClick={() => setQuery("")}>
                  Clear search
                </button>
              </p>
            )}
            <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {shown.map((book) => (
                <li key={book.id}>
                  <BookCard
                    book={book}
                    page={library?.progress.get(book.id)?.page}
                    cached={library?.cached.has(book.id) ?? false}
                    onOpen={openBook}
                    onRemove={setRemoving}
                    onCheckUpdate={isGoogleConfigured() ? checkUpdate : undefined}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {updating && (
        <ConfirmDialog
          title="Update from Google Drive?"
          message={`A newer version of "${updating.title}" is in Drive. Download it now? Your page and bookmarks are kept.`}
          confirmLabel="Update"
          onCancel={() => setUpdating(null)}
          onConfirm={() => {
            const book = updating;
            setUpdating(null);
            useAuth
              .getState()
              .driveToken()
              .then((token) =>
                imports.start([{ id: book.id, name: `${book.title}.pdf`, mimeType: "application/pdf" }], token, { autoOpen: false }),
              )
              .catch(() => {});
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove from library?"
          message={`"${removing.title}" and your reading progress will be removed from this device.${
            removing.source === "drive" ? " The file in your Google Drive is not touched." : ""
          }`}
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const book = removing;
            setRemoving(null);
            await removeBook(book.id);
            await refresh();
          }}
        />
      )}

      <ImportPanel items={imports.items} onRetry={imports.retry} onDismiss={imports.dismiss} />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-accent/15 outline-4 -outline-offset-8 outline-accent outline-dashed">
          <p className="rounded-lg bg-paper px-6 py-4 font-serif text-xl shadow-lg">Drop a PDF to add it</p>
        </div>
      )}
    </div>
  );
}

/** LIB-4: explain the two ways to add a book. */
function EmptyState({ onPick, onDrive, busy }: { onPick(): void; onDrive(): void; busy: boolean }) {
  const drive = isGoogleConfigured();
  return (
    <section className="mx-auto mt-12 max-w-lg text-center">
      <h1 className="font-serif text-3xl">Your library is empty</h1>
      <p className="mt-3 text-ink-muted">Add a PDF to start reading. There are two ways:</p>
      <ol className="mt-6 grid gap-4 text-left sm:grid-cols-2">
        <li className="flex flex-col rounded-lg bg-surface p-4 shadow-sm ring-1 ring-ink/10">
          <p className="font-medium">From Google Drive</p>
          <p className="mt-1 flex-1 text-sm text-ink-muted">
            {drive
              ? "Sign in with Google and pick one or more PDFs. PageTurn only sees the files you pick."
              : "Not set up in this copy of PageTurn (see the README)."}
          </p>
          {drive && (
            <button type="button" className="btn-primary mt-4" onClick={onDrive} disabled={busy}>
              Open from Google Drive
            </button>
          )}
        </li>
        <li className="flex flex-col rounded-lg bg-surface p-4 shadow-sm ring-1 ring-ink/10">
          <p className="font-medium">From this device</p>
          <p className="mt-1 flex-1 text-sm text-ink-muted">Choose a PDF, or drag one anywhere onto this page. No sign-in needed.</p>
          <button type="button" className={`${drive ? "btn-secondary" : "btn-primary"} mt-4`} onClick={onPick} disabled={busy}>
            {busy ? "Adding…" : "Open from this device"}
          </button>
        </li>
      </ol>
    </section>
  );
}
