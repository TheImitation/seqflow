/** Pure helpers behind the SVG/PNG snapshot, kept separate so they can be tested. */

export interface Size {
  width: number
  height: number
}

/**
 * The canvases render at `width = layout.width * zoom` while the viewBox stays
 * at the natural size, so the two disagree at any zoom other than 100%. Every
 * child of the SVG — including the background rect we add — is positioned in
 * viewBox space, so that is the only size an export may use.
 */
export function naturalSize(
  viewBox: string | null,
  widthAttr: string | null,
  heightAttr: string | null,
  fallback: Size,
): Size {
  const parts = (viewBox ?? '').trim().split(/[\s,]+/).map(Number)
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const [, , w, h] = parts
    if (w > 0 && h > 0) return { width: w, height: h }
  }
  const w = Number(widthAttr)
  const h = Number(heightAttr)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h }
  return fallback
}

/**
 * Canvas rasterisation fails silently past a browser-specific area limit —
 * Safari gives up around 16.7M pixels. A tall sequence diagram at 2× blows
 * through that easily, so the scale is reduced rather than the export failing.
 */
export const MAX_CANVAS_PIXELS = 16_000_000

export function pngScaleFor(size: Size, requested: number, budget = MAX_CANVAS_PIXELS): number {
  const area = size.width * size.height
  if (area <= 0) return requested
  const maxScale = Math.sqrt(budget / area)
  // Never go below 1: a downscaled PNG of a diagram is unreadable, and at that
  // point the SVG export is the right answer anyway.
  return Math.max(1, Math.min(requested, maxScale))
}

/**
 * Classes the app uses for live state: playback dimming, selection, hover and
 * drag. Baked into a file they read as "most of the diagram is faded out",
 * which is what a snapshot of a mid-playback canvas looks like.
 */
export const TRANSIENT_CLASSES = [
  'dim',
  'active',
  'selected',
  'dragging',
  // The pointer is still down on this node; a file cannot be mid-drag.
  'grabbed',
  'playing',
  'current',
]

/**
 * Elements that exist only to catch a pointer, preview a drag, or offer an
 * editing affordance on hover. `.slot` is the insert gutter — its `+` and pen
 * are invisible until hover, but that rule lives outside the selectors
 * `collectCss` inlines, so exporting the nodes printed them at full strength.
 */
export const INTERACTION_ONLY = [
  '.arrow-hit',
  '.arch-edge-hit',
  '.lifeline-grip',
  '.slot',
  '.drop-lane',
  '.drop-slot',
  '.create-preview',
  '.create-hint',
  '.arrow-handle',
  '.packet',
  // Descendant selector, not a bare `.hit`: that class is too generic to strip
  // safely on its own, and only the schema pane's invisible edge target is meant.
  '.schema-edge .hit',
]

/**
 * Class prefixes whose styling `collectCss` inlines. Anything rendered with a
 * class outside this set exports unstyled, which is how the insert gutter came
 * to be visible — so the two lists have to be kept honest against each other.
 */
export const STYLED_PREFIXES = [
  'seq-svg',
  'arch-svg',
  // The schema pane was absent from both this list and `collectCss`, so its
  // diagram exported as unstyled black-on-transparent shapes.
  'schema-svg',
  'schema-node',
  'schema-edge',
  'lane-',
  'lifeline',
  'arrow-',
  'block-',
  'note-',
  'contract-badge',
  'packet',
  'arch-node',
  'arch-edge',
  'drop-lane',
  // A parked node keeps its marker in an export: unlike a selection or a
  // hover, where the user put a box is real state, not live state.
  'pin-mark',
  // Styled through a descendant selector on one of the above — for example
  // `.arch-node rect.body` — so they carry no prefix of their own.
  'body',
  'title',
  'kind',
  'accent-bar',
  'header',
  'col-name',
  'col-key',
  'row',
  // `.schema-edge .line` — the foreign-key stroke itself, which would
  // otherwise export as an unstyled hairline.
  'line',
]

/**
 * True when at least one class on the element is covered by the inlined
 * stylesheet. Modifiers like `unhappy`, `async` or `aws` never carry a prefix
 * of their own — they are always compound selectors on a styled base — so one
 * match is what makes an element styled.
 */
export function isStyledClass(value: string): boolean {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .some((name) => STYLED_PREFIXES.some((prefix) => name.startsWith(prefix)))
}

/** Strip live-state classes from one class attribute, preserving the rest. */
export function cleanClassList(value: string): string {
  return value
    .split(/\s+/)
    .filter((name) => name && !TRANSIENT_CLASSES.includes(name))
    .join(' ')
}
