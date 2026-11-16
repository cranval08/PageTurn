// @vitest-environment node
// Node's Blob is structured-cloneable by fake-indexeddb; jsdom's is not.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCache,
  getBook,
  getBookFile,
  loadLibrary,
  removeBook,
  saveBook,
  storageUsage,
  type NewBook,
} from "../../src/lib/db/books";
import { getProgress, savePage, toggleBookmark } from "../../src/lib/db/progress";
import { db } from "../../src/lib/db/schema";

const book = (id: string, sizeBytes = 1000): NewBook => ({
  id,
  source: "local",
  title: `Book ${id}`,
  pageCount: 50,
  sizeBytes,
  coverDataUrl: "data:image/jpeg;base64,AAAA",
  data: new Blob([new Uint8Array(sizeBytes)], { type: "application/pdf" }),
});

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("books (LIB-1, OFF-1)", () => {
  it("stores metadata and PDF bytes in separate tables", async () => {
    await saveBook(book("local:a", 1234), 100);
    const saved = await getBook("local:a");
    expect(saved).toMatchObject({ id: "local:a", title: "Book local:a", addedAt: 100, lastOpenedAt: 100 });
    expect(saved).not.toHaveProperty("data");
    expect((await getBookFile("local:a"))?.size).toBe(1234);
  });

  it("re-adding keeps addedAt and progress", async () => {
    await saveBook(book("local:a"), 100);
    await savePage("local:a", 20, 150);
    await saveBook(book("local:a"), 200);
    expect(await getBook("local:a")).toMatchObject({ addedAt: 100, lastOpenedAt: 200 });
    expect((await getProgress("local:a"))?.page).toBe(20);
  });

  it("lists books most recently opened first, with progress and cache state", async () => {
    await saveBook(book("local:old"), 100);
    await saveBook(book("local:new"), 300);
    await saveBook(book("local:mid"), 200);
    await savePage("local:old", 7, 400); // reading bumps last-opened
    const lib = await loadLibrary();
    expect(lib.books.map((b) => b.id)).toEqual(["local:old", "local:new", "local:mid"]);
    expect(lib.progress.get("local:old")?.page).toBe(7);
    expect(lib.cached).toEqual(new Set(["local:old", "local:new", "local:mid"]));
  });
});

describe("removeBook (LIB-3)", () => {
  it("deletes the book, its blob and its progress, and frees storage", async () => {
    await saveBook(book("local:a", 5000));
    await saveBook(book("local:b", 3000));
    await savePage("local:a", 10);
    expect(await storageUsage()).toEqual({ bytes: 8000, books: 2 });

    await removeBook("local:a");

    expect(await getBook("local:a")).toBeUndefined();
    expect(await getBookFile("local:a")).toBeUndefined();
    expect(await getProgress("local:a")).toBeUndefined();
    expect(await db.files.count()).toBe(1);
    expect(await storageUsage()).toEqual({ bytes: 3000, books: 1 });
  });
});

describe("clearCache (OFF-1)", () => {
  it("removes all PDF bytes but keeps books and progress", async () => {
    await saveBook(book("local:a", 5000));
    await savePage("local:a", 12);
    await clearCache();
    expect(await storageUsage()).toEqual({ bytes: 0, books: 0 });
    const lib = await loadLibrary();
    expect(lib.books).toHaveLength(1);
    expect(lib.cached.size).toBe(0);
    expect((await getProgress("local:a"))?.page).toBe(12);
  });
});

describe("toggleBookmark (RDR-14)", () => {
  it("adds and removes bookmarks, kept sorted, and the page save keeps them", async () => {
    await saveBook(book("local:a"));
    expect(await toggleBookmark("local:a", 30, 4)).toEqual([30]);
    expect(await toggleBookmark("local:a", 12, 4)).toEqual([12, 30]);
    await savePage("local:a", 20);
    expect(await getProgress("local:a")).toMatchObject({ page: 20, bookmarks: [12, 30] });
    expect(await toggleBookmark("local:a", 30, 20)).toEqual([12]);
    expect((await getProgress("local:a"))?.bookmarks).toEqual([12]);
  });

  it("seeds the progress row with the current page for a book never saved", async () => {
    await saveBook(book("local:b"));
    await toggleBookmark("local:b", 7, 7, 900);
    expect(await getProgress("local:b")).toEqual({ bookId: "local:b", page: 7, updatedAt: 900, bookmarks: [7] });
  });

  it("is removed with the book", async () => {
    await saveBook(book("local:c"));
    await toggleBookmark("local:c", 3, 3);
    await removeBook("local:c");
    expect(await getProgress("local:c")).toBeUndefined();
  });
});

describe("savePage (PRG-1)", () => {
  it("loadLibrary waits for a save that is still in flight", async () => {
    await saveBook(book("local:a"), 100);
    void savePage("local:a", 33, 200); // not awaited, like the reader's flush on unmount
    const lib = await loadLibrary();
    expect(lib.progress.get("local:a")?.page).toBe(33);
  });

  it("saves the page and last-opened time, keeping bookmarks", async () => {
    await saveBook(book("local:a"), 100);
    await db.progress.put({ bookId: "local:a", page: 3, updatedAt: 100, bookmarks: [5, 9] });
    await savePage("local:a", 20, 500);
    expect(await getProgress("local:a")).toEqual({ bookId: "local:a", page: 20, updatedAt: 500, bookmarks: [5, 9] });
    expect((await getBook("local:a"))?.lastOpenedAt).toBe(500);
  });
});
