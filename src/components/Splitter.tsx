import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag handle between two slots of a split.
 *
 * `extent` is the split's **own** main-axis length in pixels, not the window's.
 * That distinction matters once splits nest: a handle inside a 300px column has
 * to convert a pixel drag against 300, or the panes move faster than the
 * pointer. The reported delta is a fraction of that extent, which is the unit
 * the tree stores.
 *
 * `orientation` names the separator, not the split it belongs to — which is
 * also what `aria-orientation` means for `role="separator"`. A row of panes is
 * divided by *vertical* separators.
 */
export function Splitter({
  orientation,
  extent,
  onResize,
  style,
}: {
  orientation: 'vertical' | 'horizontal'
  extent: number
  onResize: (deltaFraction: number) => void
  style?: React.CSSProperties
}) {
  const [dragging, setDragging] = useState(false)
  const teardown = useRef<(() => void) | null>(null)

  // Cancelled drags are the reason this exists: a gesture killed by an
  // edge-swipe or a tab switch never fires `pointerup`, and the global cursor
  // and `user-select` would stay stuck for the rest of the session.
  useEffect(() => () => teardown.current?.(), [])

  const begin = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return
      teardown.current?.()

      const vertical = orientation === 'vertical'
      let last = vertical ? event.clientX : event.clientY
      const span = extent || 1

      // Attached here rather than from an effect keyed on `dragging`: an effect
      // only runs after React commits, so a quick flick could finish before
      // anything was listening. Same reasoning as the canvas drags.
      const move = (e: PointerEvent) => {
        const now = vertical ? e.clientX : e.clientY
        onResize((now - last) / span)
        last = now
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', cleanup)
        window.removeEventListener('pointercancel', cleanup)
        window.removeEventListener('blur', cleanup)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        teardown.current = null
        setDragging(false)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', cleanup)
      window.addEventListener('pointercancel', cleanup)
      window.addEventListener('blur', cleanup)
      document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      teardown.current = cleanup
      setDragging(true)
    },
    [extent, onResize, orientation],
  )

  const nudge = 24 / (extent || 1)

  return (
    <div
      className={`splitter ${orientation}${dragging ? ' dragging' : ''}`}
      style={style}
      role="separator"
      aria-orientation={orientation}
      tabIndex={0}
      onPointerDown={begin}
      onKeyDown={(e) => {
        if (orientation === 'vertical') {
          if (e.key === 'ArrowLeft') onResize(-nudge)
          if (e.key === 'ArrowRight') onResize(nudge)
        } else {
          if (e.key === 'ArrowUp') onResize(-nudge)
          if (e.key === 'ArrowDown') onResize(nudge)
        }
      }}
    />
  )
}
