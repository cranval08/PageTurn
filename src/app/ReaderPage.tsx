import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FlipBook, type FlipBookHandle } from "../components/FlipBook";
import { isTap, keyToAction, tapZone } from "../lib/input";
import { chooseLayout, fitPageSize, pageAnnouncement, pageLabel, stageMargin } from "../lib/layout";
import { openPdf, PdfOpenError, type PDFDocumentProxy } from "../lib/pdf/loader";
import { getSessionBook } from "../lib/session";
import { useReaderStore } from "../store/reader";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; doc: PDFDocumentProxy; aspect: number };

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
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [debounceMs]);
  return size;
}

export default function ReaderPage() {
  const { bookId = "" } = useParams();
  const book = getSessionBook(bookId);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const viewport = useViewportSize();
  const bookRef = useRef<FlipBookHandle>(null);
  const pointerDown = useRef<{ x: number; y: number; t: number } | null>(null);

  // Open the PDF (pdf.js loads lazily on first use).
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setLoad({ status: "loading" });
    setPageIndex(0);
    (async () => {
      try {
        doc = await openPdf(book.data);
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setLoad({ status: "ready", doc, aspect: vp.width / vp.height });
      } catch (err) {
        if (cancelled) return;
        setLoad({
          status: "error",
          message: err instanceof PdfOpenError ? err.message : "Something went wrong opening this PDF.",
        });
      }
    })();
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, [book, attempt, setPageIndex]);

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

  if (!book) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper p-6 text-center">
        <div>
          <h1 className="font-serif text-2xl">Book not found</h1>
          <p className="mt-2 text-ink-muted">Open it again from your library.</p>
          <Link to="/" className="btn-primary mt-6 inline-flex">
            Back to library
          </Link>
        </div>
      </main>
    );
  }

  const layout = chooseLayout("auto", viewport.width, viewport.height);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);

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
        <h1 className="min-w-0 flex-1 truncate font-serif text-base">{book.title}</h1>
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
            onFlip={setPageIndex}
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
  layout: ReturnType<typeof chooseLayout>;
  viewport: { width: number; height: number };
  pixelRatio: number;
  onFlip(index: number): void;
}) {
  const { doc, aspect, layout, viewport } = props;
  const size = fitPageSize(layout, viewport.width, viewport.height, aspect, stageMargin(viewport.width));
  // Read (not subscribe): only needed when the book remounts after a layout/size change.
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
