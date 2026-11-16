import { useEffect, useId, useRef, useState } from "react";
import type { Book } from "../lib/db/schema";
import { progressLabel, progressPercent } from "../lib/format";

interface BookCardProps {
  book: Book;
  /** 1-based saved page, if the book has been read. */
  page?: number;
  /** False when the PDF bytes are no longer on this device. */
  cached: boolean;
  onOpen(book: Book): void;
  onRemove(book: Book): void;
  /** DRV-6: offered for Drive books. Called from a click. */
  onCheckUpdate?(book: Book): void;
}

const LONG_PRESS_MS = 500;

export function SourceIcon({ source }: { source: Book["source"] }) {
  const label = source === "drive" ? "From Google Drive" : "From this device";
  return (
    <span className="inline-flex shrink-0 text-ink-muted" title={label}>
      <span className="sr-only">{label}</span>
      {source === "drive" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3h8l6 10-4 7H6l-4-7z" strokeLinejoin="round" />
          <path d="M8 3l6 10H2M16 3l-6 10M22 13H10l-4 7" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M11 18h2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/** LIB-1 card: cover, title (2 lines), source icon, progress bar; ⋮ menu or long-press (LIB-3). */
export function BookCard({ book, page, cached, onOpen, onRemove, onCheckUpdate }: BookCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const percent = page ? progressPercent(page, book.pageCount) : 0;

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        menuButtonRef.current?.focus();
      } else if (menuRef.current?.contains(e.target as Node)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const startPress = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  };
  const endPress = () => window.clearTimeout(pressTimer.current);

  return (
    <article className="relative flex flex-col" data-testid="book-card" data-book-id={book.id}>
      <button
        type="button"
        className="group flex flex-col text-left"
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onOpen(book);
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        aria-label={`Open ${book.title}, ${progressLabel(page, book.pageCount)}`}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-surface shadow-md ring-1 ring-ink/10 transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none">
          <img
            src={book.coverDataUrl}
            alt=""
            className={`pt-paper h-full w-full object-cover object-top ${cached ? "" : "opacity-50 grayscale"}`}
            decoding="async"
            loading="lazy"
          />
          {!cached && (
            <span className="absolute inset-x-2 bottom-2 rounded bg-black/75 px-2 py-1 text-center text-xs text-white">
              Not on this device
            </span>
          )}
        </div>
        <h3 className="mt-2 line-clamp-2 font-serif text-[0.95rem] leading-snug" title={book.title}>
          {book.title}
        </h3>
      </button>

      <div className="mt-1 flex items-center gap-2">
        <SourceIcon source={book.source} />
        <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-ink-muted" data-testid="book-progress">
          {progressLabel(page, book.pageCount)}
        </span>
        <button
          ref={menuButtonRef}
          type="button"
          className="-mr-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-ink-muted hover:bg-ink/10"
          aria-label={`More actions for ${book.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden="true">⋮</span>
        </button>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-ink/10"
        role="progressbar"
        aria-label={`Reading progress for ${book.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${book.title}`}
          className="absolute right-0 bottom-8 z-30 min-w-48 rounded-lg bg-surface py-1 shadow-xl ring-1 ring-ink/15"
        >
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setMenuOpen(false);
              onOpen(book);
            }}
          >
            Open
          </button>
          {book.source === "drive" && onCheckUpdate && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                onCheckUpdate(book);
              }}
            >
              Check Drive for update
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-item text-danger"
            onClick={() => {
              setMenuOpen(false);
              onRemove(book);
            }}
          >
            Remove from library
          </button>
        </div>
      )}
    </article>
  );
}
