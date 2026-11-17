import { useCallback, useRef, useState } from "react";
import type { ImportItem } from "../components/ImportPanel";
import { importDriveFile } from "../lib/addDriveBook";
import type { Book } from "../lib/db/schema";
import { NotPdfError } from "../lib/files";
import { DriveError } from "../lib/google/drive";
import type { PickedFile } from "../lib/google/picker";
import { PdfOpenError } from "../lib/pdf/loader";
import { useAuth } from "../store/auth";
import { syncWithin } from "../store/sync";

/** PRG-2: how long a finished import waits for progress from other devices before opening. */
const IMPORT_SYNC_WAIT_MS = 4_000;

function messageFor(err: unknown): string {
  if (err instanceof NotPdfError || err instanceof PdfOpenError || err instanceof DriveError) return err.message;
  console.error(err);
  return "Couldn't add this file. Try again.";
}

/**
 * Runs Drive imports one at a time and tracks per-file progress and errors.
 * `onFinished(added, autoOpen)`: autoOpen is true only when the batch is a single
 * file that was added (open it straight away). Retrying one file of a larger batch
 * never navigates away from the others.
 */
export function useDriveImport(onFinished: (added: Book[], autoOpen: boolean) => void) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const patch = useCallback((key: string, p: Partial<ImportItem>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const run = useCallback(
    async (targets: ImportItem[], token: string, autoOpen: boolean) => {
      const added: Book[] = [];
      for (const item of targets) {
        patch(item.key, { status: "downloading", loaded: 0, error: undefined, authError: false });
        try {
          const book = await importDriveFile(item.file, token, (stage, loaded, total) =>
            patch(item.key, { status: stage, loaded, total }),
          );
          patch(item.key, { status: "done" });
          added.push(book);
        } catch (err) {
          const authError = err instanceof DriveError && err.kind === "auth";
          if (authError) useAuth.getState().markExpired();
          patch(item.key, { status: "error", error: messageFor(err), authError });
        }
      }
      // PRG-2: pull progress from other devices first, so the book opens at the synced page.
      if (added.length > 0) await syncWithin(IMPORT_SYNC_WAIT_MS, token);
      onFinishedRef.current(added, autoOpen && added.length === 1);
    },
    [patch],
  );

  const start = useCallback(
    (files: PickedFile[], token: string, options: { autoOpen?: boolean } = {}) => {
      const fresh: ImportItem[] = files.map((file, i) => ({
        key: `${file.id}:${Date.now()}:${i}`,
        file,
        status: "queued",
        loaded: 0,
        total: file.sizeBytes ?? 0,
      }));
      setItems(fresh);
      void run(fresh, token, options.autoOpen ?? fresh.length === 1);
    },
    [run],
  );

  /** Call from a click: may need to re-open the Google popup (DRV-4). */
  const retry = useCallback(
    (item: ImportItem) => {
      useAuth
        .getState()
        .driveToken()
        .then((token) => run([item], token, itemsRef.current.length === 1))
        .catch(() => {
          /* shown by the auth banner */
        });
    },
    [run],
  );

  const dismiss = useCallback(() => setItems([]), []);

  return { items, start, retry, dismiss };
}
