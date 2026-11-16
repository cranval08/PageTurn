import { db, type Progress } from "./schema";

const inFlight = new Set<Promise<void>>();

/** Register a library-visible write so loadLibrary() waits for it. */
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  const settled = write.then(() => undefined);
  inFlight.add(settled);
  void settled.finally(() => inFlight.delete(settled)).catch(() => {});
  return write;
}

export function getProgress(bookId: string): Promise<Progress | undefined> {
  return db.progress.get(bookId);
}

/** PRG-1: save the current page (1-based) and the book's last-opened time. */
export function savePage(bookId: string, page: number, at = Date.now()): Promise<void> {
  const write = db.transaction("rw", db.progress, db.books, async () => {
    const existing = await db.progress.get(bookId);
    await db.progress.put({ bookId, page, updatedAt: at, bookmarks: existing?.bookmarks ?? [] });
    await db.books.update(bookId, { lastOpenedAt: at });
  });
  inFlight.add(write);
  void write.finally(() => inFlight.delete(write)).catch(() => {});
  return write;
}

/**
 * RDR-14: add or remove a bookmark (1-based page). Runs in one transaction with
 * the progress row, so it can't race the debounced page save. Returns the new,
 * sorted list. `currentPage` seeds the row if the book has no progress yet.
 */
export function toggleBookmark(bookId: string, page: number, currentPage: number, at = Date.now()): Promise<number[]> {
  const write = db.transaction("rw", db.progress, async () => {
    const existing = await db.progress.get(bookId);
    const marks = new Set(existing?.bookmarks ?? []);
    if (marks.has(page)) marks.delete(page);
    else marks.add(page);
    const bookmarks = [...marks].sort((a, b) => a - b);
    await db.progress.put({ bookId, page: existing?.page ?? currentPage, updatedAt: at, bookmarks });
    return bookmarks;
  });
  const settled = write.then(() => undefined);
  inFlight.add(settled);
  void settled.finally(() => inFlight.delete(settled)).catch(() => {});
  return write;
}

const PENDING_KEY = "pageturn.pendingProgress";

/**
 * PRG-1 safety net: an IndexedDB write started while the page unloads (reload,
 * tab closed) can be cut off, losing the last page turn. On pagehide the reader
 * also stashes the pending page here, synchronously.
 */
export function stashPendingProgress(bookId: string, page: number, at = Date.now()): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ bookId, page, at }));
  } catch {
    /* storage blocked: the IndexedDB write may still land */
  }
}

/** Fold a stashed page into IndexedDB if it is newer than what was saved. Never throws. */
export async function applyPendingProgress(): Promise<void> {
  let pending: { bookId?: unknown; page?: unknown; at?: unknown } | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
    localStorage.removeItem(PENDING_KEY);
  } catch {
    return;
  }
  if (!pending || typeof pending.bookId !== "string" || !Number.isInteger(pending.page) || typeof pending.at !== "number") return;
  const { bookId, page, at } = pending as { bookId: string; page: number; at: number };
  try {
    const [existing, book] = await Promise.all([db.progress.get(bookId), db.books.get(bookId)]);
    if (book && (!existing || existing.updatedAt < at)) await savePage(bookId, page, at);
  } catch {
    /* best effort */
  }
}

/**
 * Resolves once every progress write started so far has finished. The reader
 * flushes its last save when it unmounts, so the library awaits this before
 * reading to never show a stale page.
 */
export async function whenProgressSaved(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}
