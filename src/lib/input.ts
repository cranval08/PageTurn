export type NavAction = "next" | "prev";
export type TapZone = NavAction | "center";

type KeyLike = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;

/** RDR-3 keyboard: Arrow keys, PageUp/PageDown, Space (Shift+Space goes back). */
export function keyToAction(e: KeyLike): NavAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
      return "next";
    case "ArrowLeft":
    case "PageUp":
      return "prev";
    case " ":
    case "Spacebar":
      return e.shiftKey ? "prev" : "next";
    default:
      return null;
  }
}

/** RDR-3 tap zones: left 20% = previous, right 20% = next, centre = toggle chrome. */
export function tapZone(x: number, width: number): TapZone {
  if (width <= 0) return "center";
  const ratio = x / width;
  if (ratio < 0.2) return "prev";
  if (ratio > 0.8) return "next";
  return "center";
}

/** A pointer gesture is a tap when it barely moved and was short. */
export const TAP_MAX_DISTANCE = 10;
export const TAP_MAX_DURATION_MS = 500;

export function isTap(dx: number, dy: number, durationMs: number): boolean {
  return Math.hypot(dx, dy) <= TAP_MAX_DISTANCE && durationMs <= TAP_MAX_DURATION_MS;
}
