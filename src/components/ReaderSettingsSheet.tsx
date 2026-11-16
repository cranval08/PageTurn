import { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";
import type { Settings } from "../lib/db/schema";
import { useSettings } from "../store/settings";

const LAYOUTS: { value: Settings["layout"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "single", label: "Single" },
  { value: "spread", label: "Spread" },
];

const ANIMATIONS: { value: Settings["animation"]; label: string }[] = [
  { value: "curl", label: "Curl" },
  { value: "slide", label: "Slide" },
  { value: "none", label: "None" },
];

function Segmented<T extends string>(props: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{props.legend}</legend>
      <div className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-ink/5 p-1">
        {props.options.map((o) => (
          <label key={o.value} className="segment">
            <input
              type="radio"
              name={props.name}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
              className="peer sr-only"
            />
            <span className="segment-label">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Reader settings sheet ("Aa"): right panel on desktop, bottom sheet on phones. */
export function ReaderSettingsSheet({ onClose }: { onClose(): void }) {
  const layout = useSettings((s) => s.layout);
  const animation = useSettings((s) => s.animation);
  const update = useSettings((s) => s.update);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("input:checked")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

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
        className="sheet absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-paper p-5 text-ink shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-80 sm:rounded-none"
        data-testid="reader-settings"
      >
        <div className="mb-4 flex items-center">
          <h2 id={titleId} className="flex-1 font-serif text-xl">
            Reading settings
          </h2>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="space-y-5">
          <Segmented legend="Page layout" name="reader-layout" value={layout} options={LAYOUTS} onChange={(v) => update({ layout: v })} />
          <Segmented legend="Page turn" name="reader-animation" value={animation} options={ANIMATIONS} onChange={(v) => update({ animation: v })} />
          <Link to="/settings" className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">
            All settings
          </Link>
        </div>
      </div>
    </div>
  );
}
