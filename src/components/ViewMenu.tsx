import { useEffect, useRef, useState } from 'react'
import { shortLabelOf, shortcutOf, slotOrder } from '../state/docId'
import { isBackgroundTab, paneIds, usePanels } from '../state/panels'

/**
 * Every panel in one place, so nothing can be hidden past finding again.
 *
 * The list is the open project's four documents plus the inspector, in
 * canonical order — `slotOrder` rather than a constant, because which documents
 * exist depends on which project is open.
 */
export function ViewMenu() {
  const root = usePanels((s) => s.root)
  const projectId = usePanels((s) => s.projectId)
  const toggle = usePanels((s) => s.toggle)
  const resetLayout = usePanels((s) => s.resetLayout)
  const minimap = usePanels((s) => s.minimap)
  const toggleMinimap = usePanels((s) => s.toggleMinimap)
  const explorerOpen = usePanels((s) => s.explorerOpen)
  const toggleExplorer = usePanels((s) => s.toggleExplorer)
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const onScreen = new Set(paneIds(root))
  const onlyPane = onScreen.size === 1

  return (
    <div className="dropdown" ref={host}>
      <button className={`btn${open ? ' active' : ''}`} onClick={() => setOpen((o) => !o)}>
        View ▾
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="group-label">Panels</div>
          {slotOrder(projectId).map((id) => {
            const on = onScreen.has(id)
            const behind = on && isBackgroundTab(root, id)
            const last = on && onlyPane
            return (
              <button
                key={id}
                onClick={() => {
                  toggle(id)
                  setOpen(false)
                }}
                disabled={last}
                title={
                  last
                    ? 'This is the only panel left open'
                    : behind
                      ? 'Open, behind another tab in its slot'
                      : undefined
                }
              >
                {/* Three states, not two: a pane can be open but tabbed behind
                    another, which a plain tick would misreport as fully visible. */}
                <span className="check">{behind ? '◗' : on ? '✓' : ''}</span>
                {shortLabelOf(id)}
                <small>{shortcutOf(id)}</small>
              </button>
            )
          })}

          <div className="divider" />
          <button
            onClick={() => {
              toggleExplorer()
              setOpen(false)
            }}
            title="The project and file list down the left-hand side"
          >
            <span className="check">{explorerOpen ? '✓' : ''}</span>
            Explorer
            <small>files</small>
          </button>

          <button
            onClick={() => {
              toggleMinimap()
              setOpen(false)
            }}
            title="Minimaps appear only when a diagram is bigger than its pane"
          >
            <span className="check">{minimap ? '✓' : ''}</span>
            Minimap
            <small>when oversized</small>
          </button>

          <div className="divider" />
          <button
            onClick={() => {
              resetLayout()
              setOpen(false)
            }}
          >
            Reset layout
          </button>
        </div>
      )}
    </div>
  )
}
