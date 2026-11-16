import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../components/AccountButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { isGoogleConfigured } from "../lib/google/config";
import { useAuth } from "../store/auth";
import { clearCache, storageUsage, type StorageUsage } from "../lib/db/books";
import { formatBytes } from "../lib/format";
import type { Settings } from "../lib/db/schema";
import type { LayoutMode } from "../lib/layout";
import { useSettings } from "../store/settings";

const LAYOUTS: { value: LayoutMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Two pages on wide landscape screens, one page otherwise" },
  { value: "single", label: "Single", hint: "Always one page" },
  { value: "spread", label: "Spread", hint: "Always two pages side by side" },
];

const ANIMATIONS: { value: Settings["animation"]; label: string; hint: string }[] = [
  { value: "curl", label: "Curl", hint: "A realistic page curl; drag a corner or swipe" },
  { value: "slide", label: "Slide", hint: "A short slide, gentler on the eyes" },
  { value: "none", label: "None", hint: "Pages change instantly (default when your device asks for reduced motion)" },
];

export default function SettingsPage() {
  const layout = useSettings((s) => s.layout);
  const animation = useSettings((s) => s.animation);
  const update = useSettings((s) => s.update);
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => setUsage(await storageUsage()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-4">
        <Link to="/" className="icon-btn" aria-label="Back to library">
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="font-serif text-2xl">Settings</h1>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 pb-16">
        <fieldset className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
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

        <fieldset className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
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
          <section aria-labelledby="account-heading" className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
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
              <p className="mt-2 text-ink-muted">Not signed in. Sign in from the library to add books from Google Drive.</p>
            )}
            <p className="mt-3 text-sm text-ink-muted">
              Signing out doesn't remove books from this device. PageTurn can only see Drive files you pick.
            </p>
          </section>
        )}

        <section aria-labelledby="storage-heading" className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5">
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
