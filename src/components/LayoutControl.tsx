import { useEffect, useRef, useState } from 'react'
import {
  LAYOUT_MODES,
  MODE_GLYPH,
  MODE_HINT,
  MODE_LABEL,
  type LayoutMode,
} from '../state/viewLayout'

/**
 * How a graph pane is arranged, in one header button.
 *
 * A dropdown rather than a run of buttons because `.pane-head` is 33px tall and
 * already carries a direction toggle, four zoom controls and the hide button —
 * three more would not fit. It absorbs the direction toggle, which only has
 * meaning for the ranked layout anyway.
 */
export function LayoutControl({
  mode,
  setMode,
  sticky,
  stickyApplies,
  toggleSticky,
  reorganise,
  direction,
  setDirection,
  hasPins,
  settling,
}: {
  mode: LayoutMode
  setMode: (mode: LayoutMode) => void
  sticky: boolean
  stickyApplies: boolean
  toggleSticky: () => void
  reorganise: () => void
  direction: 'LR' | 'TB'
  setDirection: (direction: 'LR' | 'TB') => void
  hasPins: boolean
  settling: boolean
}) {
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="dropdown layout-control" ref={host}>
      <button
        className={`btn ghost sm${open ? ' active' : ''}${settling ? ' settling' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Layout: ${MODE_LABEL[mode]} — ${MODE_HINT[mode]}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="mode-glyph">{MODE_GLYPH[mode]}</span>
        {MODE_LABEL[mode]}
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="group-label">Arrangement</div>
          {LAYOUT_MODES.map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setOpen(false)
              }}
              title={MODE_HINT[m]}
            >
              <span className="check">{mode === m ? '✓' : ''}</span>
              {MODE_GLYPH[m]} {MODE_LABEL[m]}
            </button>
          ))}

          <div className="divider" />
          <button
            onClick={() => {
              toggleSticky()
              setOpen(false)
            }}
            disabled={!stickyApplies}
            title={
              stickyApplies
                ? 'A node you drop keeps the position you put it in'
                : 'Manual mode always keeps a dropped position'
            }
          >
            <span className="check">{sticky || !stickyApplies ? '✓' : ''}</span>
            Sticky drops
            <small>{stickyApplies ? '📌' : 'always'}</small>
          </button>

          <div className="divider" />
          <div className="group-label">Ranked layout</div>
          {(['LR', 'TB'] as const).map((d) => (
            <button
              key={d}
              onClick={() => {
                setDirection(d)
                setOpen(false)
              }}
              title={
                mode === 'rigid'
                  ? 'Direction the ranks run in'
                  : 'Direction the ranked layout runs in, which seeds this view and Re-organise'
              }
            >
              <span className="check">{direction === d ? '✓' : ''}</span>
              {d === 'LR' ? 'Left to right' : 'Top to bottom'}
            </button>
          ))}

          <div className="divider" />
          <button
            onClick={() => {
              reorganise()
              setOpen(false)
            }}
            disabled={!hasPins && mode === 'rigid'}
            title={
              hasPins
                ? 'Release every parked node and arrange the graph from scratch. Not undoable with ⌘Z — this is view state, not part of the document.'
                : 'Arrange the graph from scratch'
            }
          >
            ↻ Re-organise
            {hasPins && <small>unpins all</small>}
          </button>
        </div>
      )}
    </div>
  )
}
