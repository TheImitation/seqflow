import { isToolId, makeDocId, shortLabelOf, shortcutOf, type ToolId, type ViewKind } from '../state/docId'
import { paneIds, usePanels, type SlotId } from '../state/panels'

/**
 * A closed pane leaves this strip behind on the workspace edge.
 *
 * It used to sit in the pane's own slot in the row, so "the way back is always
 * where the pane was" was literally true of the rail's position. A docking tree
 * has no ordinal slots, so the rails collect on the edge instead and the promise
 * is kept by the stored restore descriptor rather than by where the strip is.
 *
 * The label is the short view name rather than the file name: a rail is a way
 * back to *a view*, and at this width `platform-spine.arch` would not fit. The
 * chevron points into the workspace — the direction the pane comes from.
 */
export function PaneRail({ id }: { id: SlotId }) {
  const show = usePanels((s) => s.show)
  const label = shortLabelOf(id)
  const key = shortcutOf(id)

  return (
    <button
      className="pane-rail"
      onClick={() => show(id)}
      title={key ? `Open ${label} (${key})` : `Open ${label}`}
      aria-label={`Open ${label}`}
    >
      <span className="chev">‹</span>
      <span className="rail-label">{label}</span>
    </button>
  )
}

/**
 * The explorer's way back once it is closed.
 *
 * The explorer is a fixed column rather than a dock pane, so it never had a
 * rail — closing it from the View menu left nothing on screen to reopen it
 * with, which is the exact trap the README gives as the reason it is not in
 * the dock. It gets a rail on its own edge, the same as everything else.
 */
export function ExplorerRail() {
  const toggleExplorer = usePanels((s) => s.toggleExplorer)
  return (
    <button
      className="pane-rail explorer-rail"
      onClick={toggleExplorer}
      title="Open the explorer"
      aria-label="Open the explorer"
    >
      <span className="chev">›</span>
      <span className="rail-label">Explorer</span>
    </button>
  )
}

/**
 * The close control at the far end of every pane head.
 *
 * Takes a **view**, not a slot id, and resolves it against the open project —
 * the same way the ⌘ keys do. It used to take the id, and when slots started
 * holding documents three of the four canvases were left passing the old pane
 * names: `hide('arch')` matched nothing in a tree of `p_…#arch` ids, so their
 * buttons silently did nothing. A slot id is a plain string, so the compiler
 * could not see it; a view is a closed union, so now it can.
 *
 * `×` rather than the `‹` it used to be. Closing is one action with one glyph
 * — the same one the tabs and the explorer rows use — and a left-pointing
 * chevron on a pane whose rail then appears on the *right* pointed the wrong way.
 */
export function PaneCloseButton({ view }: { view: ViewKind | ToolId }) {
  const projectId = usePanels((s) => s.projectId)
  const hide = usePanels((s) => s.hide)
  const last = usePanels((s) => paneIds(s.root).length === 1)
  const id = isToolId(view) ? view : makeDocId(projectId, view)
  const label = shortLabelOf(id)
  const key = shortcutOf(id)

  return (
    <button
      className="btn ghost icon pane-close"
      onClick={() => hide(id)}
      disabled={last}
      title={
        last
          ? 'This is the only pane left open'
          : key
            ? `Close ${label} (${key})`
            : `Close ${label}`
      }
      aria-label={`Close ${label}`}
    >
      ×
    </button>
  )
}
