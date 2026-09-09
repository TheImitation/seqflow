import { useMemo } from 'react'
import { buildCoverage, danglingContractRefs, type ResponseState } from '../dsl/coverage'
import { useDismiss } from '../components/useDismiss'
import { useStore } from '../state/store'

const STATE_LABEL: Record<ResponseState, string> = {
  modelled: 'modelled',
  'on-failure-path': 'on a failure path',
  'declared-only': 'declared only',
}

const STATE_HINT: Record<ResponseState, string> = {
  modelled: 'A branch names this response, so playback can walk it.',
  'on-failure-path':
    'The call sits on a failure branch, but no branch names this response specifically.',
  'declared-only':
    'Nothing on the canvas follows from this. It exports to OpenAPI and nowhere else.',
}

/**
 * The gap the diagram cannot show: a response that never happens on any path
 * looks exactly like one that does. Deliberately a table — a few dozen failure
 * modes are tabular data, and forcing them into a sequence diagram is what
 * makes such diagrams unreadable.
 */
export function CoverageDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const select = useStore((s) => s.select)
  const report = useMemo(() => buildCoverage(doc), [doc])
  const dangling = useMemo(() => danglingContractRefs(doc), [doc])

  useDismiss(onClose)

  const pct = report.declared
    ? Math.round((report.modelled / report.declared) * 100)
    : 100

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Failure coverage">
        <header>
          <h2>Failure coverage</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="body">
          <p className="hint" style={{ marginBottom: 14 }}>
            <b>
              {report.modelled} of {report.declared} declared failures are modelled as
              paths ({pct}%).
            </b>{' '}
            A response marked <em>declared only</em> is a fact about one call: it has no
            position in the sequence, playback cannot reach it, and nothing shows what
            happens next.
          </p>

          {report.contracts.length === 0 && (
            <div className="empty-state">
              <strong>No contracts yet</strong>
              Attach one to a message with <code>@ContractName</code> and its responses
              appear here.
            </div>
          )}

          {report.contracts.map((c) => (
            <section key={c.contract.name} className="coverage-contract">
              <h3>
                <button
                  className="linkish"
                  onClick={() => {
                    select({ type: 'contract', name: c.contract.name })
                    onClose()
                  }}
                >
                  @{c.contract.name}
                </button>
                <small>
                  {c.messages.length === 0 ? (
                    <span className="bad">attached to nothing</span>
                  ) : (
                    `${c.messages.length} call${c.messages.length === 1 ? '' : 's'}`
                  )}
                  {c.declared > 0 && ` · ${c.modelled}/${c.declared} modelled`}
                </small>
              </h3>

              {c.declared === 0 ? (
                <p className="hint">No failure responses declared.</p>
              ) : (
                <table className="coverage">
                  <tbody>
                    {c.responses.map((r, i) => (
                      <tr key={`${r.response.code}-${i}`} className={r.state}>
                        <td className="code">{r.response.code}</td>
                        <td>{r.response.label}</td>
                        <td className="state" title={STATE_HINT[r.state]}>
                          {r.state === 'modelled' ? '●' : r.state === 'on-failure-path' ? '◐' : '○'}{' '}
                          {STATE_LABEL[r.state]}
                          {r.matchedBranch && <em> — {r.matchedBranch}</em>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}

          {(report.undeclaredBranches.length > 0 ||
            report.orphanContracts.length > 0 ||
            dangling.length > 0) && (
            <section className="coverage-contract">
              <h3>Loose ends</h3>
              <ul className="hint loose-ends">
                {report.undeclaredBranches.map((b, i) => (
                  <li key={`b${i}`}>
                    Branch <b>{b.branchLabel}</b> is drawn but no contract declares a
                    matching response — the diagram models a failure the API does not
                    admit to.
                  </li>
                ))}
                {report.orphanContracts.map((name) => (
                  <li key={name}>
                    <b>@{name}</b> is defined but attached to no message. It exports, but
                    says nothing about this diagram.
                  </li>
                ))}
                {dangling.map((name) => (
                  <li key={`d${name}`} className="bad">
                    <b>@{name}</b> is referenced by a message but never defined.
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
