import type { Block, Message, Note, SequenceDoc } from './ast'

/**
 * The flat AST arrays are the storage format; this rebuilds the nesting the
 * renderer and serializer need. Nesting is taken from `parentBlock` (set by the
 * parser) with `startOrder`/`endOrder` ranges deciding which `alt` branch an
 * item lands in.
 */

export interface BranchNode {
  index: number
  label: string
  isUnhappy?: boolean
  startOrder: number
  endOrder: number
  children: SeqNode[]
}

export type SeqNode =
  | { kind: 'message'; message: Message }
  | { kind: 'note'; note: Note }
  | { kind: 'block'; block: Block; branches: BranchNode[] }

type Item =
  | { key: number; rank: 0; block: Block }
  | { key: number; rank: 1; step: Message | Note; isNote: boolean }

export function buildTree(doc: SequenceDoc): SeqNode[] {
  const byParent = new Map<string, Item[]>()

  const push = (parent: string | undefined, item: Item) => {
    const k = parent ?? ''
    const list = byParent.get(k)
    if (list) list.push(item)
    else byParent.set(k, [item])
  }

  for (const b of doc.blocks) push(b.parentBlock, { key: b.startOrder, rank: 0, block: b })
  for (const m of doc.messages)
    push(m.parentBlock, { key: m.order, rank: 1, step: m, isNote: false })
  for (const n of doc.notes)
    push(n.parentBlock, { key: n.order, rank: 1, step: n, isNote: true })

  // Blocks open before a sibling step sharing their order, so rank sorts first.
  for (const list of byParent.values()) {
    list.sort((a, z) => a.key - z.key || a.rank - z.rank)
  }

  const seen = new Set<string>()

  const toNode = (item: Item): SeqNode => {
    if (item.rank === 1) {
      return item.isNote
        ? { kind: 'note', note: item.step as Note }
        : { kind: 'message', message: item.step as Message }
    }
    return blockNode(item.block)
  }

  const blockNode = (block: Block): SeqNode => {
    // Guard against a malformed doc producing a parent cycle.
    if (seen.has(block.id)) return { kind: 'block', block, branches: [] }
    seen.add(block.id)

    const children = byParent.get(block.id) ?? []
    const ranges: { label: string; isUnhappy?: boolean; start: number; end: number }[] =
      block.branches?.length
        ? block.branches.map((b) => ({
            label: b.label,
            isUnhappy: b.isUnhappy,
            start: b.startOrder,
            end: b.endOrder,
          }))
        : [
            {
              label: block.label,
              isUnhappy: block.isUnhappy,
              start: block.startOrder,
              end: block.endOrder,
            },
          ]

    const branches: BranchNode[] = ranges.map((r, index) => ({
      index,
      label: r.label,
      isUnhappy: r.isUnhappy,
      startOrder: r.start,
      endOrder: r.end,
      children: [],
    }))

    for (const item of children) {
      branches[branchIndexFor(item, ranges)].children.push(toNode(item))
    }

    return { kind: 'block', block, branches }
  }

  return (byParent.get('') ?? []).map(toNode)
}

function branchIndexFor(
  item: Item,
  ranges: { start: number; end: number }[],
): number {
  // An empty block sitting exactly on a branch boundary belongs to the branch
  // that just closed — it was written before the `else`.
  const emptyBlock = item.rank === 0 && item.block.startOrder === item.block.endOrder
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    if (emptyBlock && item.key === r.end && i < ranges.length - 1) return i
    if (item.key >= r.start && item.key < r.end) return i
  }
  return Math.max(0, ranges.length - 1)
}

/* --------------------------------------------------------------- playback */

export interface FlatStep {
  message: Message
  /** Enclosing blocks, outermost first — used to show context during playback. */
  blockPath: { block: Block; branch: BranchNode }[]
}

/**
 * Linearize messages for playback. `branchChoice` picks which `alt` branch to
 * walk (defaults to the first / happy branch).
 */
export function flattenSteps(
  nodes: SeqNode[],
  branchChoice: Record<string, number> = {},
  path: { block: Block; branch: BranchNode }[] = [],
): FlatStep[] {
  const out: FlatStep[] = []
  for (const node of nodes) {
    if (node.kind === 'message') {
      out.push({ message: node.message, blockPath: path })
      continue
    }
    if (node.kind !== 'block') continue

    if (node.block.type === 'alt') {
      const pick = clamp(branchChoice[node.block.id] ?? 0, 0, node.branches.length - 1)
      const branch = node.branches[pick]
      if (branch) {
        out.push(
          ...flattenSteps(branch.children, branchChoice, [
            ...path,
            { block: node.block, branch },
          ]),
        )
      }
      continue
    }

    // loop / opt: a single branch, always walked once.
    for (const branch of node.branches) {
      out.push(
        ...flattenSteps(branch.children, branchChoice, [
          ...path,
          { block: node.block, branch },
        ]),
      )
    }
  }
  return out
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.min(hi, Math.max(lo, n))
}

/** Every `alt` in the doc, for the playback branch picker. */
export function collectAltBlocks(nodes: SeqNode[]): { block: Block; branches: BranchNode[] }[] {
  const out: { block: Block; branches: BranchNode[] }[] = []
  const walk = (list: SeqNode[]) => {
    for (const n of list) {
      if (n.kind !== 'block') continue
      if (n.block.type === 'alt') out.push({ block: n.block, branches: n.branches })
      for (const b of n.branches) walk(b.children)
    }
  }
  walk(nodes)
  return out
}

/* ------------------------------------------------------- range selection */

function nodeId(node: SeqNode): string {
  if (node.kind === 'message') return node.message.id
  if (node.kind === 'note') return node.note.id
  return node.block.id
}

function nodeRange(node: SeqNode): [number, number] {
  if (node.kind === 'message') return [node.message.order, node.message.order + 1]
  if (node.kind === 'note') return [node.note.order, node.note.order + 1]
  return [node.block.startOrder, node.block.endOrder]
}

export interface SiblingRun {
  lo: number
  hi: number
  /** How many top-level steps or blocks the run covers. */
  count: number
}

/**
 * The order range spanned by two nodes, provided they are siblings — same
 * enclosing block *and* same `alt` branch. Shift-click selection and "wrap in a
 * block" both need exactly this, and both must refuse a run that straddles an
 * `else` or escapes its block.
 */
export function siblingRun(
  nodes: SeqNode[],
  aId: string,
  bId: string,
): SiblingRun | undefined {
  const search = (list: SeqNode[]): SiblingRun | undefined => {
    const ai = list.findIndex((n) => nodeId(n) === aId)
    const bi = list.findIndex((n) => nodeId(n) === bId)
    if (ai >= 0 && bi >= 0) {
      const from = Math.min(ai, bi)
      const to = Math.max(ai, bi)
      return {
        lo: nodeRange(list[from])[0],
        hi: nodeRange(list[to])[1],
        count: to - from + 1,
      }
    }
    // Both must live in the same list; finding only one means they are not
    // siblings, so stop rather than pairing across levels.
    if (ai >= 0 || bi >= 0) return undefined

    for (const node of list) {
      if (node.kind !== 'block') continue
      for (const branch of node.branches) {
        const found = search(branch.children)
        if (found) return found
      }
    }
    return undefined
  }

  return search(nodes)
}
