import { db, type Progress } from "./schema";

const inFlight = new Set<Promise<void>>();

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
 * Resolves once every progress write started so far has finished. The reader
 * flushes its last save when it unmounts, so the library awaits this before
 * reading to never show a stale page.
 */
export async function whenProgressSaved(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}
