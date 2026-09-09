import { PANEL_LABEL, PANEL_SHORTCUT, paneIds, usePanels, type PanelId } from '../state/panels'

/**
 * A closed pane leaves this strip behind on the workspace edge.
 *
 * It used to sit in the pane's own slot in the row, so "the way back is always
 * where the pane was" was literally true of the rail's position. A docking tree
 * has no ordinal slots, so the rails collect on the edge instead and the promise
 * is kept by the stored restore descriptor rather than by where the strip is.
 */
export function PaneRail({ id }: { id: PanelId }) {
  const show = usePanels((s) => s.show)
  const label = PANEL_LABEL[id]

  return (
    <button
      className="pane-rail"
      onClick={() => show(id)}
      title={`Show ${label} (${PANEL_SHORTCUT[id]})`}
      aria-label={`Show ${label}`}
    >
      <span className="chev">{id === 'inspector' ? '‹' : '›'}</span>
      <span className="rail-label">{label}</span>
    </button>
  )
}

/** The collapse control that lives in a `.pane-head`. */
export function PaneHideButton({ id }: { id: PanelId }) {
  const hide = usePanels((s) => s.hide)
  const openCount = usePanels((s) => paneIds(s.root).length)
  const last = openCount === 1

  return (
    <button
      className="btn ghost icon pane-hide"
      onClick={() => hide(id)}
      disabled={last}
      title={
        last
          ? 'This is the only pane left open'
          : `Hide ${PANEL_LABEL[id]} (${PANEL_SHORTCUT[id]})`
      }
      aria-label={`Hide ${PANEL_LABEL[id]}`}
    >
      ‹
    </button>
  )
}
