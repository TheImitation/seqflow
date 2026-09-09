import { useMemo, useState } from 'react'
import { useDismiss } from '../components/useDismiss'
import { contractByName, type Message } from '../dsl/ast'
import { serialize } from '../dsl/serializer'
import { useStore } from '../state/store'
import {
  applyUnhappyPaths,
  defaultHappyLabel,
  findDlqParticipant,
} from './generateUnhappyPaths'
import { suggestUnhappyPaths, type UnhappySuggestion } from './unhappyPathRules'

/**
 * The checklist: nothing is inserted until the person ticks and confirms, and
 * the preview shows the exact DSL that will land in the document.
 */
export function UnhappyPathDialog({
  message,
  onClose,
  onApplied,
}: {
  message: Message
  onClose: () => void
  onApplied: (summary: string) => void
}) {
  useDismiss(onClose)
  const doc = useStore((s) => s.doc)
  const replaceDoc = useStore((s) => s.replaceDoc)

  const { context, suggestions } = useMemo(
    () => suggestUnhappyPaths(doc, message),
    [doc, message],
  )

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(suggestions.filter((s) => s.defaultChecked).map((s) => s.id)),
  )
  const [happyLabel, setHappyLabel] = useState(() => defaultHappyLabel(doc, message.id))
  const contract = contractByName(doc, message.contractRef)
  // Only meaningful when there is a contract to record them on.
  const [addResponses, setAddResponses] = useState(() => !!contract)
  const chosen = suggestions.filter((s) => checked.has(s.id))
  const needsDlq = chosen.some((s) => s.needsParticipant)
  const existingDlq = findDlqParticipant(doc)

  const preview = useMemo(() => {
    if (!chosen.length) return ''
    const result = applyUnhappyPaths(doc, message.id, chosen, {
      happyLabel,
      addContractResponses: addResponses,
    })
    return serialize(result.doc)
  }, [doc, message.id, chosen, happyLabel, addResponses])

  const groups = useMemo(() => {
    const map = new Map<string, UnhappySuggestion[]>()
    for (const s of suggestions) {
      const list = map.get(s.group)
      if (list) list.push(s)
      else map.set(s.group, [s])
    }
    return [...map]
  }, [suggestions])

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const confirm = () => {
    const result = applyUnhappyPaths(doc, message.id, chosen, {
      happyLabel,
      addContractResponses: addResponses,
    })
    replaceDoc(result.doc)

    const bits: string[] = []
    if (result.addedBranches) bits.push(`${result.addedBranches} alt branch${result.addedBranches === 1 ? '' : 'es'}`)
    const optBlocks = result.addedBlocks - (result.addedBranches ? 1 : 0)
    if (optBlocks > 0) bits.push(`${optBlocks} opt block${optBlocks === 1 ? '' : 's'}`)
    if (result.addedResponses) bits.push(`${result.addedResponses} contract response${result.addedResponses === 1 ? '' : 's'}`)
    if (result.createdParticipantId) bits.push(`added ${result.createdParticipantId}`)

    onApplied(`Added ${bits.join(', ')}`)
    onClose()
  }

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Suggest unhappy paths">
        <header>
          <h2>Suggest unhappy paths</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <p className="hint" style={{ marginBottom: 12 }}>
              <code>
                {message.from} → {message.to}: {message.label}
              </code>
              <br />
              Rules matched on <b>{context.transport}</b>
              {context.transport === 'http' && <> · <b>{context.method}</b></>}
              {context.targetKind && <> · target is <b>{context.targetKind}</b></>}
              {context.brokerId && context.consumerId && (
                <> · delivers to <b>{context.consumerId}</b></>
              )}
              .
            </p>

            {!suggestions.length && (
              <p className="hint">
                Every failure mode this rule table knows about is already modelled on
                this contract.
              </p>
            )}

            {groups.map(([group, items]) => (
              <div key={group}>
                <div className="group-head">{group}</div>
                {items.map((s) => (
                  <div
                    key={s.id}
                    className={`suggestion${checked.has(s.id) ? ' checked' : ''}`}
                  >
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={checked.has(s.id)}
                        onChange={() => toggle(s.id)}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="title">{s.label}</span>
                        <span className="shape">{s.shape}</span>
                        <div className="desc">{s.description}</div>
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div className="field">
              <span>HAPPY BRANCH LABEL</span>
              <input
                className="mono"
                type="text"
                value={happyLabel}
                onChange={(e) => setHappyLabel(e.target.value)}
              />
            </div>

            <label className="check" style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={addResponses}
                disabled={!contract}
                onChange={(e) => setAddResponses(e.target.checked)}
              />
              <span>
                Also record these as responses on{' '}
                {contract ? <code>@{contract.name}</code> : <em>the contract</em>}
                {!contract && (
                  <div className="desc" style={{ color: 'var(--text-faint)' }}>
                    This message has no contract yet — attach one first if you want the
                    responses recorded too.
                  </div>
                )}
              </span>
            </label>

            {needsDlq && (
              <p className="hint">
                {existingDlq ? (
                  <>
                    Routing dead letters to the existing <code>{existingDlq}</code>{' '}
                    participant.
                  </>
                ) : (
                  <>
                    No dead-letter queue in this diagram — one will be added as{' '}
                    <code>DLQ : aws:sqs</code>.
                  </>
                )}
              </p>
            )}

            <div className="field" style={{ flex: 1, minHeight: 0 }}>
              <span>PREVIEW</span>
              {preview ? (
                <pre className="preview" style={{ flex: 1 }}>
                  {preview}
                </pre>
              ) : (
                <p className="hint">Tick a branch to see the DSL it will generate.</p>
              )}
            </div>
          </div>
        </div>

        <footer>
          <span className="hint">
            {chosen.length} selected · {chosen.filter((s) => s.shape === 'alt').length} alt,{' '}
            {chosen.filter((s) => s.shape === 'opt').length} opt
          </span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={!chosen.length}>
            Insert into diagram
          </button>
        </footer>
      </div>
    </div>
  )
}
