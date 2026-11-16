import { useGesture } from "@use-gesture/react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { tapZone, TAP_MAX_DISTANCE, type NavAction } from "../lib/input";
import { clampPan, DOUBLE_TAP_ZOOM, IDENTITY, isZoomed, MAX_ZOOM, MIN_ZOOM, zoomAt, ZOOM_STEP, type ZoomState } from "../lib/zoom";

export interface ZoomLayerHandle {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  isZoomed(): boolean;
}

interface ZoomLayerProps {
  /** Unscaled size of the book, for pan limits. */
  content: { width: number; height: number };
  /** Turn on swipe-to-turn (when page-flip's own gestures are off: Slide/None animation). */
  swipeToTurn: boolean;
  onTurn(dir: NavAction): void;
  onToggleChrome(): void;
  /** Mouse moved over the stage (desktop): show the toolbar. */
  onPointerActivity(): void;
  /** False while page-flip is mid-flip (it may have handled the tap itself). */
  isBookIdle(): boolean;
  /** A pinch is starting: make page-flip drop the touch it began. */
  cancelBookInput(): void;
  /** Zoom changed (settled), for the toolbar and re-rendering. */
  onZoomSettled(scale: number): void;
  children: ReactNode;
}

const DOUBLE_TAP_MS = 300;
const CHROME_TAP_DELAY_MS = 260;
const ZOOM_SETTLE_MS = 250;

/**
 * RDR-6 (and RDR-3 taps): one gesture surface over the book.
 * - Not zoomed: taps in the left/right 20% turn pages; centre tap toggles the toolbar.
 * - Pinch, double-tap (centre), Ctrl/Cmd + scroll and the +/− buttons zoom 100–400%.
 * - Zoomed: an overlay sits above the book so page-flip gets no input; drags and
 *   swipes pan the page and never turn it; double-tap resets.
 */
export const ZoomLayer = forwardRef<ZoomLayerHandle, ZoomLayerProps>(function ZoomLayer(props, ref) {
  const { content, swipeToTurn, children } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ZoomState>(IDENTITY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const propsRef = useRef(props);
  propsRef.current = props;
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const chromeTimer = useRef<number | undefined>(undefined);

  const stageSize = () => {
    const el = rootRef.current;
    return { width: el?.clientWidth ?? window.innerWidth, height: el?.clientHeight ?? window.innerHeight };
  };
  /** Screen point → offset from the stage centre. */
  const fromCenter = (clientX: number, clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const apply = useCallback(
    (next: ZoomState) => setState(clampPan(next, propsRef.current.content, stageSize())),
    [],
  );
  const zoomTo = useCallback(
    (scale: number, focus = { x: 0, y: 0 }) => apply(zoomAt(stateRef.current, scale, focus)),
    [apply],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomTo(stateRef.current.scale + ZOOM_STEP),
      zoomOut: () => zoomTo(stateRef.current.scale - ZOOM_STEP),
      reset: () => setState(IDENTITY),
      isZoomed: () => isZoomed(stateRef.current),
    }),
    [zoomTo],
  );

  // The book changed size (layout/resize): start unzoomed.
  useEffect(() => setState(IDENTITY), [content.width, content.height]);

  // Report the zoom once it stops changing (re-render pages crisper, update toolbar).
  useEffect(() => {
    const t = window.setTimeout(() => propsRef.current.onZoomSettled(state.scale), ZOOM_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [state.scale]);

  // A second finger landing: stop page-flip from treating the pinch as a page drag.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        propsRef.current.cancelBookInput();
        e.stopPropagation();
      }
    };
    el.addEventListener("touchstart", onTouchStart, { capture: true });
    return () => el.removeEventListener("touchstart", onTouchStart, { capture: true });
  }, []);

  const handleTap = (clientX: number, clientY: number) => {
    const p = propsRef.current;
    const zoomed = isZoomed(stateRef.current);
    const now = performance.now();
    const last = lastTap.current;
    const isDouble = last !== null && now - last.t < DOUBLE_TAP_MS && Math.hypot(clientX - last.x, clientY - last.y) < 40;
    const zone = zoomed ? "center" : tapZone(clientX, window.innerWidth);

    if (zone === "center") {
      if (isDouble) {
        window.clearTimeout(chromeTimer.current);
        lastTap.current = null;
        if (zoomed) setState(IDENTITY);
        else zoomTo(DOUBLE_TAP_ZOOM, fromCenter(clientX, clientY));
        return;
      }
      lastTap.current = { t: now, x: clientX, y: clientY };
      window.clearTimeout(chromeTimer.current);
      chromeTimer.current = window.setTimeout(() => p.onToggleChrome(), CHROME_TAP_DELAY_MS);
      return;
    }

    lastTap.current = null;
    // Run after page-flip has handled the same touchend/mouseup: if it started a
    // flip itself (corner tap), it is no longer idle and we must not flip again.
    window.setTimeout(() => {
      if (p.isBookIdle()) p.onTurn(zone);
    }, 0);
  };

  useGesture(
    {
      onPinch: ({ first, offset: [scale], origin: [ox, oy] }) => {
        if (first) propsRef.current.cancelBookInput();
        zoomTo(scale, fromCenter(ox, oy));
      },
      onWheel: ({ event, delta: [dx, dy] }) => {
        if (event.ctrlKey || event.metaKey) {
          // Ctrl/Cmd + scroll, and trackpad pinch (which browsers report as ctrl+wheel).
          event.preventDefault();
          zoomTo(stateRef.current.scale * Math.exp(-dy * 0.01), fromCenter(event.clientX, event.clientY));
        } else if (isZoomed(stateRef.current)) {
          event.preventDefault();
          const s = stateRef.current;
          apply({ ...s, x: s.x - dx, y: s.y - dy });
        }
      },
      onDrag: ({ tap, pinching, cancel, delta: [dx, dy], swipe: [sx], xy: [x, y], event }) => {
        if (pinching) return cancel();
        if (tap) {
          if ((event as PointerEvent).isPrimary !== false) handleTap(x, y);
          return;
        }
        const s = stateRef.current;
        if (isZoomed(s)) {
          apply({ ...s, x: s.x + dx, y: s.y + dy }); // pan, never turn (RDR-6)
        } else if (propsRef.current.swipeToTurn && sx !== 0) {
          propsRef.current.onTurn(sx < 0 ? "next" : "prev");
        }
      },
      onPointerMove: ({ event }) => {
        if (event.pointerType === "mouse") propsRef.current.onPointerActivity();
      },
    },
    {
      target: rootRef,
      eventOptions: { passive: false },
      drag: {
        filterTaps: true,
        tapsThreshold: TAP_MAX_DISTANCE,
        pointer: { capture: false },
        swipe: { distance: 40, velocity: 0.3 },
      },
      pinch: {
        scaleBounds: { min: MIN_ZOOM, max: MAX_ZOOM },
        from: () => [stateRef.current.scale, 0],
        pinchOnWheel: false,
      },
    },
  );

  const zoomed = isZoomed(state);
  return (
    <div
      ref={rootRef}
      className="absolute inset-0 grid touch-none place-items-center overflow-hidden"
      data-testid="stage"
      data-zoom={Math.round(state.scale * 100)}
      data-swipe-to-turn={swipeToTurn ? "true" : "false"}
    >
      <div
        className="pt-zoom"
        data-testid="zoom-transform"
        style={{
          transform: `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`,
          willChange: zoomed ? "transform" : undefined,
        }}
      >
        {children}
      </div>
      {/* Zoomed: the overlay takes every touch so the flip component never turns a page. */}
      {zoomed && <div className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing" data-testid="zoom-overlay" />}
    </div>
  );
});
