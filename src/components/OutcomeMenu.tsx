import { useEffect, useMemo, useRef, useState } from 'react'
import { enumerateOutcomes, type Outcome } from '../dsl/outcomes'
import { useStore } from '../state/store'
import { useDismiss } from './useDismiss'

/**
 * Every distinct way the diagram can play out, in one list.
 *
 * Playback has always walked one path; this names them all, so "what are the
 * ways this can end" stops being something you reconstruct by toggling branch
 * pickers one at a time.
 */
export function OutcomeMenu() {
  const doc = useStore((s) => s.doc)
  const setBranchChoice = useStore((s) => s.setBranchChoice)
  const setFocusPath = useStore((s) => s.setFocusPath)
  const focusPath = useStore((s) => s.focusPath)
  const resetPlayback = useStore((s) => s.resetPlayback)
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)

  const outcomes = useMemo(() => enumerateOutcomes(doc), [doc])

  useDismiss(() => setOpen(false), open)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  if (outcomes.length <= 1) return null

  const trace = (outcome: Outcome) => {
    for (const d of outcome.decisions) setBranchChoice(d.blockId, d.branchIndex)
    setFocusPath({ id: outcome.id, messageIds: outcome.messageIds })
    resetPlayback()
    setOpen(false)
  }

  const unhappy = outcomes.filter((o) => o.isUnhappy).length

  return (
    <div className="dropdown up" ref={host}>
      <button
        className={`btn${open ? ' active' : ''}${focusPath ? ' tracing' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Every distinct path through the diagram"
      >
        {outcomes.length} outcome{outcomes.length === 1 ? '' : 's'}
        {unhappy > 0 && <span className="warn-dot"> ⚠{unhappy}</span>} ▴
      </button>

      {open && (
        <div className="menu outcomes" role="menu">
          <div className="group-label">
            {outcomes.length} distinct paths · {unhappy} end in a failure branch
          </div>

          {outcomes.map((o) => (
            <button
              key={o.id}
              className={`outcome${o.isUnhappy ? ' unhappy' : ''}${
                focusPath?.id === o.id ? ' current' : ''
              }`}
              onClick={() => trace(o)}
            >
              <span className="outcome-head">
                {o.isUnhappy ? '⚠' : '✓'}
                <b>
                  {o.decisions.length
                    ? o.decisions.map((d) => d.branchLabel).join(' → ')
                    : 'single path'}
                </b>
              </span>
              <small>
                {o.stepCount} step{o.stepCount === 1 ? '' : 's'}
                {o.endsAt ? ` · ends at ${o.endsAt}` : ''}
                {o.declaredFailures > 0
                  ? ` · ${o.declaredFailures} declared failure${
                      o.declaredFailures === 1 ? '' : 's'
                    } not drawn`
                  : ''}
              </small>
            </button>
          ))}

          {focusPath && (
            <>
              <div className="divider" />
              <button
                onClick={() => {
                  setFocusPath(null)
                  setOpen(false)
                }}
              >
                Stop tracing
                <small>show everything again</small>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
