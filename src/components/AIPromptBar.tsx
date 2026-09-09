import { useCallback, useRef, useState } from 'react'
import { generateFromPrompt } from '../ai/generateFromPrompt'
import { useStore } from '../state/store'
import { useDismiss } from './useDismiss'

const EXAMPLES = [
  'A checkout flow where API Gateway calls a Lambda that writes to DynamoDB and publishes to EventBridge',
  'Add a dead-letter path to the payment queue',
  'Kinesis stream feeding two Lambda consumers, with retry and DLQ',
]

/**
 * The parser that validates hand-written DSL is the same one that validates
 * what comes back here — a bad generation surfaces as ordinary parse errors you
 * can edit, not as a separate failure mode.
 */
export function AIPromptBar({ onToast }: { onToast: (m: string) => void }) {
  const setText = useStore((s) => s.setText)
  const currentDsl = useStore((s) => s.text)
  const select = useStore((s) => s.select)

  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const dismissError = useCallback(() => setError(null), [])
  useDismiss(dismissError, error !== null)

  const run = async () => {
    const trimmed = prompt.trim()
    if (!trimmed || busy) return

    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller

    setBusy(true)
    setError(null)
    try {
      const result = await generateFromPrompt(trimmed, currentDsl, controller.signal)
      setText(result.dsl, 'command')
      select(null)

      if (result.errors.length) {
        setError(
          `The model returned ${result.errors.length} parse error${result.errors.length === 1 ? '' : 's'}. ` +
            'It has been loaded anyway so you can fix or retry:\n\n' +
            result.errors
              .slice(0, 6)
              .map((e) => `  line ${e.line}: ${e.message}`)
              .join('\n'),
        )
      } else {
        onToast(`Generated with ${result.model ?? 'Claude'}`)
        setPrompt('')
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="ai-bar">
        <input
          type="text"
          value={prompt}
          placeholder="Describe a flow in plain English…"
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
            if (e.key === 'Escape') setError(null)
          }}
          title={`Try: ${EXAMPLES[0]}`}
        />
        <button className="btn primary" onClick={() => void run()} disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
        {busy && (
          <button className="btn ghost sm" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        )}
      </div>

      {error && (
        <div
          className="overlay"
          onPointerDown={(e) => e.target === e.currentTarget && setError(null)}
        >
          <div className="modal" role="alertdialog" aria-label="AI generation problem">
            <header>
              <h2>AI assist</h2>
              <span className="spacer" />
              <button className="btn ghost icon" onClick={() => setError(null)} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="body">
              <div className="ai-error">{error}</div>
              <p className="hint" style={{ marginTop: 12 }}>
                Examples that work well:
              </p>
              <ul className="hint" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {EXAMPLES.map((e) => (
                  <li key={e} style={{ marginBottom: 3 }}>
                    <button
                      className="btn ghost sm"
                      style={{ textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '2px 4px' }}
                      onClick={() => {
                        setPrompt(e)
                        setError(null)
                      }}
                    >
                      {e}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <footer>
              <span className="spacer" />
              <button className="btn" onClick={() => setError(null)}>
                Close
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setError(null)
                  void run()
                }}
              >
                Retry
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
