import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdf/loader";
import { RenderCancelled, releaseCanvas, renderPageCanvas } from "../lib/pdf/renderPage";
import { Panel } from "./Panel";

export const THUMB_WIDTH = 104;
const MAX_CONCURRENT = 2;

/** Tiny semaphore so a fast scroll can't queue hundreds of renders at once. */
function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };
  return function limit<T>(task: () => Promise<T>, isWanted: () => boolean): Promise<T | null> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        const finish = () => {
          active--;
          next();
        };
        if (!isWanted()) {
          finish();
          resolve(null);
          return;
        }
        task().then(
          (v) => {
            finish();
            resolve(v);
          },
          (e) => {
            finish();
            reject(e);
          },
        );
      });
      next();
    });
  };
}

interface ThumbnailPanelProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  aspect: number;
  /** 0-based pages currently on screen (highlighted). */
  visible: number[];
  onGo(pageIndex: number): void;
  onClose(): void;
}

/**
 * RDR-11: page thumbnails, rendered lazily as they scroll into view and released
 * when they scroll away (a 1,000-page book never holds 1,000 canvases).
 */
export function ThumbnailPanel({ doc, pageCount, aspect, visible, onGo, onClose }: ThumbnailPanelProps) {
  const gridRef = useRef<HTMLOListElement>(null);
  const [inView, setInView] = useState<Set<number>>(() => new Set());
  const limiter = useRef(createLimiter(MAX_CONCURRENT));

  useEffect(() => {
    const grid = gridRef.current;
    const root = grid?.closest<HTMLElement>("[data-panel-scroll]") ?? null;
    if (!grid) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setInView((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const page = Number((e.target as HTMLElement).dataset.thumb);
            if (e.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { root, rootMargin: "300px 0px" },
    );
    grid.querySelectorAll("[data-thumb]").forEach((el) => observer.observe(el));
    // Start at the current page.
    grid.querySelector(`[data-thumb="${visible[0] ?? 0}"]`)?.scrollIntoView({ block: "center" });
    return () => observer.disconnect();
    // Observe once per open; `visible` only sets the initial scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  return (
    <Panel title="Pages" onClose={onClose} testId="thumbnail-panel">
      <ol ref={gridRef} className="grid grid-cols-3 gap-3 sm:grid-cols-2" aria-label="Page thumbnails">
        {Array.from({ length: pageCount }, (_, i) => {
          const current = visible.includes(i);
          return (
            <li key={i} data-thumb={i}>
              <button
                type="button"
                className={`pt-thumb block w-full rounded-md p-1 text-center ${current ? "bg-accent/15 ring-2 ring-accent" : "hover:bg-ink/10"}`}
                aria-label={`Page ${i + 1}`}
                aria-current={current ? "page" : undefined}
                data-autofocus={current && i === visible[0] ? "" : undefined}
                onClick={() => onGo(i)}
              >
                <span className="block overflow-hidden rounded-sm bg-white shadow-sm" style={{ aspectRatio: String(aspect) }}>
                  {inView.has(i) && <Thumb doc={doc} page={i + 1} limiter={limiter.current} />}
                </span>
                <span className="mt-1 block text-xs tabular-nums text-ink-muted" aria-hidden="true">
                  {i + 1}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Thumb(props: { doc: PDFDocumentProxy; page: number; limiter: ReturnType<typeof createLimiter> }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let alive = true;
    let canvas: HTMLCanvasElement | null = null;
    let cancel: (() => void) | null = null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    props.limiter(
      () => {
        const handle = renderPageCanvas(props.doc, props.page, THUMB_WIDTH, ratio);
        cancel = handle.cancel;
        return handle.promise;
      },
      () => alive,
    ).then(
      (c) => {
        if (!c) return;
        if (!alive) return releaseCanvas(c);
        canvas = c;
        c.className = "pt-paper";
        hostRef.current?.replaceChildren(c);
      },
      (err) => {
        if (!(err instanceof RenderCancelled)) console.error("Thumbnail failed", err);
      },
    );
    return () => {
      alive = false;
      cancel?.();
      if (canvas) releaseCanvas(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.doc, props.page]);
  return <span ref={hostRef} className="block h-full w-full" />;
}
