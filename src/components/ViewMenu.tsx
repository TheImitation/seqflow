import { useEffect, useRef, useState } from 'react'
import {
  isBackgroundTab,
  PANEL_LABEL,
  PANEL_ORDER,
  PANEL_SHORTCUT,
  paneIds,
  usePanels,
} from '../state/panels'

/** Every panel in one place, so nothing can be hidden past finding again. */
export function ViewMenu() {
  const root = usePanels((s) => s.root)
  const toggle = usePanels((s) => s.toggle)
  const resetLayout = usePanels((s) => s.resetLayout)
  const minimap = usePanels((s) => s.minimap)
  const toggleMinimap = usePanels((s) => s.toggleMinimap)
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
          {PANEL_ORDER.map((id) => {
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
                {PANEL_LABEL[id]}
                <small>{PANEL_SHORTCUT[id]}</small>
              </button>
            )
          })}

          <div className="divider" />
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
