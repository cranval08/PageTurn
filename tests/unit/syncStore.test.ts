import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncProgress = vi.fn();
let token: string | null = "tok";
let allowed = true;

vi.mock("../../src/lib/sync/sync", () => ({ syncProgress: (...args: unknown[]) => syncProgress(...args) }));
vi.mock("../../src/lib/google/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/google/config")>()),
  isGoogleConfigured: () => true,
}));
vi.mock("../../src/lib/google/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/google/auth")>()),
  currentToken: () => token,
  canSync: () => allowed,
}));

import { DriveError } from "../../src/lib/google/drive";
import { useAuth } from "../../src/store/auth";
import { _resetSyncForTests, flushScheduledSync, requestSync, scheduleSync, SYNC_DEBOUNCE_MS, useSync } from "../../src/store/sync";

beforeEach(() => {
  _resetSyncForTests();
  syncProgress.mockReset();
  syncProgress.mockResolvedValue({ changed: [], uploaded: false });
  token = "tok";
  allowed = true;
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("PRG-2: sync scheduling", () => {
  it("does nothing without a token in memory or without the app-folder permission (no popups)", async () => {
    token = null;
    expect(await requestSync()).toBeNull();
    token = "tok";
    allowed = false;
    expect(await requestSync()).toBeNull();
    expect(syncProgress).not.toHaveBeenCalled();
  });

  it("records the last sync time and bumps the revision only when progress changed here", async () => {
    await requestSync();
    expect(useSync.getState()).toMatchObject({ status: "idle", revision: 0 });
    expect(useSync.getState().lastSyncedAt).toBeGreaterThan(0);
    expect(localStorage.getItem("pageturn.lastSync")).toBe(String(useSync.getState().lastSyncedAt));
    syncProgress.mockResolvedValueOnce({ changed: ["bio"], uploaded: false });
    await requestSync();
    expect(useSync.getState()).toMatchObject({ revision: 1, lastChanged: ["bio"] });
  });

  it("calls during a running sync coalesce into exactly one more round", async () => {
    let release!: () => void;
    syncProgress.mockImplementationOnce(() => new Promise((r) => (release = () => r({ changed: [], uploaded: true }))));
    const first = requestSync();
    const second = requestSync();
    const third = requestSync();
    expect(second).toBe(third);
    release();
    await Promise.all([first, second, third]);
    expect(syncProgress).toHaveBeenCalledTimes(2);
  });

  it("debounces syncs after page turns, and flushes them when leaving the reader", async () => {
    vi.useFakeTimers();
    scheduleSync();
    scheduleSync();
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS - 1);
    expect(syncProgress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(syncProgress).toHaveBeenCalledTimes(1);

    scheduleSync();
    flushScheduledSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncProgress).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(syncProgress).toHaveBeenCalledTimes(2); // the flushed timer doesn't fire again
  });

  it("a 401 marks the Google session expired; errors never throw", async () => {
    useAuth.setState({ status: "signed-in", user: { name: "A", email: "a@example.com" }, error: null });
    syncProgress.mockRejectedValueOnce(new DriveError("auth", "expired", 401));
    expect(await requestSync()).toBeNull();
    expect(useAuth.getState().status).toBe("expired");
    expect(useSync.getState()).toMatchObject({ status: "error", error: "Your Google session expired. Sign in again to sync." });

    syncProgress.mockRejectedValueOnce(new DriveError("network", "x"));
    await requestSync();
    expect(useSync.getState().error).toMatch(/when you're back online/);
  });
});
