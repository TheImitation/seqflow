/**
 * The order panes are rendered in, which is deliberately not the order they are
 * arranged in.
 *
 * `DockView` renders every pane once as an absolutely positioned box and never
 * nests them, so the DOM order is free — and it has to stay still. React does
 * not unmount a keyed child that moves, but it does `insertBefore` the node,
 * which resets canvas scroll, forces CodeMirror to re-measure and restarts
 * transitions. That is what the fixed `PANE_RENDER_ORDER` constant was
 * protecting, and a dynamic set of documents cannot use a constant.
 *
 * So: keep the previous order, drop what closed, append what opened. Anything
 * still open holds its slot however the tree is rearranged.
 *
 * Derived on every render from the tree rather than stored alongside it. Three
 * paths change the open set without going through open/close — `sanitise` at
 * load, `setRoot` (which `export/captureDiagrams.ts` uses as a wholesale
 * restore), and reconciliation against the project list — and a stored copy
 * would drift out of step with all three.
 */

/**
 * Merge the open set into the order it was last rendered in.
 *
 * Returns `previous` unchanged when nothing moved, so a caller holding it in a
 * ref can compare by identity. **Idempotent**: `merge(merge(p, o), o)` is
 * `merge(p, o)`, which matters because React 19 double-invokes render under
 * StrictMode and this runs during render.
 */
export function mergeRenderOrder(previous: readonly string[], open: readonly string[]): string[] {
  const openSet = new Set(open)
  const seen = new Set(previous)

  const kept = previous.filter((id) => openSet.has(id))
  const added = open.filter((id) => !seen.has(id))

  // Nothing closed and nothing opened: hand back the same array.
  if (added.length === 0 && kept.length === previous.length) return previous as string[]
  return [...kept, ...added]
}
