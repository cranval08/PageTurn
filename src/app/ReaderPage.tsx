import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FlipBook, type FlipBookHandle } from "../components/FlipBook";
import { BookmarksPanel } from "../components/BookmarksPanel";
import { OutlinePanel } from "../components/OutlinePanel";
import { ReaderSettingsSheet } from "../components/ReaderSettingsSheet";
import { ThumbnailPanel } from "../components/ThumbnailPanel";
import { Toolbar, type ReaderPanel } from "../components/Toolbar";
import { ZoomLayer, type ZoomLayerHandle } from "../components/ZoomLayer";
import { getBook, getBookFile, markOpened } from "../lib/db/books";
import { importDriveFile } from "../lib/addDriveBook";
import { applyPendingProgress, getProgress, savePage, stashPendingProgress, toggleBookmark } from "../lib/db/progress";
import { checkQuietly } from "../lib/driveUpdates";
import type { Book } from "../lib/db/schema";
import { debounce } from "../lib/debounce";
import { keyToAction, type NavAction } from "../lib/input";
import {
  chooseLayout,
  chromeInset,
  fitPageSize,
  pageAnnouncement,
  pageLabel,
  spreadLeftIndex,
  stageMargin,
  type Layout,
} from "../lib/layout";
import { openPdf, PdfOpenError, type PDFDocumentProxy } from "../lib/pdf/loader";
import { visiblePages } from "../lib/pdf/renderPlan";
import { MAX_ZOOM, MIN_ZOOM } from "../lib/zoom";
import { useAuth } from "../store/auth";
import { useReaderStore } from "../store/reader";
import { useSettings } from "../store/settings";
import { flushScheduledSync, requestSync, scheduleSync, useSync } from "../store/sync";
import { useAutoHide } from "./useAutoHide";

/** PRG-1: progress is saved this long after the last page turn. */
export const SAVE_DEBOUNCE_MS = 500;

type LoadState =
  | { status: "loading" }
  | { status: "missing"; book?: Book }
  | { status: "error"; book: Book; message: string }
  | { status: "ready"; book: Book; doc: PDFDocumentProxy; aspect: number };

function useViewportSize(debounceMs = 120) {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setSize(read()), debounceMs);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    // Mobile browsers can report a wider layout viewport left over from the previous
    // screen during client-side navigation; re-measure once layout has settled.
    const frame = requestAnimationFrame(() => setSize(read()));
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [debounceMs]);
  return size;
}

function useFullscreen() {
  const supported = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const [active, setActive] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  return { supported, active, toggle };
}

/** 1-based page to persist: the left page of a spread (PRD data model). */
function pageToSave(index: number, layout: Layout): number {
  return (layout === "spread" ? spreadLeftIndex(index) : index) + 1;
}

export default function ReaderPage() {
  const { bookId = "" } = useParams();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [panel, setPanel] = useState<ReaderPanel | null>(null);
  /** DRV-6: a newer Drive version is available / being downloaded / failed. */
  const [update, setUpdate] = useState<null | { status: "available" | "updating" } | { status: "error"; message: string }>(null);
  const [goToOpen, setGoToOpen] = useState(false);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const settledZoom = useReaderStore((s) => s.settledZoom);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const layoutMode = useSettings((s) => s.layout);
  const animation = useSettings((s) => s.animation);
  const viewport = useViewportSize();
  const layout = chooseLayout(layoutMode, viewport.width, viewport.height);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const bookRef = useRef<FlipBookHandle>(null);
  const zoomRef = useRef<ZoomLayerHandle>(null);
  const bookmarks = useReaderStore((s) => s.bookmarks);
  /** PRG-2: the page the book opened at, while the reader hasn't turned away from it. */
  const untouchedIndex = useRef<number | null>(null);
  const chrome = useAutoHide(panel !== null || goToOpen);
  const fullscreen = useFullscreen();

  useEffect(() => {
    useReaderStore.getState().setLayout(layout);
  }, [layout]);

  // PRG-1: debounced save of page + last-opened time; flushed when leaving.
  const saver = useMemo(
    () =>
      debounce(
        (page: number) =>
          void savePage(bookId, page)
            .then(() => scheduleSync()) // PRG-2
            .catch((err) => console.error("Saving progress failed", err)),
        SAVE_DEBOUNCE_MS,
      ),
    [bookId],
  );
  useEffect(() => {
    const flush = () => saver.flush();
    // Leaving the page (reload, tab closed, app backgrounded): an async IndexedDB
    // write may be cut off, so also stash the pending page synchronously.
    const leave = () => {
      const pending = saver.pending();
      if (pending) stashPendingProgress(bookId, pending[0]);
      flush();
      flushScheduledSync(Boolean(pending)); // PRG-2: upload before the app is frozen or closed
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      const pending = saver.pending();
      flush();
      flushScheduledSync(Boolean(pending));
    };
  }, [saver, bookId]);

  // Load the book from IndexedDB, restore progress, open the PDF.
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setLoad({ status: "loading" });
    setUpdate(null);
    const store = useReaderStore.getState();
    store.setBookmarks([]);
    store.setSettledZoom(1);
    store.setFlipping(false);
    (async () => {
      await applyPendingProgress();
      const book = await getBook(bookId);
      const data = book ? await getBookFile(bookId) : undefined;
      if (cancelled) return;
      if (!book || !data) {
        setLoad({ status: "missing", book });
        return;
      }
      void markOpened(bookId); // LIB-2 "last opened", even if the reader leaves before the PDF loads
      try {
        const [progress, opened] = await Promise.all([getProgress(bookId), openPdf(data)]);
        doc = opened;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        const start = Math.min(Math.max((progress?.page ?? 1) - 1, 0), doc.numPages - 1);
        store.setPageCount(doc.numPages);
        store.setPageIndex(start);
        store.setBookmarks(progress?.bookmarks ?? []);
        untouchedIndex.current = start;
        setLoad({ status: "ready", book, doc, aspect: vp.width / vp.height });
        void requestSync(); // PRG-2: quietly pull progress from other devices (token in memory only)
        // DRV-6: quietly ask Drive whether a newer version exists (only if already signed in).
        void checkQuietly(book).then((remote) => {
          if (!cancelled && remote) setUpdate({ status: "available" });
        });
      } catch (err) {
        if (cancelled) return;
        setLoad({
          status: "error",
          book,
          message: err instanceof PdfOpenError ? err.message : "Something went wrong opening this PDF.",
        });
      }
    })();
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, [bookId, attempt]);

  const handleFlip = useCallback(
    (index: number) => {
      setPageIndex(index);
      saver.call(pageToSave(index, layoutRef.current));
    },
    [setPageIndex, saver],
  );

  /** Turning by key, tap or button leaves zoom (zoomed swipes pan instead: RDR-6). */
  const turn = useCallback((dir: NavAction) => {
    zoomRef.current?.reset();
    if (dir === "next") bookRef.current?.next();
    else bookRef.current?.prev();
  }, []);

  // RDR-3 keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (e.key === " " && target?.closest("button, a")) return; // let Space activate controls
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      turn(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn]);

  const closePanel = useCallback(() => setPanel(null), []);

  /** Jump to a 0-based page (go to page, scrubber, contents, thumbnails, links). */
  const goToIndex = useCallback((index: number) => {
    zoomRef.current?.reset();
    bookRef.current?.goTo(index);
  }, []);

  // PRG-2: a sync brought newer progress for this book from another device.
  // Bookmarks always follow; the page only moves if the reader hasn't turned yet.
  const syncRevision = useSync((s) => s.revision);
  useEffect(() => {
    if (load.status !== "ready" || !useSync.getState().lastChanged.includes(bookId)) return;
    let cancelled = false;
    void getProgress(bookId).then((progress) => {
      if (cancelled || !progress) return;
      const store = useReaderStore.getState();
      store.setBookmarks(progress.bookmarks);
      const target = Math.min(Math.max(progress.page - 1, 0), load.doc.numPages - 1);
      if (untouchedIndex.current !== null && store.pageIndex === untouchedIndex.current && target !== store.pageIndex) {
        untouchedIndex.current = target;
        goToIndex(target);
      }
    });
    return () => {
      cancelled = true;
    };
    // Runs once per sync revision.
  }, [syncRevision]);

  // RDR-12: in-page PDF links navigate through the store.
  useEffect(() => {
    useReaderStore.getState().setNavigate(goToIndex);
    return () => useReaderStore.getState().setNavigate(() => {});
  }, [goToIndex]);

  /** RDR-14: toggle a bookmark (1-based page) and persist it. */
  const toggleBookmarkAt = useCallback(
    (page: number) => {
      const current = pageToSave(useReaderStore.getState().pageIndex, layoutRef.current);
      void toggleBookmark(bookId, page, current).then((marks) => {
        useReaderStore.getState().setBookmarks(marks);
        scheduleSync();
      });
    },
    [bookId],
  );

  /** DRV-6: download the newer version (from a click: may open the Google popup), then reopen. */
  const runUpdate = () => {
    if (load.status !== "ready") return;
    const book = load.book;
    const tokenPromise = useAuth.getState().driveToken();
    setUpdate({ status: "updating" });
    saver.flush();
    tokenPromise
      .then((token) => importDriveFile({ id: book.id, name: `${book.title}.pdf`, mimeType: "application/pdf" }, token, () => {}))
      .then(() => {
        setUpdate(null);
        setAttempt((a) => a + 1); // reopen the updated file at the saved page
      })
      .catch((err) => setUpdate({ status: "error", message: err instanceof Error ? err.message : "The update failed. Try again." }));
  };

  if (load.status === "missing") {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper p-6 text-center">
        <div className="max-w-sm">
          <h1 className="font-serif text-2xl">{load.book ? "This book isn't on this device" : "Book not found"}</h1>
          <p className="mt-2 text-ink-muted">
            {load.book
              ? "Its PDF was cleared from storage. Add the same file again from your library to keep reading where you left off."
              : "It may have been removed from your library."}
          </p>
          <Link to="/" className="btn-primary mt-6 inline-flex">
            Back to library
          </Link>
        </div>
      </main>
    );
  }

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const title = load.status === "loading" ? "" : load.book.title;
  const pageCount = load.status === "ready" ? load.doc.numPages : 0;
  const zoomed = settledZoom > MIN_ZOOM + 0.001;

  return (
    <main className="reader relative h-dvh w-full overflow-hidden bg-stage select-none">
      {load.status === "ready" ? (
        <ReadyBook
          bookRef={bookRef}
          zoomRef={zoomRef}
          doc={load.doc}
          aspect={load.aspect}
          layout={layout}
          animation={animation}
          viewport={viewport}
          pixelRatio={pixelRatio}
          onFlip={handleFlip}
          onTurn={turn}
          onToggleChrome={chrome.toggle}
          onPointerActivity={chrome.show}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          {load.status === "loading" && (
            <div className="pt-page-skeleton reader-skeleton" role="status" aria-label="Loading book">
              <div className="pt-spinner" />
            </div>
          )}
          {load.status === "error" && (
            <div role="alert" className="max-w-sm rounded-lg bg-paper p-6 text-center shadow-lg">
              <p className="text-ink">{load.message}</p>
              <div className="mt-4 flex justify-center gap-3">
                <button type="button" className="btn-primary" onClick={() => setAttempt((a) => a + 1)}>
                  Retry
                </button>
                <Link to="/" className="btn-secondary">
                  Back to library
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      <Toolbar
        visible={chrome.visible || load.status !== "ready"}
        title={title}
        indicator={load.status === "ready" ? pageLabel(pageIndex, pageCount, layout) : "–"}
        pageCount={Math.max(pageCount, 1)}
        currentPage={pageToSave(pageIndex, layout)}
        zoomPercent={Math.round(settledZoom * 100)}
        canZoomIn={load.status === "ready" && settledZoom < MAX_ZOOM}
        canZoomOut={zoomed}
        onZoomIn={() => zoomRef.current?.zoomIn()}
        onZoomOut={() => zoomRef.current?.zoomOut()}
        onGoTo={(page) => goToIndex(page - 1)}
        onOpenPanel={setPanel}
        bookmarked={bookmarks.includes(pageToSave(pageIndex, layout))}
        onToggleBookmark={() => toggleBookmarkAt(pageToSave(pageIndex, layout))}
        fullscreen={fullscreen}
        onActivity={chrome.show}
        onPinnedChange={setGoToOpen}
      />

      {zoomed && (
        <button
          type="button"
          className="btn-primary absolute bottom-20 left-1/2 z-30 -translate-x-1/2 shadow-lg"
          onClick={() => zoomRef.current?.reset()}
        >
          Reset zoom
        </button>
      )}

      {update && (
        <div
          role={update.status === "error" ? "alert" : "status"}
          className="absolute top-16 left-1/2 z-30 flex w-[min(92vw,30rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl bg-surface p-3 text-ink shadow-xl ring-1 ring-ink/15"
          data-testid="update-banner"
        >
          <p className="min-w-0 flex-1 text-sm">
            {update.status === "available" && "A newer version is in Drive. Update?"}
            {update.status === "updating" && "Downloading the newer version…"}
            {update.status === "error" && update.message}
          </p>
          {update.status !== "updating" && (
            <>
              <button type="button" className="btn-primary min-h-10 px-3 text-sm" onClick={runUpdate}>
                {update.status === "error" ? "Retry" : "Update"}
              </button>
              <button type="button" className="btn-secondary min-h-10 px-3 text-sm" onClick={() => setUpdate(null)}>
                Not now
              </button>
            </>
          )}
        </div>
      )}

      {panel === "settings" && <ReaderSettingsSheet onClose={closePanel} />}
      {panel === "contents" && load.status === "ready" && (
        <OutlinePanel
          doc={load.doc}
          pageIndex={visiblePages(pageIndex, layout, pageCount).at(-1) ?? pageIndex}
          onClose={closePanel}
          onGo={(index) => {
            closePanel();
            goToIndex(index);
          }}
        />
      )}
      {panel === "thumbnails" && load.status === "ready" && (
        <ThumbnailPanel
          doc={load.doc}
          pageCount={pageCount}
          aspect={load.aspect}
          visible={visiblePages(pageIndex, layout, pageCount)}
          onClose={closePanel}
          onGo={(index) => {
            closePanel();
            goToIndex(index);
          }}
        />
      )}
      {panel === "bookmarks" && load.status === "ready" && (
        <BookmarksPanel
          bookmarks={bookmarks}
          pageCount={pageCount}
          currentPage={pageToSave(pageIndex, layout)}
          onToggleCurrent={() => toggleBookmarkAt(pageToSave(pageIndex, layout))}
          onRemove={toggleBookmarkAt}
          onGo={(page) => {
            closePanel();
            goToIndex(page - 1);
          }}
          onClose={closePanel}
        />
      )}

      {load.status === "ready" && (
        <p className="sr-only" aria-live="polite" data-testid="page-announcement">
          {pageAnnouncement(pageIndex, pageCount, layout)}
        </p>
      )}
    </main>
  );
}

function ReadyBook(props: {
  bookRef: React.RefObject<FlipBookHandle>;
  zoomRef: React.Ref<ZoomLayerHandle>;
  doc: PDFDocumentProxy;
  aspect: number;
  layout: Layout;
  animation: "curl" | "slide" | "none";
  viewport: { width: number; height: number };
  pixelRatio: number;
  onFlip(index: number): void;
  onTurn(dir: NavAction): void;
  onToggleChrome(): void;
  onPointerActivity(): void;
}) {
  const { doc, aspect, layout, viewport, bookRef } = props;
  const inset = chromeInset(viewport.width);
  const size = fitPageSize(layout, viewport.width, viewport.height - inset * 2, aspect, stageMargin(viewport.width));
  // Read (not subscribe): only needed when the book (re)mounts.
  const startIndex = useReaderStore.getState().pageIndex;
  const content = useMemo(
    () => ({ width: layout === "spread" ? size.width * 2 : size.width, height: size.height }),
    [layout, size.width, size.height],
  );
  return (
    <ZoomLayer
      ref={props.zoomRef}
      content={content}
      swipeToTurn={props.animation !== "curl"}
      onTurn={props.onTurn}
      onToggleChrome={props.onToggleChrome}
      onPointerActivity={props.onPointerActivity}
      isBookIdle={() => bookRef.current?.isIdle() ?? true}
      cancelBookInput={() => bookRef.current?.cancelUserInput()}
      onZoomSettled={(scale) => useReaderStore.getState().setSettledZoom(scale)}
    >
      <FlipBook
        ref={bookRef}
        doc={doc}
        pageCount={doc.numPages}
        layout={layout}
        animation={props.animation}
        pageWidth={size.width}
        pageHeight={size.height}
        pixelRatio={props.pixelRatio}
        startIndex={startIndex}
        onFlip={props.onFlip}
      />
    </ZoomLayer>
  );
}
