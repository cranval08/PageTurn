import { formatBytes } from "../lib/format";
import type { PickedFile } from "../lib/google/picker";

/** DRV-3: show a progress bar for files larger than this. */
export const PROGRESS_BAR_MIN_BYTES = 5 * 1024 * 1024;

export interface ImportItem {
  key: string;
  file: PickedFile;
  status: "queued" | "downloading" | "processing" | "done" | "error";
  loaded: number;
  total: number;
  error?: string;
  /** The failure was an expired Google session (retrying re-authenticates). */
  authError?: boolean;
}

interface ImportPanelProps {
  items: ImportItem[];
  onRetry(item: ImportItem): void;
  onDismiss(): void;
}

function statusText(item: ImportItem): string {
  switch (item.status) {
    case "queued":
      return "Waiting…";
    case "downloading":
      return item.total > 0 ? `Downloading… ${formatBytes(item.loaded)} of ${formatBytes(item.total)}` : "Downloading…";
    case "processing":
      return "Preparing…";
    case "done":
      return "Added to library";
    case "error":
      return item.error ?? "Failed";
  }
}

/** Drive import progress and errors (DRV-3, DRV-7, Reliability: errors offer Retry). */
export function ImportPanel({ items, onRetry, onDismiss }: ImportPanelProps) {
  if (items.length === 0) return null;
  const finished = items.every((i) => i.status === "done" || i.status === "error");
  const done = items.filter((i) => i.status === "done").length;

  return (
    <section
      aria-label="Google Drive imports"
      data-testid="import-panel"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-xl bg-white p-4 shadow-2xl ring-1 ring-black/10 sm:right-4 sm:left-auto sm:mx-0 sm:w-96"
    >
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-medium" aria-live="polite">
          {finished ? `Added ${done} of ${items.length} ${items.length === 1 ? "book" : "books"}` : "Adding from Google Drive…"}
        </h2>
        {finished && (
          <button type="button" className="icon-btn -my-2 -mr-2 text-base" aria-label="Close import list" onClick={onDismiss}>
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>
      <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto">
        {items.map((item) => {
          const showBar = item.status === "downloading" && item.total > PROGRESS_BAR_MIN_BYTES;
          const percent = item.total > 0 ? Math.round((item.loaded / item.total) * 100) : 0;
          return (
            <li key={item.key} data-testid="import-item" data-status={item.status}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-sm" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p
                    className={`text-xs ${item.status === "error" ? "text-red-800" : "text-ink-muted"}`}
                    role={item.status === "error" ? "alert" : undefined}
                  >
                    {statusText(item)}
                  </p>
                </div>
                {item.status === "error" && (
                  <button type="button" className="btn-secondary min-h-9 px-3 text-sm" onClick={() => onRetry(item)}>
                    {item.authError ? "Sign in & retry" : "Retry"}
                  </button>
                )}
              </div>
              {showBar && (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10"
                  role="progressbar"
                  aria-label={`Downloading ${item.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <div className="h-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
