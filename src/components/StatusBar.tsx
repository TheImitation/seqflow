import { useMemo, useState } from 'react'
import { CoverageDialog } from '../contracts/CoverageDialog'
import { buildCoverage } from '../dsl/coverage'
import { summaryStats } from '../export/reportSummary'
import { useStore } from '../state/store'

export function StatusBar({
  saved,
  onGoToLine,
}: {
  saved: string | null
  onGoToLine: (line: number) => void
}) {
  const errors = useStore((s) => s.errors)
  const warnings = useStore((s) => s.warnings)
  const doc = useStore((s) => s.doc)
  const arch = useStore((s) => s.arch)
  const [open, setOpen] = useState(false)
  const [coverage, setCoverage] = useState(false)
  const report = useMemo(() => buildCoverage(doc), [doc])
  // Shared with the design-review export, so the two cannot quote different
  // numbers for the same document.
  const stats = useMemo(() => summaryStats(doc, arch), [doc, arch])

  const issues = [
    ...errors.map((e) => ({ ...e, level: 'err' as const })),
    ...warnings.map((w) => ({ ...w, level: 'warn' as const })),
  ].sort((a, z) => a.line - z.line)

  const modelledEdges = stats.linksOnFailurePath

  return (
    <>
      {open && issues.length > 0 && (
        <div className="issue-list">
          {issues.map((issue, i) => (
            <button
              key={i}
              className={issue.level}
              onClick={() => {
                if (issue.line > 0) onGoToLine(issue.line)
                setOpen(false)
              }}
            >
              <span className="ln">{issue.line > 0 ? `L${issue.line}` : '—'}</span>
              <span>{issue.message}</span>
            </button>
          ))}
        </div>
      )}

      <div className="statusbar">
        <button
          className={`pill ${errors.length ? 'err' : warnings.length ? 'warn' : 'ok'}`}
          onClick={() => issues.length && setOpen((o) => !o)}
          disabled={!issues.length}
          title={issues.length ? 'Show parse issues' : 'The diagram parses cleanly'}
        >
          {errors.length
            ? `✕ ${errors.length} error${errors.length === 1 ? '' : 's'}`
            : warnings.length
              ? `▲ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
              : '✓ parses'}
          {warnings.length > 0 && errors.length > 0 ? ` · ▲ ${warnings.length}` : ''}
        </button>

        <span>
          {doc.participants.length} participants · {doc.messages.length} messages ·{' '}
          {doc.blocks.length} blocks
        </span>
        <span>
          {arch.nodes.length} nodes · {arch.edges.length} links
        </span>
        <span title="Links carrying at least one message on a drawn failure branch">
          {modelledEdges}/{arch.edges.length} links on a failure path
        </span>
        {report.declared > 0 && (
          <button
            className={`pill ${report.modelled === report.declared ? 'ok' : 'warn'}`}
            onClick={() => setCoverage(true)}
            title="Declared failure responses that are modelled as walkable paths"
          >
            {report.modelled}/{report.declared} failures modelled
          </button>
        )}
        {doc.contracts.length > 0 && (
          <span>
            {doc.contracts.length} contract{doc.contracts.length === 1 ? '' : 's'} ·{' '}
            {doc.dataModels.length} model{doc.dataModels.length === 1 ? '' : 's'}
          </span>
        )}
        {doc.tables.length > 0 && (
          <span>
            {doc.tables.length} table{doc.tables.length === 1 ? '' : 's'}
          </span>
        )}

        <span className="spacer" />
        <span>{saved ?? ''}</span>
      </div>

      {coverage && <CoverageDialog onClose={() => setCoverage(false)} />}
    </>
  )
}
