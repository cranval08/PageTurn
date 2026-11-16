import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NotPdfError, readLocalPdf } from "../lib/files";
import { putSessionBook } from "../lib/session";

/**
 * Phase 1 library: open a PDF from the device (DRV-5) by file picker or
 * drag-and-drop anywhere on the page. The covers grid arrives in Phase 2.
 */
export default function LibraryPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setBusy(true);
      try {
        const pdf = await readLocalPdf(file);
        putSessionBook({ id: pdf.id, title: pdf.title, data: pdf.data });
        navigate(`/read/${encodeURIComponent(pdf.id)}`);
      } catch (err) {
        setError(err instanceof NotPdfError ? err.message : "Couldn't read that file. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [navigate],
  );

  // Drag a PDF anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void openFile(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openFile]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <span className="font-serif text-2xl font-semibold">PageTurn</span>
        <button
          type="button"
          className="btn-primary"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          + Add book
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          data-testid="file-input"
          aria-label="Open a PDF from this device"
          tabIndex={-1}
          onChange={(e) => {
            void openFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16">
        {error && (
          <p role="alert" className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900">
            {error}
          </p>
        )}
        <section className="mt-16 text-center">
          <h1 className="font-serif text-3xl">Your library is empty</h1>
          <p className="mx-auto mt-3 max-w-md text-ink-muted">
            Open a PDF from this device, or drag one anywhere onto this page.
            Opening from Google Drive is coming soon.
          </p>
          <button
            type="button"
            className="btn-primary mt-6"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Opening…" : "Open from this device"}
          </button>
        </section>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-accent/15 outline-4 -outline-offset-8 outline-accent outline-dashed">
          <p className="rounded-lg bg-paper px-6 py-4 font-serif text-xl shadow-lg">Drop a PDF to open it</p>
        </div>
      )}
    </div>
  );
}
