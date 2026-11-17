import type { Progress } from "../db/schema";

/**
 * PRG-2: the file PageTurn keeps in the user's hidden Drive app folder.
 * One entry per book id (Drive fileId, or "local:" + SHA-256 of the bytes).
 * No titles or file contents: only page numbers, bookmarks and times.
 */
export const SYNC_FILE_NAME = "progress.json";

export interface SyncEntry {
  /** 1-based, left page of a spread (same as Progress.page). */
  page: number;
  updatedAt: number;
  bookmarks: number[];
}

export interface SyncDoc {
  version: 1;
  books: Record<string, SyncEntry>;
}

export const emptySyncDoc = (): SyncDoc => ({ version: 1, books: {} });

const isPage = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;

function parseEntry(raw: unknown): SyncEntry | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || !isPage(o.page) || typeof o.updatedAt !== "number" || !Number.isFinite(o.updatedAt)) return null;
  const marks = Array.isArray(o.bookmarks) ? o.bookmarks.filter(isPage) : [];
  return { page: o.page, updatedAt: o.updatedAt, bookmarks: [...new Set(marks)].sort((a, b) => a - b) };
}

/** Tolerant parse: anything unreadable becomes an empty doc; bad entries are dropped. */
export function parseSyncDoc(json: unknown): SyncDoc {
  const books = (json as { books?: unknown } | null)?.books;
  const doc = emptySyncDoc();
  if (!books || typeof books !== "object" || Array.isArray(books)) return doc;
  for (const [id, raw] of Object.entries(books)) {
    const entry = parseEntry(raw);
    if (entry && id) doc.books[id] = entry;
  }
  return doc;
}

export const toEntry = (p: Progress): SyncEntry => ({ page: p.page, updatedAt: p.updatedAt, bookmarks: [...p.bookmarks] });

const sameEntry = (a: SyncEntry, b: SyncEntry) =>
  a.page === b.page && a.updatedAt === b.updatedAt && a.bookmarks.length === b.bookmarks.length && a.bookmarks.every((m, i) => m === b.bookmarks[i]);

export interface MergeResult {
  /** What both sides should hold afterwards. */
  merged: SyncDoc;
  /** Entries where the remote copy is newer: write these to this device. */
  toLocal: Map<string, SyncEntry>;
  /** The remote file is missing something newer from this device: upload `merged`. */
  remoteChanged: boolean;
}

/**
 * Last-write-wins per book on `updatedAt`. On a tie the remote copy stays (no
 * pointless writes either way). Books only on one side are kept.
 */
export function mergeProgress(local: Progress[], remote: SyncDoc): MergeResult {
  const merged: SyncDoc = { version: 1, books: { ...remote.books } };
  const toLocal = new Map<string, SyncEntry>();
  let remoteChanged = false;
  const localIds = new Set<string>();
  for (const row of local) {
    localIds.add(row.bookId);
    const mine = toEntry(row);
    const theirs = remote.books[row.bookId];
    if (!theirs || mine.updatedAt > theirs.updatedAt) {
      merged.books[row.bookId] = mine;
      remoteChanged = true;
    } else if (!sameEntry(mine, theirs)) {
      toLocal.set(row.bookId, theirs);
    }
  }
  for (const [id, theirs] of Object.entries(remote.books)) {
    if (!localIds.has(id)) toLocal.set(id, theirs);
  }
  return { merged, toLocal, remoteChanged };
}

/** Combine several remote files (two devices may have created one each at the same time). */
export function combineDocs(docs: SyncDoc[]): SyncDoc {
  const out = emptySyncDoc();
  for (const doc of docs) {
    for (const [id, entry] of Object.entries(doc.books)) {
      const have = out.books[id];
      if (!have || entry.updatedAt > have.updatedAt) out.books[id] = entry;
    }
  }
  return out;
}
