import { useEffect, useRef, useState } from 'react'
import { toAsyncApi } from '../export/toAsyncApi'
import { toCdk } from '../export/toCdk'
import { toDrawio } from '../export/toDrawio'
import { toMermaid } from '../export/toMermaid'
import { toOpenApi } from '../export/toOpenApi'
import { toPlantUML } from '../export/toPlantUML'
import { downloadBlob, downloadText, svgToPngBlob, svgToString } from '../export/snapshot'
import { ReportDialog } from './ReportDialog'
import { projectToJson } from '../persist/db'
import { useStore } from '../state/store'
import { useDismiss } from './useDismiss'
import type { SequenceDoc } from '../dsl/ast'

interface Format {
  id: string
  label: string
  ext: string
  mime: string
  run: (doc: SequenceDoc) => string
  /** Shown greyed with a reason when the doc can't produce anything useful. */
  gate?: (doc: SequenceDoc) => string | undefined
}

const FORMATS: Format[] = [
  {
    id: 'mermaid',
    label: 'Mermaid',
    ext: 'mmd',
    mime: 'text/plain',
    run: toMermaid,
  },
  {
    id: 'plantuml',
    label: 'PlantUML',
    ext: 'puml',
    mime: 'text/plain',
    run: (doc) => toPlantUML(doc),
  },
  {
    id: 'drawio',
    label: 'draw.io (architecture)',
    ext: 'drawio',
    mime: 'application/xml',
    run: (doc) => toDrawio(doc),
  },
  {
    id: 'cdk',
    label: 'AWS CDK (TypeScript)',
    ext: 'ts',
    mime: 'text/plain',
    run: (doc) => toCdk(doc),
    gate: (doc) =>
      doc.participants.some((p) => p.kind.startsWith('aws:'))
        ? undefined
        : 'no aws:* participants',
  },
  {
    id: 'openapi',
    label: 'OpenAPI 3.0',
    ext: 'json',
    mime: 'application/json',
    run: (doc) => toOpenApi(doc),
    gate: (doc) =>
      doc.messages.some((m) => m.contractRef) ? undefined : 'no contracts attached',
  },
  {
    id: 'asyncapi',
    label: 'AsyncAPI 2.x',
    ext: 'json',
    mime: 'application/json',
    run: (doc) => toAsyncApi(doc),
    gate: (doc) =>
      doc.messages.some((m) => m.contractRef) ? undefined : 'no contracts attached',
  },
]

export function ExportMenu({ onToast }: { onToast: (m: string) => void }) {
  const doc = useStore((s) => s.doc)
  const text = useStore((s) => s.text)
  const projectName = useStore((s) => s.projectName)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<{ format: Format; content: string } | null>(null)
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const [report, setReport] = useState(false)

  const snapshot = async (which: 'seq' | 'arch', as: 'svg' | 'png') => {
    const svg = document.querySelector<SVGSVGElement>(which === 'seq' ? '.seq-svg' : '.arch-svg')
    if (!svg) {
      onToast('That diagram is not on screen right now.')
      return
    }
    const name = `seqflow-${which === 'seq' ? 'sequence' : 'architecture'}`
    try {
      if (as === 'svg') {
        downloadText(svgToString(svg), `${name}.svg`, 'image/svg+xml')
      } else {
        downloadBlob(await svgToPngBlob(svg), `${name}.png`)
      }
      onToast(`Saved ${name}.${as}`)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Snapshot failed.')
    }
    setOpen(false)
  }

  return (
    <div className="dropdown" ref={host}>
      <button className={`btn${open ? ' active' : ''}`} onClick={() => setOpen((o) => !o)}>
        Export ▾
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="group-label">Diagram formats</div>
          {FORMATS.map((f) => {
            const blocked = f.gate?.(doc)
            return (
              <button
                key={f.id}
                onClick={() => {
                  setPreview({ format: f, content: f.run(doc) })
                  setOpen(false)
                }}
                title={blocked ? `Will be near-empty: ${blocked}` : undefined}
              >
                {f.label}
                <small>{blocked ? blocked : `.${f.ext}`}</small>
              </button>
            )
          })}

          <div className="divider" />
          <div className="group-label">Image</div>
          <button onClick={() => void snapshot('seq', 'svg')}>
            Sequence <small>.svg</small>
          </button>
          <button onClick={() => void snapshot('seq', 'png')}>
            Sequence <small>.png</small>
          </button>
          <button onClick={() => void snapshot('arch', 'svg')}>
            Architecture <small>.svg</small>
          </button>
          <button onClick={() => void snapshot('arch', 'png')}>
            Architecture <small>.png</small>
          </button>

          <div className="divider" />
          <div className="group-label">Report</div>
          <button
            onClick={() => {
              setReport(true)
              setOpen(false)
            }}
            title="A Word document assembling the diagrams, coverage analysis and schema"
          >
            Design review <small>.docx</small>
          </button>

          <div className="divider" />
          <div className="group-label">Project</div>
          <button
            onClick={() => {
              const file = `${slug(projectName)}.json`
              downloadText(projectToJson(projectName, text), file, 'application/json')
              onToast(`Saved ${file}`)
              setOpen(false)
            }}
          >
            Project file <small>.json</small>
          </button>
        </div>
      )}

      {report && <ReportDialog onToast={onToast} onClose={() => setReport(false)} />}

      {preview && (
        <PreviewModal
          title={preview.format.label}
          content={preview.content}
          filename={`${slug(projectName)}.${preview.format.ext}`}
          mime={preview.format.mime}
          onToast={onToast}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'seqflow'
}

function PreviewModal({
  title,
  content,
  filename,
  mime,
  onToast,
  onClose,
}: {
  title: string
  content: string
  filename: string
  mime: string
  onToast: (m: string) => void
  onClose: () => void
}) {
  useDismiss(onClose)
  const lines = content.split('\n').length

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={`${title} export`}>
        <header>
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body" style={{ display: 'flex', minHeight: 0 }}>
          <pre className="preview" style={{ flex: 1 }}>
            {content}
          </pre>
        </div>
        <footer>
          <span className="hint">
            {lines} line{lines === 1 ? '' : 's'} · {filename}
          </span>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard
                .writeText(content)
                .then(() => onToast('Copied to clipboard'))
                .catch(() => onToast('The browser blocked clipboard access.'))
            }}
          >
            Copy
          </button>
          <button
            className="btn primary"
            onClick={() => {
              downloadText(content, filename, mime)
              onToast(`Saved ${filename}`)
              onClose()
            }}
          >
            Download
          </button>
        </footer>
      </div>
    </div>
  )
}
