import { useEffect, useRef, useState } from 'react'

/**
 * An input rendered onto the canvas itself, so a step you just dropped can be
 * named where you dropped it rather than across the pane in the inspector.
 */
export function InlineLabel({
  x,
  y,
  width,
  value,
  placeholder,
  onCommit,
  onCancel,
}: {
  x: number
  y: number
  width: number
  value: string
  placeholder?: string
  onCommit: (next: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement | null>(null)
  const committed = useRef(false)
  const openedAt = useRef(0)

  useEffect(() => {
    // The editor is opened from a `pointerup`, and the browser still has a
    // `click` to deliver — which lands on the canvas and blurs us. Focus on the
    // next frame so it arrives after that.
    openedAt.current = performance.now()
    const frame = requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.select()
      openedAt.current = performance.now()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const finish = (next: string) => {
    if (committed.current) return
    committed.current = true
    onCommit(next.trim())
  }

  return (
    <foreignObject x={x - width / 2} y={y - 13} width={width} height={26}>
      <input
        ref={input}
        className="inline-label"
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => {
          // A blur in the first moments is that same stray click, not the
          // person clicking away.
          if (performance.now() - openedAt.current < 250) {
            input.current?.focus()
            return
          }
          finish(draft)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(draft)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            committed.current = true
            onCancel()
          }
        }}
      />
    </foreignObject>
  )
}
