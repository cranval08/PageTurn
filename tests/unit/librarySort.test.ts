import { describe, expect, it } from "vitest";
import type { Book } from "../../src/lib/db/schema";
import { loadSort, saveSort, sortAndFilter } from "../../src/lib/librarySort";

const book = (id: string, title: string, addedAt: number, lastOpenedAt: number): Book => ({
  id,
  source: "local",
  title,
  pageCount: 10,
  sizeBytes: 1,
  coverDataUrl: "",
  addedAt,
  lastOpenedAt,
});

const books = [
  book("a", "Chapter 10 – Évolution", 1, 30),
  book("b", "chapter 2 genetics", 3, 10),
  book("c", "Organic Chemistry", 2, 20),
];
const ids = (list: Book[]) => list.map((b) => b.id);

describe("library sort and search (LIB-2)", () => {
  it("sorts by last opened (default), title (natural, case-insensitive) and date added", () => {
    expect(ids(sortAndFilter(books, "recent", ""))).toEqual(["a", "c", "b"]);
    expect(ids(sortAndFilter(books, "title", ""))).toEqual(["b", "a", "c"]); // 2 before 10
    expect(ids(sortAndFilter(books, "added", ""))).toEqual(["b", "c", "a"]);
  });

  it("searches titles ignoring case, accents and word order", () => {
    expect(ids(sortAndFilter(books, "recent", "evolution"))).toEqual(["a"]);
    expect(ids(sortAndFilter(books, "recent", "GENETICS chapter"))).toEqual(["b"]);
    expect(ids(sortAndFilter(books, "title", "chapter"))).toEqual(["b", "a"]);
    expect(sortAndFilter(books, "recent", "physics")).toEqual([]);
    expect(ids(sortAndFilter(books, "recent", "   "))).toEqual(["a", "c", "b"]);
  });

  it("never mutates the input", () => {
    const copy = [...books];
    sortAndFilter(books, "title", "");
    expect(books).toEqual(copy);
  });

  it("remembers the chosen sort, defaulting to last opened", () => {
    localStorage.clear();
    expect(loadSort()).toBe("recent");
    saveSort("title");
    expect(loadSort()).toBe("title");
    localStorage.setItem("pageturn.librarySort", "bogus");
    expect(loadSort()).toBe("recent");
  });
});
