import { DRIVE_API, DRIVE_UPLOAD_API, USERINFO_URL } from "./config";

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

async function driveFetch(url: string, token: string, fetchImpl: FetchLike, signal?: AbortSignal, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }, signal });
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

// ---- PRG-2: PageTurn's hidden app folder (drive.appdata) -------------------------

export interface AppDataFile {
  id: string;
  modifiedTime?: string;
}

export function parseAppDataList(json: unknown): AppDataFile[] {
  const files = (json as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) throw new DriveError("bad_response", "Google Drive sent an unexpected response.");
  return files
    .filter((f): f is { id: string; modifiedTime?: unknown } => typeof (f as { id?: unknown })?.id === "string")
    .map((f) => ({ id: f.id, modifiedTime: typeof f.modifiedTime === "string" ? f.modifiedTime : undefined }));
}

/** Files named `name` in the app folder, oldest first (two devices may each create one). */
export async function findAppDataFiles(name: string, token: string, fetchImpl: FetchLike = fetch): Promise<AppDataFile[]> {
  const q = `name = '${name.replace(/['\\]/g, "\\$&")}' and trashed = false`;
  const params = new URLSearchParams({ spaces: "appDataFolder", q, fields: "files(id,modifiedTime)", orderBy: "createdTime", pageSize: "10" });
  const res = await driveFetch(`${DRIVE_API}/files?${params}`, token, fetchImpl);
  return parseAppDataList(await res.json());
}

/** Download an app-folder JSON file. Returns null if it isn't valid JSON (treated as empty). */
export async function readAppDataJson(id: string, token: string, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`, token, fetchImpl);
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

/** Create a JSON file in the app folder (multipart upload). Returns its id. */
export async function createAppDataJson(name: string, data: unknown, token: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const boundary = `pageturn-${Math.random().toString(36).slice(2)}`;
  const CRLF = "\r\n";
  const part = (json: unknown) => `--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${JSON.stringify(json)}${CRLF}`;
  const body = part({ name, parents: ["appDataFolder"], mimeType: "application/json" }) + part(data) + `--${boundary}--`;
  const res = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, token, fetchImpl, undefined, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const json = (await res.json()) as { id?: unknown };
  if (typeof json?.id !== "string") throw new DriveError("bad_response", "Google Drive sent an unexpected response.");
  return json.id;
}

/** Replace the contents of an app-folder JSON file. */
export async function updateAppDataJson(id: string, data: unknown, token: string, fetchImpl: FetchLike = fetch): Promise<void> {
  await driveFetch(`${DRIVE_UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, token, fetchImpl, undefined, {
    method: "PATCH",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(data),
  });
}
