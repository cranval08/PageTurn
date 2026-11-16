import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyPendingProgress, getProgress, stashPendingProgress } from "../../src/lib/db/progress";
import { db } from "../../src/lib/db/schema";

const addBook = (id: string) =>
  db.books.put({ id, source: "local", title: id, pageCount: 50, sizeBytes: 1, coverDataUrl: "", addedAt: 1, lastOpenedAt: 1 });

beforeEach(async () => {
  localStorage.clear();
  await db.delete();
  await db.open();
});

describe("pending progress safety net (PRG-1)", () => {
  it("applies a page stashed on unload when it is newer than the saved one", async () => {
    await addBook("local:a");
    await db.progress.put({ bookId: "local:a", page: 3, updatedAt: 100, bookmarks: [7] });
    stashPendingProgress("local:a", 9, 200);
    await applyPendingProgress();
    expect(await getProgress("local:a")).toEqual({ bookId: "local:a", page: 9, updatedAt: 200, bookmarks: [7] });
    expect(localStorage.getItem("pageturn.pendingProgress")).toBeNull();
  });

  it("ignores a stale stash, a removed book and junk", async () => {
    await addBook("local:a");
    await db.progress.put({ bookId: "local:a", page: 12, updatedAt: 500, bookmarks: [] });
    stashPendingProgress("local:a", 9, 200);
    await applyPendingProgress();
    expect((await getProgress("local:a"))?.page).toBe(12);

    stashPendingProgress("local:gone", 4, 900);
    await applyPendingProgress();
    expect(await getProgress("local:gone")).toBeUndefined();

    localStorage.setItem("pageturn.pendingProgress", "{not json");
    await expect(applyPendingProgress()).resolves.toBeUndefined();
  });
});
