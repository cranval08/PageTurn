import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../components/AccountButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { canSync, initAuth } from "../lib/google/auth";
import { isGoogleConfigured } from "../lib/google/config";
import { useAuth } from "../store/auth";
import { clearCache, storageUsage, type StorageUsage } from "../lib/db/books";
import { formatBytes, timeAgo } from "../lib/format";
import type { Settings } from "../lib/db/schema";
import type { LayoutMode } from "../lib/layout";
import { useSettings } from "../store/settings";
import { requestSync, useSync } from "../store/sync";

const LAYOUTS: { value: LayoutMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Two pages on wide landscape screens, one page otherwise" },
  { value: "single", label: "Single", hint: "Always one page" },
  { value: "spread", label: "Spread", hint: "Always two pages side by side" },
];

const THEMES: { value: Settings["theme"]; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Off-white paper" },
  { value: "sepia", label: "Sepia", hint: "Warm tones, easier on the eyes" },
  { value: "dark", label: "Dark", hint: "For night study: pages are dimmed, never inverted, so images look right" },
];

const ANIMATIONS: { value: Settings["animation"]; label: string; hint: string }[] = [
  { value: "curl", label: "Curl", hint: "A realistic page curl; drag a corner or swipe" },
  { value: "slide", label: "Slide", hint: "A short slide, gentler on the eyes" },
  { value: "none", label: "None", hint: "Pages change instantly (default when your device asks for reduced motion)" },
];

export default function SettingsPage() {
  const layout = useSettings((s) => s.layout);
  const animation = useSettings((s) => s.animation);
  const theme = useSettings((s) => s.theme);
  const update = useSettings((s) => s.update);
  const user = useAuth((s) => s.user);
  const authStatus = useAuth((s) => s.status);
  const authError = useAuth((s) => s.error);
  const signIn = useAuth((s) => s.signIn);
  const signOut = useAuth((s) => s.signOut);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => setUsage(await storageUsage()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load Google sign-in early so the popup can open straight from a click.
  useEffect(() => {
    if (isGoogleConfigured()) initAuth().catch(() => {});
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-4">
        <Link to="/" className="icon-btn" aria-label="Back to library">
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="font-serif text-2xl">Settings</h1>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 pb-16">
        <fieldset className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-ink/10">
          <legend className="float-left mb-3 font-serif text-lg">Page layout</legend>
          <div className="clear-both grid gap-2">
            {LAYOUTS.map((opt) => (
              <label key={opt.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-paper">
                <input
                  type="radio"
                  name="layout"
                  value={opt.value}
                  checked={layout === opt.value}
                  onChange={() => update({ layout: opt.value })}
                  className="h-5 w-5 accent-accent"
                />
                <span>
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-sm text-ink-muted">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-ink/10">
          <legend className="float-left mb-3 font-serif text-lg">Theme</legend>
          <div className="clear-both grid gap-2">
            {THEMES.map((opt) => (
              <label key={opt.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-paper">
                <input
                  type="radio"
                  name="theme"
                  value={opt.value}
                  checked={theme === opt.value}
                  onChange={() => update({ theme: opt.value })}
                  className="h-5 w-5 accent-accent"
                />
                <span>
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-sm text-ink-muted">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-ink/10">
          <legend className="float-left mb-3 font-serif text-lg">Page turn</legend>
          <div className="clear-both grid gap-2">
            {ANIMATIONS.map((opt) => (
              <label key={opt.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-paper">
                <input
                  type="radio"
                  name="animation"
                  value={opt.value}
                  checked={animation === opt.value}
                  onChange={() => update({ animation: opt.value })}
                  className="h-5 w-5 accent-accent"
                />
                <span>
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-sm text-ink-muted">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {isGoogleConfigured() && (
          <section aria-labelledby="account-heading" className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-ink/10">
            <h2 id="account-heading" className="font-serif text-lg">
              Google account
            </h2>
            {user ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Avatar name={user.name} picture={user.picture} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{user.name}</p>
                  <p className="truncate text-sm text-ink-muted">{user.email}</p>
                </div>
                <button type="button" className="btn-secondary" onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 text-ink-muted">
                  Not signed in. Sign in to add books from Google Drive and sync your reading progress.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={authStatus === "signing-in"}
                  onClick={() => void signIn().catch(() => {})}
                >
                  {authStatus === "signing-in" ? "Signing in…" : "Sign in with Google"}
                </button>
              </div>
            )}
            {authError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {authError}
              </p>
            )}
            <p className="mt-3 text-sm text-ink-muted">
              Signing out doesn't remove books from this device. PageTurn can only see Drive files you pick.
            </p>
          </section>
        )}

        {isGoogleConfigured() && <SyncSection />}

        <section aria-labelledby="storage-heading" className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-ink/10">
          <h2 id="storage-heading" className="font-serif text-lg">
            Storage
          </h2>
          <p className="mt-2 text-ink-muted">
            Books are saved on this device so they open without internet.
          </p>
          <p className="mt-3" data-testid="storage-used">
            {usage
              ? `${formatBytes(usage.bytes)} used by ${usage.books} ${usage.books === 1 ? "book" : "books"}`
              : "Calculating…"}
          </p>
          <button
            type="button"
            className="btn-secondary mt-4"
            disabled={!usage || usage.books === 0}
            onClick={() => setConfirmClear(true)}
          >
            Clear cache
          </button>
          <p className="mt-2 text-sm text-ink-muted">
            Clearing removes the saved PDFs but keeps your library and reading progress.
          </p>
        </section>

        <p className="text-sm text-ink-muted">
          <Link to="/privacy" className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">
            Privacy: what PageTurn stores and why
          </Link>
        </p>
        <p className="-mt-4 text-sm text-ink-muted">
          {/* A real file (built by scripts/licenses.mjs), so a plain link, not a router Link. */}
          <a href="/third-party-licenses.txt" className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">
            Open-source licenses
          </a>
        </p>
      </main>

      {confirmClear && (
        <ConfirmDialog
          title="Clear cache?"
          message="All saved PDFs will be deleted from this device. Your library and reading progress stay. Books from this device will need to be added again to read them."
          confirmLabel="Clear cache"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={async () => {
            setConfirmClear(false);
            await clearCache();
            await refresh();
          }}
        />
      )}
    </div>
  );
}

/** PRG-2: progress and bookmarks sync through the hidden Drive app folder. */
function SyncSection() {
  const user = useAuth((s) => s.user);
  const authStatus = useAuth((s) => s.status);
  const status = useSync((s) => s.status);
  const lastSyncedAt = useSync((s) => s.lastSyncedAt);
  const error = useSync((s) => s.error);
  const [, tick] = useState(0);

  // Keep "Last synced 3 minutes ago" current.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  /** From a click: may refresh the token (popup), then syncs. */
  const syncNow = () => {
    useAuth
      .getState()
      .driveToken()
      .then((token) => requestSync(token))
      .catch(() => {});
  };

  const allowed = user !== null && canSync();
  let line: string;
  if (!user) line = "Sign in with Google to sync your page and bookmarks between your devices.";
  else if (!allowed) line = "Sync is off: the permission for PageTurn's app folder in Google Drive wasn't given.";
  else if (status === "syncing") line = "Syncing…";
  else if (status === "error" && error) line = error;
  else if (authStatus === "expired") line = "Your Google session expired. Sign in again to sync.";
  else line = lastSyncedAt ? `Last synced ${timeAgo(lastSyncedAt)}` : "Not synced yet";

  return (
    <section aria-labelledby="sync-heading" className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-ink/10">
      <h2 id="sync-heading" className="font-serif text-lg">
        Sync across devices
      </h2>
      <p className="mt-2 text-ink-muted">
        While you're signed in, your page and bookmarks in every book are saved to a hidden PageTurn folder in your
        Google Drive, so another device opens the same book where you stopped. Your PDFs are not uploaded.
      </p>
      <p className="mt-3" data-testid="sync-status" role={status === "error" ? "alert" : "status"}>
        {line}
      </p>
      {user && (
        <button type="button" className="btn-secondary mt-4" disabled={status === "syncing"} onClick={allowed ? syncNow : () => void useAuth.getState().signIn().catch(() => {})}>
          {allowed ? "Sync now" : "Turn on sync"}
        </button>
      )}
    </section>
  );
}
