import { describe, expect, it, vi } from "vitest";
import { SCOPE_STRING, SCOPES } from "../../src/lib/google/config";
import {
  DriveError,
  downloadDriveFile,
  driveErrorFor,
  getDriveFile,
  parseDriveFile,
  parseUserInfo,
} from "../../src/lib/google/drive";

describe("OAuth scopes (PRD: only drive.file + profile in Phase 3)", () => {
  it("requests exactly drive.file, openid, email, profile", () => {
    expect([...SCOPES]).toEqual(["https://www.googleapis.com/auth/drive.file", "openid", "email", "profile"]);
    expect(SCOPE_STRING).toBe("https://www.googleapis.com/auth/drive.file openid email profile");
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
