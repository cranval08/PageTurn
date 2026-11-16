import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import HTMLFlipBook from "react-pageflip";
import type { PageFlip } from "page-flip";
import type { Layout } from "../lib/layout";
import type { PDFDocumentProxy } from "../lib/pdf/loader";
import { PageContext, PdfPage, type PageContextValue } from "./PdfPage";

/**
 * page-flip 2.0.7 bug: flipPrev() starts the animation from a synthetic point at
 * x=10, and with disableFlipByClick=true flip() drops any point that is not on a
 * page corner. In portrait that point is off the visible page, so every backward
 * turn (keys, tap zones and page-flip's own back-swipe) silently does nothing.
 * We need disableFlipByClick (so centre taps don't turn pages), so lift it only
 * for the duration of programmatic flips. The UI calls these instance methods too.
 */
function patchProgrammaticFlips(pf: PageFlip) {
  const settings = (pf as unknown as { getSettings(): { disableFlipByClick: boolean } }).getSettings();
  for (const method of ["flipNext", "flipPrev"] as const) {
    const original = pf[method].bind(pf);
    pf[method] = (corner) => {
      const previous = settings.disableFlipByClick;
      settings.disableFlipByClick = false;
      try {
        original(corner);
      } finally {
        settings.disableFlipByClick = previous;
      }
    };
  }
}

interface FlipControllerInternals {
  calc: { getPosition(): { x: number; y: number }; getCorner(): "top" | "bottom" } | null;
  getBoundsRect(): { height: number; pageWidth: number };
  animateFlippingTo(from: { x: number; y: number }, to: { x: number; y: number }, isTurned: boolean): void;
  stopMove(): void;
}

/**
 * page-flip 2.0.7: a released drag only completes the turn when the fold point
 * has passed x <= 0 (the spine). In portrait the "spine" is the left edge of the
 * single page, which on a full-bleed phone is the screen edge, so a finger drag
 * can never complete. In portrait, complete once the corner passes mid-page.
 */
function patchPortraitDragRelease(pf: PageFlip) {
  const controller = (pf as unknown as { getFlipController(): FlipControllerInternals | null }).getFlipController();
  if (!controller) return;
  const original = controller.stopMove.bind(controller);
  controller.stopMove = () => {
    const calc = controller.calc;
    if (!calc || pf.getOrientation() !== "portrait") return original();
    const pos = calc.getPosition();
    const rect = controller.getBoundsRect();
    const y = calc.getCorner() === "bottom" ? rect.height : 0;
    if (pos.x <= rect.pageWidth / 2) controller.animateFlippingTo(pos, { x: -rect.pageWidth, y }, true);
    else controller.animateFlippingTo(pos, { x: rect.pageWidth, y }, false);
  };
}

export interface FlipBookHandle {
  /** Turn forward. If a flip is animating, the turn is queued (one deep). */
  next(): void;
  /** Turn back. If a flip is animating, the turn is queued (one deep). */
  prev(): void;
  /** True when no flip or drag is in progress. */
  isIdle(): boolean;
}

interface FlipBookProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  layout: Layout;
  pageWidth: number;
  pageHeight: number;
  pixelRatio: number;
  /** Page shown when the book (re)mounts. Read only at mount. */
  startIndex: number;
  onFlip(index: number): void;
}

/**
 * RDR-1/RDR-2: thin wrapper over react-pageflip.
 *
 * Works around react-pageflip 2.0.3 quirks:
 * - It never destroys its PageFlip instance, so we call destroy() on remount/unmount.
 * - It binds event handlers once, so callbacks go through refs.
 * - Its own portrait rule differs from RDR-2, so we size the container ourselves,
 *   pass usePortrait only for single-page layout, and remount (via `key`) when
 *   the layout or page size changes, restarting at the current page.
 */
export const FlipBook = forwardRef<FlipBookHandle, FlipBookProps>(function FlipBook(props, ref) {
  const { doc, pageCount, layout, pageWidth, pageHeight, pixelRatio, startIndex } = props;
  const instanceRef = useRef<PageFlip | null>(null);
  const onFlipRef = useRef(props.onFlip);
  onFlipRef.current = props.onFlip;

  const pendingRef = useRef<"next" | "prev" | null>(null);

  const bookKey = `${layout}:${pageWidth}x${pageHeight}`;

  // page-flip ignores flipNext/flipPrev while a flip animates, so quick key
  // presses would be lost. Queue one turn and run it when the book is idle again.
  const turn = useCallback((dir: "next" | "prev") => {
    const pf = instanceRef.current;
    if (!pf) return;
    const state = pf.getState();
    if (state === "read" || state === "fold_corner") {
      if (dir === "next") pf.flipNext();
      else pf.flipPrev();
    } else {
      pendingRef.current = dir;
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      next: () => turn("next"),
      prev: () => turn("prev"),
      isIdle: () => (instanceRef.current?.getState() ?? "read") === "read",
    }),
    [turn],
  );

  useEffect(
    () => () => {
      pendingRef.current = null;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    },
    [bookKey],
  );

  const handleInit = useCallback((e: { object: PageFlip }) => {
    patchProgrammaticFlips(e.object);
    patchPortraitDragRelease(e.object);
    instanceRef.current = e.object;
  }, []);
  const handleFlip = useCallback((e: { data: number }) => onFlipRef.current(e.data), []);
  const handleChangeState = useCallback(
    (e: { data: string }) => {
      if (e.data !== "read" || !pendingRef.current) return;
      const dir = pendingRef.current;
      pendingRef.current = null;
      window.setTimeout(() => turn(dir), 0);
    },
    [turn],
  );

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => <PdfPage key={i} index={i} />),
    [pageCount],
  );

  const context = useMemo<PageContextValue>(
    () => ({ doc, width: pageWidth, height: pageHeight, pixelRatio }),
    [doc, pageWidth, pageHeight, pixelRatio],
  );

  return (
    <PageContext.Provider value={context}>
      <div
        className="pt-book"
        data-layout={layout}
        style={{ width: layout === "spread" ? pageWidth * 2 : pageWidth, height: pageHeight }}
      >
        <HTMLFlipBook
          key={bookKey}
          className="pt-flipbook"
          style={{}}
          width={pageWidth}
          height={pageHeight}
          size="fixed"
          minWidth={pageWidth}
          maxWidth={pageWidth}
          minHeight={pageHeight}
          maxHeight={pageHeight}
          startPage={startIndex}
          usePortrait={layout === "single"}
          showCover={true}
          drawShadow={true}
          maxShadowOpacity={0.5}
          flippingTime={600}
          startZIndex={0}
          autoSize={false}
          mobileScrollSupport={false}
          clickEventForward={true}
          useMouseEvents={true}
          swipeDistance={30}
          showPageCorners={true}
          disableFlipByClick={true}
          renderOnlyPageLengthChange={true}
          onInit={handleInit}
          onFlip={handleFlip}
          onChangeState={handleChangeState}
        >
          {pages}
        </HTMLFlipBook>
      </div>
    </PageContext.Provider>
  );
});
