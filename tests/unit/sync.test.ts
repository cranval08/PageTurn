// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { saveBook, type NewBook } from "../../src/lib/db/books";
import { getProgress, savePage, toggleBookmark } from "../../src/lib/db/progress";
import { db } from "../../src/lib/db/schema";
import { DriveError } from "../../src/lib/google/drive";
import { syncProgress } from "../../src/lib/sync/sync";

/** A tiny in-memory Drive app folder speaking the REST calls drive.ts makes. */
function fakeDrive() {
  const files = new Map<string, { name: string; body: string; created: number }>();
  const calls: string[] = [];
  let n = 0;
  let status = 200;
  const json = (data: unknown, s = 200) => new Response(JSON.stringify(data), { status: s, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if ((init.headers as Record<string, string>)?.Authorization !== "Bearer tok") return json({}, 401);
    if (status !== 200) return json({}, status);
    if (url.pathname === "/drive/v3/files") {
      expect(url.searchParams.get("spaces")).toBe("appDataFolder");
      const list = [...files.entries()].sort((a, b) => a[1].created - b[1].created).map(([id]) => ({ id }));
      return json({ files: list });
    }
    if (url.pathname.startsWith("/drive/v3/files/")) {
      const f = files.get(url.pathname.split("/").pop()!);
      return f ? new Response(f.body) : json({}, 404);
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      const body = String(init.body);
      const parts = [...body.matchAll(/\r\n\r\n(.*?)\r\n/g)].map((m) => m[1]);
      const meta = JSON.parse(parts[0]);
      expect(meta).toMatchObject({ name: "progress.json", parents: ["appDataFolder"] });
      const id = `f${++n}`;
      files.set(id, { name: meta.name, body: parts[1], created: n });
      return json({ id });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files/") && method === "PATCH") {
      const f = files.get(url.pathname.split("/").pop()!)!;
      f.body = String(init.body);
      return json({ id: "ok" });
    }
    return json({}, 400);
  }) as typeof fetch;
  return {
    files,
    calls,
    fetchImpl,
    fail: (s: number) => (status = s),
    put: (body: unknown) => files.set(`f${++n}`, { name: "progress.json", body: JSON.stringify(body), created: n }),
    read: (id = "f1") => JSON.parse(files.get(id)!.body),
  };
}

const book = (id: string): NewBook => ({
  id,
  source: "drive",
  title: id,
  pageCount: 100,
  sizeBytes: 10,
  coverDataUrl: "data:,",
  data: new Blob([new Uint8Array(10)]),
});

let drive: ReturnType<typeof fakeDrive>;

beforeEach(async () => {
  await db.delete();
  await db.open();
  drive = fakeDrive();
});

describe("PRG-2: syncing progress through the Drive app folder", () => {
  it("creates progress.json on the first sync with this device's pages and bookmarks", async () => {
    await saveBook(book("bio"), 1);
    await savePage("bio", 50, 1000);
    await toggleBookmark("bio", 12, 50, 1001);
    const out = await syncProgress("tok", drive.fetchImpl);
    expect(out).toEqual({ changed: [], uploaded: true });
    expect(drive.read()).toEqual({ version: 1, books: { bio: { page: 50, updatedAt: 1001, bookmarks: [12] } } });
  });

  it("laptop → phone: a book read on another device opens at that page here, even if it is added afterwards", async () => {
    drive.put({ version: 1, books: { bio: { page: 50, updatedAt: 5000, bookmarks: [7] } } });
    const out = await syncProgress("tok", drive.fetchImpl);
    expect(out.changed).toEqual(["bio"]);
    expect(out.uploaded).toBe(false);
    // The phone imports the Drive book later; saveBook keeps the synced progress.
    await saveBook(book("bio"), 6000);
    expect(await getProgress("bio")).toEqual({ bookId: "bio", page: 50, updatedAt: 5000, bookmarks: [7] });
  });

  it("newer remote progress replaces older local progress and moves 'last opened' forward", async () => {
    await saveBook(book("bio"), 1);
    await savePage("bio", 3, 100);
    drive.put({ version: 1, books: { bio: { page: 80, updatedAt: 900, bookmarks: [] } } });
    await syncProgress("tok", drive.fetchImpl);
    expect((await getProgress("bio"))?.page).toBe(80);
    expect((await db.books.get("bio"))?.lastOpenedAt).toBe(900);
  });

  it("newer local progress is uploaded, never overwritten", async () => {
    await saveBook(book("bio"), 1);
    await savePage("bio", 60, 2000);
    drive.put({ version: 1, books: { bio: { page: 10, updatedAt: 1000, bookmarks: [] }, other: { page: 4, updatedAt: 5, bookmarks: [] } } });
    const out = await syncProgress("tok", drive.fetchImpl);
    expect(out.uploaded).toBe(true);
    expect((await getProgress("bio"))?.page).toBe(60);
    expect(drive.read().books).toEqual({ bio: { page: 60, updatedAt: 2000, bookmarks: [] }, other: { page: 4, updatedAt: 5, bookmarks: [] } });
    expect(drive.calls).toContain("PATCH /upload/drive/v3/files/f1");
  });

  it("a second sync with nothing new makes no upload", async () => {
    await saveBook(book("bio"), 1);
    await savePage("bio", 5, 10);
    await syncProgress("tok", drive.fetchImpl);
    drive.calls.length = 0;
    expect(await syncProgress("tok", drive.fetchImpl)).toEqual({ changed: [], uploaded: false });
    expect(drive.calls.some((c) => c.includes("/upload/"))).toBe(false);
  });

  it("folds duplicate files (two devices' first syncs) into the oldest", async () => {
    drive.put({ version: 1, books: { a: { page: 2, updatedAt: 2, bookmarks: [] } } });
    drive.put({ version: 1, books: { b: { page: 9, updatedAt: 3, bookmarks: [] } } });
    await syncProgress("tok", drive.fetchImpl);
    expect(Object.keys(drive.read("f1").books).sort()).toEqual(["a", "b"]);
    expect((await getProgress("b"))?.page).toBe(9);
  });

  it("an unreadable remote file is treated as empty and rewritten", async () => {
    drive.files.set("f1", { name: "progress.json", body: "{not json", created: 0 });
    await saveBook(book("bio"), 1);
    await savePage("bio", 5, 10);
    await syncProgress("tok", drive.fetchImpl);
    expect(drive.read().books.bio.page).toBe(5);
  });

  it("Drive errors surface as DriveError (401 → auth) and change nothing locally", async () => {
    await saveBook(book("bio"), 1);
    await savePage("bio", 5, 10);
    await expect(syncProgress("bad", drive.fetchImpl)).rejects.toMatchObject({ kind: "auth" });
    drive.fail(503);
    await expect(syncProgress("tok", drive.fetchImpl)).rejects.toBeInstanceOf(DriveError);
    expect((await getProgress("bio"))?.page).toBe(5);
  });
});
