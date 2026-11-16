import { useState } from "react";

interface ScrubberProps {
  pageCount: number;
  /** 1-based current page. */
  currentPage: number;
  /** Called once the reader lets go (or after a keyboard step). */
  onCommit(page: number): void;
}

const COMMIT_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** RDR-8: page slider with a live page-number preview while dragging. */
export function Scrubber({ pageCount, currentPage, onCommit }: ScrubberProps) {
  const [preview, setPreview] = useState<number | null>(null);
  if (pageCount < 2) return null;
  const value = preview ?? currentPage;
  const percent = ((value - 1) / (pageCount - 1)) * 100;

  const commit = () => {
    if (preview !== null && preview !== currentPage) onCommit(preview);
    setPreview(null);
  };

  return (
    <div className="relative mx-2 flex min-w-0 flex-1 items-center">
      {preview !== null && (
        <span
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-sm whitespace-nowrap text-paper tabular-nums shadow"
          style={{ left: `${percent}%` }}
          data-testid="scrubber-preview"
          aria-hidden="true"
        >
          p. {preview}
        </span>
      )}
      <input
        type="range"
        min={1}
        max={pageCount}
        step={1}
        value={value}
        aria-label="Page"
        aria-valuetext={`Page ${value} of ${pageCount}`}
        data-testid="scrubber"
        className="pt-scrubber h-11 w-full min-w-0 cursor-pointer accent-accent"
        onChange={(e) => setPreview(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={(e) => {
          if (COMMIT_KEYS.has(e.key)) commit();
        }}
        onBlur={() => setPreview(null)}
      />
    </div>
  );
}
