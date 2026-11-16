import { Link } from "react-router-dom";
import type { Settings } from "../lib/db/schema";
import { useSettings } from "../store/settings";
import { Panel } from "./Panel";

const LAYOUTS: { value: Settings["layout"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "single", label: "Single" },
  { value: "spread", label: "Spread" },
];

const THEMES: { value: Settings["theme"]; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
];

const ANIMATIONS: { value: Settings["animation"]; label: string }[] = [
  { value: "curl", label: "Curl" },
  { value: "slide", label: "Slide" },
  { value: "none", label: "None" },
];

export function Segmented<T extends string>(props: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{props.legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-ink/5 p-1">
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

/** Reader settings ("Aa"): layout, theme (RDR-13), page turn (RDR-4). */
export function ReaderSettingsSheet({ onClose }: { onClose(): void }) {
  const layout = useSettings((s) => s.layout);
  const theme = useSettings((s) => s.theme);
  const animation = useSettings((s) => s.animation);
  const update = useSettings((s) => s.update);

  return (
    <Panel title="Reading settings" onClose={onClose} testId="reader-settings">
      <div className="space-y-5">
        <Segmented legend="Theme" name="reader-theme" value={theme} options={THEMES} onChange={(v) => update({ theme: v })} />
        <Segmented legend="Page layout" name="reader-layout" value={layout} options={LAYOUTS} onChange={(v) => update({ layout: v })} />
        <Segmented legend="Page turn" name="reader-animation" value={animation} options={ANIMATIONS} onChange={(v) => update({ animation: v })} />
        <Link to="/settings" className="inline-flex min-h-11 items-center text-accent underline underline-offset-2">
          All settings
        </Link>
      </div>
    </Panel>
  );
}
