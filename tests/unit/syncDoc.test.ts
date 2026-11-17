import { describe, expect, it } from "vitest";
import type { Progress } from "../../src/lib/db/schema";
import { combineDocs, emptySyncDoc, mergeProgress, parseSyncDoc, type SyncDoc } from "../../src/lib/sync/syncDoc";

const row = (bookId: string, page: number, updatedAt: number, bookmarks: number[] = []): Progress => ({ bookId, page, updatedAt, bookmarks });
const doc = (books: SyncDoc["books"]): SyncDoc => ({ version: 1, books });

describe("PRG-2: progress.json parsing", () => {
  it("reads valid entries and sorts/dedupes bookmarks", () => {
    expect(parseSyncDoc({ version: 1, books: { a: { page: 12, updatedAt: 5, bookmarks: [9, 3, 3] } } })).toEqual(
      doc({ a: { page: 12, updatedAt: 5, bookmarks: [3, 9] } }),
    );
  });

  it("turns anything unreadable into an empty doc and drops bad entries", () => {
    for (const bad of [null, "x", 42, [], { books: [] }, { books: "no" }]) expect(parseSyncDoc(bad)).toEqual(emptySyncDoc());
    expect(
      parseSyncDoc({
        books: {
          ok: { page: 2, updatedAt: 1 },
          zero: { page: 0, updatedAt: 1 },
          frac: { page: 1.5, updatedAt: 1 },
          noTime: { page: 3 },
          badMarks: { page: 4, updatedAt: 1, bookmarks: [1, "2", -1, 7] },
        },
      }),
    ).toEqual(doc({ ok: { page: 2, updatedAt: 1, bookmarks: [] }, badMarks: { page: 4, updatedAt: 1, bookmarks: [1, 7] } }));
  });
});

describe("PRG-2: last-write-wins merge per book", () => {
  it("uploads books the remote doesn't have", () => {
    const r = mergeProgress([row("a", 50, 100)], emptySyncDoc());
    expect(r.remoteChanged).toBe(true);
    expect(r.toLocal.size).toBe(0);
    expect(r.merged.books.a).toEqual({ page: 50, updatedAt: 100, bookmarks: [] });
  });

  it("the newer side wins, per book", () => {
    const r = mergeProgress(
      [row("laptop-newer", 50, 200, [4]), row("phone-newer", 3, 100)],
      doc({ "laptop-newer": { page: 10, updatedAt: 150, bookmarks: [] }, "phone-newer": { page: 80, updatedAt: 300, bookmarks: [2] } }),
    );
    expect(r.merged.books["laptop-newer"]).toEqual({ page: 50, updatedAt: 200, bookmarks: [4] });
    expect(r.merged.books["phone-newer"]).toEqual({ page: 80, updatedAt: 300, bookmarks: [2] });
    expect([...r.toLocal.keys()]).toEqual(["phone-newer"]);
    expect(r.remoteChanged).toBe(true);
  });

  it("keeps remote-only books and hands them to this device (opening that book later lands on the synced page)", () => {
    const r = mergeProgress([], doc({ other: { page: 50, updatedAt: 9, bookmarks: [] } }));
    expect(r.toLocal.get("other")?.page).toBe(50);
    expect(r.remoteChanged).toBe(false);
    expect(r.merged.books.other.page).toBe(50);
  });

  it("does nothing when both sides already agree", () => {
    const r = mergeProgress([row("a", 7, 10, [1])], doc({ a: { page: 7, updatedAt: 10, bookmarks: [1] } }));
    expect(r.remoteChanged).toBe(false);
    expect(r.toLocal.size).toBe(0);
  });

  it("on a timestamp tie with different data, the remote copy stays and is applied here", () => {
    const r = mergeProgress([row("a", 7, 10)], doc({ a: { page: 9, updatedAt: 10, bookmarks: [] } }));
    expect(r.remoteChanged).toBe(false);
    expect(r.toLocal.get("a")?.page).toBe(9);
  });
});

describe("PRG-2: combining duplicate files", () => {
  it("keeps the newest entry for each book", () => {
    expect(
      combineDocs([
        doc({ a: { page: 1, updatedAt: 1, bookmarks: [] }, b: { page: 5, updatedAt: 9, bookmarks: [] } }),
        doc({ a: { page: 2, updatedAt: 2, bookmarks: [] } }),
      ]),
    ).toEqual(doc({ a: { page: 2, updatedAt: 2, bookmarks: [] }, b: { page: 5, updatedAt: 9, bookmarks: [] } }));
  });
});
