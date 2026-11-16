import { usePwa } from "../pwa";

/** Shown when a new app version is ready; the reader chooses when to reload. */
export function UpdateToast() {
  const needRefresh = usePwa((s) => s.needRefresh);
  const update = usePwa((s) => s.update);
  const dismiss = usePwa((s) => s.dismiss);
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-ink px-4 py-3 text-paper shadow-2xl"
    >
      <p className="flex-1 text-sm">A new version of PageTurn is ready.</p>
      <button type="button" className="min-h-11 rounded-lg bg-paper px-3 font-medium text-ink" onClick={update}>
        Reload
      </button>
      <button type="button" className="min-h-11 min-w-11 rounded-lg text-paper/80 hover:text-paper" aria-label="Dismiss update message" onClick={dismiss}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
