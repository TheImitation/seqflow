import { isToolId, shortLabelOf, shortcutOf } from '../state/docId'
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
 * back to *a view*, and at this width `platform-spine.arch` would not fit.
 */
export function PaneRail({ id }: { id: SlotId }) {
  const show = usePanels((s) => s.show)
  const label = shortLabelOf(id)
  const key = shortcutOf(id)

  return (
    <button
      className="pane-rail"
      onClick={() => show(id)}
      title={key ? `Show ${label} (${key})` : `Show ${label}`}
      aria-label={`Show ${label}`}
    >
      <span className="chev">{isToolId(id) ? '‹' : '›'}</span>
      <span className="rail-label">{label}</span>
    </button>
  )
}

/** The collapse control that lives in a `.pane-head`. */
export function PaneHideButton({ id }: { id: SlotId }) {
  const hide = usePanels((s) => s.hide)
  const openCount = usePanels((s) => paneIds(s.root).length)
  const last = openCount === 1
  const label = shortLabelOf(id)
  const key = shortcutOf(id)

  return (
    <button
      className="btn ghost icon pane-hide"
      onClick={() => hide(id)}
      disabled={last}
      title={
        last
          ? 'This is the only pane left open'
          : key
            ? `Hide ${label} (${key})`
            : `Hide ${label}`
      }
      aria-label={`Hide ${label}`}
    >
      ‹
    </button>
  )
}
