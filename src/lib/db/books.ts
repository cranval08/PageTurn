import { whenProgressSaved } from "./progress";
import { db, type Book, type Progress } from "./schema";

export interface NewBook {
  id: string;
  source: Book["source"];
  title: string;
  pageCount: number;
  sizeBytes: number;
  coverDataUrl: string;
  driveModifiedTime?: string;
  data: Blob;
}

/**
 * OFF-1: store (or refresh) a book and its PDF bytes. Re-adding an existing
 * book keeps its addedAt date and its reading progress.
 */
export async function saveBook(input: NewBook, now = Date.now()): Promise<Book> {
  return db.transaction("rw", db.books, db.files, async () => {
    const existing = await db.books.get(input.id);
    const { data, ...meta } = input;
    const book: Book = { ...meta, addedAt: existing?.addedAt ?? now, lastOpenedAt: now };
    await db.books.put(book);
    await db.files.put({ bookId: input.id, data });
    return book;
  });
}

export function getBook(id: string): Promise<Book | undefined> {
  return db.books.get(id);
}

export async function getBookFile(id: string): Promise<Blob | undefined> {
  return (await db.files.get(id))?.data;
}

export function markOpened(id: string, at = Date.now()): Promise<number> {
  return db.books.update(id, { lastOpenedAt: at });
}

/** LIB-3: delete the local copy, its bytes and its progress. Never touches Drive. */
export async function removeBook(id: string): Promise<void> {
  await db.transaction("rw", db.books, db.files, db.progress, async () => {
    await db.books.delete(id);
    await db.files.delete(id);
    await db.progress.delete(id);
  });
}

export interface LibraryData {
  /** Most recently opened first. */
  books: Book[];
  progress: Map<string, Progress>;
  /** Ids of books whose PDF bytes are on this device. */
  cached: Set<string>;
}

export async function loadLibrary(): Promise<LibraryData> {
  await whenProgressSaved();
  const [books, progress, cachedIds] = await Promise.all([
    db.books.orderBy("lastOpenedAt").reverse().toArray(),
    db.progress.toArray(),
    db.files.toCollection().primaryKeys(),
  ]);
  return {
    books,
    progress: new Map(progress.map((p) => [p.bookId, p])),
    cached: new Set(cachedIds),
  };
}

export interface StorageUsage {
  bytes: number;
  books: number;
}

/** OFF-1: bytes of PDFs stored on this device (exact, from book sizes). */
export async function storageUsage(): Promise<StorageUsage> {
  const ids = await db.files.toCollection().primaryKeys();
  const books = await db.books.bulkGet(ids);
  const bytes = books.reduce((sum, b) => sum + (b?.sizeBytes ?? 0), 0);
  return { bytes, books: ids.length };
}

/**
 * OFF-1 "Clear cache": delete every stored PDF but keep the library entries and
 * reading progress. Drive books re-download on demand; local books need the file again.
 */
export async function clearCache(): Promise<void> {
  await db.files.clear();
}
