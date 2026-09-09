/** Pure geometry behind `Minimap`, kept separate so it can be tested. */

/** The minimap never grows past this; the shorter axis shrinks to fit. */
export const MAX_W = 168
export const MAX_H = 136
/** A very long, thin diagram would otherwise map to a couple of pixels. */
export const MIN_SIDE = 44
/** Slack, in content pixels, before a diagram counts as bigger than its pane. */
export const OVERFLOW_SLOP = 8

export interface Viewport {
  /** Scroll offsets and visible size, in device pixels. */
  left: number
  top: number
  w: number
  h: number
}

/** The visible window expressed in content coordinates. */
export function viewportRect(view: Viewport, scale: number) {
  return {
    x: view.left / scale,
    y: view.top / scale,
    w: view.w / scale,
    h: view.h / scale,
  }
}

/** A diagram entirely on screen has nothing to navigate, so no map is drawn. */
export function overflows(
  width: number,
  height: number,
  visible: { w: number; h: number },
): boolean {
  return width - visible.w >= OVERFLOW_SLOP || height - visible.h >= OVERFLOW_SLOP
}

/**
 * Box size in screen pixels. Aspect ratio is preserved unless a diagram is so
 * lopsided that one side hits `MIN_SIDE`.
 */
export function minimapSize(width: number, height: number): { w: number; h: number } {
  const fit = Math.min(MAX_W / width, MAX_H / height)
  return {
    w: Math.max(MIN_SIDE, Math.round(width * fit)),
    h: Math.max(MIN_SIDE, Math.round(height * fit)),
  }
}

/**
 * Scroll offsets, in device pixels, that centre the viewport on a point given
 * as a fraction of the minimap. Clamped so a click near an edge parks against
 * that edge instead of asking for a scroll position that does not exist.
 */
export function scrollTargetFor(opts: {
  fx: number
  fy: number
  width: number
  height: number
  visible: { w: number; h: number }
  scale: number
}): { left: number; top: number } {
  const { fx, fy, width, height, visible, scale } = opts
  const cx = fx * width
  const cy = fy * height
  return {
    left: clamp((cx - visible.w / 2) * scale, 0, Math.max(0, (width - visible.w) * scale)),
    top: clamp((cy - visible.h / 2) * scale, 0, Math.max(0, (height - visible.h) * scale)),
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
