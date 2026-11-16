import { useEffect, useId, useRef, useState } from "react";

/** Parse what the reader typed; returns the page number or an error message. */
export function parsePageInput(value: string, pageCount: number): { page: number } | { error: string } {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (!trimmed || !Number.isInteger(n) || n < 1 || n > pageCount) {
    return { error: `Enter a page from 1 to ${pageCount}.` };
  }
  return { page: n };
}

interface GoToPageProps {
  pageCount: number;
  currentPage: number;
  onGo(page: number): void;
  onClose(): void;
}

/** RDR-9: type a page number to jump there. */
export function GoToPage({ pageCount, currentPage, onGo, onClose }: GoToPageProps) {
  const [value, setValue] = useState(String(currentPage));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form
      className="flex w-64 flex-col gap-2 rounded-xl bg-paper p-4 text-ink shadow-2xl ring-1 ring-black/10"
      aria-label="Go to page"
      noValidate // our message is clearer than the browser's validation bubble
      onSubmit={(e) => {
        e.preventDefault();
        const result = parsePageInput(value, pageCount);
        if ("error" in result) setError(result.error);
        else onGo(result.page);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <label htmlFor={`${id}-page`} className="font-medium">
        Go to page <span className="font-normal text-ink-muted">(1–{pageCount})</span>
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          id={`${id}-page`}
          type="number"
          inputMode="numeric"
          min={1}
          max={pageCount}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          className="min-h-11 w-full min-w-0 rounded-lg border border-ink/30 bg-white px-3 tabular-nums"
        />
        <button type="submit" className="btn-primary">
          Go
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}
