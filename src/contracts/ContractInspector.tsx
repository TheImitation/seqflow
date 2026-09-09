import { useState } from 'react'
import { messageIsOnUnhappyPath } from '../dsl/architecture'
import {
  BODY_KINDS,
  BODY_MEDIA_TYPE,
  contractByName,
  effectiveBody,
  isDatabaseKind,
  isStructuredBody,
  KIND_GROUPS,
  modelByName,
  type BodyKind,
  type Contract,
  type HttpMethod,
  type Message,
  type MessageStyle,
  type ParticipantKind,
  type SequenceDoc,
  type Transport,
} from '../dsl/ast'
import { DatabaseSchema, TableCard } from './DatabaseSchema'
import {
  insertMessage,
  moveParticipant,
  moveStep,
  removeBlock,
  removeMessage,
  removeNote,
  removeParticipant,
  renameParticipant,
} from '../dsl/edit'
import { DraftField } from '../components/DraftField'
import { useDismiss } from '../components/useDismiss'
import { validateContractName, validateParticipantId } from '../dsl/validate'
import { KindIcon } from '../render/aws-icons'
import { KIND_LABEL } from '../render/aws-icons/labels'
import { usePanels } from '../state/panels'
import { useStore, type Selection } from '../state/store'
import {
  TRANSPORTS,
  contractUsage,
  draftContract,
  emptyModel,
  renameContract,
} from './contractStore'
import { uniqueModelName } from './modelEdit'
import {
  applyBodyTemplate,
  BODY_TEMPLATES,
  contentTypeMismatch,
  setContentType,
  type BodyTemplate,
} from './dataTemplates'
import { FieldTree } from './FieldTree'
import { HEADER_PRESETS, HTTP_METHODS, STATUS_BY_CODE, STATUS_CODES } from './unhappyPathRules'

export function ContractInspector() {
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const hidePanel = usePanels((s) => s.hide)

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <button
          className="btn ghost icon"
          onClick={() => hidePanel('inspector')}
          aria-label="Hide the inspector"
          title="Hide the inspector (⌘B)"
        >
          ›
        </button>
        <h2>{titleFor(selection)}</h2>
        {selection && (
          <button
            className="btn ghost icon"
            onClick={() => select(null)}
            aria-label="Clear selection"
            title="Clear selection (esc)"
          >
            ✕
          </button>
        )}
      </div>
      <div className="inspector-body">
        <Body />
      </div>
    </aside>
  )
}

function titleFor(selection: Selection | null): string {
  if (!selection) return 'Inspector'
  switch (selection.type) {
    case 'message':
      return 'Interaction'
    case 'participant':
      return 'Participant'
    case 'block':
      return 'Block'
    case 'note':
      return 'Note'
    case 'edge':
      return 'Architecture link'
    case 'contract':
      return 'Contract'
    case 'model':
      return 'Data model'
    case 'table':
      return 'Database table'
  }
}

function Body() {
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)

  if (!selection) return <EmptyState />

  switch (selection.type) {
    case 'message': {
      const message = doc.messages.find((m) => m.id === selection.id)
      return message ? <MessagePanel message={message} /> : <EmptyState />
    }
    case 'participant':
      return <ParticipantPanel id={selection.id} />
    case 'block':
      return <BlockPanel id={selection.id} />
    case 'note':
      return <NotePanel id={selection.id} />
    case 'edge':
      return <EdgePanel id={selection.id} />
    case 'contract':
      return <ContractPanel name={selection.name} />
    case 'model':
      return <ModelPanel name={selection.name} />
    case 'table':
      return <TablePanel name={selection.name} />
  }
}

function EmptyState() {
  return (
    <div className="empty-state">
      <strong>Nothing selected</strong>
      Click an arrow to attach a contract and generate its unhappy paths, a
      participant box to change its kind, or a link in the architecture view to see
      every interaction it stands for.
    </div>
  )
}

/* --------------------------------------------------------------- message */

const STYLES: { value: MessageStyle; label: string; arrow: string }[] = [
  { value: 'sync', label: 'Sync call', arrow: '->>' },
  { value: 'async', label: 'Async / reply', arrow: '-->>' },
  { value: 'fireAndForget', label: 'Fire and forget', arrow: '-x' },
]

function MessagePanel({ message }: { message: Message }) {
  const doc = useStore((s) => s.doc)
  const mutate = useStore((s) => s.mutate)
  const select = useStore((s) => s.select)
  const setSuggestingFor = useStore((s) => s.setSuggestingFor)

  const contract = contractByName(doc, message.contractRef)
  const unhappy = messageIsOnUnhappyPath(doc, message)

  const patch = (fields: Partial<Message>) =>
    mutate((draft) => {
      const m = draft.messages.find((x) => x.id === message.id)
      if (m) Object.assign(m, fields)
    })

  return (
    <>
      <section className="section">
        <header>Interaction</header>
        <div className="content">
          <div className="field-row">
            <label className="field">
              <span>FROM</span>
              <select value={message.from} onChange={(e) => patch({ from: e.target.value })}>
                {doc.participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>TO</span>
              <select value={message.to} onChange={(e) => patch({ to: e.target.value })}>
                {doc.participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <DraftField
            label="LABEL"
            value={message.label}
            onCommit={(label) => patch({ label })}
          />

          <label className="field">
            <span>STYLE</span>
            <select
              value={message.style}
              onChange={(e) => patch({ style: e.target.value as MessageStyle })}
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({s.arrow})
                </option>
              ))}
            </select>
          </label>

          {unhappy && (
            <p className="hint" style={{ color: 'var(--amber)' }}>
              This interaction sits on an unhappy path — it renders amber in both views.
            </p>
          )}

          <div className="field-row">
            <button
              className="btn sm"
              onClick={() => mutate((d) => moveStep(d, message.id, -1))}
              title="Move earlier"
            >
              ↑ Earlier
            </button>
            <button
              className="btn sm"
              onClick={() => mutate((d) => moveStep(d, message.id, 1))}
              title="Move later"
            >
              ↓ Later
            </button>
            <button
              className="btn sm"
              onClick={() =>
                mutate((d) => {
                  insertMessage(d, message.order + 1, {
                    from: message.to,
                    to: message.from,
                    label: 'response',
                    style: 'async',
                    parentBlock: message.parentBlock,
                  })
                })
              }
            >
              + Reply
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                mutate((d) => removeMessage(d, message.id))
                select(null)
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      <section className="section">
        <header>
          Contract
          <span className="spacer" />
          {contract && (
            <button
              className="btn sm"
              onClick={() => patch({ contractRef: undefined })}
              title="Detach without deleting the contract"
            >
              Detach
            </button>
          )}
        </header>
        <div className="content">
          <label className="field">
            <span>ATTACHED CONTRACT</span>
            <select
              value={message.contractRef ?? ''}
              onChange={(e) => patch({ contractRef: e.target.value || undefined })}
            >
              <option value="">— none —</option>
              {doc.contracts.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {!contract && (
            <button
              className="btn"
              onClick={() =>
                mutate((draft) => {
                  const created = draftContract(draft, message)
                  draft.contracts.push(created)
                  const m = draft.messages.find((x) => x.id === message.id)
                  if (m) m.contractRef = created.name
                })
              }
            >
              + Create a contract for this interaction
            </button>
          )}
        </div>
      </section>

      {contract && <ContractEditor contract={contract} />}

      <section className="section">
        <header>Failure modes</header>
        <div className="content">
          <p className="hint">
            Runs a rule table keyed on transport, method and target kind, then inserts
            the branches you tick as real <code>alt</code> / <code>opt</code> blocks.
          </p>
          <button className="btn primary" onClick={() => setSuggestingFor(message.id)}>
            Suggest unhappy paths…
          </button>
        </div>
      </section>
    </>
  )
}

/* -------------------------------------------------------------- contract */

function ContractEditor({ contract }: { contract: Contract }) {
  const doc = useStore((s) => s.doc)
  const mutate = useStore((s) => s.mutate)
  const [open, setOpen] = useState<string | null>(null)
  const [bodyPicker, setBodyPicker] = useState(false)

  const edit = (fn: (c: Contract, draft: SequenceDoc) => void) =>
    mutate((draft) => {
      const c = draft.contracts.find((x) => x.name === contract.name)
      if (c) fn(c, draft)
    })

  const isHttp = contract.transport === 'http'
  const model = modelByName(doc, contract.modelName)
  const bodyKind = effectiveBody(contract)
  const mismatch = contentTypeMismatch(contract)
  const usage = contractUsage(doc, contract.name)

  return (
    <>
      <section className="section">
        <header>
          {contract.name}
          <span className="spacer" />
          <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
            on {usage.length} arrow{usage.length === 1 ? '' : 's'}
          </span>
        </header>
        <div className="content">
          <DraftField
            label="NAME"
            value={contract.name}
            commitOn="blur"
            hint="Arrows reference this as @Name."
            validate={(next) => validateContractName(doc, contract.name, next)}
            onCommit={(next) => {
              const trimmed = next.trim()
              if (trimmed === contract.name) return true
              let ok = false
              mutate((draft) => {
                ok = renameContract(draft, contract.name, trimmed)
              })
              return ok
            }}
          />

          <label className="field">
            <span>TRANSPORT</span>
            <select
              value={contract.transport}
              onChange={(e) =>
                edit((c) => {
                  c.transport = e.target.value as Transport
                  if (c.transport !== 'http') {
                    c.method = undefined
                    c.path = undefined
                  } else {
                    c.method ??= 'POST'
                    c.path ??= '/resource'
                  }
                })
              }
            >
              {TRANSPORTS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {isHttp && (
            <div className="field-row">
              <label className="field" style={{ flex: '0 0 96px' }}>
                <span>METHOD</span>
                <select
                  value={contract.method ?? 'POST'}
                  onChange={(e) => edit((c) => (c.method = e.target.value as HttpMethod))}
                >
                  {HTTP_METHODS.map((m) => (
                    <option key={m.method} value={m.method}>
                      {m.method}
                    </option>
                  ))}
                </select>
              </label>
              <DraftField
                label="PATH"
                value={contract.path ?? ''}
                onCommit={(path) => edit((c) => (c.path = path))}
              />
            </div>
          )}

          {isHttp && (
            <p className="hint">
              {HTTP_METHODS.find((m) => m.method === (contract.method ?? 'POST'))?.use}.
              Typically {HTTP_METHODS.find((m) => m.method === (contract.method ?? 'POST'))?.happy}{' '}
              on success.
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <header>
          Headers
          <span className="spacer" />
          <button
            className="btn sm"
            onClick={() =>
              edit((c) => c.headers.push({ key: 'X-Header', value: 'string', required: false }))
            }
          >
            + Add
          </button>
        </header>
        <div className="content">
          {contract.headers.length > 0 && (
            <table className="grid">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th className="req">Req</th>
                  <th className="act" />
                </tr>
              </thead>
              <tbody>
                {contract.headers.map((h, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="mono"
                        type="text"
                        value={h.key}
                        onChange={(e) => edit((c) => (c.headers[i].key = e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        className="mono"
                        type="text"
                        value={h.value}
                        onChange={(e) => edit((c) => (c.headers[i].value = e.target.value))}
                      />
                    </td>
                    <td className="req">
                      <input
                        type="checkbox"
                        checked={h.required}
                        onChange={(e) => edit((c) => (c.headers[i].required = e.target.checked))}
                      />
                    </td>
                    <td className="act">
                      <button
                        className="btn ghost sm"
                        onClick={() => edit((c) => c.headers.splice(i, 1))}
                        aria-label={`Remove ${h.key}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {HEADER_PRESETS.filter(
              (p) => !contract.headers.some((h) => h.key.toLowerCase() === p.key.toLowerCase()),
            ).map((p) => (
              <button
                key={p.key}
                className="btn sm"
                title={p.note}
                onClick={() =>
                  edit((c) => c.headers.push({ key: p.key, value: p.value, required: false }))
                }
              >
                + {p.key}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <header>
          Request body
          <span className="spacer" />
          <button className="btn sm" onClick={() => setBodyPicker(true)}>
            Templates…
          </button>
        </header>
        <div className="content">
          <label className="field">
            <span>SENT AS</span>
            <select
              value={bodyKind}
              onChange={(e) =>
                edit((c) => {
                  const next = e.target.value as BodyKind
                  c.body = next
                  setContentType(c, next)
                  if (!isStructuredBody(next)) c.modelName = undefined
                })
              }
            >
              {BODY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === 'none' ? 'No body' : `${k} · ${BODY_MEDIA_TYPE[k]}`}
                </option>
              ))}
            </select>
          </label>

          {mismatch && (
            <p className="hint" style={{ color: 'var(--amber)' }}>
              {mismatch}{' '}
              <button
                className="btn sm"
                onClick={() => edit((c) => setContentType(c, bodyKind))}
              >
                Fix header
              </button>
            </p>
          )}

          {isStructuredBody(bodyKind) ? (
            <>
              <label className="field">
                <span>SHAPE</span>
                <select
                  value={contract.modelName ?? ''}
                  onChange={(e) => edit((c) => (c.modelName = e.target.value || undefined))}
                >
                  <option value="">— none —</option>
                  {doc.dataModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <FieldTree model={model} />
              {!model && (
                <button
                  className="btn sm"
                  onClick={() =>
                    mutate((draft) => {
                      const created = emptyModel(
                        uniqueModelName(draft, `${contract.name}Body`),
                      )
                      draft.dataModels.push(created)
                      const c = draft.contracts.find((x) => x.name === contract.name)
                      if (c) c.modelName = created.name
                    })
                  }
                >
                  + Create a model
                </button>
              )}
            </>
          ) : (
            <p className="hint">
              {bodyKind === 'none'
                ? 'Nothing is sent with this request.'
                : `An opaque ${BODY_MEDIA_TYPE[bodyKind]} payload — no field shape to describe.`}
            </p>
          )}
        </div>
      </section>

      {bodyPicker && (
        <BodyTemplatePicker
          current={bodyKind}
          onClose={() => setBodyPicker(false)}
          onPick={(template) => {
            mutate((draft) => {
              const c = draft.contracts.find((x) => x.name === contract.name)
              if (c) applyBodyTemplate(draft, c, template, contract.name)
            })
            setBodyPicker(false)
          }}
        />
      )}

      <section className="section">
        <header>
          Responses
          <span className="spacer" />
          <button
            className="btn sm"
            onClick={() =>
              edit((c) =>
                c.responses.push({
                  code: isHttp ? '500' : 'failure',
                  label: isHttp ? 'InternalServerError' : 'Failed',
                  isHappyPath: false,
                }),
              )
            }
          >
            + Add
          </button>
        </header>
        <div className="content">
          {!contract.responses.length && (
            <p className="hint">No responses modelled yet.</p>
          )}
          {contract.responses.map((r, i) => {
            const key = `${r.code}-${i}`
            const known = STATUS_BY_CODE.get(r.code)
            return (
              <div
                key={key}
                className={`response${r.isHappyPath ? '' : ' unhappy'}`}
              >
                <button onClick={() => setOpen(open === key ? null : key)}>
                  <span className="dot" />
                  <span className="code">{r.code}</span>
                  <span className="meaning">{r.label || known?.meaning || ''}</span>
                  {effectiveBody(r) !== 'json' && effectiveBody(r) !== 'none' && (
                    <span className="response-kind">{effectiveBody(r)}</span>
                  )}
                  <span style={{ color: 'var(--text-faint)' }}>{open === key ? '▾' : '▸'}</span>
                </button>

                {open === key && (
                  <div className="detail">
                    <div className="field-row">
                      <div style={{ flex: '0 0 92px' }}>
                        <DraftField
                          label="CODE"
                          value={r.code}
                          commitOn="blur"
                          list="seqflow-status-codes"
                          validate={(next) =>
                            next.trim()
                              ? undefined
                              : { error: 'A response needs a code.', suggestion: r.code }
                          }
                          onCommit={(code) =>
                            edit((c) => {
                              c.responses[i].code = code.trim()
                              const info = STATUS_BY_CODE.get(code.trim())
                              if (info) {
                                c.responses[i].isHappyPath = info.happy
                                c.responses[i].label = info.meaning.replace(/\s+/g, '')
                              }
                            })
                          }
                        />
                      </div>
                      <DraftField
                        label="LABEL"
                        value={r.label}
                        commitOn="blur"
                        onCommit={(label) => edit((c) => (c.responses[i].label = label))}
                      />
                    </div>

                    <label className="field">
                      <span>RETURNED AS</span>
                      <select
                        value={effectiveBody(r)}
                        onChange={(e) =>
                          edit((c) => {
                            const next = e.target.value as BodyKind
                            c.responses[i].body = next
                            if (!isStructuredBody(next)) c.responses[i].modelName = undefined
                          })
                        }
                      >
                        {BODY_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k === 'none' ? 'No body' : `${k} · ${BODY_MEDIA_TYPE[k]}`}
                          </option>
                        ))}
                      </select>
                    </label>

                    {isStructuredBody(effectiveBody(r)) && (
                      <label className="field">
                        <span>BODY MODEL</span>
                        <select
                          value={r.modelName ?? ''}
                          onChange={(e) =>
                            edit((c) => (c.responses[i].modelName = e.target.value || undefined))
                          }
                        >
                          <option value="">— none —</option>
                          {doc.dataModels.map((m) => (
                            <option key={m.name} value={m.name}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!r.isHappyPath}
                        onChange={(e) => edit((c) => (c.responses[i].isHappyPath = !e.target.checked))}
                      />
                      <span>Unhappy path</span>
                    </label>

                    <button
                      className="btn sm danger"
                      onClick={() => edit((c) => c.responses.splice(i, 1))}
                    >
                      Remove response
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          <datalist id="seqflow-status-codes">
            {STATUS_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.meaning}
              </option>
            ))}
          </datalist>
        </div>
      </section>
    </>
  )
}

function BodyTemplatePicker({
  current,
  onClose,
  onPick,
}: {
  current: BodyKind
  onClose: () => void
  onPick: (template: BodyTemplate) => void
}) {
  useDismiss(onClose)

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Body templates">
        <header>
          <h2>Body templates</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">
          <p className="hint" style={{ marginBottom: 14 }}>
            Sets how the body is encoded, the matching <code>Content-Type</code>, and a
            starter shape. An existing shape is kept — changing how something is sent
            does not throw away what is in it.
          </p>
          <div className="gallery">
            {BODY_TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => onPick(t)}>
                <span className="name">
                  {t.name}
                  {/* Marks the encoding already in use, which several
                      templates can share. */}
                  {t.kind === current && <span className="tag">current kind</span>}
                </span>
                <span className="blurb">{t.blurb}</span>
                <span className="teaches">
                  {t.kind === 'none' ? 'no body' : BODY_MEDIA_TYPE[t.kind]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <footer>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- participant */

function ParticipantPanel({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const mutate = useStore((s) => s.mutate)
  const select = useStore((s) => s.select)

  const participant = doc.participants.find((p) => p.id === id)
  if (!participant) return <EmptyState />

  const touching = doc.messages.filter((m) => m.from === id || m.to === id)

  return (
    <>
      <section className="section">
        <header>
          <KindIcon kind={participant.kind} size={14} />
          {KIND_LABEL[participant.kind]}
        </header>
        <div className="content">
          <DraftField
            label="ID (used in the DSL)"
            value={id}
            commitOn="blur"
            hint="No spaces — this is the name arrows reference."
            validate={(next) => validateParticipantId(doc, id, next)}
            onCommit={(next) => {
              const trimmed = next.trim()
              if (trimmed === id) return true
              let ok = false
              mutate((draft) => {
                ok = renameParticipant(draft, id, trimmed)
              })
              if (ok) select({ type: 'participant', id: trimmed })
              return ok
            }}
          />

          <DraftField
            label="LABEL"
            mono={false}
            value={participant.label}
            placeholder={id}
            hint="Shown on the diagram. Leave empty to use the id."
            onCommit={(label) =>
              mutate((draft) => {
                const p = draft.participants.find((x) => x.id === id)
                if (p) p.label = label || id
              })
            }
          />

          <label className="field">
            <span>KIND</span>
            <select
              value={participant.kind}
              onChange={(e) =>
                mutate((draft) => {
                  const p = draft.participants.find((x) => x.id === id)
                  if (p) p.kind = e.target.value as ParticipantKind
                })
              }
            >
              {KIND_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.kinds.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="field-row">
            <button className="btn sm" onClick={() => mutate((d) => moveParticipant(d, id, -1))}>
              ← Left
            </button>
            <button className="btn sm" onClick={() => mutate((d) => moveParticipant(d, id, 1))}>
              Right →
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                mutate((d) => removeParticipant(d, id))
                select(null)
              }}
              title={`Also removes ${touching.length} interaction(s)`}
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      {isDatabaseKind(participant.kind) && (
        <section className="section">
          <header>Schema</header>
          <DatabaseSchema participantId={id} />
        </section>
      )}

      <section className="section">
        <header>Interactions ({touching.length})</header>
        <div className="content">
          {!touching.length && <p className="hint">Not referenced by any message yet.</p>}
          {touching.map((m) => (
            <button
              key={m.id}
              className="btn sm"
              style={{ justifyContent: 'flex-start', width: '100%' }}
              onClick={() => select({ type: 'message', id: m.id })}
            >
              {m.from === id ? '→' : '←'} {m.from === id ? m.to : m.from}: {m.label}
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- block */

function BlockPanel({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const mutate = useStore((s) => s.mutate)
  const select = useStore((s) => s.select)
  const setBranchChoice = useStore((s) => s.setBranchChoice)

  const block = doc.blocks.find((b) => b.id === id)
  if (!block) return <EmptyState />

  const branches = block.branches ?? [
    { label: block.label, startOrder: block.startOrder, endOrder: block.endOrder, isUnhappy: block.isUnhappy },
  ]

  return (
    <>
      <section className="section">
        <header>{block.type.toUpperCase()}</header>
        <div className="content">
          <DraftField
            label="LABEL"
            value={branches[0].label}
            onCommit={(label) =>
              mutate((draft) => {
                const b = draft.blocks.find((x) => x.id === id)
                if (!b) return
                b.label = label
                if (b.branches?.length) b.branches[0].label = label
              })
            }
          />

          <label className="check">
            <input
              type="checkbox"
              checked={!!block.isUnhappy}
              onChange={(e) =>
                mutate((draft) => {
                  const b = draft.blocks.find((x) => x.id === id)
                  if (b) b.isUnhappy = e.target.checked || undefined
                })
              }
            />
            <span>Marked (unhappy) — renders amber in both views</span>
          </label>

          <div className="field-row">
            <button className="btn sm" onClick={() => mutate((d) => moveStep(d, id, -1))}>
              ↑ Earlier
            </button>
            <button className="btn sm" onClick={() => mutate((d) => moveStep(d, id, 1))}>
              ↓ Later
            </button>
          </div>
          <div className="field-row">
            <button
              className="btn sm"
              onClick={() => {
                mutate((d) => removeBlock(d, id, true))
                select(null)
              }}
              title="Remove the wrapper, keep the messages inside"
            >
              Unwrap
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                mutate((d) => removeBlock(d, id, false))
                select(null)
              }}
              title="Remove the block and everything in it"
            >
              Delete all
            </button>
          </div>
        </div>
      </section>

      {block.type === 'alt' && (
        <section className="section">
          <header>Branches ({branches.length})</header>
          <div className="content">
            {branches.map((b, i) => (
              <div key={i} className="field-row" style={{ alignItems: 'center' }}>
                <span
                  className="dot"
                  style={{
                    flex: 'none',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: b.isUnhappy ? 'var(--amber)' : 'var(--green)',
                  }}
                />
                <input
                  className="mono"
                  type="text"
                  value={b.label}
                  onChange={(e) =>
                    mutate((draft) => {
                      const blk = draft.blocks.find((x) => x.id === id)
                      if (blk?.branches) blk.branches[i].label = e.target.value
                      if (blk && i === 0) blk.label = e.target.value
                    })
                  }
                />
                <button
                  className="btn sm"
                  style={{ flex: 'none' }}
                  onClick={() => setBranchChoice(id, i)}
                  title="Walk this branch during playback"
                >
                  ▶
                </button>
              </div>
            ))}
            <p className="hint">
              ▶ makes playback walk that branch — a 503 or a DLQ path animates through
              both diagrams exactly like the happy one.
            </p>
          </div>
        </section>
      )}
    </>
  )
}

/* ----------------------------------------------------------------- note */

function NotePanel({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const mutate = useStore((s) => s.mutate)
  const select = useStore((s) => s.select)

  const note = doc.notes.find((n) => n.id === id)
  if (!note) return <EmptyState />

  return (
    <section className="section">
      <header>Note</header>
      <div className="content">
        <label className="field">
          <span>TEXT</span>
          <textarea
            rows={3}
            value={note.text}
            onChange={(e) =>
              mutate((draft) => {
                const n = draft.notes.find((x) => x.id === id)
                if (n) n.text = e.target.value
              })
            }
          />
        </label>
        <label className="field">
          <span>OVER</span>
          <input className="mono" type="text" value={note.over.join(', ')} readOnly />
        </label>
        <div className="field-row">
          <button className="btn sm" onClick={() => mutate((d) => moveStep(d, id, -1))}>
            ↑ Earlier
          </button>
          <button className="btn sm" onClick={() => mutate((d) => moveStep(d, id, 1))}>
            ↓ Later
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              mutate((d) => removeNote(d, id))
              select(null)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- edge */

function EdgePanel({ id }: { id: string }) {
  const doc = useStore((s) => s.doc)
  const arch = useStore((s) => s.arch)
  const select = useStore((s) => s.select)

  const edge = arch.edges.find((e) => `${e.from} ${e.to}` === id)
  if (!edge) return <EmptyState />

  const messages = doc.messages.filter((m) => m.from === edge.from && m.to === edge.to)
  const label = (pid: string) => doc.participants.find((p) => p.id === pid)?.label ?? pid

  return (
    <>
      <section className="section">
        <header>
          {edge.hasUnhappyPath
            ? '⚠ Failure branch drawn'
            : edge.declaredFailures > 0
              ? '○ Failures declared, none drawn'
              : 'Happy path only'}
        </header>
        <div className="content">
          <p className="hint">
            <b>{label(edge.from)}</b> → <b>{label(edge.to)}</b>
            <br />
            {edge.interactionCount} interaction{edge.interactionCount === 1 ? '' : 's'} ·{' '}
            {[...edge.styles].join(', ')}
          </p>
          {!edge.hasUnhappyPath && (
            <p className="hint">
              {edge.declaredFailures > 0 ? (
                <>
                  The contracts here declare {edge.declaredFailures} failure response
                  {edge.declaredFailures === 1 ? '' : 's'}, but none of them has a branch
                  in the sequence — nothing shows what happens next. Select an
                  interaction below and run <b>Suggest unhappy paths</b>.
                </>
              ) : (
                <>
                  Nothing on this link models what happens when it fails. Select one of
                  the interactions below and run <b>Suggest unhappy paths</b>.
                </>
              )}
            </p>
          )}
        </div>
      </section>

      <section className="section">
        <header>Interactions</header>
        <div className="content">
          {messages.map((m) => (
            <button
              key={m.id}
              className="btn sm"
              style={{ justifyContent: 'flex-start', width: '100%' }}
              onClick={() => select({ type: 'message', id: m.id })}
            >
              {m.label || '(no label)'}
              {m.contractRef ? ` @${m.contractRef}` : ''}
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

/* -------------------------------------------------------- contract/model */

function ContractPanel({ name }: { name: string }) {
  const doc = useStore((s) => s.doc)
  const contract = contractByName(doc, name)
  if (!contract) return <EmptyState />
  return <ContractEditor contract={contract} />
}

function ModelPanel({ name }: { name: string }) {
  const doc = useStore((s) => s.doc)
  const model = modelByName(doc, name)
  return (
    <section className="section">
      <header>{name}</header>
      <div className="content">
        <FieldTree model={model} />
        <p className="hint">
          Edit fields in the text pane — a <code>model</code> block is the source of truth
          for its shape.
        </p>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- table */

function TablePanel({ name }: { name: string }) {
  const doc = useStore((s) => s.doc)
  const table = doc.tables.find((t) => t.name === name)
  if (!table) return <EmptyState />
  return <TableCard table={table} />
}
