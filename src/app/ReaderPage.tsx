import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FlipBook, type FlipBookHandle } from "../components/FlipBook";
import { getBook, getBookFile, markOpened } from "../lib/db/books";
import { getProgress, savePage } from "../lib/db/progress";
import type { Book } from "../lib/db/schema";
import { debounce } from "../lib/debounce";
import { isTap, keyToAction, tapZone } from "../lib/input";
import {
  chooseLayout,
  fitPageSize,
  pageAnnouncement,
  pageLabel,
  spreadLeftIndex,
  stageMargin,
  type Layout,
} from "../lib/layout";
import { openPdf, PdfOpenError, type PDFDocumentProxy } from "../lib/pdf/loader";
import { useReaderStore } from "../store/reader";
import { useSettings } from "../store/settings";

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

/** 1-based page to persist: the left page of a spread (PRD data model). */
function pageToSave(index: number, layout: Layout): number {
  return (layout === "spread" ? spreadLeftIndex(index) : index) + 1;
}

export default function ReaderPage() {
  const { bookId = "" } = useParams();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const layoutMode = useSettings((s) => s.layout);
  const viewport = useViewportSize();
  const layout = chooseLayout(layoutMode, viewport.width, viewport.height);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const bookRef = useRef<FlipBookHandle>(null);
  const pointerDown = useRef<{ x: number; y: number; t: number } | null>(null);

  // PRG-1: debounced save of page + last-opened time; flushed when leaving.
  const saver = useMemo(
    () => debounce((page: number) => void savePage(bookId, page).catch((err) => console.error("Saving progress failed", err)), SAVE_DEBOUNCE_MS),
    [bookId],
  );
  useEffect(() => {
    const flush = () => saver.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [saver]);

  // Load the book from IndexedDB, restore progress, open the PDF.
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setLoad({ status: "loading" });
    (async () => {
      const book = await getBook(bookId);
      const data = book ? await getBookFile(bookId) : undefined;
      if (cancelled) return;
      if (!book || !data) {
        setLoad({ status: "missing", book });
        return;
      }
      try {
        const [progress, opened] = await Promise.all([getProgress(bookId), openPdf(data)]);
        doc = opened;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        const start = Math.min(Math.max((progress?.page ?? 1) - 1, 0), doc.numPages - 1);
        setPageIndex(start);
        void markOpened(bookId);
        setLoad({ status: "ready", book, doc, aspect: vp.width / vp.height });
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
  }, [bookId, attempt, setPageIndex]);

  const handleFlip = useCallback(
    (index: number) => {
      setPageIndex(index);
      saver.call(pageToSave(index, layoutRef.current));
    },
    [setPageIndex, saver],
  );

  const next = useCallback(() => bookRef.current?.next(), []);
  const prev = useCallback(() => bookRef.current?.prev(), []);

  // RDR-3 keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === " " && target?.closest("button, a")) return; // let Space activate controls
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === "next") next();
      else prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // RDR-3 tap zones. Pointer events still fire when page-flip calls preventDefault on touch.
  const onPointerDown = (e: React.PointerEvent) => {
    pointerDown.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = pointerDown.current;
    pointerDown.current = null;
    if (!start || !e.isPrimary) return;
    if (!isTap(e.clientX - start.x, e.clientY - start.y, performance.now() - start.t)) return;
    const zone = tapZone(e.clientX, window.innerWidth);
    // Defer until page-flip has handled the same mouseup/touchend: if it started
    // a flip itself (corner click), it is no longer idle and we must not flip again.
    window.setTimeout(() => {
      if (zone === "center") setChromeVisible((v) => !v);
      else if (bookRef.current?.isIdle()) {
        if (zone === "next") next();
        else prev();
      }
    }, 0);
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

  return (
    <main className="reader relative h-dvh w-full overflow-hidden bg-stage select-none">
      <header
        className={`reader-bar absolute inset-x-0 top-0 z-20 flex items-center gap-3 px-3 py-2 transition-opacity ${
          chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <Link to="/" className="icon-btn" aria-label="Back to library">
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-base">{title}</h1>
        {load.status === "ready" && (
          <span className="tabular-nums text-sm" data-testid="page-indicator">
            {pageLabel(pageIndex, load.doc.numPages, layout)}
          </span>
        )}
      </header>

      <div
        className="absolute inset-0 grid place-items-center"
        data-testid="stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
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
        {load.status === "ready" && (
          <ReadyBook
            bookRef={bookRef}
            doc={load.doc}
            aspect={load.aspect}
            layout={layout}
            viewport={viewport}
            pixelRatio={pixelRatio}
            onFlip={handleFlip}
          />
        )}
      </div>

      {load.status === "ready" && (
        <p className="sr-only" aria-live="polite" data-testid="page-announcement">
          {pageAnnouncement(pageIndex, load.doc.numPages, layout)}
        </p>
      )}
    </main>
  );
}

function ReadyBook(props: {
  bookRef: React.Ref<FlipBookHandle>;
  doc: PDFDocumentProxy;
  aspect: number;
  layout: Layout;
  viewport: { width: number; height: number };
  pixelRatio: number;
  onFlip(index: number): void;
}) {
  const { doc, aspect, layout, viewport } = props;
  const size = fitPageSize(layout, viewport.width, viewport.height, aspect, stageMargin(viewport.width));
  // Read (not subscribe): only needed when the book (re)mounts.
  const startIndex = useReaderStore.getState().pageIndex;
  return (
    <FlipBook
      ref={props.bookRef}
      doc={doc}
      pageCount={doc.numPages}
      layout={layout}
      pageWidth={size.width}
      pageHeight={size.height}
      pixelRatio={props.pixelRatio}
      startIndex={startIndex}
      onFlip={props.onFlip}
    />
  );
}
