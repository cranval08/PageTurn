export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function progressPercent(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((page / pageCount) * 100)));
}

/** LIB-1: "p. 84 of 312 · 27%". */
export function progressLabel(page: number | undefined, pageCount: number): string {
  if (!page) return `Not started · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
  return `p. ${page} of ${pageCount} · ${progressPercent(page, pageCount)}%`;
}

/** PRG-2: "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}
