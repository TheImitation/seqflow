import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { contractByName, isAwsKind, type SequenceDoc } from '../dsl/ast'
import {
  insertMessage,
  insertNote,
  moveParticipant,
  moveStepToSlot,
  reorderParticipant,
} from '../dsl/edit'
import { ContextMenu } from '../components/ContextMenu'
import { useContextMenu } from '../components/useContextMenu'
import {
  activeRange,
  arrowMenu,
  blockMenu,
  canvasMenu,
  noteMenu,
  participantMenu,
  viewSection,
  type MenuDeps,
} from '../components/menus'
import { ZoomControl } from '../components/ZoomControl'
import { useZoom } from '../components/useZoom'
import { usePlaybackEngine } from '../playback/usePlayback'
import { PaneHideButton } from '../components/PaneRail'
import { usePanels } from '../state/panels'
import { Minimap } from './Minimap'
import { useStore } from '../state/store'
import { KindGlyph } from './aws-icons'
import { KIND_LABEL } from './aws-icons/labels'
import { InlineLabel } from './InlineLabel'
import {
  SEQ,
  laneAtX,
  layoutSequence,
  slotAtY,
  type ArrowLayout,
  type InsertSlot,
  type SequenceLayout,
} from './sequenceLayout'

type Drag =
  | { kind: 'lane'; id: string; fromIndex: number; x: number }
  | { kind: 'endpoint'; messageId: string; end: 'from' | 'to'; x: number }
  /** Dragging across lifelines to create a new step. */
  | {
      kind: 'create'
      from: string
      note: boolean
      startX: number
      startY: number
      x: number
      y: number
      moved: boolean
    }
  /** Dragging a step vertically to reposition it. */
  | { kind: 'reorder'; id: string; startY: number; y: number; moved: boolean }
  | null

/** How far a pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4

export function SequenceCanvas({
  style,
  menuDeps,
}: {
  style?: React.CSSProperties
  menuDeps: MenuDeps
}) {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const showMinimap = usePanels((s) => s.minimap)
  const focusPath = useStore((s) => s.focusPath)
  const select = useStore((s) => s.select)
  const extendSelection = useStore((s) => s.extendSelection)
  const anchorId = useStore((s) => s.anchorId)
  const mutate = useStore((s) => s.mutate)
  const ctx = useContextMenu()

  const { current, index, progress } = usePlaybackEngine()
  const layout = useMemo(() => layoutSequence(doc), [doc])

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [drag, setDragState] = useState<Drag>(null)
  /**
   * The drag also lives in a ref because `pointerup` must read the latest
   * values. State updates are async, so a drag whose last `pointermove` lands
   * in the same frame as its `pointerup` would otherwise be released against a
   * stale `moved: false` and silently do nothing.
   */
  const dragRef = useRef<Drag>(null)
  const setDrag = useCallback((next: Drag | ((current: Drag) => Drag)) => {
    const resolved = typeof next === 'function' ? next(dragRef.current) : next
    dragRef.current = resolved
    setDragState(resolved)
  }, [])
  const zoom = useZoom(layout.width, false)
  const { scale, hostRef } = zoom

  const [editing, setEditing] = useState<{ id: string; kind: 'message' | 'note' } | null>(
    null,
  )

  const toLocal = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return { x: 0, y: 0 }
      const rect = svg.getBoundingClientRect()
      return {
        x: ((clientX - rect.left) / rect.width) * layout.width,
        y: ((clientY - rect.top) / rect.height) * layout.height,
      }
    },
    [layout.width, layout.height],
  )
  const toLocalX = useCallback(
    (clientX: number) => toLocal(clientX, 0).x,
    [toLocal],
  )

  /**
   * Insert a step and immediately open its label for editing, looking the new
   * id up from the reparsed document — ids are positional, so the one the
   * insert returned is already stale.
   */
  const createStep = useCallback(
    (from: string, to: string, slot: InsertSlot, asNote: boolean) => {
      mutate(
        (d) => {
          if (asNote) {
            insertNote(d, slot.order, {
              over: from === to ? [from] : [from, to],
              text: 'note',
              placement: 'over',
              parentBlock: slot.parentBlock,
            })
          } else {
            insertMessage(d, slot.order, {
              from,
              to,
              label: '',
              style: from === to ? 'sync' : 'sync',
              parentBlock: slot.parentBlock,
            })
          }
        },
        (fresh) => {
          if (asNote) {
            const created = fresh.notes.find((n) => n.order === slot.order)
            if (created) {
              select({ type: 'note', id: created.id })
              setEditing({ id: created.id, kind: 'note' })
            }
            return
          }
          const created = fresh.messages.find((m) => m.order === slot.order)
          if (created) {
            select({ type: 'message', id: created.id })
            setEditing({ id: created.id, kind: 'message' })
          }
        },
      )
    },
    [mutate, select],
  )

  /* ------------------------------------------------------------ dragging */
  /**
   * Listeners are attached here, at press time, rather than from an effect
   * keyed on drag state — an effect only runs after React commits, so a quick
   * flick could finish before anything was listening.
   */
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  const beginDrag = useCallback(
    (initial: Drag) => {
      endDrag.current?.()
      dragRef.current = initial
      setDragState(initial)

      const move = (e: PointerEvent) => {
        const { x, y } = toLocal(e.clientX, e.clientY)
        setDrag((d) => {
          if (!d) return d
          if (d.kind === 'create') {
            return {
              ...d,
              x,
              y,
              moved: d.moved || Math.hypot(x - d.startX, y - d.startY) > DRAG_THRESHOLD,
              note: d.note || e.altKey,
            }
          }
          if (d.kind === 'reorder') {
            return { ...d, y, moved: d.moved || Math.abs(y - d.startY) > DRAG_THRESHOLD }
          }
          return { ...d, x }
        })
      }

      const finish = () => {
        const live = dragRef.current
        cleanup()
        if (!live) return

        if (live.kind === 'lane' || live.kind === 'endpoint') {
          const target = laneAtX(layout, live.x)
          if (target) {
            if (live.kind === 'lane' && target.index !== live.fromIndex) {
              mutate((draft) => reorderParticipant(draft, live.id, target.index))
            } else if (live.kind === 'endpoint') {
              mutate((draft) => {
                const m = draft.messages.find((x) => x.id === live.messageId)
                if (m) m[live.end] = target.id
              })
            }
          }
        }

        if (live.kind === 'create' && live.moved) {
          const target = laneAtX(layout, live.x)
          const slot = slotAtY(layout, live.y)
          if (target && slot) createStep(live.from, target.id, slot, live.note)
        }

        if (live.kind === 'reorder' && live.moved) {
          const slot = slotAtY(layout, live.y)
          if (slot) mutate((d) => void moveStepToSlot(d, live.id, slot))
        }
      }

      function cleanup() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', cleanup)
        endDrag.current = null
        dragRef.current = null
        setDragState(null)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', cleanup)
      endDrag.current = cleanup
    },
    [layout, mutate, toLocal, setDrag, createStep],
  )

  /** Where the `+` gutter drops a step: guess plausible endpoints, then name it. */
  const insertAtSlot = useCallback(
    (slot: InsertSlot, asNote: boolean) => {
      const lanes = layout.lanes
      if (!lanes.length) return
      // Continue the conversation: the step before this slot suggests who is
      // talking, and a reply back is the most common next move.
      const previous = [...doc.messages]
        .filter((m) => m.order < slot.order)
        .sort((a, z) => z.order - a.order)[0]
      const from = previous?.to ?? lanes[0].id
      const to = previous?.from ?? lanes[Math.min(1, lanes.length - 1)].id
      createStep(from, to, slot, asNote)
    },
    [layout.lanes, doc.messages, createStep],
  )

  const range = activeRange(doc, anchorId, focusIdOf(selection))
  const deps: MenuDeps = { ...menuDeps, range }

  const dropLane = drag && drag.kind !== 'reorder' ? laneAtX(layout, drag.x) : undefined
  const dropSlot =
    drag && (drag.kind === 'create' || drag.kind === 'reorder') && drag.moved
      ? slotAtY(layout, drag.y)
      : undefined

  const playing = index >= 0
  const activeId = current?.message.id
  const activeArrow = activeId ? layout.arrowByMessageId.get(activeId) : undefined

  /* -------------------------------------------------------- inline editing */
  const editor = (() => {
    if (!editing) return undefined
    if (editing.kind === 'message') {
      const arrow = layout.arrowByMessageId.get(editing.id)
      if (!arrow) return undefined
      return {
        x: arrow.midX,
        y: arrow.y - 13,
        width: Math.max(150, Math.abs(arrow.x2 - arrow.x1) - 16),
        value: arrow.label,
        placeholder: 'Name this step',
      }
    }
    const note = layout.notes.find((n) => n.noteId === editing.id)
    if (!note) return undefined
    return {
      x: note.x + note.w / 2,
      y: note.y + note.h / 2,
      width: Math.max(150, note.w - 12),
      value: note.note.text,
      placeholder: 'Note text',
    }
  })()

  const commitInlineLabel = (next: string) => {
    if (!editing) return
    const { id, kind } = editing
    mutate((d) => {
      if (kind === 'message') {
        const m = d.messages.find((x) => x.id === id)
        if (m) m.label = next || 'call'
      } else {
        const n = d.notes.find((x) => x.id === id)
        if (n) n.text = next || 'note'
      }
    })
  }

  // Keep the step being played in view — a long diagram scrolls past it otherwise.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !activeArrow) return
    // Assigned rather than animated: at a few steps per second a smooth scroll
    // would still be catching up when the next step lands.
    host.scrollTop = Math.max(0, activeArrow.y * scale - host.clientHeight / 2)
    host.scrollLeft = Math.max(0, activeArrow.midX * scale - host.clientWidth / 2)
  }, [activeArrow, hostRef, scale])

  return (
    <section className="pane" style={style}>
      <div className="pane-head">
        Sequence
        <span className="spacer" />
        <ZoomControl zoom={zoom} />
        <PaneHideButton id="sequence" />
      </div>
      <div className="pane-body">
        <div className="canvas-scroll" ref={hostRef}>
          <svg
            ref={svgRef}
            className="seq-svg"
            width={layout.width * scale}
            height={layout.height * scale}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) select(null)
            }}
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return
              select(null)
              ctx.open(e, canvasMenu(deps, [viewSection(zoom)]))
            }}
          >
            <Blocks
              layout={layout}
              selection={selection}
              onSelect={select}
              onMenu={(e, block) => {
                select({ type: 'block', id: block.id })
                ctx.open(e, blockMenu(deps, block))
              }}
            />
            <Notes
              layout={layout}
              selection={selection}
              onSelect={select}
              onMenu={(e, noteId) => {
                select({ type: 'note', id: noteId })
                ctx.open(e, noteMenu(deps, noteId))
              }}
            />

        {layout.lanes.map((lane) => (
          <g key={`ll-${lane.id}`}>
            <line
              className="lifeline"
              x1={lane.x}
              x2={lane.x}
              y1={SEQ.headTop + SEQ.headH}
              y2={layout.lifelineBottom}
            />
            {/* Press a lifeline and drag to another to create a step;
                hold Alt to make it a note instead. */}
            <rect
              className="lifeline-grip"
              x={lane.x - 9}
              y={SEQ.headTop + SEQ.headH}
              width={18}
              height={Math.max(0, layout.lifelineBottom - SEQ.headTop - SEQ.headH)}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                const { x, y } = toLocal(e.clientX, e.clientY)
                beginDrag({
                  kind: 'create',
                  from: lane.id,
                  note: e.altKey,
                  startX: x,
                  startY: y,
                  x,
                  y,
                  moved: false,
                })
              }}
            >
              <title>{`Drag from ${lane.label} to another lifeline to add a step — hold Alt for a note`}</title>
            </rect>
          </g>
        ))}

        {/* Hover gutter: one insertion point per boundary between steps. */}
        {layout.slots.map((slot, i) => (
          <g className="slot" key={`slot-${i}-${slot.order}`}>
            <rect
              className="slot-hit"
              x={SEQ.marginX / 2}
              y={slot.y - 9}
              width={Math.max(0, layout.width - SEQ.marginX)}
              height={18}
            />
            <line
              className="slot-line"
              x1={SEQ.marginX / 2}
              x2={layout.width - SEQ.marginX / 2}
              y1={slot.y}
              y2={slot.y}
            />
            <g
              className="slot-add"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                insertAtSlot(slot, false)
              }}
            >
              <circle cx={SEQ.marginX / 2 + 12} cy={slot.y} r={8} />
              <text x={SEQ.marginX / 2 + 12} y={slot.y + 3.6} textAnchor="middle">
                +
              </text>
              <title>Add a step here</title>
            </g>
            <g
              className="slot-add note"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                insertAtSlot(slot, true)
              }}
            >
              <circle cx={SEQ.marginX / 2 + 32} cy={slot.y} r={8} />
              <text x={SEQ.marginX / 2 + 32} y={slot.y + 3.4} textAnchor="middle">
                ✎
              </text>
              <title>Add a note here</title>
            </g>
          </g>
        ))}

        {layout.arrows.map((arrow) => (
          <Arrow
            key={arrow.messageId}
            arrow={arrow}
            doc={doc}
            selected={selection?.type === 'message' && selection.id === arrow.messageId}
            inRange={
              !!range &&
              arrow.message.order >= range.lo &&
              arrow.message.order < range.hi
            }
            active={arrow.messageId === activeId}
            dim={
              (playing && arrow.messageId !== activeId) ||
              // Tracing an outcome: everything not on that path recedes.
              (!!focusPath && !focusPath.messageIds.has(arrow.messageId))
            }
            onSelect={(shift) =>
              shift
                ? extendSelection({ type: 'message', id: arrow.messageId })
                : select({ type: 'message', id: arrow.messageId })
            }
            onStartReorder={(clientY) =>
              beginDrag({
                kind: 'reorder',
                id: arrow.messageId,
                startY: toLocal(0, clientY).y,
                y: toLocal(0, clientY).y,
                moved: false,
              })
            }
            onRename={() => setEditing({ id: arrow.messageId, kind: 'message' })}
            onMenu={(e) => {
              if (
                !range ||
                arrow.message.order < range.lo ||
                arrow.message.order >= range.hi
              ) {
                select({ type: 'message', id: arrow.messageId })
              }
              ctx.open(e, arrowMenu(deps, arrow.message))
            }}
            onGrabEnd={(end, clientX) =>
              beginDrag({
                kind: 'endpoint',
                messageId: arrow.messageId,
                end,
                x: toLocalX(clientX),
              })
            }
          />
        ))}

        {dropLane && drag?.kind !== 'create' && (
          <line
            className="drop-lane"
            x1={dropLane.x}
            x2={dropLane.x}
            y1={SEQ.headTop - 6}
            y2={layout.lifelineBottom}
          />
        )}

        {dropSlot && drag?.kind === 'create' && (
          <g pointerEvents="none">
            <line
              className="drop-slot"
              x1={SEQ.marginX / 2}
              x2={layout.width - SEQ.marginX / 2}
              y1={dropSlot.y}
              y2={dropSlot.y}
            />
            <line
              className={`create-preview${drag.note ? ' note' : ''}`}
              x1={layout.laneById.get(drag.from)?.x ?? drag.startX}
              x2={dropLane?.x ?? drag.x}
              y1={dropSlot.y}
              y2={dropSlot.y}
            />
            <text
              className="create-hint"
              x={
                ((layout.laneById.get(drag.from)?.x ?? drag.startX) +
                  (dropLane?.x ?? drag.x)) /
                2
              }
              y={dropSlot.y - 10}
              textAnchor="middle"
            >
              {drag.note
                ? `note over ${drag.from}, ${dropLane?.id ?? ''}`
                : `${drag.from} → ${dropLane?.id ?? ''}`}
            </text>
          </g>
        )}

        {dropSlot && drag?.kind === 'reorder' && (
          <line
            className="drop-slot"
            x1={SEQ.marginX / 2}
            x2={layout.width - SEQ.marginX / 2}
            y1={dropSlot.y}
            y2={dropSlot.y}
            pointerEvents="none"
          />
        )}

        {layout.lanes.map((lane) => (
          <Lane
            key={lane.id}
            lane={lane}
            laneW={layout.laneW}
            selected={selection?.type === 'participant' && selection.id === lane.id}
            active={
              !!activeArrow &&
              (activeArrow.from === lane.id || activeArrow.to === lane.id)
            }
            dragging={drag?.kind === 'lane' && drag.id === lane.id}
            onSelect={() => select({ type: 'participant', id: lane.id })}
            onMenu={(e) => {
              select({ type: 'participant', id: lane.id })
              ctx.open(e, participantMenu(deps, lane.id))
            }}
            onGrab={(clientX) =>
              beginDrag({
                kind: 'lane',
                id: lane.id,
                fromIndex: lane.index,
                x: toLocalX(clientX),
              })
            }
            onNudge={(delta) => mutate((draft) => moveParticipant(draft, lane.id, delta))}
          />
        ))}

            {activeArrow && <Packet arrow={activeArrow} progress={progress} />}

        {editor && (
          <InlineLabel
            x={editor.x}
            y={editor.y}
            width={editor.width}
            value={editor.value}
            placeholder={editor.placeholder}
            onCommit={(next) => {
              commitInlineLabel(next)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        )}

            {editor && (
              <InlineLabel
                x={editor.x}
                y={editor.y}
                width={editor.width}
                value={editor.value}
                placeholder={editor.placeholder}
                onCommit={(next) => {
                  commitInlineLabel(next)
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            )}
          </svg>
        </div>

        {showMinimap && (
          <Minimap
            hostRef={hostRef}
            width={layout.width}
            height={layout.height}
            scale={scale}
            label="Sequence"
          >
            {layout.blocks.map((b) => (
              <rect
                key={b.blockId}
                className={`mini-block${b.isUnhappy ? ' unhappy' : ''}`}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={2}
              />
            ))}
            {layout.lanes.map((l) => (
              <line
                key={l.id}
                className="mini-lifeline"
                x1={l.x}
                x2={l.x}
                y1={SEQ.headTop}
                y2={layout.lifelineBottom}
              />
            ))}
            {layout.lanes.map((l) => (
              <rect
                key={`h-${l.id}`}
                className="mini-head"
                x={l.x - layout.laneW / 2 + 6}
                y={SEQ.headTop}
                width={layout.laneW - 12}
                height={SEQ.headH}
                rx={2}
              />
            ))}
            {layout.arrows.map((a) => (
              <line
                key={a.messageId}
                className={`mini-arrow${a.isUnhappy ? ' unhappy' : ''}${
                  a.messageId === activeArrow?.messageId ? ' active' : ''
                }`}
                x1={a.isSelf ? a.x1 : Math.min(a.x1, a.x2)}
                x2={a.isSelf ? a.x1 + 26 : Math.max(a.x1, a.x2)}
                y1={a.y}
                y2={a.y}
              />
            ))}
          </Minimap>
        )}
      </div>
      {ctx.menu && <ContextMenu menu={ctx.menu} onClose={ctx.close} />}
    </section>
  )
}

function focusIdOf(selection: ReturnType<typeof useStore.getState>['selection']) {
  if (selection?.type === 'message' || selection?.type === 'block') return selection.id
  return null
}

/* -------------------------------------------------------------------- lane */

function Lane({
  lane,
  laneW,
  selected,
  active,
  dragging,
  onSelect,
  onMenu,
  onGrab,
  onNudge,
}: {
  lane: SequenceLayout['lanes'][number]
  laneW: number
  selected: boolean
  active: boolean
  dragging: boolean
  onSelect: () => void
  onMenu: (e: React.MouseEvent) => void
  onGrab: (clientX: number) => void
  onNudge: (delta: -1 | 1) => void
}) {
  const w = laneW - 22
  const x = lane.x - w / 2
  const aws = isAwsKind(lane.kind)

  return (
    <g
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onSelect()
        onGrab(e.clientX)
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        onMenu(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onNudge(-1)
        if (e.key === 'ArrowRight') onNudge(1)
      }}
      tabIndex={0}
      role="button"
      aria-label={`${lane.label}, ${KIND_LABEL[lane.kind]}`}
    >
      <title>{`${lane.label} · ${KIND_LABEL[lane.kind]}\nDrag to reorder · right-click for more`}</title>
      <rect
        className={[
          'lane-box',
          aws ? 'aws' : '',
          selected ? 'selected' : '',
          active ? 'active' : '',
          dragging ? 'dragging' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        x={x}
        y={SEQ.headTop}
        width={w}
        height={SEQ.headH}
        rx={7}
      />
      <g className={aws ? 'lane-icon aws' : 'lane-icon'}>
        <KindGlyph kind={lane.kind} x={x + 11} y={SEQ.headTop + 11} size={19} />
      </g>
      <text className="lane-label" x={x + 38} y={SEQ.headTop + 25}>
        {truncate(lane.label, Math.floor((w - 46) / 6.6))}
      </text>
      <text className="lane-kind" x={x + 38} y={SEQ.headTop + 42}>
        {KIND_LABEL[lane.kind].toUpperCase()}
      </text>
    </g>
  )
}

/* ------------------------------------------------------------------ arrow */

function Arrow({
  arrow,
  doc,
  selected,
  inRange,
  active,
  dim,
  onSelect,
  onMenu,
  onStartReorder,
  onRename,
  onGrabEnd,
}: {
  arrow: ArrowLayout
  doc: SequenceDoc
  selected: boolean
  inRange: boolean
  active: boolean
  dim: boolean
  onSelect: (shiftKey: boolean) => void
  onMenu: (e: React.MouseEvent) => void
  onStartReorder: (clientY: number) => void
  onRename: () => void
  onGrabEnd: (end: 'from' | 'to', clientX: number) => void
}) {
  const contract = contractByName(doc, arrow.contractRef)
  const contractUnhappy = !!contract?.responses.some((r) => !r.isHappyPath)

  const cls = [
    'arrow-line',
    arrow.style,
    arrow.isUnhappy ? 'unhappy' : '',
    selected || inRange ? 'selected' : '',
    active ? 'active' : '',
    dim ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const path = arrowPath(arrow)
  const forward = arrow.x2 >= arrow.x1
  const headX = arrow.isSelf ? arrow.x1 + 5 : arrow.x2
  const headY = arrow.isSelf ? arrow.y + SEQ.selfHeight : arrow.y
  const headDir = arrow.isSelf ? -1 : forward ? 1 : -1

  const labelY = arrow.y - 9
  const labelWidth = arrow.label.length * 6.4 + 12

  return (
    <g>
      <path className={cls} d={path} />
      <ArrowHead
        x={headX}
        y={headY}
        dir={headDir}
        style={arrow.style}
        className={cls.replace('arrow-line', 'arrow-line head')}
      />

      {arrow.label && (
        <>
          <rect
            x={arrow.midX - labelWidth / 2}
            y={labelY - 11}
            width={labelWidth}
            height={15}
            rx={3}
            fill="var(--surface-0)"
            opacity={dim ? 0.3 : 0.92}
            pointerEvents="none"
          />
          <text
            className={[
              'arrow-label',
              arrow.isUnhappy ? 'unhappy' : '',
              dim ? 'dim' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            x={arrow.midX}
            y={labelY}
            textAnchor="middle"
          >
            {arrow.label}
          </text>
        </>
      )}

      {contract && (
        <g
          className={`contract-badge${contractUnhappy ? ' unhappy' : ''}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            onSelect(e.shiftKey)
          }}
          onContextMenu={(e) => {
            e.stopPropagation()
            onMenu(e)
          }}
          opacity={dim ? 0.35 : 1}
        >
          <title>{contractSummary(doc, arrow.contractRef!)}</title>
          <rect
            x={arrow.midX - 26}
            y={arrow.y + 5}
            width={52}
            height={15}
            rx={4}
            strokeWidth={1}
          />
          <text x={arrow.midX} y={arrow.y + 16} textAnchor="middle">
            {badgeText(doc, arrow.contractRef!)}
          </text>
        </g>
      )}

      <path
        className="arrow-hit"
        d={path}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          onSelect(e.shiftKey)
          // The drag only becomes a move once the pointer travels; a plain
          // press still just selects.
          if (!e.shiftKey) onStartReorder(e.clientY)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onRename()
        }}
        onContextMenu={(e) => {
          e.stopPropagation()
          onMenu(e)
        }}
      >
        <title>
          {`${arrow.from} → ${arrow.to}: ${arrow.label}\nDouble-click to rename · drag up or down to move · shift-click to extend`}
        </title>
      </path>

      {selected && !arrow.isSelf && (
        <>
          <circle
            className="arrow-handle"
            cx={arrow.x1}
            cy={arrow.y}
            r={5}
            onPointerDown={(e) => {
              e.stopPropagation()
              onGrabEnd('from', e.clientX)
            }}
          >
            <title>Drag to change the sender</title>
          </circle>
          <circle
            className="arrow-handle"
            cx={arrow.x2}
            cy={arrow.y}
            r={5}
            onPointerDown={(e) => {
              e.stopPropagation()
              onGrabEnd('to', e.clientX)
            }}
          >
            <title>Drag to change the receiver</title>
          </circle>
        </>
      )}
    </g>
  )
}

function ArrowHead({
  x,
  y,
  dir,
  style,
  className,
}: {
  x: number
  y: number
  dir: number
  style: ArrowLayout['style']
  className: string
}) {
  const s = 7 * dir
  if (style === 'fireAndForget') {
    return (
      <g className={className} pointerEvents="none">
        <line x1={x - 5} y1={y - 5} x2={x + 5} y2={y + 5} strokeDasharray="none" />
        <line x1={x - 5} y1={y + 5} x2={x + 5} y2={y - 5} strokeDasharray="none" />
      </g>
    )
  }
  if (style === 'async') {
    return (
      <polyline
        className={className}
        points={`${x - s},${y - 4.6} ${x},${y} ${x - s},${y + 4.6}`}
        strokeDasharray="none"
        pointerEvents="none"
      />
    )
  }
  return (
    <polygon
      className={className}
      points={`${x},${y} ${x - s},${y - 4.4} ${x - s},${y + 4.4}`}
      pointerEvents="none"
    />
  )
}

function arrowPath(a: ArrowLayout): string {
  if (!a.isSelf) return `M ${a.x1} ${a.y} L ${a.x2} ${a.y}`
  const h = SEQ.selfHeight
  return `M ${a.x1} ${a.y} L ${a.x2} ${a.y} L ${a.x2} ${a.y + h} L ${a.x1 + 5} ${a.y + h}`
}

/* ----------------------------------------------------------------- packet */

function Packet({ arrow, progress }: { arrow: ArrowLayout; progress: number }) {
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - (2 - 2 * progress) ** 2 / 2
  const { x, y } = pointAlong(arrow, eased)
  return <circle className="packet" cx={x} cy={y} r={5} />
}

function pointAlong(a: ArrowLayout, t: number): { x: number; y: number } {
  if (!a.isSelf) return { x: a.x1 + (a.x2 - a.x1) * t, y: a.y }

  const h = SEQ.selfHeight
  const w = a.x2 - a.x1
  const total = w + h + (w - 5)
  const d = total * t
  if (d < w) return { x: a.x1 + d, y: a.y }
  if (d < w + h) return { x: a.x2, y: a.y + (d - w) }
  return { x: a.x2 - (d - w - h), y: a.y + h }
}

/* ------------------------------------------------------------ blocks/notes */

function Blocks({
  layout,
  selection,
  onSelect,
  onMenu,
}: {
  layout: SequenceLayout
  selection: ReturnType<typeof useStore.getState>['selection']
  onSelect: (s: { type: 'block'; id: string }) => void
  onMenu: (e: React.MouseEvent, block: SequenceLayout['blocks'][number]['block']) => void
}) {
  return (
    <g>
      {layout.blocks.map((b) => {
        const selected = selection?.type === 'block' && selection.id === b.blockId
        const tagW = b.block.type.length * 7 + 14
        return (
          <g key={b.blockId}>
            <rect
              className={[
                'block-rect',
                b.isUnhappy ? 'unhappy' : '',
                selected ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                onSelect({ type: 'block', id: b.blockId })
              }}
              onContextMenu={(e) => {
                e.stopPropagation()
                onMenu(e, b.block)
              }}
            >
              <title>{`${b.block.type} ${b.label}`}</title>
            </rect>
            <path
              className={`block-tag${b.isUnhappy ? ' unhappy' : ''}`}
              d={`M ${b.x} ${b.y} h ${tagW} l -7 17 h ${-tagW + 7} z`}
              pointerEvents="none"
            />
            <text className="block-tag-text" x={b.x + 7} y={b.y + 12.5}>
              {b.block.type.toUpperCase()}
            </text>
            <text
              className={`block-label${b.isUnhappy ? ' unhappy' : ''}`}
              x={b.x + tagW + 8}
              y={b.y + 13}
            >
              {truncate(b.label, Math.floor((b.w - tagW - 20) / 6))}
            </text>

            {b.dividers.map((d) => (
              <g key={`${b.blockId}-${d.branchIndex}`}>
                <line
                  className="block-divider"
                  x1={b.x}
                  x2={b.x + b.w}
                  y1={d.y + 8}
                  y2={d.y + 8}
                />
                <text
                  className={`block-label${d.isUnhappy ? ' unhappy' : ''}`}
                  x={b.x + 9}
                  y={d.y + 23}
                >
                  {`[else] ${truncate(d.label, Math.floor((b.w - 30) / 6))}`}
                </text>
              </g>
            ))}
          </g>
        )
      })}
    </g>
  )
}

function Notes({
  layout,
  selection,
  onSelect,
  onMenu,
}: {
  layout: SequenceLayout
  selection: ReturnType<typeof useStore.getState>['selection']
  onSelect: (s: { type: 'note'; id: string }) => void
  onMenu: (e: React.MouseEvent, noteId: string) => void
}) {
  return (
    <g>
      {layout.notes.map((n) => (
        <g key={n.noteId}>
          <rect
            className="note-box"
            x={n.x}
            y={n.y}
            width={n.w}
            height={n.h}
            stroke={selection?.type === 'note' && selection.id === n.noteId ? 'var(--accent)' : undefined}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              onSelect({ type: 'note', id: n.noteId })
            }}
            onContextMenu={(e) => {
              e.stopPropagation()
              onMenu(e, n.noteId)
            }}
          >
            <title>{n.note.text}</title>
          </rect>
          <text className="note-text" x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle">
            {truncate(n.note.text, Math.floor((n.w - 16) / 5.9))}
          </text>
        </g>
      ))}
    </g>
  )
}

/* ----------------------------------------------------------------- helpers */

function truncate(s: string, max: number): string {
  if (max < 4) return ''
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

function badgeText(doc: SequenceDoc, name: string): string {
  const c = contractByName(doc, name)
  if (!c) return name.slice(0, 8)
  if (c.transport === 'http') return c.method ?? 'HTTP'
  return c.transport.toUpperCase().replace('GENERIC-ASYNC', 'ASYNC')
}

function contractSummary(doc: SequenceDoc, name: string): string {
  const c = contractByName(doc, name)
  if (!c) return `@${name} (not defined)`
  const happy = c.responses.find((r) => r.isHappyPath)
  const unhappy = c.responses.filter((r) => !r.isHappyPath).length
  const head =
    c.transport === 'http'
      ? `${c.method ?? 'POST'} ${c.path ?? ''}`.trim()
      : `${c.transport} ${c.modelName ?? ''}`.trim()
  return [
    `${c.name} — ${head}`,
    happy ? `happy: ${happy.code} ${happy.label}` : 'no happy path modelled',
    `${unhappy} unhappy path${unhappy === 1 ? '' : 's'}`,
  ].join('\n')
}
