import { create } from "zustand";
import { canSync, currentToken } from "../lib/google/auth";
import { isGoogleConfigured } from "../lib/google/config";
import { DriveError } from "../lib/google/drive";
import { syncProgress, type SyncOutcome } from "../lib/sync/sync";
import { useAuth } from "./auth";

/** PRG-2: upload this long after the last page turn or bookmark change. */
export const SYNC_DEBOUNCE_MS = 5_000;
const LAST_SYNC_KEY = "pageturn.lastSync";

export type SyncStatus = "idle" | "syncing" | "error";

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  /** Bumps whenever a sync changed progress on this device (screens reload it). */
  revision: number;
  /** Book ids changed by the latest sync that changed anything. */
  lastChanged: string[];
}

function readLastSync(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export const useSync = create<SyncState>(() => ({
  status: "idle",
  lastSyncedAt: readLastSync(),
  error: null,
  revision: 0,
  lastChanged: [],
}));

function messageFor(err: unknown): string {
  if (err instanceof DriveError) {
    if (err.kind === "auth") return "Your Google session expired. Sign in again to sync.";
    if (err.kind === "network") return "Couldn't reach Google Drive. Progress will sync when you're back online.";
    if (err.kind === "forbidden") return "Google Drive refused to sync right now. Try again shortly.";
    return err.message;
  }
  return "Syncing reading progress didn't work. Try again.";
}

/** Sync is possible right now: signed in with a live token and the app-folder permission. */
export function syncAvailable(): boolean {
  return isGoogleConfigured() && currentToken() !== null && canSync();
}

let running: Promise<SyncOutcome | null> | null = null;
let queued: Promise<SyncOutcome | null> | null = null;

async function runOnce(token?: string): Promise<SyncOutcome | null> {
  const t = token ?? currentToken();
  if (!t || !canSync() || (typeof navigator !== "undefined" && navigator.onLine === false)) return null;
  useSync.setState({ status: "syncing" });
  try {
    const outcome = await syncProgress(t);
    const now = Date.now();
    try {
      localStorage.setItem(LAST_SYNC_KEY, String(now));
    } catch {
      /* per-device convenience only */
    }
    useSync.setState((s) => ({
      status: "idle",
      error: null,
      lastSyncedAt: now,
      ...(outcome.changed.length > 0 ? { revision: s.revision + 1, lastChanged: outcome.changed } : {}),
    }));
    return outcome;
  } catch (err) {
    if (err instanceof DriveError && err.kind === "auth") useAuth.getState().markExpired();
    useSync.setState({ status: "error", error: messageFor(err) });
    return null;
  }
}

/**
 * PRG-2: sync now (never throws, never opens a popup: needs a token in memory).
 * Calls during a running sync coalesce into one more round afterwards, so the
 * result always reflects writes made before the call.
 */
export function requestSync(token?: string): Promise<SyncOutcome | null> {
  if (!running) {
    running = runOnce(token).finally(() => {
      running = null;
    });
    return running;
  }
  queued ??= running.then(() => {
    queued = null;
    return requestSync(token);
  });
  return queued;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced sync after reading (page turns, bookmarks). */
export function scheduleSync(delayMs = SYNC_DEBOUNCE_MS): void {
  if (!syncAvailable()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void requestSync();
  }, delayMs);
}

/** Run a scheduled sync now (leaving the reader, app going to the background). `force`: a save was just flushed. */
export function flushScheduledSync(force = false): void {
  if (timer === undefined && !(force && syncAvailable())) return;
  clearTimeout(timer);
  timer = undefined;
  void requestSync();
}

/** Sync with a time limit (e.g. before opening a just-imported book). Never throws. */
export function syncWithin(ms: number, token?: string): Promise<SyncOutcome | null> {
  return Promise.race([requestSync(token), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

let started = false;

/** Sync whenever the user signs in (or back in after expiry), and when the network returns. */
export function initSync(): void {
  if (started || !isGoogleConfigured()) return;
  started = true;
  useAuth.subscribe((state, prev) => {
    if (state.status === "signed-in" && prev.status !== "signed-in") void requestSync();
    if (state.status === "signed-out") useSync.setState({ status: "idle", error: null });
  });
  window.addEventListener("online", () => void requestSync());
}

/** Test helper. */
export function _resetSyncForTests(): void {
  running = null;
  queued = null;
  clearTimeout(timer);
  timer = undefined;
  useSync.setState({ status: "idle", lastSyncedAt: null, error: null, revision: 0, lastChanged: [] });
}
