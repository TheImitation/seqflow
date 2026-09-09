import { messageIsOnUnhappyPath } from '../dsl/architecture'
import type {
  Block,
  Message,
  MessageStyle,
  Note,
  ParticipantKind,
  SequenceDoc,
} from '../dsl/ast'
import { buildTree, type SeqNode } from '../dsl/tree'

/* --------------------------------------------------------------- constants */

export const SEQ = {
  marginX: 28,
  headTop: 18,
  headH: 62,
  gapBelowHead: 30,
  rowH: 56,
  noteH: 50,
  blockHeader: 30,
  blockPadBottom: 14,
  elseH: 28,
  selfWidth: 58,
  selfHeight: 30,
  laneMin: 156,
  laneMax: 280,
  bottomPad: 44,
  charW: 7.0,
} as const

/* ------------------------------------------------------------------- types */

export interface LaneLayout {
  id: string
  label: string
  kind: ParticipantKind
  index: number
  /** Centre of the lifeline. */
  x: number
}

export interface ArrowLayout {
  messageId: string
  message: Message
  from: string
  to: string
  x1: number
  x2: number
  y: number
  /** Where the badge and label sit. */
  midX: number
  isSelf: boolean
  style: MessageStyle
  label: string
  contractRef?: string
  isUnhappy: boolean
  depth: number
}

export interface NoteLayout {
  noteId: string
  note: Note
  x: number
  y: number
  w: number
  h: number
}

export interface BlockDivider {
  y: number
  label: string
  isUnhappy?: boolean
  branchIndex: number
}

export interface BlockLayout {
  blockId: string
  block: Block
  x: number
  y: number
  w: number
  h: number
  depth: number
  label: string
  dividers: BlockDivider[]
  isUnhappy: boolean
}

/**
 * A place a new step can be inserted. One before every node at every level, plus
 * one at the end of each branch — which is exactly what drag-to-create, the
 * hover gutter and drag-to-reorder all need to answer "where did they drop it?".
 */
export interface InsertSlot {
  /** Order the inserted step would take. */
  order: number
  /** y of the boundary between the steps either side. */
  y: number
  parentBlock?: string
  depth: number
}

export interface SequenceLayout {
  width: number
  height: number
  laneW: number
  bodyTop: number
  lifelineBottom: number
  lanes: LaneLayout[]
  laneById: Map<string, LaneLayout>
  arrows: ArrowLayout[]
  notes: NoteLayout[]
  blocks: BlockLayout[]
  slots: InsertSlot[]
  arrowByMessageId: Map<string, ArrowLayout>
}

/* ------------------------------------------------------------------ layout */

export function layoutSequence(doc: SequenceDoc): SequenceLayout {
  const longest = doc.participants.reduce((n, p) => Math.max(n, p.label.length), 4)
  const laneW = clamp(longest * SEQ.charW + 54, SEQ.laneMin, SEQ.laneMax)

  const lanes: LaneLayout[] = doc.participants.map((p, index) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    index,
    x: SEQ.marginX + laneW / 2 + index * laneW,
  }))
  const laneById = new Map(lanes.map((l) => [l.id, l]))

  const bodyTop = SEQ.headTop + SEQ.headH + SEQ.gapBelowHead
  const arrows: ArrowLayout[] = []
  const notes: NoteLayout[] = []
  const blocks: BlockLayout[] = []
  const slots: InsertSlot[] = []

  const width = Math.max(
    SEQ.marginX * 2 + Math.max(lanes.length, 1) * laneW,
    520,
  )

  const laneIndex = (id: string) => laneById.get(id)?.index ?? 0
  const laneX = (id: string) => laneById.get(id)?.x ?? SEQ.marginX + laneW / 2

  interface Span {
    y: number
    min: number
    max: number
    touched: boolean
  }

  const walk = (
    nodes: SeqNode[],
    startY: number,
    depth: number,
    context: { order: number; parentBlock?: string },
  ): Span => {
    let y = startY
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    let touched = false

    const touch = (...ids: string[]) => {
      for (const id of ids) {
        const i = laneIndex(id)
        min = Math.min(min, i)
        max = Math.max(max, i)
        touched = true
      }
    }

    for (const node of nodes) {
      slots.push({ order: orderOf(node), y, parentBlock: context.parentBlock, depth })

      if (node.kind === 'message') {
        const m = node.message
        const isSelf = m.from === m.to
        const x1 = laneX(m.from)
        const x2 = laneX(m.to)
        const arrowY = y + SEQ.rowH * 0.62
        const arrow: ArrowLayout = {
          messageId: m.id,
          message: m,
          from: m.from,
          to: m.to,
          x1,
          x2: isSelf ? x1 + SEQ.selfWidth : x2,
          y: arrowY,
          midX: isSelf ? x1 + SEQ.selfWidth : (x1 + x2) / 2,
          isSelf,
          style: m.style,
          label: m.label,
          contractRef: m.contractRef,
          isUnhappy: messageIsOnUnhappyPath(doc, m),
          depth,
        }
        arrows.push(arrow)
        touch(m.from, m.to)
        y += isSelf ? SEQ.rowH + SEQ.selfHeight : SEQ.rowH
        continue
      }

      if (node.kind === 'note') {
        const n = node.note
        const ids = n.over.length ? n.over : []
        const xs = ids.map(laneX)
        let nx: number
        let nw: number
        if (!xs.length) {
          nx = SEQ.marginX
          nw = Math.min(320, width - SEQ.marginX * 2)
        } else if (n.placement === 'left') {
          nw = Math.max(140, n.text.length * SEQ.charW + 24)
          nx = Math.min(...xs) - nw - 12
        } else if (n.placement === 'right') {
          nw = Math.max(140, n.text.length * SEQ.charW + 24)
          nx = Math.max(...xs) + 12
        } else {
          const lo = Math.min(...xs)
          const hi = Math.max(...xs)
          nw = Math.max(hi - lo + 120, n.text.length * SEQ.charW + 28)
          nx = (lo + hi) / 2 - nw / 2
        }
        nx = clamp(nx, 8, Math.max(8, width - nw - 8))
        notes.push({ noteId: n.id, note: n, x: nx, y: y + 6, w: nw, h: SEQ.noteH - 12 })
        touch(...ids)
        y += SEQ.noteH
        continue
      }

      // block
      const blockTop = y
      y += SEQ.blockHeader
      const dividers: BlockDivider[] = []
      let bMin = Number.POSITIVE_INFINITY
      let bMax = Number.NEGATIVE_INFINITY
      let bTouched = false

      node.branches.forEach((branch, i) => {
        if (i > 0) {
          dividers.push({
            y,
            label: branch.label,
            isUnhappy: branch.isUnhappy,
            branchIndex: i,
          })
          y += SEQ.elseH
        }
        const span = walk(branch.children, y, depth + 1, {
          order: branch.startOrder,
          parentBlock: node.block.id,
        })
        y = span.y
        slots.push({
          order: branch.endOrder,
          y,
          parentBlock: node.block.id,
          depth: depth + 1,
        })
        if (span.touched) {
          bMin = Math.min(bMin, span.min)
          bMax = Math.max(bMax, span.max)
          bTouched = true
        }
        // Keep an empty branch from collapsing to nothing.
        if (!branch.children.length) y += 18
      })

      y += SEQ.blockPadBottom

      const inset = 22
      let bx: number
      let bw: number
      if (bTouched) {
        const lo = SEQ.marginX + laneW / 2 + bMin * laneW
        const hi = SEQ.marginX + laneW / 2 + bMax * laneW
        bx = lo - inset - depth * 6
        bw = hi - lo + (inset + depth * 6) * 2
      } else {
        bx = SEQ.marginX
        bw = width - SEQ.marginX * 2
      }
      const minW = Math.max(240, node.block.label.length * SEQ.charW + 90)
      if (bw < minW) {
        bx -= (minW - bw) / 2
        bw = minW
      }
      bx = clamp(bx, 6, Math.max(6, width - 6 - bw))

      blocks.push({
        blockId: node.block.id,
        block: node.block,
        x: bx,
        y: blockTop,
        w: bw,
        h: y - blockTop,
        depth,
        label: node.branches[0]?.label || node.block.label,
        dividers,
        isUnhappy: !!(node.block.isUnhappy || node.branches.some((b) => b.isUnhappy)),
      })

      if (bTouched) {
        min = Math.min(min, bMin)
        max = Math.max(max, bMax)
        touched = true
      }
    }

    slots.push({ order: endOrderOf(nodes, context), y, parentBlock: context.parentBlock, depth })
    return { y, min, max, touched }
  }

  const end = walk(buildTree(doc), bodyTop, 0, { order: 0 })
  const lifelineBottom = Math.max(end.y + 16, bodyTop + 60)

  // Outer blocks are pushed last by the recursion; draw them first.
  blocks.sort((a, z) => a.depth - z.depth || a.y - z.y)

  return {
    width,
    height: lifelineBottom + SEQ.bottomPad,
    laneW,
    bodyTop,
    lifelineBottom,
    lanes,
    laneById,
    arrows,
    notes,
    blocks,
    slots: dedupeSlots(slots),
    arrowByMessageId: new Map(arrows.map((a) => [a.messageId, a])),
  }
}

function orderOf(node: SeqNode): number {
  if (node.kind === 'message') return node.message.order
  if (node.kind === 'note') return node.note.order
  return node.block.startOrder
}

function endOrderOf(nodes: SeqNode[], context: { order: number }): number {
  const last = nodes[nodes.length - 1]
  if (!last) return context.order
  if (last.kind === 'message') return last.message.order + 1
  if (last.kind === 'note') return last.note.order + 1
  return last.block.endOrder
}

/**
 * A branch end and the next sibling's start land on the same y. Keep the
 * innermost (deepest) one so dropping just below the last step of a block puts
 * you inside it rather than after it.
 */
function dedupeSlots(slots: InsertSlot[]): InsertSlot[] {
  const best = new Map<string, InsertSlot>()
  for (const slot of slots) {
    const key = `${Math.round(slot.y)}`
    const current = best.get(key)
    if (!current || slot.depth > current.depth) best.set(key, slot)
  }
  return [...best.values()].sort((a, z) => a.y - z.y)
}

/** The slot nearest a y coordinate — used when dropping a dragged step. */
export function slotAtY(layout: SequenceLayout, y: number): InsertSlot | undefined {
  let best: InsertSlot | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const slot of layout.slots) {
    const d = Math.abs(slot.y - y)
    if (d < bestD) {
      bestD = d
      best = slot
    }
  }
  return best
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Nearest lane to an x coordinate — used when dropping a dragged arrow end. */
export function laneAtX(layout: SequenceLayout, x: number): LaneLayout | undefined {
  let best: LaneLayout | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const lane of layout.lanes) {
    const d = Math.abs(lane.x - x)
    if (d < bestD) {
      bestD = d
      best = lane
    }
  }
  return best
}
