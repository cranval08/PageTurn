import { Panel } from "./Panel";

interface BookmarksPanelProps {
  bookmarks: number[];
  pageCount: number;
  /** 1-based page the toggle applies to. */
  currentPage: number;
  onToggleCurrent(): void;
  onGo(page: number): void;
  onRemove(page: number): void;
  onClose(): void;
}

/** RDR-14: bookmarks list, plus a toggle for the current page. */
export function BookmarksPanel(props: BookmarksPanelProps) {
  const { bookmarks, currentPage } = props;
  const marked = bookmarks.includes(currentPage);
  const valid = bookmarks.filter((p) => p >= 1 && p <= props.pageCount);
  return (
    <Panel title="Bookmarks" onClose={props.onClose} testId="bookmarks-panel">
      <button type="button" className={marked ? "btn-secondary w-full" : "btn-primary w-full"} onClick={props.onToggleCurrent} data-autofocus>
        {marked ? `Remove bookmark from page ${currentPage}` : `Bookmark page ${currentPage}`}
      </button>
      {valid.length === 0 ? (
        <p className="mt-4 text-ink-muted">No bookmarks yet. Use the bookmark button in the toolbar to mark a page.</p>
      ) : (
        <ul className="mt-4 divide-y divide-ink/10" aria-label="Bookmarked pages">
          {valid.map((page) => (
            <li key={page} className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-h-11 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-ink/10"
                aria-current={page === currentPage ? "page" : undefined}
                onClick={() => props.onGo(page)}
              >
                <span aria-hidden="true" className="text-[#b4232a]">
                  ▮
                </span>
                Page {page}
              </button>
              <button type="button" className="icon-btn text-base" aria-label={`Remove bookmark on page ${page}`} onClick={() => props.onRemove(page)}>
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
