import type {
  Block,
  BlockType,
  Message,
  Note,
  Participant,
  ParticipantKind,
  SequenceDoc,
} from './ast'
import { buildTree, type SeqNode } from './tree'

/**
 * Order-space surgery. Messages and notes share one linear index; blocks own a
 * half-open range of it. Every structural edit here keeps those consistent so
 * the doc re-serializes to valid DSL.
 */

export function cloneDoc(doc: SequenceDoc): SequenceDoc {
  return {
    participants: doc.participants.map((p) => ({ ...p })),
    messages: doc.messages.map((m) => ({ ...m })),
    notes: doc.notes.map((n) => ({ ...n, over: [...n.over] })),
    blocks: doc.blocks.map((b) => ({
      ...b,
      branches: b.branches?.map((x) => ({ ...x })),
    })),
    dataModels: structuredClone(doc.dataModels),
    contracts: structuredClone(doc.contracts),
    tables: structuredClone(doc.tables),
  }
}

/** Make room for `count` steps at `at`, growing any block that spans the point. */
export function makeRoom(doc: SequenceDoc, at: number, count: number): void {
  if (count === 0) return
  for (const m of doc.messages) if (m.order >= at) m.order += count
  for (const n of doc.notes) if (n.order >= at) n.order += count
  for (const b of doc.blocks) {
    if (b.startOrder >= at) b.startOrder += count
    if (b.endOrder >= at) b.endOrder += count
    for (const br of b.branches ?? []) {
      if (br.startOrder >= at) br.startOrder += count
      if (br.endOrder >= at) br.endOrder += count
    }
  }
}

/** Close the gap left by removing `count` steps starting at `at`. */
export function closeGap(doc: SequenceDoc, at: number, count: number): void {
  if (count === 0) return
  for (const m of doc.messages) if (m.order >= at + count) m.order -= count
  for (const n of doc.notes) if (n.order >= at + count) n.order -= count
  for (const b of doc.blocks) {
    if (b.startOrder >= at + count) b.startOrder -= count
    else if (b.startOrder > at) b.startOrder = at
    if (b.endOrder >= at + count) b.endOrder -= count
    else if (b.endOrder > at) b.endOrder = at
    for (const br of b.branches ?? []) {
      if (br.startOrder >= at + count) br.startOrder -= count
      else if (br.startOrder > at) br.startOrder = at
      if (br.endOrder >= at + count) br.endOrder -= count
      else if (br.endOrder > at) br.endOrder = at
    }
  }
}

/* ------------------------------------------------------------ participants */

export function addParticipant(
  doc: SequenceDoc,
  kind: ParticipantKind = 'service',
): Participant {
  let n = doc.participants.length + 1
  let id = `Service${n}`
  while (doc.participants.some((p) => p.id === id)) id = `Service${++n}`
  const p: Participant = { id, label: id, kind }
  doc.participants.push(p)
  return p
}

export function renameParticipant(doc: SequenceDoc, id: string, nextId: string): boolean {
  const trimmed = nextId.trim()
  if (!trimmed || /\s/.test(trimmed) || trimmed === id) return false
  if (doc.participants.some((p) => p.id === trimmed)) return false

  const p = doc.participants.find((x) => x.id === id)
  if (!p) return false
  // A label that just echoed the id was never customised, so follow the rename
  // rather than stranding the old name on the diagram.
  if (p.label === p.id) p.label = trimmed
  p.id = trimmed
  for (const m of doc.messages) {
    if (m.from === id) m.from = trimmed
    if (m.to === id) m.to = trimmed
  }
  for (const n of doc.notes) n.over = n.over.map((o) => (o === id ? trimmed : o))
  return true
}

export function removeParticipant(doc: SequenceDoc, id: string): void {
  doc.participants = doc.participants.filter((p) => p.id !== id)
  for (const m of [...doc.messages]) {
    if (m.from === id || m.to === id) removeMessage(doc, m.id)
  }
  for (const n of [...doc.notes]) {
    const over = n.over.filter((o) => o !== id)
    if (!over.length) removeNote(doc, n.id)
    else n.over = over
  }
}

export function moveParticipant(doc: SequenceDoc, id: string, delta: number): void {
  const i = doc.participants.findIndex((p) => p.id === id)
  if (i < 0) return
  const j = i + delta
  if (j < 0 || j >= doc.participants.length) return
  const [p] = doc.participants.splice(i, 1)
  doc.participants.splice(j, 0, p)
}

export function reorderParticipant(doc: SequenceDoc, id: string, toIndex: number): void {
  const i = doc.participants.findIndex((p) => p.id === id)
  if (i < 0) return
  const j = Math.max(0, Math.min(doc.participants.length - 1, toIndex))
  if (i === j) return
  const [p] = doc.participants.splice(i, 1)
  doc.participants.splice(j, 0, p)
}

/* ---------------------------------------------------------------- messages */

function nextMessageId(doc: SequenceDoc): string {
  let n = doc.messages.length
  while (doc.messages.some((m) => m.id === `m${n}`)) n++
  return `m${n}`
}

export function insertMessage(
  doc: SequenceDoc,
  at: number,
  init: Omit<Message, 'id' | 'order'>,
): Message {
  makeRoom(doc, at, 1)
  const m: Message = { ...init, id: nextMessageId(doc), order: at }
  doc.messages.push(m)
  doc.messages.sort((a, z) => a.order - z.order)
  return m
}

export function removeMessage(doc: SequenceDoc, id: string): void {
  const m = doc.messages.find((x) => x.id === id)
  if (!m) return
  doc.messages = doc.messages.filter((x) => x.id !== id)
  closeGap(doc, m.order, 1)
}

export function insertNote(
  doc: SequenceDoc,
  at: number,
  init: Omit<Note, 'id' | 'order'>,
): Note {
  makeRoom(doc, at, 1)
  let n = doc.notes.length
  while (doc.notes.some((x) => x.id === `n${n}`)) n++
  const note: Note = { ...init, id: `n${n}`, order: at }
  doc.notes.push(note)
  doc.notes.sort((a, z) => a.order - z.order)
  return note
}

export function removeNote(doc: SequenceDoc, id: string): void {
  const n = doc.notes.find((x) => x.id === id)
  if (!n) return
  doc.notes = doc.notes.filter((x) => x.id !== id)
  closeGap(doc, n.order, 1)
}

/** Order range a tree node occupies. */
function rangeOf(node: SeqNode): [number, number] {
  if (node.kind === 'message') return [node.message.order, node.message.order + 1]
  if (node.kind === 'note') return [node.note.order, node.note.order + 1]
  return [node.block.startOrder, node.block.endOrder]
}

function idOf(node: SeqNode): string {
  if (node.kind === 'message') return node.message.id
  if (node.kind === 'note') return node.note.id
  return node.block.id
}

/** Find a node's sibling list in the tree, so a move stays inside its branch. */
function findSiblings(nodes: SeqNode[], id: string): SeqNode[] | undefined {
  if (nodes.some((n) => idOf(n) === id)) return nodes
  for (const n of nodes) {
    if (n.kind !== 'block') continue
    for (const b of n.branches) {
      const found = findSiblings(b.children, id)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Move a step (or a whole block) past its neighbouring sibling, without
 * escaping its enclosing block or branch.
 */
export function moveStep(doc: SequenceDoc, id: string, dir: -1 | 1): boolean {
  const siblings = findSiblings(buildTree(doc), id)
  if (!siblings) return false
  const i = siblings.findIndex((n) => idOf(n) === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= siblings.length) return false

  const a = rangeOf(siblings[Math.min(i, j)])
  const b = rangeOf(siblings[Math.max(i, j)])
  if (a[1] !== b[0]) return false // not actually adjacent in order space

  const lenA = a[1] - a[0]
  const lenB = b[1] - b[0]
  if (lenA === 0 && lenB === 0) return false

  const inA = collect(doc, a[0], a[1])
  const inB = collect(doc, b[0], b[1])
  applyDelta(inA, lenB)
  applyDelta(inB, -lenA)

  doc.messages.sort((x, z) => x.order - z.order)
  doc.notes.sort((x, z) => x.order - z.order)
  doc.blocks.sort((x, z) => x.startOrder - z.startOrder || z.endOrder - x.endOrder)
  return true
}

interface Collected {
  steps: (Message | Note)[]
  blocks: Block[]
}

function collect(doc: SequenceDoc, lo: number, hi: number): Collected {
  return {
    steps: [
      ...doc.messages.filter((m) => m.order >= lo && m.order < hi),
      ...doc.notes.filter((n) => n.order >= lo && n.order < hi),
    ],
    blocks: doc.blocks.filter((b) => b.startOrder >= lo && b.endOrder <= hi),
  }
}

function applyDelta(c: Collected, delta: number): void {
  for (const s of c.steps) s.order += delta
  for (const b of c.blocks) {
    b.startOrder += delta
    b.endOrder += delta
    for (const br of b.branches ?? []) {
      br.startOrder += delta
      br.endOrder += delta
    }
  }
}

/* ------------------------------------------------------------------ blocks */

export function removeBlock(doc: SequenceDoc, id: string, keepChildren: boolean): void {
  const block = doc.blocks.find((b) => b.id === id)
  if (!block) return

  if (keepChildren) {
    // Unwrap: children move out to the block's own parent.
    for (const m of doc.messages) {
      if (m.parentBlock === id) m.parentBlock = block.parentBlock
    }
    for (const n of doc.notes) {
      if (n.parentBlock === id) n.parentBlock = block.parentBlock
    }
    for (const b of doc.blocks) {
      if (b.parentBlock === id) b.parentBlock = block.parentBlock
    }
    doc.blocks = doc.blocks.filter((b) => b.id !== id)
    return
  }

  const len = block.endOrder - block.startOrder
  const inside = new Set<string>()
  const markDescendants = (blockId: string) => {
    inside.add(blockId)
    for (const b of doc.blocks) if (b.parentBlock === blockId) markDescendants(b.id)
  }
  markDescendants(id)

  doc.messages = doc.messages.filter(
    (m) => !(m.order >= block.startOrder && m.order < block.endOrder),
  )
  doc.notes = doc.notes.filter(
    (n) => !(n.order >= block.startOrder && n.order < block.endOrder),
  )
  doc.blocks = doc.blocks.filter((b) => !inside.has(b.id))
  closeGap(doc, block.startOrder, len)
}

export function nextBlockId(doc: SequenceDoc): string {
  let n = doc.blocks.length
  while (doc.blocks.some((b) => b.id === `b${n}`)) n++
  return `b${n}`
}

/* -------------------------------------------------- structural block edits */

/**
 * Move everything in `[lo, hi)` that currently sits directly under
 * `previousParent` into `block`. Nested blocks come along with their contents.
 */
export function reparentInto(
  doc: SequenceDoc,
  block: Block,
  previousParent: string | undefined,
  lo: number,
  hi: number,
): void {
  for (const m of doc.messages) {
    if (m.parentBlock === previousParent && m.order >= lo && m.order < hi) {
      m.parentBlock = block.id
    }
  }
  for (const n of doc.notes) {
    if (n.parentBlock === previousParent && n.order >= lo && n.order < hi) {
      n.parentBlock = block.id
    }
  }
  for (const b of doc.blocks) {
    if (
      b.id !== block.id &&
      b.parentBlock === previousParent &&
      b.startOrder >= lo &&
      b.endOrder <= hi
    ) {
      b.parentBlock = block.id
    }
  }
}

/** The consecutive sibling run that exactly covers `[lo, hi)`, if there is one. */
function findRun(
  nodes: SeqNode[],
  lo: number,
  hi: number,
  parent: string | undefined,
): { parent: string | undefined } | undefined {
  const ranges = nodes.map(rangeOf)
  const start = ranges.findIndex((r) => r[0] === lo && r[1] > r[0])
  if (start >= 0) {
    let end = start
    while (end < ranges.length && ranges[end][1] <= hi) end++
    if (end > start && ranges[end - 1][1] === hi) return { parent }
  }

  for (const node of nodes) {
    if (node.kind !== 'block') continue
    for (const branch of node.branches) {
      const found = findRun(branch.children, lo, hi, node.block.id)
      if (found) return found
    }
  }
  return undefined
}

export interface WrapResult {
  ok: boolean
  blockId?: string
  reason?: string
}

/**
 * Put a `loop` / `alt` / `opt` around the steps in `[lo, hi)`. The range has to
 * line up with whole siblings at one level — you cannot wrap half of a branch,
 * or a run that straddles an `else`.
 */
export function wrapInBlock(
  doc: SequenceDoc,
  lo: number,
  hi: number,
  type: BlockType,
  label: string,
): WrapResult {
  if (hi <= lo) return { ok: false, reason: 'Nothing to wrap.' }

  const found = findRun(buildTree(doc), lo, hi, undefined)
  if (!found) {
    return {
      ok: false,
      reason: 'That run crosses a block boundary — select whole steps at one level.',
    }
  }

  const block: Block = {
    id: nextBlockId(doc),
    type,
    label,
    startOrder: lo,
    endOrder: hi,
    parentBlock: found.parent,
    branches:
      type === 'alt' ? [{ label, startOrder: lo, endOrder: hi }] : undefined,
  }
  doc.blocks.push(block)
  reparentInto(doc, block, found.parent, lo, hi)
  doc.blocks.sort((a, z) => a.startOrder - z.startOrder || z.endOrder - a.endOrder)

  return { ok: true, blockId: block.id }
}

/**
 * Append an `else` branch. The new branch gets a placeholder message mirroring
 * the first branch's opener, so it is something you can edit rather than an
 * empty region you cannot click into.
 */
export function addBranch(
  doc: SequenceDoc,
  blockId: string,
  label: string,
  isUnhappy?: boolean,
): boolean {
  const block = doc.blocks.find((b) => b.id === blockId)
  if (!block || block.type !== 'alt' || !block.branches?.length) return false

  const at = block.endOrder
  const last = block.branches[block.branches.length - 1]
  const first = block.branches[0]

  const seed = doc.messages
    .filter(
      (m) =>
        m.parentBlock === blockId &&
        m.order >= first.startOrder &&
        m.order < first.endOrder,
    )
    .sort((a, z) => a.order - z.order)[0]

  if (seed) {
    insertMessage(doc, at, {
      from: seed.from,
      to: seed.to,
      label: label || 'response',
      style: seed.style,
      parentBlock: blockId,
    })
    // `makeRoom` grew the previously-last branch and the block; the new step
    // belongs to the new branch, not to the one that just closed.
    last.endOrder = at
    block.endOrder = at + 1
    block.branches.push({ label, startOrder: at, endOrder: at + 1, isUnhappy })
  } else {
    block.branches.push({ label, startOrder: at, endOrder: at, isUnhappy })
  }
  return true
}

/**
 * Retype a block. Going to `alt` synthesises the single branch it needs; going
 * away from `alt` is refused when there is more than one branch, because there
 * is nowhere for the others to go.
 */
export function changeBlockType(
  doc: SequenceDoc,
  blockId: string,
  type: BlockType,
): boolean {
  const block = doc.blocks.find((b) => b.id === blockId)
  if (!block || block.type === type) return false
  if (type !== 'alt' && (block.branches?.length ?? 1) > 1) return false

  block.type = type
  if (type === 'alt') {
    block.branches ??= [
      {
        label: block.label,
        startOrder: block.startOrder,
        endOrder: block.endOrder,
        isUnhappy: block.isUnhappy,
      },
    ]
  } else {
    block.branches = undefined
  }
  return true
}

/** Swap a message's endpoints, keeping its style, label and contract. */
export function reverseMessage(doc: SequenceDoc, id: string): boolean {
  const m = doc.messages.find((x) => x.id === id)
  if (!m || m.from === m.to) return false
  const from = m.from
  m.from = m.to
  m.to = from
  return true
}

export function duplicateMessage(doc: SequenceDoc, id: string): Message | undefined {
  const m = doc.messages.find((x) => x.id === id)
  if (!m) return undefined
  return insertMessage(doc, m.order + 1, {
    from: m.from,
    to: m.to,
    label: m.label,
    style: m.style,
    parentBlock: m.parentBlock,
    contractRef: m.contractRef,
  })
}

/**
 * Move a message or note to an arbitrary insertion point, including into or out
 * of a block. Unlike `moveStep`, which swaps with a sibling, this is a lift and
 * drop: remove, close the gap, then re-insert at the target — with the target
 * order adjusted when the removal happened above it.
 */
export function moveStepToSlot(
  doc: SequenceDoc,
  id: string,
  slot: { order: number; parentBlock?: string },
): boolean {
  const message = doc.messages.find((m) => m.id === id)
  const note = message ? undefined : doc.notes.find((n) => n.id === id)
  const from = message?.order ?? note?.order
  if (from === undefined) return false

  // Dropping either side of where it already sits is a no-op, not a move.
  if (
    (slot.order === from || slot.order === from + 1) &&
    slot.parentBlock === (message?.parentBlock ?? note?.parentBlock)
  ) {
    return false
  }

  if (message) doc.messages = doc.messages.filter((m) => m.id !== id)
  else doc.notes = doc.notes.filter((n) => n.id !== id)
  closeGap(doc, from, 1)

  const at = slot.order > from ? slot.order - 1 : slot.order
  makeRoom(doc, at, 1)

  if (message) {
    doc.messages.push({ ...message, order: at, parentBlock: slot.parentBlock })
    doc.messages.sort((a, z) => a.order - z.order)
  } else if (note) {
    doc.notes.push({ ...note, order: at, parentBlock: slot.parentBlock })
    doc.notes.sort((a, z) => a.order - z.order)
  }
  return true
}
