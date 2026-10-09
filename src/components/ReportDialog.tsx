import { useState } from 'react'
import { useDismiss } from './useDismiss'
import { captureDiagrams } from '../export/captureDiagrams'
import {
  ALL_SECTIONS,
  buildReport,
  SECTION_DIAGRAM,
  SECTION_HINT,
  SECTION_LABEL,
  type DiagramId,
  type SectionId,
} from '../export/reportContent'
import { renderDocx, type PageSize } from '../export/toDocx'
import { downloadBlob } from '../export/snapshot'
import { useStore } from '../state/store'

/**
 * Options for the design-review export, then the generate/download step.
 *
 * The download is deliberately a *second* click rather than automatic. Building
 * the file involves revealing panes and rasterising three diagrams, which takes
 * long enough that browsers stop treating the eventual download as user-driven
 * and may suppress it. It also gives somewhere to report a figure that could
 * not be captured, which a silently-incomplete document would hide.
 */
export function ReportDialog({
  onToast,
  onClose,
}: {
  onToast: (message: string) => void
  onClose: () => void
}) {
  const doc = useStore((s) => s.doc)
  const arch = useStore((s) => s.arch)
  const projectName = useStore((s) => s.projectName)
  const projectId = useStore((s) => s.projectId)
  const projects = useStore((s) => s.projects)
  const errors = useStore((s) => s.errors)
  const warnings = useStore((s) => s.warnings)

  const [sections, setSections] = useState<SectionId[]>(ALL_SECTIONS)
  const [title, setTitle] = useState(projectName === 'Untitled' ? '' : projectName)
  const [author, setAuthor] = useState('')
  const [rootStoryTitle, setRootStoryTitle] = useState('')
  const [pageSize, setPageSize] = useState<PageSize>('a4')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{
    blob: Blob
    filename: string
    skipped: { id: DiagramId; reason: string; detail?: string }[]
    blocks: number
  } | null>(null)

  useDismiss(onClose, !busy)

  const summary = projects.find((p) => p.id === projectId)

  const toggle = (id: SectionId) =>
    setSections((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    )

  const generate = async () => {
    setBusy('Preparing…')
    setResult(null)
    try {
      // Only capture the diagrams the selected sections will actually place.
      const wanted = [
        ...new Set(
          sections
            .map((id) => SECTION_DIAGRAM[id])
            .filter((id): id is DiagramId => Boolean(id)),
        ),
      ]

      setBusy(wanted.length ? 'Capturing diagrams…' : 'Building document…')
      const capture = wanted.length
        ? await captureDiagrams(wanted)
        : { captured: [], skipped: [] }

      setBusy('Building document…')
      const report = buildReport({
        doc,
        arch,
        projectName,
        documentTitle: title,
        author,
        rootStoryTitle,
        createdAt: summary?.createdAt,
        savedAt: summary?.savedAt,
        generatedAt: new Date(),
        sections: ALL_SECTIONS.filter((s) => sections.includes(s)),
        errors,
        warnings,
        captured: capture.captured.map((c) => c.id),
      })

      setBusy('Writing Word file…')
      const blob = await renderDocx(report, {
        pageSize,
        images: new Map(capture.captured.map((c) => [c.id, c.png])),
      })

      setResult({
        blob,
        filename: `${slug(title || projectName)}-design-review.docx`,
        skipped: capture.skipped,
        blocks: report.blocks.length,
      })
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not build the report.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="overlay"
      onPointerDown={(e) => !busy && e.target === e.currentTarget && onClose()}
    >
      <div className="modal" role="dialog" aria-label="Design review export">
        <header>
          <h2>Design review</h2>
          <span className="spacer" />
          <button
            className="btn ghost icon"
            onClick={onClose}
            disabled={!!busy}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="body report-options">
          <label className="report-field">
            <span>Document title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={projectName}
            />
          </label>

          <label className="report-field">
            <span>Author</span>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Optional"
            />
          </label>

          <div className="report-field">
            <span>Page size</span>
            <div className="seg">
              {(['a4', 'letter'] as const).map((size) => (
                <button
                  key={size}
                  className={`btn ghost sm${pageSize === size ? ' active' : ''}`}
                  onClick={() => setPageSize(size)}
                >
                  {size === 'a4' ? 'A4' : 'Letter'}
                </button>
              ))}
            </div>
          </div>

          <div className="group-label">Sections</div>
          {ALL_SECTIONS.map((id) => (
            <label key={id} className="check-row">
              <input
                type="checkbox"
                checked={sections.includes(id)}
                onChange={() => toggle(id)}
              />
              <span>
                <strong>{SECTION_LABEL[id]}</strong>
                <small>{SECTION_HINT[id]}</small>
              </span>
            </label>
          ))}

          {sections.includes('tickets') && (
            <label className="report-field">
              <span>Main story title</span>
              <input
                value={rootStoryTitle}
                onChange={(e) => setRootStoryTitle(e.target.value)}
                placeholder="Named from its first step if left blank"
              />
            </label>
          )}

          {result && (
            <div className="report-result">
              <strong>
                Ready — {result.blocks} block{result.blocks === 1 ? '' : 's'}
              </strong>
              {result.skipped.length > 0 && (
                <ul>
                  {result.skipped.map((s) => (
                    <li key={s.id}>
                      {s.id} diagram not included — {reasonText(s.reason)}
                      {s.detail ? ` (${s.detail})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <footer>
          <span className="hint">
            {busy ?? (result ? result.filename : `${sections.length} of ${ALL_SECTIONS.length} sections`)}
          </span>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          {result ? (
            <button
              className="btn primary"
              onClick={() => {
                downloadBlob(result.blob, result.filename)
                onToast(`Saved ${result.filename}`)
                onClose()
              }}
            >
              Download
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={() => void generate()}
              disabled={!!busy || !sections.length}
            >
              {busy ? 'Working…' : 'Generate'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function reasonText(reason: string): string {
  if (reason === 'pane-empty') return 'there is nothing to draw'
  if (reason === 'too-large') return 'too large for the browser to rasterise'
  return 'the capture failed'
}

function slug(name: string): string {
  return (
    name.trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'seqflow'
  )
}
