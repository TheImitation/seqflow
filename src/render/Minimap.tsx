import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  minimapSize,
  overflows,
  scrollTargetFor,
  viewportRect,
  type Viewport,
} from './minimapGeometry'

/**
 * A scaled-down plan of the whole diagram with the visible region boxed on it.
 *
 * The caller draws the diagram's silhouette in *content* coordinates — the same
 * space the real SVG uses — and the viewBox does the shrinking, so a minimap
 * can never drift out of step with the thing it maps.
 */
export function Minimap({
  hostRef,
  width,
  height,
  scale,
  children,
  label,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>
  /** Natural, unscaled content size. */
  width: number
  height: number
  /** Zoom the real canvas is rendered at. */
  scale: number
  children: ReactNode
  label: string
}) {
  const [view, setView] = useState<Viewport | null>(null)
  const dragging = useRef(false)

  // A scroll and a resize both move the box, and neither is a render — so this
  // reads the DOM on the events that change it rather than during render.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sync = () =>
      setView({
        left: host.scrollLeft,
        top: host.scrollTop,
        w: host.clientWidth,
        h: host.clientHeight,
      })
    host.addEventListener('scroll', sync, { passive: true })
    // Fires once on observe, which is also the initial read.
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    return () => {
      host.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [hostRef])

  // Content size and zoom changes move the box too, but a zoom that does not
  // happen to change scrollTop fires neither event.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const id = requestAnimationFrame(() =>
      setView({
        left: host.scrollLeft,
        top: host.scrollTop,
        w: host.clientWidth,
        h: host.clientHeight,
      }),
    )
    return () => cancelAnimationFrame(id)
  }, [hostRef, width, height, scale])

  if (!view || width <= 0 || height <= 0) return null

  const v = viewportRect(view, scale)
  if (!overflows(width, height, v)) return null

  const box = minimapSize(width, height)

  /** Centre the viewport on the point under the pointer. */
  const scrollTo = (e: { clientX: number; clientY: number }, svg: SVGSVGElement) => {
    const host = hostRef.current
    if (!host) return
    const rect = svg.getBoundingClientRect()
    const target = scrollTargetFor({
      fx: (e.clientX - rect.left) / rect.width,
      fy: (e.clientY - rect.top) / rect.height,
      width,
      height,
      visible: v,
      scale,
    })
    host.scrollLeft = target.left
    host.scrollTop = target.top
  }

  return (
    <div className="minimap" style={{ width: box.w, height: box.h }}>
      <svg
        width={box.w}
        height={box.h}
        viewBox={`0 0 ${width} ${height}`}
        /* The box is sized from the content's aspect ratio already, so "none"
           distorts nothing and keeps the click-to-scroll maths exact. */
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} overview`}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dragging.current = true
          // Capture keeps a drag alive past the map's edge. It throws if the
          // pointer is already gone, which must not cost us the click.
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* nothing to capture */
          }
          scrollTo(e, e.currentTarget)
        }}
        onPointerMove={(e) => {
          if (dragging.current) scrollTo(e, e.currentTarget)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* never captured */
          }
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}

        {/* Everything outside the viewport dims, so the box reads as a window. */}
        <path
          className="mini-shade"
          fillRule="evenodd"
          d={`M0 0H${width}V${height}H0Z M${v.x} ${v.y}H${v.x + v.w}V${v.y + v.h}H${v.x}Z`}
        />
        <rect
          className="mini-view"
          x={v.x}
          y={v.y}
          width={Math.min(v.w, width)}
          height={Math.min(v.h, height)}
          /* Strokes scale with the viewBox, so undo it to keep a hairline. */
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}
