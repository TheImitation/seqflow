import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { computeLayout, paneIds, usePanels, type SlotId } from '../state/panels'
import { dropTargetAt, type DropTarget, type LeafBox } from '../state/dockTree'
import { mergeRenderOrder } from '../state/renderOrder'
import { Splitter } from './Splitter'

/** How far a press must travel before it becomes a drag, not a click. */
const DRAG_THRESHOLD = 4

/**
 * The workspace, laid out from the docking tree.
 *
 * Every pane is rendered **once, in a stable order**, as an absolutely
 * positioned box at the rect `computeLayout` gives it. That is the whole trick,
 * and the order is load-bearing: rendering in tree-traversal order would look
 * more natural and would silently reintroduce DOM moves whenever the tree
 * reorders, resetting each canvas's scroll position and making CodeMirror
 * re-measure. Keyed by slot id at a stable position, nothing ever moves in the
 * React tree — a pane changing slot is four style properties.
 *
 * The order used to be a constant, which a fixed set of five panes could
 * afford. Documents open and close, so it is now accumulated across renders by
 * `renderOrder.mergeRenderOrder` — kept in a ref because what the DOM currently
 * looks like is not derivable from this render's props.
 *
 * An inactive tab keeps the same rect and is hidden with `visibility` rather
 * than `display`. `display: none` would be cheaper to paint but it drops the
 * element out of layout, which zeroes `getBoundingClientRect` — and both
 * `useZoom` and `Minimap` measure their host through a `ResizeObserver`, so a
 * background tab would come forward at the wrong zoom with a collapsed minimap.
 */
export function DockView({
  renderPane,
  labelOf,
}: {
  /** What goes in a slot. Called for each open slot, by id. */
  renderPane: (id: SlotId) => ReactNode
  /** What its tab says — a file name for a document, a name for a tool. */
  labelOf: (id: SlotId) => string
}) {
  const root = usePanels((s) => s.root)
  const resize = usePanels((s) => s.resizeSplit)
  const setActive = usePanels((s) => s.setActive)

  const dock = usePanels((s) => s.dockPane)

  const host = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  /** The pane under the pointer and where it would land, for the overlay. */
  const [drag, setDrag] = useState<{ pane: SlotId; target: DropTarget | null } | null>(null)

  // Cancels a live drag if the component goes away mid-gesture.
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  // Measured before paint, so the first frame is not laid out at zero.
  useLayoutEffect(() => {
    const node = host.current
    if (!node) return
    setSize({ w: node.clientWidth, h: node.clientHeight })
  }, [])

  useEffect(() => {
    const node = host.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const layout = computeLayout(root, size.w, size.h)
  const openIds = paneIds(root)
  const open = new Set(openIds)
  const active = new Set(layout.leaves.map((l) => l.active))

  // Read and written during render on purpose: what the DOM currently looks
  // like is not derivable from this render's inputs, and `mergeRenderOrder` is
  // idempotent, which is what makes that safe under StrictMode's double
  // invocation of the render function.
  const previousOrder = useRef<readonly string[]>([])
  const order = (previousOrder.current = mergeRenderOrder(previousOrder.current, openIds))

  // Read by the pointer listeners, which outlive the render that made them.
  // Synced from an effect, which is soon enough: a listener can only fire after
  // the commit that armed it.
  const leavesRef = useRef<LeafBox[]>(layout.leaves)
  useEffect(() => {
    leavesRef.current = layout.leaves
  }, [layout.leaves])

  /**
   * Begin dragging a pane by its header.
   *
   * Listeners go on immediately rather than from an effect: an effect only runs
   * after React commits, so a quick flick could finish before anything was
   * listening — the same reasoning the two canvas drags document. The committed
   * target lives in a closure variable because `pointerup` can land in the same
   * frame as the last `pointermove` and would otherwise read stale state.
   */
  const beginPaneDrag = useCallback(
    (pane: SlotId, event: React.PointerEvent) => {
      if (event.button !== 0) return
      // A press on a header control is a click on that control, not a drag.
      if ((event.target as HTMLElement).closest('button, .dropdown, input, select')) return
      endDrag.current?.()

      const rect = host.current?.getBoundingClientRect()
      if (!rect) return
      const startX = event.clientX
      const startY = event.clientY
      let moved = false
      let target: DropTarget | null = null

      const move = (e: PointerEvent) => {
        if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) <= DRAG_THRESHOLD) return
        moved = true
        target = dropTargetAt(e.clientX - rect.left, e.clientY - rect.top, leavesRef.current)
        setDrag({ pane, target })
      }

      const finish = () => {
        const landed = target
        const wasMoved = moved
        cleanup()
        if (wasMoved && landed) dock(pane, landed.path, landed.zone)
      }

      function cleanup() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', cleanup)
        window.removeEventListener('blur', cleanup)
        document.body.style.userSelect = ''
        endDrag.current = null
        setDrag(null)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      // A cancelled gesture discards rather than commits.
      window.addEventListener('pointercancel', cleanup)
      window.addEventListener('blur', cleanup)
      document.body.style.userSelect = 'none'
      endDrag.current = cleanup
    },
    [dock],
  )

  return (
    <div className="dock" ref={host}>
      {layout.leaves
        .filter((box) => box.hasTabs)
        .map((box) => (
          <div
            key={`tabs-${box.path.join('.')}`}
            className="dock-tabs"
            role="tablist"
            style={{ left: box.rect.x, top: box.rect.y, width: box.rect.w }}
          >
            {box.panes.map((pane) => (
              <button
                key={pane}
                role="tab"
                aria-selected={pane === box.active}
                className={`dock-tab${pane === box.active ? ' active' : ''}`}
                onClick={() => setActive(box.path, pane)}
              >
                {labelOf(pane)}
              </button>
            ))}
          </div>
        ))}

      {/* Stable order, keyed by slot — see the note above. */}
      {order.map((pane) => {
        const rect = layout.panes.get(pane)
        if (!open.has(pane) || !rect) return null
        const showing = active.has(pane)
        return (
          <div
            key={pane}
            className="dock-pane"
            data-pane={pane}
            // `inert` also removes it from the tab order and from the
            // accessibility tree, which `visibility` alone does not guarantee.
            inert={!showing}
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              visibility: showing ? 'visible' : 'hidden',
            }}
            // Delegated from the box rather than bound inside each pane, so the
            // four pane components stay unaware of docking entirely.
            onPointerDownCapture={(e) => {
              if ((e.target as HTMLElement).closest('.pane-head')) beginPaneDrag(pane, e)
            }}
          >
            {renderPane(pane)}
          </div>
        )
      })}

      {drag?.target && (
        <div className="dock-drop" style={dropRect(drag.target, layout.leaves)} />
      )}

      {layout.splitters.map((s) => (
        <Splitter
          key={`${s.path.join('.')}-${s.index}`}
          orientation={s.orientation}
          extent={s.extent}
          onResize={(delta) => resize(s.path, s.index, delta)}
          style={{ left: s.rect.x, top: s.rect.y, width: s.rect.w, height: s.rect.h }}
        />
      ))}
    </div>
  )
}

/** Where the drop preview goes: the half, or the whole slot for a tab drop. */
function dropRect(target: DropTarget, leaves: LeafBox[]): React.CSSProperties {
  const box = leaves.find((l) => l.path.join('.') === target.path.join('.'))
  if (!box) return { display: 'none' }
  const { x, y, w, h } = box.rect
  switch (target.zone) {
    case 'left':
      return { left: x, top: y, width: w / 2, height: h }
    case 'right':
      return { left: x + w / 2, top: y, width: w / 2, height: h }
    case 'top':
      return { left: x, top: y, width: w, height: h / 2 }
    case 'bottom':
      return { left: x, top: y + h / 2, width: w, height: h / 2 }
    default:
      return { left: x, top: y, width: w, height: h }
  }
}
