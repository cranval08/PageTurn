/** RDR-6: zoom range. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.5;
export const DOUBLE_TAP_ZOOM = 2;

export interface ZoomState {
  scale: number;
  /** Translation in CSS px, applied before scaling around the stage centre. */
  x: number;
  y: number;
}

export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Keep the zoomed content covering the stage: it can't be dragged further than
 * its overflow. `content` is the unscaled size of the book, `stage` the viewport.
 */
export function clampPan(state: ZoomState, content: { width: number; height: number }, stage: { width: number; height: number }): ZoomState {
  const maxX = Math.max(0, (content.width * state.scale - stage.width) / 2);
  const maxY = Math.max(0, (content.height * state.scale - stage.height) / 2);
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v)) || 0;
  return { scale: state.scale, x: clamp(state.x, maxX), y: clamp(state.y, maxY) };
}

/**
 * Zoom to `scale` keeping the screen point `focus` (relative to the stage centre)
 * fixed under the finger or cursor.
 */
export function zoomAt(state: ZoomState, scale: number, focus: { x: number; y: number }): ZoomState {
  const next = clampScale(scale);
  if (next === MIN_ZOOM) return IDENTITY;
  const ratio = next / state.scale;
  return {
    scale: next,
    x: focus.x - (focus.x - state.x) * ratio,
    y: focus.y - (focus.y - state.y) * ratio,
  };
}

export function isZoomed(state: ZoomState): boolean {
  return state.scale > MIN_ZOOM + 0.001;
}
