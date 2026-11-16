import { useState } from "react";
import { Link } from "react-router-dom";
import { GoToPage } from "./GoToPage";

interface ToolbarProps {
  visible: boolean;
  title: string;
  /** "12–13 / 312" */
  indicator: string;
  pageCount: number;
  /** 1-based current (left) page, prefilled in Go to page. */
  currentPage: number;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onGoTo(page: number): void;
  onOpenSettings(): void;
  fullscreen: { supported: boolean; active: boolean; toggle(): void };
  /** Keep the toolbar showing (focus or pointer on it). */
  onActivity(): void;
  /** True while go-to-page is open, so auto-hide waits. */
  onPinnedChange(pinned: boolean): void;
}

/**
 * RDR-7 top and bottom bars. They fade out when hidden but stay in the tab order:
 * focusing a control shows them again, so keyboard users never lose them.
 */
export function Toolbar(props: ToolbarProps) {
  const [goToOpen, setGoToOpen] = useState(false);
  const setGoTo = (open: boolean) => {
    setGoToOpen(open);
    props.onPinnedChange(open);
  };
  const hiddenClass = props.visible ? "opacity-100" : "pointer-events-none opacity-0";
  const barEvents = {
    onFocus: props.onActivity,
    onPointerMove: props.onActivity,
    "data-visible": props.visible ? "true" : "false",
  };

  return (
    <>
      <header
        {...barEvents}
        className={`reader-bar absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-2 py-2 transition-opacity motion-reduce:transition-none sm:gap-2 sm:px-3 ${hiddenClass}`}
        data-testid="top-bar"
      >
        <Link to="/" className="icon-btn" aria-label="Back to library">
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-base">{props.title}</h1>
        <button type="button" className="icon-btn font-serif text-lg" aria-label="Reading settings" onClick={props.onOpenSettings}>
          <span aria-hidden="true">Aa</span>
        </button>
        {props.fullscreen.supported && (
          <button
            type="button"
            className="icon-btn"
            aria-label={props.fullscreen.active ? "Exit full screen" : "Full screen"}
            aria-pressed={props.fullscreen.active}
            onClick={props.fullscreen.toggle}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {props.fullscreen.active ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              )}
            </svg>
          </button>
        )}
      </header>

      <footer
        {...barEvents}
        className={`reader-bar absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 px-2 py-2 transition-opacity motion-reduce:transition-none sm:px-3 ${hiddenClass}`}
        data-testid="bottom-bar"
      >
        <div className="flex items-center">
          <button type="button" className="icon-btn" aria-label="Zoom out" disabled={!props.canZoomOut} onClick={props.onZoomOut}>
            <span aria-hidden="true">−</span>
          </button>
          <span className="w-12 text-center text-sm tabular-nums" aria-live="polite" data-testid="zoom-level">
            {props.zoomPercent}%
          </span>
          <button type="button" className="icon-btn" aria-label="Zoom in" disabled={!props.canZoomIn} onClick={props.onZoomIn}>
            <span aria-hidden="true">+</span>
          </button>
        </div>

        <div className="relative">
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-full px-4 tabular-nums hover:bg-black/5"
            aria-label={`Page ${props.indicator}. Go to page`}
            aria-expanded={goToOpen}
            data-testid="page-indicator"
            onClick={() => setGoTo(!goToOpen)}
          >
            {props.indicator}
          </button>
          {goToOpen && (
            <div className="absolute right-0 bottom-full mb-2">
              <GoToPage
                pageCount={props.pageCount}
                currentPage={props.currentPage}
                onClose={() => setGoTo(false)}
                onGo={(page) => {
                  setGoTo(false);
                  props.onGoTo(page);
                }}
              />
            </div>
          )}
        </div>
      </footer>
    </>
  );
}
