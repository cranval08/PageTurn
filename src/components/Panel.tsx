import { useEffect, useId, useRef, type ReactNode } from "react";

interface PanelProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  testId?: string;
}

/**
 * Reader side panel (UX spec): slides over the book, right on desktop and a
 * bottom sheet on phones; closes on Escape or a tap outside; focus moves in and
 * is restored on close. Put `data-autofocus` on the element to focus first.
 */
export function Panel({ title, onClose, children, testId }: PanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>("input:checked, button, a[href], input, [tabindex='0']");
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/25"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-paper text-ink shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-80 sm:rounded-none"
      >
        <div className="flex shrink-0 items-center border-b border-ink/10 px-5 py-3">
          <h2 id={titleId} className="flex-1 font-serif text-xl">
            {title}
          </h2>
          <button type="button" className="icon-btn -mr-2" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4" data-panel-scroll>
          {children}
        </div>
      </div>
    </div>
  );
}
