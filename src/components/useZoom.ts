import { useLayoutEffect, useRef, useState } from 'react'

const STEPS = [0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2]

/**
 * Diagrams are drawn at their natural size; this scales the rendered SVG so a
 * wide architecture graph is legible without scrolling to find it.
 */
export function useZoom(contentWidth: number, defaultFit = true) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [manual, setManual] = useState<number | null>(defaultFit ? null : 1)
  const [available, setAvailable] = useState(0)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    )
    observer.observe(host)
    setAvailable(host.clientWidth)
    return () => observer.disconnect()
  }, [])

  // Below ~45% nothing is legible, so stop shrinking and let the pane scroll.
  const fitScale =
    available > 0 && contentWidth > 0
      ? Math.min(1, Math.max(0.45, (available - 18) / contentWidth))
      : 1
  const scale = manual ?? fitScale

  return {
    hostRef,
    scale,
    isFit: manual === null,
    setFit: () => setManual(null),
    zoomIn: () => setManual(nextStep(scale, 1)),
    zoomOut: () => setManual(nextStep(scale, -1)),
    reset: () => setManual(1),
  }
}

function nextStep(current: number, direction: 1 | -1): number {
  if (direction === 1) return STEPS.find((s) => s > current + 0.001) ?? STEPS.at(-1)!
  return [...STEPS].reverse().find((s) => s < current - 0.001) ?? STEPS[0]
}
