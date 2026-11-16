import { DRIVE_API, USERINFO_URL } from "./config";

export type DriveErrorKind = "auth" | "not_found" | "forbidden" | "network" | "server" | "bad_response";

export class DriveError extends Error {
  readonly kind: DriveErrorKind;
  readonly status: number;
  constructor(kind: DriveErrorKind, message: string, status = 0) {
    super(message);
    this.name = "DriveError";
    this.kind = kind;
    this.status = status;
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  modifiedTime?: string;
}

export interface GoogleUser {
  name: string;
  email: string;
  picture?: string;
}

type FetchLike = typeof fetch;

/** Parse a Drive v3 `files` resource. Throws on missing fields (unit-tested). */
export function parseDriveFile(json: unknown): DriveFile {
  const o = json as Record<string, unknown> | null;
  if (!o || typeof o.id !== "string" || typeof o.name !== "string" || typeof o.mimeType !== "string") {
    throw new DriveError("bad_response", "Google Drive sent an unexpected response.");
  }
  const size = o.size === undefined ? undefined : Number(o.size);
  return {
    id: o.id,
    name: o.name,
    mimeType: o.mimeType,
    sizeBytes: size !== undefined && Number.isFinite(size) ? size : undefined,
    modifiedTime: typeof o.modifiedTime === "string" ? o.modifiedTime : undefined,
  };
}

export function parseUserInfo(json: unknown): GoogleUser {
  const o = json as Record<string, unknown> | null;
  if (!o || typeof o.email !== "string") throw new DriveError("bad_response", "Google sent an unexpected profile.");
  return {
    email: o.email,
    name: typeof o.name === "string" && o.name ? o.name : o.email,
    picture: typeof o.picture === "string" ? o.picture : undefined,
  };
}

/** Map an HTTP failure to a user-facing DriveError. */
export function driveErrorFor(status: number): DriveError {
  if (status === 401) return new DriveError("auth", "Your Google session expired. Sign in again to continue.", status);
  if (status === 404) return new DriveError("not_found", "This file is no longer in Drive, or PageTurn can't access it.", status);
  if (status === 403 || status === 429) {
    return new DriveError("forbidden", "Google Drive refused the request (too many requests or no access). Try again shortly.", status);
  }
  if (status >= 500) return new DriveError("server", "Google Drive had a problem. Try again.", status);
  return new DriveError("bad_response", `Google Drive returned an error (${status}).`, status);
}

async function driveFetch(url: string, token: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new DriveError("network", "Couldn't reach Google Drive. Check your connection.");
  }
  if (!res.ok) throw driveErrorFor(res.status);
  return res;
}

export async function getDriveFile(id: string, token: string, fetchImpl: FetchLike = fetch): Promise<DriveFile> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true`;
  const res = await driveFetch(url, token, fetchImpl);
  return parseDriveFile(await res.json());
}

export async function getUserInfo(token: string, fetchImpl: FetchLike = fetch): Promise<GoogleUser> {
  const res = await driveFetch(USERINFO_URL, token, fetchImpl);
  return parseUserInfo(await res.json());
}

export interface DownloadOptions {
  /** Bytes from metadata, used when the response has no Content-Length. */
  expectedBytes?: number;
  onProgress?(loaded: number, total: number): void;
  signal?: AbortSignal;
}

/** DRV-3: download file bytes with `files.get?alt=media`, reporting progress. */
export async function downloadDriveFile(id: string, token: string, opts: DownloadOptions = {}, fetchImpl: FetchLike = fetch): Promise<Blob> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
  const res = await driveFetch(url, token, fetchImpl, opts.signal);
  const total = Number(res.headers.get("Content-Length")) || opts.expectedBytes || 0;
  if (!res.body) {
    const blob = await res.blob();
    opts.onProgress?.(blob.size, total || blob.size);
    return new Blob([blob], { type: "application/pdf" });
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      opts.onProgress?.(loaded, total);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new DriveError("network", "The download was interrupted. Check your connection and retry.");
  }
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
