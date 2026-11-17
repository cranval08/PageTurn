import { trackWrite, whenProgressSaved } from "../db/progress";
import { db } from "../db/schema";
import { createAppDataJson, findAppDataFiles, readAppDataJson, updateAppDataJson } from "../google/drive";
import { combineDocs, mergeProgress, parseSyncDoc, SYNC_FILE_NAME, type SyncEntry } from "./syncDoc";

type FetchLike = typeof fetch;

export interface SyncOutcome {
  /** Book ids whose page or bookmarks were updated on this device. */
  changed: string[];
  /** This device's progress was uploaded. */
  uploaded: boolean;
}

/**
 * Write newer remote entries to IndexedDB. Rows for books not in this library are
 * kept too, so adding that Drive book later opens it at the synced page. A row
 * written locally while the network round-trip ran is never overwritten.
 */
function applyRemote(entries: Map<string, SyncEntry>): Promise<string[]> {
  if (entries.size === 0) return Promise.resolve([]);
  const write = db.transaction("rw", db.progress, db.books, async () => {
    const changed: string[] = [];
    for (const [bookId, entry] of entries) {
      const current = await db.progress.get(bookId);
      if (current && current.updatedAt > entry.updatedAt) continue;
      await db.progress.put({ bookId, page: entry.page, updatedAt: entry.updatedAt, bookmarks: entry.bookmarks });
      // "Last opened" follows reading on any device (Continue reading strip).
      const book = await db.books.get(bookId);
      if (book && book.lastOpenedAt < entry.updatedAt) await db.books.update(bookId, { lastOpenedAt: entry.updatedAt });
      changed.push(bookId);
    }
    return changed;
  });
  return trackWrite(write);
}

/**
 * PRG-2: one round of progress sync with `progress.json` in the Drive app folder:
 * download, merge last-write-wins per book, save what's newer here, upload what's
 * newer from here. Throws DriveError.
 */
export async function syncProgress(token: string, fetchImpl: FetchLike = fetch): Promise<SyncOutcome> {
  await whenProgressSaved();
  const files = await findAppDataFiles(SYNC_FILE_NAME, token, fetchImpl);
  const docs = await Promise.all(files.map(async (f) => parseSyncDoc(await readAppDataJson(f.id, token, fetchImpl))));
  const remote = combineDocs(docs);
  const local = await db.progress.toArray();
  const { merged, toLocal, remoteChanged } = mergeProgress(local, remote);
  const changed = await applyRemote(toLocal);

  // Two devices may each have created the file on their first sync: fold them into the oldest.
  const upload = remoteChanged || (files.length > 1 && Object.keys(merged.books).length > 0);
  if (upload) {
    if (files[0]) await updateAppDataJson(files[0].id, merged, token, fetchImpl);
    else await createAppDataJson(SYNC_FILE_NAME, merged, token, fetchImpl);
  }
  return { changed, uploaded: upload };
}
