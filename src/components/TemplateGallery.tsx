import { PATTERNS } from '../templates/patterns'
import { useStore } from '../state/store'
import { useDismiss } from './useDismiss'

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  useDismiss(onClose)
  const setText = useStore((s) => s.setText)
  const select = useStore((s) => s.select)
  const reset = useStore((s) => s.resetPlayback)

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="AWS pattern templates">
        <header>
          <h2>AWS patterns</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">
          <p className="hint" style={{ marginBottom: 14 }}>
            Each one replaces the editor contents and both diagrams update immediately.
            They double as worked examples of the syntax.
          </p>
          <div className="gallery">
            {PATTERNS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setText(p.dsl, 'command')
                  select(null)
                  reset()
                  onClose()
                }}
              >
                <span className="name">{p.name}</span>
                <span className="blurb">{p.blurb}</span>
                <span className="teaches">{p.teaches}</span>
              </button>
            ))}
          </div>
        </div>
        <footer>
          <span className="hint">Loading a template replaces the current diagram — undo brings it back.</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}
