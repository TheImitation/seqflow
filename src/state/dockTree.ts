/**
 * The docking layout, as a tree.
 *
 * A leaf is one slot on screen holding one or more panes; more than one means
 * they are stacked as tabs. A split divides its area between two or more
 * children along one axis. That is the whole model.
 *
 * Everything here is pure and synchronous, including the geometry: `computeLayout`
 * turns a tree plus a container size into rectangles, and the React shell does
 * nothing but position boxes at them. That split is deliberate — the test
 * environment is node-only, so anything expressed as JSX would be untestable,
 * and layout arithmetic is exactly the sort of thing that is quietly wrong.
 *
 * Nodes carry **no ids**. A node is identified by its path from the root — `[]`
 * for the root, `[1, 0]` for the first child of the second child — which needs
 * no id generation, is stable across a save and reload, and cannot drift out of
 * step with the tree the way a stored id can.
 */

export type PaneId = 'editor' | 'sequence' | 'arch' | 'schema' | 'inspector'

export interface DockLeaf {
  type: 'leaf'
  /** More than one pane means tabs. Never empty. */
  panes: PaneId[]
  /** Always a member of `panes`. */
  active: PaneId
}

export interface DockSplit {
  type: 'split'
  direction: 'row' | 'column'
  /** Always two or more, after `normalise`. */
  children: DockNode[]
  /** Fractions of the split's main axis, summing to 1. Same length as `children`. */
  sizes: number[]
}

export type DockNode = DockLeaf | DockSplit

/** Index path from the root. `[]` is the root itself. */
export type DockPath = number[]

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** Thickness of a splitter, in px. It occupies space rather than overlapping. */
export const SPLITTER_PX = 5
/**
 * How narrow each pane may be laid out, in px. Per pane rather than one
 * constant because they genuinely differ: the inspector's body stacks
 * natural-height children and clips below ~260px, CodeMirror wants ~200px to
 * be usable, and the canvases scroll so they tolerate far less.
 */
export const MIN_PANE_PX: Record<PaneId, number> = {
  editor: 200,
  sequence: 130,
  arch: 130,
  schema: 130,
  inspector: 260,
}

/** The floor for a slot: the largest minimum among the tabs sharing it. */
export function minWidthOf(panes: PaneId[]): number {
  return Math.max(...panes.map((p) => MIN_PANE_PX[p]))
}
/** Height of the tab strip drawn above a leaf that holds more than one pane. */
export const TAB_BAR_PX = 28
/** How much of a slot each edge drop-band covers; the rest is the centre. */
export const EDGE_BAND = 0.22

/* ------------------------------------------------------------ constructors */

export function leaf(panes: PaneId[], active?: PaneId): DockLeaf {
  if (!panes.length) throw new Error('A dock leaf must hold at least one pane.')
  return { type: 'leaf', panes, active: active && panes.includes(active) ? active : panes[0] }
}

export function split(
  direction: 'row' | 'column',
  children: DockNode[],
  sizes?: number[],
): DockSplit {
  const even = children.map(() => 1 / children.length)
  return { type: 'split', direction, children, sizes: renormalise(sizes ?? even, children.length) }
}

/**
 * The arrangement the app shipped with before docking existed: the four panes
 * in a row at their original weights, with the inspector as a right-hand column.
 */
export function defaultTree(): DockNode {
  const working = 1 - INSPECTOR_FRACTION
  return split(
    'row',
    [leaf(['editor']), leaf(['sequence']), leaf(['arch']), leaf(['schema']), leaf(['inspector'])],
    [0.2 * working, 0.28 * working, 0.28 * working, 0.24 * working, INSPECTOR_FRACTION],
  )
}

/**
 * The inspector was a fixed 360px column that panes could never squeeze. As an
 * ordinary dockable pane it becomes resizable like everything else — a
 * deliberate reversal of that decision, not an oversight.
 */
const INSPECTOR_FRACTION = 0.22

/* ------------------------------------------------------------------ queries */

export function nodeAt(root: DockNode, path: DockPath): DockNode | undefined {
  let node: DockNode | undefined = root
  for (const index of path) {
    if (!node || node.type !== 'split') return undefined
    node = node.children[index]
  }
  return node
}

/** Every pane in the tree, depth-first and left to right. */
export function paneIds(root: DockNode): PaneId[] {
  if (root.type === 'leaf') return [...root.panes]
  return root.children.flatMap(paneIds)
}

export function findPane(
  root: DockNode,
  pane: PaneId,
): { path: DockPath; leaf: DockLeaf } | undefined {
  const walk = (node: DockNode, path: DockPath): { path: DockPath; leaf: DockLeaf } | undefined => {
    if (node.type === 'leaf') return node.panes.includes(pane) ? { path, leaf: node } : undefined
    for (let i = 0; i < node.children.length; i++) {
      const hit = walk(node.children[i], [...path, i])
      if (hit) return hit
    }
    return undefined
  }
  return walk(root, [])
}

export function samePath(a: DockPath, b: DockPath): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i])
}

/* --------------------------------------------------------------- normalise */

/**
 * Put a tree back into canonical form: no empty leaves, no split with a single
 * child, no split nested directly inside another of the same direction, and
 * every `sizes` array summing to 1.
 *
 * Flattening same-direction splits is what keeps repeated drops from building a
 * staircase of nested rows that behave differently from a flat one — and it is
 * why the child's sizes have to be scaled by its own share on the way up.
 */
export function normalise(node: DockNode): DockNode | null {
  if (node.type === 'leaf') {
    if (!node.panes.length) return null
    return node.panes.includes(node.active) ? node : leaf(node.panes)
  }

  const kept: { child: DockNode; size: number }[] = []
  node.children.forEach((child, i) => {
    const done = normalise(child)
    if (!done) return
    const size = node.sizes[i] ?? 1 / node.children.length
    if (done.type === 'split' && done.direction === node.direction) {
      // Absorb the grandchildren, scaling their fractions into this child's share.
      done.children.forEach((grand, g) => {
        kept.push({ child: grand, size: size * (done.sizes[g] ?? 1 / done.children.length) })
      })
    } else {
      kept.push({ child: done, size })
    }
  })

  if (!kept.length) return null
  if (kept.length === 1) return kept[0].child
  return {
    type: 'split',
    direction: node.direction,
    children: kept.map((k) => k.child),
    sizes: renormalise(
      kept.map((k) => k.size),
      kept.length,
    ),
  }
}

/* ------------------------------------------------------------- mutations */

/** Drop a pane from the tree, pruning whatever that empties. */
export function removePane(root: DockNode, pane: PaneId): DockNode | null {
  const strip = (node: DockNode): DockNode | null => {
    if (node.type === 'leaf') {
      if (!node.panes.includes(pane)) return node
      const panes = node.panes.filter((p) => p !== pane)
      if (!panes.length) return null
      if (node.active !== pane) return leaf(panes, node.active)
      // Promote the tab to the right, falling back to the left — the same rule
      // an editor uses when you close the tab you were looking at.
      const was = node.panes.indexOf(pane)
      return leaf(panes, panes[Math.min(was, panes.length - 1)])
    }
    const children: DockNode[] = []
    const sizes: number[] = []
    node.children.forEach((child, i) => {
      const done = strip(child)
      if (!done) return
      children.push(done)
      sizes.push(node.sizes[i] ?? 1 / node.children.length)
    })
    if (!children.length) return null
    return { type: 'split', direction: node.direction, children, sizes: renormalise(sizes, children.length) }
  }

  const stripped = strip(root)
  return stripped ? normalise(stripped) : null
}

/**
 * Put `pane` into the tree relative to the leaf at `target`: as a tab when the
 * zone is `center`, otherwise splitting that slot along the matching axis.
 */
export function insertPane(
  root: DockNode,
  pane: PaneId,
  target: DockPath,
  zone: DropZone,
  /** Share of the new split to give the incoming pane. Half, by default. */
  share = 0.5,
): DockNode {
  const replace = (node: DockNode, path: DockPath): DockNode => {
    if (!path.length) return place(node)
    if (node.type !== 'split') return node
    const [head, ...rest] = path
    if (!node.children[head]) return node
    const children = node.children.map((child, i) => (i === head ? replace(child, rest) : child))
    return { ...node, children }
  }

  const place = (node: DockNode): DockNode => {
    if (zone === 'center') {
      if (node.type === 'leaf') return leaf([...node.panes, pane], pane)
      // A centre drop can only land on a leaf; treat anything else as a no-op.
      return node
    }
    const direction = zone === 'left' || zone === 'right' ? 'row' : 'column'
    const before = zone === 'left' || zone === 'top'
    const fresh = leaf([pane])
    const mine = Math.min(Math.max(share, MIN_FRACTION), 1 - MIN_FRACTION)
    return split(
      direction,
      before ? [fresh, node] : [node, fresh],
      before ? [mine, 1 - mine] : [1 - mine, mine],
    )
  }

  return normalise(replace(root, target)) ?? root
}

/**
 * Move a pane already in the tree to a new slot.
 *
 * The order matters and is the one real trap here: removing the pane first can
 * collapse or delete the very leaf the drop was aimed at, so the target cannot
 * be carried across as a path. Instead it is re-found afterwards by one of its
 * *other* panes, which the removal cannot have disturbed.
 */
export function movePane(
  root: DockNode,
  pane: PaneId,
  target: DockPath,
  zone: DropZone,
): DockNode {
  const home = findPane(root, pane)
  const destination = nodeAt(root, target)
  if (!home || !destination || destination.type !== 'leaf') return root

  if (samePath(home.path, target)) {
    // Already a tab here, or being split off a slot it is alone in — either way
    // the result would be the tree we started with.
    if (zone === 'center' || home.leaf.panes.length === 1) return root
  }

  const anchor = destination.panes.find((p) => p !== pane)
  if (!anchor) return root

  const without = removePane(root, pane)
  if (!without) return root

  const relocated = findPane(without, anchor)
  if (!relocated) return root

  return insertPane(without, pane, relocated.path, zone)
}

export function setActiveTab(root: DockNode, target: DockPath, pane: PaneId): DockNode {
  const node = nodeAt(root, target)
  if (!node || node.type !== 'leaf' || !node.panes.includes(pane)) return root

  const replace = (current: DockNode, path: DockPath): DockNode => {
    if (!path.length) return current.type === 'leaf' ? leaf(current.panes, pane) : current
    if (current.type !== 'split') return current
    const [head, ...rest] = path
    return {
      ...current,
      children: current.children.map((child, i) => (i === head ? replace(child, rest) : child)),
    }
  }
  return replace(root, target)
}

/**
 * Move `delta` (a fraction of the split's main axis) from the child after the
 * boundary into the one before it. Conserves the pair's total, so no other
 * child of the split — and no other split — moves.
 */
export function resizeSplit(
  root: DockNode,
  target: DockPath,
  index: number,
  delta: number,
): DockNode {
  const node = nodeAt(root, target)
  if (!node || node.type !== 'split') return root
  if (index < 0 || index + 1 >= node.children.length) return root

  const total = node.sizes[index] + node.sizes[index + 1]
  const min = Math.min(MIN_FRACTION, total / 2)
  const first = clamp(node.sizes[index] + delta, min, total - min)
  if (first === node.sizes[index]) return root

  const sizes = [...node.sizes]
  sizes[index] = first
  sizes[index + 1] = total - first

  const replace = (current: DockNode, path: DockPath): DockNode => {
    if (!path.length) return current.type === 'split' ? { ...current, sizes } : current
    if (current.type !== 'split') return current
    const [head, ...rest] = path
    return {
      ...current,
      children: current.children.map((child, i) => (i === head ? replace(child, rest) : child)),
    }
  }
  return replace(root, target)
}

/** Smallest share a child may be dragged down to. */
export const MIN_FRACTION = 0.08

/* ---------------------------------------------------------------- geometry */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LeafBox {
  path: DockPath
  rect: Rect
  panes: PaneId[]
  active: PaneId
  /** Where the pane content goes: the slot minus the tab strip, if any. */
  content: Rect
  hasTabs: boolean
}

export interface SplitterBox {
  /** The split this boundary belongs to. */
  path: DockPath
  /** Boundary between `index` and `index + 1`. */
  index: number
  /** Named for the separator itself, which is what `aria-orientation` describes:
   *  a `row` split has *vertical* separators. */
  orientation: 'vertical' | 'horizontal'
  /** Main-axis length of the split, for converting a px drag into a fraction. */
  extent: number
  rect: Rect
}

export interface DockLayout {
  leaves: LeafBox[]
  splitters: SplitterBox[]
  /** Every pane's box. Panes sharing a leaf share a box; only the active shows. */
  panes: Map<PaneId, Rect>
}

/**
 * Turn the tree into rectangles. Splitters take their own space rather than
 * overlapping, which is how the flex layout this replaces already behaved.
 */
export function computeLayout(root: DockNode, width: number, height: number): DockLayout {
  const leaves: LeafBox[] = []
  const splitters: SplitterBox[] = []
  const panes = new Map<PaneId, Rect>()

  const walk = (node: DockNode, path: DockPath, rect: Rect): void => {
    if (node.type === 'leaf') {
      const hasTabs = node.panes.length > 1
      const content = hasTabs
        ? { x: rect.x, y: rect.y + TAB_BAR_PX, w: rect.w, h: Math.max(0, rect.h - TAB_BAR_PX) }
        : rect
      leaves.push({ path, rect, panes: node.panes, active: node.active, content, hasTabs })
      for (const pane of node.panes) panes.set(pane, content)
      return
    }

    const row = node.direction === 'row'
    const along = row ? rect.w : rect.h
    // A column's minimum is a height, and pane minimums are widths — only
    // constrain the axis they describe.
    const minima = node.children.map((child) =>
      row ? minWidthOf(paneIds(child)) : MIN_LEAF_HEIGHT_PX,
    )
    const lengths = distribute(node.sizes, along, minima)

    // Cumulative boundaries are rounded, not individual lengths: rounding each
    // length separately leaves 1px seams that appear and vanish as you drag.
    const start = row ? rect.x : rect.y
    const edges: number[] = [start]
    let running = start
    lengths.forEach((length, i) => {
      running += length
      edges.push(Math.round(running))
      if (i < lengths.length - 1) {
        running += SPLITTER_PX
        edges.push(Math.round(running))
      }
    })

    node.children.forEach((child, i) => {
      const from = edges[i * 2]
      const to = edges[i * 2 + 1]
      const size = Math.max(0, to - from)
      const childRect: Rect = row
        ? { x: from, y: rect.y, w: size, h: rect.h }
        : { x: rect.x, y: from, w: rect.w, h: size }
      walk(child, [...path, i], childRect)

      if (i < node.children.length - 1) {
        const gapFrom = edges[i * 2 + 1]
        const gapTo = edges[i * 2 + 2]
        splitters.push({
          path,
          index: i,
          orientation: row ? 'vertical' : 'horizontal',
          // The extent the splitter divides, so a drag can convert pixels into
          // a fraction of *this* split rather than of the whole window.
          extent: along,
          rect: row
            ? { x: gapFrom, y: rect.y, w: Math.max(0, gapTo - gapFrom), h: rect.h }
            : { x: rect.x, y: gapFrom, w: rect.w, h: Math.max(0, gapTo - gapFrom) },
        })
      }
    })
  }

  walk(root, [], { x: 0, y: 0, w: width, h: height })
  return { leaves, splitters, panes }
}

/** Floor for a slot on the cross axis, where pane width minimums do not apply. */
const MIN_LEAF_HEIGHT_PX = 80

/**
 * Child lengths along one axis, honouring each child's minimum.
 *
 * Water-filling rather than clamp-then-rescale: a child below its minimum is
 * pinned there and the *remaining* space is redistributed among the others in
 * proportion to their own shares. Clamping everything and rescaling at the end
 * would drag children that had plenty of room down below their minimum too.
 *
 * When even the minimums cannot fit, everything shrinks proportionally. That is
 * the least-bad outcome: overflowing would push a pane off screen, and because
 * the stored fractions are never touched, widening the window restores the
 * arrangement exactly.
 */
function distribute(sizes: number[], along: number, minima: number[]): number[] {
  const count = minima.length
  const available = Math.max(0, along - SPLITTER_PX * (count - 1))
  const shares = renormalise(sizes, count)

  const floorTotal = minima.reduce((a, b) => a + b, 0)
  if (floorTotal > available) {
    const scale = floorTotal === 0 ? 0 : available / floorTotal
    return minima.map((m) => m * scale)
  }

  const lengths = shares.map((s) => s * available)
  const pinned = new Array<boolean>(count).fill(false)

  for (;;) {
    let newlyPinned = false
    for (let i = 0; i < count; i++) {
      if (!pinned[i] && lengths[i] < minima[i]) {
        pinned[i] = true
        lengths[i] = minima[i]
        newlyPinned = true
      }
    }
    if (!newlyPinned) break

    const used = lengths.reduce((sum, l, i) => (pinned[i] ? sum + l : sum), 0)
    const free = Math.max(0, available - used)
    const loose = shares.reduce((sum, s, i) => (pinned[i] ? sum : sum + s), 0)
    if (loose <= 0) break
    for (let i = 0; i < count; i++) {
      if (!pinned[i]) lengths[i] = (shares[i] / loose) * free
    }
  }

  return lengths
}

/* ------------------------------------------------------------ drop testing */

export interface DropTarget {
  path: DockPath
  zone: DropZone
}

/**
 * Which slot and which of its five zones the pointer is over. Edge bands take
 * `EDGE_BAND` of the slot on each side; whichever edge the pointer is nearest
 * wins, and the middle is a centre (tab) drop.
 */
export function dropTargetAt(x: number, y: number, leaves: LeafBox[]): DropTarget | null {
  // Last match wins, so a leaf drawn later (nested deeper) takes precedence on
  // the shared boundary between two adjacent slots.
  let hit: LeafBox | undefined
  for (const box of leaves) {
    const { rect } = box
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) hit = box
  }
  if (!hit || hit.rect.w <= 0 || hit.rect.h <= 0) return null

  const fx = (x - hit.rect.x) / hit.rect.w
  const fy = (y - hit.rect.y) / hit.rect.h
  const edges: [DropZone, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ]
  const [zone, distance] = edges.reduce((best, next) => (next[1] < best[1] ? next : best))
  return { path: hit.path, zone: distance <= EDGE_BAND ? zone : 'center' }
}

/* ----------------------------------------------------------------- closing */

/**
 * Enough to put a closed pane back where it was, at the size it had.
 *
 * A bare list of closed pane ids cannot honour that: removing a pane hands its
 * share to its siblings, and re-inserting later takes half of whatever it lands
 * next to — so closing and reopening would quietly rearrange the workspace. The
 * old flat store kept each hidden pane's weight for exactly this reason, and
 * this is that rule carried over.
 *
 * Neighbours are recorded as *pane ids* rather than paths, because a path is
 * only meaningful against the tree it came from, and the tree carries on
 * changing while the pane is closed.
 */
export interface RestoreSpec {
  pane: PaneId
  /** A pane that shared its slot, when it was one of several tabs. */
  tabbedWith?: PaneId
  /** Which tab it was, so reopening does not silently send it to the end. */
  tabIndex?: number
  /** The pane whose slot it sat immediately after among its siblings. */
  after?: PaneId
  /** The pane whose slot it sat immediately before, when it was first. */
  before?: PaneId
  /** Its share of the split it belonged to. */
  size: number
  /** Which way that split ran, so it comes back on the same axis. */
  direction: 'row' | 'column'
}

export function describeForRestore(root: DockNode, pane: PaneId): RestoreSpec | undefined {
  const home = findPane(root, pane)
  if (!home) return undefined

  // The slot's own position is recorded whether or not the pane was tabbed. A
  // tab group can be closed out from under a pane, and without this the
  // fallback had no size to work from and came back at the minimum width.
  const parentPath = home.path.slice(0, -1)
  const parent = nodeAt(root, parentPath)
  const index = home.path[home.path.length - 1]

  const slot: Pick<RestoreSpec, 'after' | 'before' | 'size' | 'direction'> =
    parent && parent.type === 'split'
      ? {
          // The first pane of a neighbouring slot is a stable handle on it.
          after: neighbourPane(parent, index, -1, pane),
          before: neighbourPane(parent, index, 1, pane),
          size: parent.sizes[index] ?? 1 / parent.children.length,
          direction: parent.direction,
        }
      : { size: 1, direction: 'row' }

  const tabbedWith = home.leaf.panes.find((p) => p !== pane)
  if (tabbedWith) {
    return { pane, ...slot, tabbedWith, tabIndex: home.leaf.panes.indexOf(pane) }
  }
  return { pane, ...slot }
}

/**
 * A pane naming the sibling slot `offset` away — skipping the pane being
 * described, which may itself be a tab of that neighbour.
 */
function neighbourPane(
  parent: DockSplit,
  index: number,
  offset: number,
  exclude: PaneId,
): PaneId | undefined {
  const sibling = parent.children[index + offset]
  if (!sibling) return undefined
  return paneIds(sibling).find((p) => p !== exclude)
}

/**
 * Put a closed pane back, preferring the exact slot it had and degrading
 * gracefully as the recorded landmarks disappear: its old tab group, then
 * either neighbour, then simply the widest slot on screen.
 */
export function restorePane(root: DockNode, spec: RestoreSpec): DockNode {
  if (paneIds(root).includes(spec.pane)) return root

  if (spec.tabbedWith) {
    const host = findPane(root, spec.tabbedWith)
    if (host) return addTab(root, spec.pane, host.path, spec.tabIndex)
  }

  for (const [landmark, side] of [
    [spec.after, 'after'],
    [spec.before, 'before'],
  ] as const) {
    if (!landmark) continue
    const anchor = findPane(root, landmark)
    if (!anchor) continue
    // Exact size first, which needs the parent to still run the right way…
    const beside = insertBeside(root, spec.pane, anchor.path, side, spec.size, spec.direction)
    if (beside) return beside
    // …and otherwise split the neighbour's slot to rebuild the axis. This is
    // the case that used to fall through to a "widest slot" guess: closing a
    // pane stacked in a column collapses that column, so by the time it is
    // reopened its neighbour's parent is a row again.
    return insertPane(root, spec.pane, anchor.path, zoneFor(spec.direction, side), spec.size)
  }

  // Nothing recorded survives. Land next to the nearest pane that is still
  // open, in the canonical order — predictable, unlike picking the biggest slot.
  const fallback = nearestOpen(root, spec.pane)
  if (fallback) {
    return insertPane(root, spec.pane, fallback.path, zoneFor(spec.direction, fallback.side))
  }
  return root
}

function zoneFor(direction: 'row' | 'column', side: 'after' | 'before'): DropZone {
  if (direction === 'column') return side === 'after' ? 'bottom' : 'top'
  return side === 'after' ? 'right' : 'left'
}

/** Add a pane to an existing slot's tabs, at the position it used to hold. */
function addTab(root: DockNode, pane: PaneId, target: DockPath, index?: number): DockNode {
  const host = nodeAt(root, target)
  if (!host || host.type !== 'leaf') return root

  const panes = [...host.panes]
  const at = index === undefined ? panes.length : Math.min(Math.max(index, 0), panes.length)
  panes.splice(at, 0, pane)

  const replace = (node: DockNode, path: DockPath): DockNode => {
    if (!path.length) return leaf(panes, pane)
    if (node.type !== 'split') return node
    const [head, ...rest] = path
    return {
      ...node,
      children: node.children.map((child, i) => (i === head ? replace(child, rest) : child)),
    }
  }
  return replace(root, target)
}

/**
 * The open pane nearest `pane` in the canonical order, and which side of it to
 * land on — so a pane whose recorded neighbours have all gone still comes back
 * somewhere a reader would guess, rather than wherever happened to be largest.
 */
function nearestOpen(
  root: DockNode,
  pane: PaneId,
): { path: DockPath; side: 'after' | 'before' } | undefined {
  const home = ALL_PANES.indexOf(pane)
  if (home < 0) return undefined
  for (let distance = 1; distance < ALL_PANES.length; distance++) {
    for (const [offset, side] of [
      [-distance, 'after'],
      [distance, 'before'],
    ] as const) {
      const candidate = ALL_PANES[home + offset]
      if (!candidate) continue
      const found = findPane(root, candidate)
      if (found) return { path: found.path, side }
    }
  }
  return undefined
}

/**
 * Insert a new slot next to an existing one *inside its parent split*, taking
 * `size` of that split. Returns null when the parent does not run the right
 * way, so the caller can fall back rather than build a nested split that
 * ignores the recorded size.
 */
function insertBeside(
  root: DockNode,
  pane: PaneId,
  anchor: DockPath,
  side: 'after' | 'before',
  size: number,
  direction: 'row' | 'column',
): DockNode | null {
  const parentPath = anchor.slice(0, -1)
  const parent = nodeAt(root, parentPath)
  if (!parent || parent.type !== 'split' || parent.direction !== direction) return null

  const at = anchor[anchor.length - 1] + (side === 'after' ? 1 : 0)
  const share = Math.min(Math.max(size, MIN_FRACTION), 0.9)

  const children = [...parent.children]
  children.splice(at, 0, leaf([pane]))
  // Existing children give up `share` between them, in proportion.
  const sizes = parent.sizes.map((s) => s * (1 - share))
  sizes.splice(at, 0, share)

  const replace = (node: DockNode, path: DockPath): DockNode => {
    if (!path.length) return { type: 'split', direction, children, sizes: renormalise(sizes, children.length) }
    if (node.type !== 'split') return node
    const [head, ...rest] = path
    return {
      ...node,
      children: node.children.map((child, i) => (i === head ? replace(child, rest) : child)),
    }
  }
  return normalise(replace(root, parentPath)) ?? root
}

/* --------------------------------------------------------------- migration */

const ALL_PANES: PaneId[] = ['editor', 'sequence', 'arch', 'schema', 'inspector']

export function isPaneId(value: unknown): value is PaneId {
  return typeof value === 'string' && (ALL_PANES as string[]).includes(value)
}

/**
 * Build a tree from the flat `{ visible, weights }` layout the app persisted
 * before docking existed, so an upgrade preserves the arrangement rather than
 * resetting it.
 */
export function migrate(raw: unknown): { root: DockNode; closed: PaneId[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const saved = raw as { visible?: Record<string, boolean>; weights?: Record<string, number> }
  if (!saved.visible) return null

  const order: PaneId[] = ['editor', 'sequence', 'arch', 'schema']
  const shown = order.filter((id) => saved.visible?.[id])
  const closed = ALL_PANES.filter((id) => !saved.visible?.[id])
  if (!shown.length) return null

  const row = split(
    'row',
    shown.map((id) => leaf([id])),
    shown.map((id) => saved.weights?.[id] ?? 1 / shown.length),
  )
  const root = saved.visible.inspector
    ? split('row', [row, leaf(['inspector'])], [1 - INSPECTOR_FRACTION, INSPECTOR_FRACTION])
    : row

  return { root: normalise(root) ?? defaultTree(), closed }
}

/**
 * Drop panes a newer build no longer knows about, and anything left malformed.
 * Returns null when nothing usable survives, so the caller falls back to the
 * default rather than rendering an empty workspace.
 */
export function sanitise(raw: unknown): DockNode | null {
  const walk = (node: unknown): DockNode | null => {
    if (!node || typeof node !== 'object') return null
    const candidate = node as Partial<DockLeaf> & Partial<DockSplit>

    if (candidate.type === 'leaf') {
      const panes = Array.isArray(candidate.panes) ? candidate.panes.filter(isPaneId) : []
      const unique = [...new Set(panes)]
      return unique.length ? leaf(unique, isPaneId(candidate.active) ? candidate.active : undefined) : null
    }
    if (candidate.type === 'split' && Array.isArray(candidate.children)) {
      const direction = candidate.direction === 'column' ? 'column' : 'row'
      const kept: DockNode[] = []
      const sizes: number[] = []
      candidate.children.forEach((child, i) => {
        const done = walk(child)
        if (!done) return
        kept.push(done)
        const size = candidate.sizes?.[i]
        sizes.push(typeof size === 'number' && size > 0 ? size : 1 / candidate.children!.length)
      })
      if (!kept.length) return null
      return { type: 'split', direction, children: kept, sizes: renormalise(sizes, kept.length) }
    }
    return null
  }

  const cleaned = walk(raw)
  if (!cleaned) return null
  const deduped = dropDuplicates(cleaned)
  return deduped ? normalise(deduped) : null
}

/** A pane may appear only once in the tree; keep the first, drop the rest. */
function dropDuplicates(root: DockNode): DockNode | null {
  const seen = new Set<PaneId>()
  const walk = (node: DockNode): DockNode | null => {
    if (node.type === 'leaf') {
      const panes = node.panes.filter((p) => !seen.has(p))
      for (const p of panes) seen.add(p)
      return panes.length ? leaf(panes, node.active) : null
    }
    const kept: DockNode[] = []
    const sizes: number[] = []
    node.children.forEach((child, i) => {
      const done = walk(child)
      if (!done) return
      kept.push(done)
      sizes.push(node.sizes[i] ?? 1 / node.children.length)
    })
    if (!kept.length) return null
    return { type: 'split', direction: node.direction, children: kept, sizes: renormalise(sizes, kept.length) }
  }
  return walk(root)
}

/* ----------------------------------------------------------------- helpers */

function renormalise(sizes: number[], count: number): number[] {
  const safe = Array.from({ length: count }, (_, i) => {
    const value = sizes[i]
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  })
  const total = safe.reduce((a, b) => a + b, 0)
  if (total <= 0) return Array.from({ length: count }, () => 1 / count)
  return safe.map((s) => s / total)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
