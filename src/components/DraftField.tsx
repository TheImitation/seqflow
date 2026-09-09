import { useId, useRef, useState } from 'react'

export interface ValidationResult {
  /** Why the value cannot be committed. */
  error?: string
  /** A value that would work, offered as a one-click fix. */
  suggestion?: string
}

/**
 * A text field that holds its own draft while focused.
 *
 * Every field here writes through `parse → serialize → parse`, and that trip is
 * lossy for in-progress text: an empty display label round-trips back to the
 * participant's id, so a field bound straight to the model refills itself the
 * moment you clear it. Holding the draft locally until blur keeps typing
 * predictable, and a rejected commit stays on screen with the reason instead of
 * silently reverting.
 */
export function DraftField({
  label,
  value,
  onCommit,
  validate,
  commitOn = 'change',
  mono = true,
  placeholder,
  hint,
  list,
}: {
  label: string
  value: string
  /** Return false to reject; the draft and the error stay put. */
  onCommit: (next: string) => boolean | void
  validate?: (next: string) => ValidationResult | undefined
  /** `change` writes on every keystroke; `blur` waits for blur or Enter. */
  commitOn?: 'change' | 'blur'
  mono?: boolean
  placeholder?: string
  hint?: string
  /** id of a <datalist> to offer completions from. */
  list?: string
}) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const errorId = useId()

  // Adjust to a model change during render rather than in an effect, and only
  // when the field is not being edited — otherwise it would fight the typist.
  if (!focused && value !== seen) {
    setSeen(value)
    setDraft(value)
    setError(null)
    setSuggestion(null)
  }

  const commit = (next: string): boolean => {
    const problem = validate?.(next)
    if (problem?.error) {
      setError(problem.error)
      setSuggestion(problem.suggestion ?? null)
      return false
    }
    const ok = onCommit(next)
    if (ok === false) {
      setError('That change could not be applied.')
      return false
    }
    setError(null)
    setSuggestion(null)
    setSeen(next)
    return true
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input
        ref={input}
        className={`${mono ? 'mono ' : ''}${error ? 'invalid' : ''}`}
        type="text"
        list={list}
        value={draft}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setDraft(e.target.value)
          const problem = validate?.(e.target.value)
          setError(problem?.error ?? null)
          setSuggestion(problem?.suggestion ?? null)
          if (commitOn === 'change' && !problem?.error) commit(e.target.value)
        }}
        onBlur={() => {
          setFocused(false)
          if (draft === value) {
            setError(null)
            setSuggestion(null)
            return
          }
          if (!commit(draft)) return
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (commit(draft)) input.current?.blur()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(value)
            setError(null)
            setSuggestion(null)
            input.current?.blur()
          }
        }}
      />
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
          {suggestion && (
            <button
              type="button"
              className="btn sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft(suggestion)
                commit(suggestion)
              }}
            >
              Use “{suggestion}”
            </button>
          )}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </label>
  )
}
