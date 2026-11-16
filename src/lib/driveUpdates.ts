import type { Book } from "./db/schema";
import { currentToken } from "./google/auth";
import { getDriveFile, type DriveFile } from "./google/drive";

/** DRV-6: is the Drive copy newer than the one stored on this device? */
export function isNewerDriveVersion(localModifiedTime: string | undefined, remoteModifiedTime: string | undefined): boolean {
  if (!localModifiedTime || !remoteModifiedTime) return false;
  const local = Date.parse(localModifiedTime);
  const remote = Date.parse(remoteModifiedTime);
  if (Number.isNaN(local) || Number.isNaN(remote)) return false;
  return remote > local;
}

/** Ask Drive for the file's metadata and report a newer version, if any. */
export async function checkForDriveUpdate(book: Book, token: string): Promise<DriveFile | null> {
  if (book.source !== "drive") return null;
  const remote = await getDriveFile(book.id, token);
  return isNewerDriveVersion(book.driveModifiedTime, remote.modifiedTime) ? remote : null;
}

/**
 * Quiet check when a Drive book is opened: only if a Google token is already in
 * memory (no popups without a click) and the network is up. Never throws.
 */
export async function checkQuietly(book: Book): Promise<DriveFile | null> {
  const token = currentToken();
  if (!token || book.source !== "drive" || !navigator.onLine) return null;
  try {
    return await checkForDriveUpdate(book, token);
  } catch {
    return null;
  }
}
