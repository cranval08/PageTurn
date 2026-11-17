import { describe, expect, it, vi } from "vitest";
import { SCOPE_STRING, SCOPES } from "../../src/lib/google/config";
import {
  DriveError,
  downloadDriveFile,
  driveErrorFor,
  getDriveFile,
  parseDriveFile,
  parseUserInfo,
  createAppDataJson,
  findAppDataFiles,
  parseAppDataList,
  updateAppDataJson,
} from "../../src/lib/google/drive";

describe("OAuth scopes (PRD: drive.file, drive.appdata from Phase 6, profile)", () => {
  it("requests exactly drive.file, drive.appdata, openid, email, profile", () => {
    expect([...SCOPES]).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.appdata",
      "openid",
      "email",
      "profile",
    ]);
    expect(SCOPE_STRING).toBe("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata openid email profile");
  });

  it("never requests full or restricted Drive scopes", () => {
    for (const scope of SCOPES) {
      expect(scope).not.toMatch(/auth\/drive$/);
      expect(scope).not.toMatch(/drive\.readonly|drive\.metadata/);
    }
  });
});

describe("Drive response parsing", () => {
  it("parses a files resource, converting size to a number", () => {
    expect(
      parseDriveFile({ id: "abc", name: "Notes.pdf", mimeType: "application/pdf", size: "12345", modifiedTime: "2026-11-01T10:00:00.000Z" }),
    ).toEqual({ id: "abc", name: "Notes.pdf", mimeType: "application/pdf", sizeBytes: 12345, modifiedTime: "2026-11-01T10:00:00.000Z" });
  });

  it("tolerates missing optional fields", () => {
    expect(parseDriveFile({ id: "a", name: "n", mimeType: "application/pdf" })).toEqual({
      id: "a",
      name: "n",
      mimeType: "application/pdf",
      sizeBytes: undefined,
      modifiedTime: undefined,
    });
  });

  it("rejects malformed responses", () => {
    expect(() => parseDriveFile({ name: "x" })).toThrow(DriveError);
    expect(() => parseDriveFile(null)).toThrow(DriveError);
  });

  it("parses userinfo, falling back to email for the name", () => {
    expect(parseUserInfo({ name: "Ada", email: "ada@example.com", picture: "https://x/p.png" })).toEqual({
      name: "Ada",
      email: "ada@example.com",
      picture: "https://x/p.png",
    });
    expect(parseUserInfo({ email: "b@example.com" }).name).toBe("b@example.com");
  });

  it("maps HTTP errors to clear kinds", () => {
    expect(driveErrorFor(401).kind).toBe("auth");
    expect(driveErrorFor(403).kind).toBe("forbidden");
    expect(driveErrorFor(404).kind).toBe("not_found");
    expect(driveErrorFor(503).kind).toBe("server");
  });
});

function streamResponse(chunks: number[], headers: Record<string, string> = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const n of chunks) controller.enqueue(new Uint8Array(n));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers });
}

describe("downloadDriveFile (DRV-3)", () => {
  it("uses files.get alt=media with the bearer token and reports progress", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([1000, 2000, 3000], { "Content-Length": "6000" }));
    const progress: [number, number][] = [];
    const blob = await downloadDriveFile("file/1", "tok", { onProgress: (l, t) => progress.push([l, t]) }, fetchMock);
    expect(blob.size).toBe(6000);
    expect(blob.type).toBe("application/pdf");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/drive/v3/files/file%2F1?alt=media&supportsAllDrives=true");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
    expect(progress).toEqual([
      [1000, 6000],
      [3000, 6000],
      [6000, 6000],
    ]);
  });

  it("falls back to the metadata size when Content-Length is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([500]));
    const progress: number[] = [];
    await downloadDriveFile("x", "tok", { expectedBytes: 500, onProgress: (_l, t) => progress.push(t) }, fetchMock);
    expect(progress).toEqual([500]);
  });

  it("throws an auth error on 401 (DRV-4)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(downloadDriveFile("x", "old", {}, fetchMock)).rejects.toMatchObject({ kind: "auth" });
  });

  it("throws a network error when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(getDriveFile("x", "tok", fetchMock)).rejects.toMatchObject({ kind: "network" });
  });
});

describe("PRG-2: Drive app folder (drive.appdata)", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("lists progress.json in the appDataFolder space only, oldest first", async () => {
    const fetchImpl = vi.fn(async () => ok({ files: [{ id: "f1", modifiedTime: "t" }, { nope: 1 }] }));
    expect(await findAppDataFiles("progress.json", "tok", fetchImpl as unknown as typeof fetch)).toEqual([{ id: "f1", modifiedTime: "t" }]);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/drive/v3/files");
    expect(url.searchParams.get("spaces")).toBe("appDataFolder");
    expect(url.searchParams.get("q")).toBe("name = 'progress.json' and trashed = false");
    expect(url.searchParams.get("orderBy")).toBe("createdTime");
  });

  it("escapes quotes in the file name query", async () => {
    const fetchImpl = vi.fn(async () => ok({ files: [] }));
    await findAppDataFiles("it's.json", "tok", fetchImpl as unknown as typeof fetch);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("q")).toBe("name = 'it\\'s.json' and trashed = false");
  });

  it("rejects a list response without files", () => {
    expect(() => parseAppDataList({})).toThrow(DriveError);
  });

  it("creates the file inside appDataFolder with a multipart upload", async () => {
    const fetchImpl = vi.fn(async () => ok({ id: "new" }));
    expect(await createAppDataJson("progress.json", { version: 1, books: {} }, "tok", fetchImpl as unknown as typeof fetch)).toBe("new");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    const boundary = /boundary=(.+)$/.exec(headers["Content-Type"])![1];
    const body = String(init.body);
    expect(body.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(body.endsWith(`--${boundary}--`)).toBe(true);
    expect(body).toContain('{"name":"progress.json","parents":["appDataFolder"],"mimeType":"application/json"}');
    expect(body).toContain('{"version":1,"books":{}}');
  });

  it("updates the contents with a media PATCH", async () => {
    const fetchImpl = vi.fn(async () => ok({ id: "f1" }));
    await updateAppDataJson("f1", { a: 1 }, "tok", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/upload/drive/v3/files/f1?uploadType=media&fields=id");
    expect(init).toMatchObject({ method: "PATCH", body: '{"a":1}' });
  });

  it("maps a 401 from the app folder to an auth error", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    await expect(updateAppDataJson("f1", {}, "tok", fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ kind: "auth" });
  });
});
