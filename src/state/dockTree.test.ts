import { describe, expect, it } from 'vitest'
import {
  computeLayout as computeLayoutRaw,
  defaultTree as buildDefaultTree,
  describeForRestore,
  dropTargetAt,
  EDGE_BAND,
  findPane,
  insertPane,
  leaf,
  mapPanes,
  migrate,
  MIN_FRACTION,
  minWidthOf as minWidthOfRaw,
  movePane,
  nodeAt,
  normalise,
  paneIds,
  removePane,
  restorePane as restorePaneRaw,
  resizeSplit,
  samePath,
  sanitise as sanitiseRaw,
  setActiveTab,
  split,
  SPLITTER_PX,
  TAB_BAR_PX,
  type DockNode,
  type PaneId,
} from './dockTree'

/**
 * The vocabulary this suite is written against.
 *
 * Slot ids are opaque to the tree now, and everything that used to be baked in
 * — which ids exist, what each one's minimum width is, which ones are still
 * valid — arrives from the caller. The app injects `docId`'s answers; the suite
 * injects the five panes the tree was originally written for, so the
 * assertions below still describe the behaviour they always described.
 */
const WORKING: PaneId[] = ['editor', 'sequence', 'arch', 'schema']
const ALL_PANES: PaneId[] = [...WORKING, 'inspector']

const MIN_PANE_PX: Record<string, number> = {
  editor: 200,
  sequence: 130,
  arch: 130,
  schema: 130,
  inspector: 260,
}
const minPx = (pane: PaneId) => MIN_PANE_PX[pane] ?? 130
const known = (id: unknown) => typeof id === 'string' && id in MIN_PANE_PX

const defaultTree = () => buildDefaultTree(WORKING, 'inspector')
const computeLayout = (root: DockNode, w: number, h: number) => computeLayoutRaw(root, w, h, minPx)
const minWidthOf = (panes: PaneId[]) => minWidthOfRaw(panes, minPx)
const sanitise = (raw: unknown) => sanitiseRaw(raw, known)
const restorePane = (root: DockNode, spec: Parameters<typeof restorePaneRaw>[1]) =>
  restorePaneRaw(root, spec, ALL_PANES)

/** A plain two-pane row, the smallest interesting tree. */
const pair = () => split('row', [leaf(['editor']), leaf(['arch'])], [0.5, 0.5])

const sizesOf = (node: DockNode): number[] => (node.type === 'split' ? node.sizes : [])
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)

describe('constructors', () => {
  it('refuses a leaf with no panes', () => {
    expect(() => leaf([])).toThrow()
  })

  it('activates the first pane when no active is given', () => {
    expect(leaf(['editor', 'arch']).active).toBe('editor')
  })

  it('ignores an active that is not in the leaf', () => {
    expect(leaf(['editor'], 'arch').active).toBe('editor')
  })

  it('spreads sizes evenly when none are given', () => {
    expect(split('row', [leaf(['a' as PaneId]), leaf(['b' as PaneId])]).sizes).toEqual([0.5, 0.5])
  })

  it('renormalises sizes that do not sum to one', () => {
    expect(sum(split('row', [leaf(['editor']), leaf(['arch'])], [3, 1]).sizes)).toBeCloseTo(1)
    expect(split('row', [leaf(['editor']), leaf(['arch'])], [3, 1]).sizes[0]).toBeCloseTo(0.75)
  })

  it('falls back to even sizes when every size is junk', () => {
    const s = split('row', [leaf(['editor']), leaf(['arch'])], [0, -4])
    expect(s.sizes).toEqual([0.5, 0.5])
  })
})

describe('defaultTree', () => {
  it('holds all five panes', () => {
    expect(paneIds(defaultTree()).sort()).toEqual(
      ['arch', 'editor', 'inspector', 'schema', 'sequence'].sort(),
    )
  })

  it('lists the four working panes left to right before the inspector', () => {
    expect(paneIds(defaultTree())).toEqual([
      'editor',
      'sequence',
      'arch',
      'schema',
      'inspector',
    ])
  })

  it('is already normalised', () => {
    const tree = defaultTree()
    expect(JSON.stringify(normalise(tree))).toBe(JSON.stringify(tree))
  })
})

describe('queries', () => {
  it('resolves a node by path', () => {
    const tree = pair()
    expect(nodeAt(tree, [])).toBe(tree)
    expect(nodeAt(tree, [1])).toMatchObject({ type: 'leaf', panes: ['arch'] })
  })

  it('returns undefined for a path that runs off the tree', () => {
    expect(nodeAt(pair(), [5])).toBeUndefined()
    expect(nodeAt(pair(), [0, 0])).toBeUndefined()
  })

  it('finds which leaf holds a pane, and where', () => {
    const found = findPane(defaultTree(), 'schema')!
    expect(found.leaf.panes).toEqual(['schema'])
    expect(nodeAt(defaultTree(), found.path)).toMatchObject({ panes: ['schema'] })
  })

  it('returns undefined for a pane that is not in the tree', () => {
    expect(findPane(pair(), 'schema')).toBeUndefined()
  })

  it('compares paths by value', () => {
    expect(samePath([0, 1], [0, 1])).toBe(true)
    expect(samePath([0], [0, 1])).toBe(false)
    expect(samePath([0, 1], [1, 0])).toBe(false)
  })
})

describe('normalise', () => {
  it('collapses a split with one child into that child', () => {
    const done = normalise(split('row', [leaf(['editor'])], [1]))
    expect(done).toMatchObject({ type: 'leaf', panes: ['editor'] })
  })

  it('flattens a same-direction split into its parent', () => {
    const nested = split(
      'row',
      [leaf(['editor']), split('row', [leaf(['arch']), leaf(['schema'])], [0.5, 0.5])],
      [0.5, 0.5],
    )
    const done = normalise(nested)!
    expect(done.type).toBe('split')
    expect((done as { children: DockNode[] }).children).toHaveLength(3)
    expect(paneIds(done)).toEqual(['editor', 'arch', 'schema'])
  })

  it('scales an absorbed child’s sizes by its own share', () => {
    // The inner row owns 50%, split evenly, so each grandchild owns 25%.
    const nested = split(
      'row',
      [leaf(['editor']), split('row', [leaf(['arch']), leaf(['schema'])], [0.5, 0.5])],
      [0.5, 0.5],
    )
    expect(sizesOf(normalise(nested)!)).toEqual([0.5, 0.25, 0.25])
  })

  it('keeps a differently-directed split nested', () => {
    const nested = split(
      'row',
      [leaf(['editor']), split('column', [leaf(['arch']), leaf(['schema'])], [0.5, 0.5])],
      [0.5, 0.5],
    )
    const done = normalise(nested)!
    expect((done as { children: DockNode[] }).children).toHaveLength(2)
  })

  it('is idempotent', () => {
    const once = normalise(
      split('row', [leaf(['editor']), split('row', [leaf(['arch'])], [1])], [0.6, 0.4]),
    )!
    expect(JSON.stringify(normalise(once))).toBe(JSON.stringify(once))
  })

  it('repairs a leaf whose active pane is not one of its panes', () => {
    const broken = { type: 'leaf' as const, panes: ['editor' as PaneId], active: 'arch' as PaneId }
    expect(normalise(broken)).toMatchObject({ active: 'editor' })
  })

  it('returns null for a leaf with no panes', () => {
    expect(normalise({ type: 'leaf', panes: [], active: 'editor' })).toBeNull()
  })

  it('always leaves sizes summing to one', () => {
    const done = normalise(
      split('column', [leaf(['editor']), leaf(['arch']), leaf(['schema'])], [5, 2, 3]),
    )!
    expect(sum(sizesOf(done))).toBeCloseTo(1)
  })
})

describe('removePane', () => {
  it('drops a pane and collapses the split it emptied', () => {
    const done = removePane(pair(), 'arch')!
    expect(done).toMatchObject({ type: 'leaf', panes: ['editor'] })
  })

  it('leaves the other tabs behind when removing one of several', () => {
    const tree = split('row', [leaf(['editor', 'arch'], 'arch'), leaf(['schema'])], [0.5, 0.5])
    const done = removePane(tree, 'arch')!
    expect(paneIds(done)).toEqual(['editor', 'schema'])
  })

  it('moves the active tab on when the active pane is the one removed', () => {
    const tree = leaf(['editor', 'arch'], 'arch')
    expect(removePane(tree, 'arch')).toMatchObject({ panes: ['editor'], active: 'editor' })
  })

  it('returns null when the last pane goes', () => {
    expect(removePane(leaf(['editor']), 'editor')).toBeNull()
  })

  it('is a no-op for a pane that is not there', () => {
    const tree = pair()
    expect(JSON.stringify(removePane(tree, 'schema'))).toBe(JSON.stringify(tree))
  })

  it('keeps the surviving siblings’ proportions', () => {
    const tree = split(
      'row',
      [leaf(['editor']), leaf(['sequence']), leaf(['arch'])],
      [0.5, 0.25, 0.25],
    )
    const done = removePane(tree, 'sequence')!
    // editor kept twice the share of arch before, and still does.
    const [a, b] = sizesOf(done)
    expect(a / b).toBeCloseTo(2)
    expect(a + b).toBeCloseTo(1)
  })
})

describe('insertPane', () => {
  it('adds a tab on a centre drop', () => {
    const done = insertPane(leaf(['editor']), 'arch', [], 'center')
    expect(done).toMatchObject({ type: 'leaf', panes: ['editor', 'arch'], active: 'arch' })
  })

  it.each([
    ['left', 'row', 0],
    ['right', 'row', 1],
    ['top', 'column', 0],
    ['bottom', 'column', 1],
  ] as const)('splits %s into a %s with the new pane at index %i', (zone, direction, index) => {
    const done = insertPane(leaf(['editor']), 'arch', [], zone)
    expect(done.type).toBe('split')
    expect((done as { direction: string }).direction).toBe(direction)
    expect(paneIds(done)[index]).toBe('arch')
  })

  it('splits a nested leaf without disturbing its siblings', () => {
    const tree = defaultTree()
    const target = findPane(tree, 'arch')!.path
    const done = insertPane(tree, 'inspector', target, 'bottom')
    expect(paneIds(done)).toContain('inspector')
    expect(paneIds(done).filter((p) => p === 'inspector')).toHaveLength(2)
  })

  it('flattens the result when the split matches its parent’s direction', () => {
    // Splitting a child of a row to the right should yield one flat row.
    const tree = pair()
    const done = insertPane(tree, 'schema', [0], 'right')
    expect(paneIds(done)).toEqual(['editor', 'schema', 'arch'])
    expect((done as { children: DockNode[] }).children).toHaveLength(3)
  })

  it('leaves sizes summing to one after an insert', () => {
    const done = insertPane(defaultTree(), 'inspector', [0, 1], 'top')
    const check = (node: DockNode): void => {
      if (node.type !== 'split') return
      expect(sum(node.sizes)).toBeCloseTo(1)
      node.children.forEach(check)
    }
    check(done)
  })
})

describe('movePane', () => {
  it('moves a pane to another slot as a split', () => {
    const tree = defaultTree()
    const target = findPane(tree, 'editor')!.path
    const done = movePane(tree, 'schema', target, 'bottom')
    expect(paneIds(done)).toHaveLength(5)
    // schema now shares a column with editor.
    const editorPath = findPane(done, 'editor')!.path
    const schemaPath = findPane(done, 'schema')!.path
    expect(editorPath.slice(0, -1)).toEqual(schemaPath.slice(0, -1))
  })

  it('moves a pane into another slot as a tab', () => {
    const tree = defaultTree()
    const target = findPane(tree, 'editor')!.path
    const done = movePane(tree, 'schema', target, 'center')
    expect(findPane(done, 'schema')!.leaf.panes).toEqual(['editor', 'schema'])
    expect(paneIds(done)).toHaveLength(5)
  })

  it('is a no-op when a pane is dropped on the centre of its own slot', () => {
    const tree = defaultTree()
    const target = findPane(tree, 'arch')!.path
    expect(JSON.stringify(movePane(tree, 'arch', target, 'center'))).toBe(JSON.stringify(tree))
  })

  it('is a no-op when a pane alone in its slot is split off itself', () => {
    const tree = defaultTree()
    const target = findPane(tree, 'arch')!.path
    expect(JSON.stringify(movePane(tree, 'arch', target, 'left'))).toBe(JSON.stringify(tree))
  })

  it('splits a tab out of its own slot when it has company', () => {
    const tree = split('row', [leaf(['editor', 'arch'], 'arch'), leaf(['schema'])], [0.5, 0.5])
    const target = findPane(tree, 'arch')!.path
    const done = movePane(tree, 'arch', target, 'bottom')
    expect(paneIds(done).sort()).toEqual(['arch', 'editor', 'schema'])
    expect(findPane(done, 'arch')!.leaf.panes).toEqual(['arch'])
    expect(findPane(done, 'editor')!.leaf.panes).toEqual(['editor'])
  })

  it('survives the removal collapsing the target slot', () => {
    // Dropping `arch` onto `editor` empties arch's own leaf, which collapses the
    // split — so the target path recorded before the removal is now stale.
    const tree = pair()
    const target = findPane(tree, 'editor')!.path
    const done = movePane(tree, 'arch', target, 'center')
    expect(done).toMatchObject({ type: 'leaf', panes: ['editor', 'arch'] })
  })

  it('refuses to move a pane onto a slot holding only itself', () => {
    const tree = leaf(['editor'])
    expect(movePane(tree, 'editor', [], 'left')).toBe(tree)
  })

  it('is a no-op for a pane that is not in the tree', () => {
    const tree = pair()
    expect(movePane(tree, 'schema', [0], 'left')).toBe(tree)
  })

  it('is a no-op when the target path is a split, not a leaf', () => {
    const tree = defaultTree()
    expect(movePane(tree, 'arch', [], 'left')).toBe(tree)
  })

  it('never loses or duplicates a pane', () => {
    let tree: DockNode = defaultTree()
    const moves: [PaneId, PaneId, 'left' | 'right' | 'top' | 'bottom' | 'center'][] = [
      ['schema', 'arch', 'bottom'],
      ['editor', 'sequence', 'center'],
      ['inspector', 'schema', 'left'],
      ['arch', 'editor', 'top'],
      ['sequence', 'inspector', 'right'],
    ]
    for (const [pane, onto, zone] of moves) {
      const target = findPane(tree, onto)!.path
      tree = movePane(tree, pane, target, zone)
      expect(paneIds(tree).sort()).toEqual(
        ['arch', 'editor', 'inspector', 'schema', 'sequence'].sort(),
      )
    }
  })
})

describe('setActiveTab', () => {
  it('switches the active pane of a leaf', () => {
    const tree = leaf(['editor', 'arch'])
    expect(setActiveTab(tree, [], 'arch')).toMatchObject({ active: 'arch' })
  })

  it('refuses a pane that is not in that leaf', () => {
    const tree = leaf(['editor', 'arch'])
    expect(setActiveTab(tree, [], 'schema')).toBe(tree)
  })

  it('leaves other leaves alone', () => {
    const tree = split('row', [leaf(['editor', 'arch']), leaf(['schema', 'sequence'])], [0.5, 0.5])
    const done = setActiveTab(tree, [0], 'arch')
    expect(nodeAt(done, [0])).toMatchObject({ active: 'arch' })
    expect(nodeAt(done, [1])).toMatchObject({ active: 'schema' })
  })
})

describe('resizeSplit', () => {
  it('moves share from one child to the next', () => {
    const done = resizeSplit(pair(), [], 0, 0.1)
    expect(sizesOf(done)[0]).toBeCloseTo(0.6)
    expect(sizesOf(done)[1]).toBeCloseTo(0.4)
  })

  it('conserves the pair’s total', () => {
    const done = resizeSplit(pair(), [], 0, 0.1)
    expect(sum(sizesOf(done))).toBeCloseTo(1)
  })

  it('leaves every other child of the split untouched', () => {
    const tree = split(
      'row',
      [leaf(['editor']), leaf(['sequence']), leaf(['arch'])],
      [1 / 3, 1 / 3, 1 / 3],
    )
    const done = resizeSplit(tree, [], 0, 0.1)
    expect(sizesOf(done)[2]).toBeCloseTo(1 / 3)
  })

  it('clamps at the minimum rather than letting a pane vanish', () => {
    const done = resizeSplit(pair(), [], 0, -10)
    expect(sizesOf(done)[0]).toBeCloseTo(MIN_FRACTION)
    expect(sum(sizesOf(done))).toBeCloseTo(1)
  })

  it('clamps at the other end too', () => {
    const done = resizeSplit(pair(), [], 0, 10)
    expect(sizesOf(done)[1]).toBeCloseTo(MIN_FRACTION)
  })

  it('is a no-op at a boundary that does not exist', () => {
    const tree = pair()
    expect(resizeSplit(tree, [], 1, 0.1)).toBe(tree)
    expect(resizeSplit(tree, [], -1, 0.1)).toBe(tree)
  })

  it('is a no-op on a leaf', () => {
    const tree = leaf(['editor'])
    expect(resizeSplit(tree, [], 0, 0.1)).toBe(tree)
  })

  it('resizes a nested split without touching the outer one', () => {
    const tree = split(
      'row',
      [split('column', [leaf(['editor']), leaf(['arch'])], [0.5, 0.5]), leaf(['schema'])],
      [0.7, 0.3],
    )
    const done = resizeSplit(tree, [0], 0, 0.2)
    expect(sizesOf(done)).toEqual([0.7, 0.3])
    expect(sizesOf(nodeAt(done, [0])!)[0]).toBeCloseTo(0.7)
  })
})

describe('computeLayout', () => {
  const W = 1200
  const H = 800

  it('gives the whole container to a single leaf', () => {
    const layout = computeLayout(leaf(['editor']), W, H)
    expect(layout.leaves).toHaveLength(1)
    expect(layout.leaves[0].rect).toEqual({ x: 0, y: 0, w: W, h: H })
    expect(layout.splitters).toHaveLength(0)
  })

  it('splits a row horizontally, leaving room for the splitter', () => {
    const layout = computeLayout(pair(), W, H)
    const [a, b] = layout.leaves
    expect(a.rect.w + b.rect.w + SPLITTER_PX).toBeCloseTo(W)
    expect(a.rect.h).toBe(H)
    expect(b.rect.x).toBeCloseTo(a.rect.w + SPLITTER_PX)
  })

  it('splits a column vertically', () => {
    const tree = split('column', [leaf(['editor']), leaf(['arch'])], [0.5, 0.5])
    const layout = computeLayout(tree, W, H)
    const [a, b] = layout.leaves
    expect(a.rect.w).toBe(W)
    expect(a.rect.h + b.rect.h + SPLITTER_PX).toBeCloseTo(H)
    expect(b.rect.y).toBeCloseTo(a.rect.h + SPLITTER_PX)
  })

  it('puts a splitter exactly in the gap between two slots', () => {
    const layout = computeLayout(pair(), W, H)
    const [a, b] = layout.leaves
    const s = layout.splitters[0]
    expect(s.orientation).toBe('vertical')
    expect(s.rect.x).toBeCloseTo(a.rect.x + a.rect.w)
    expect(s.rect.x + s.rect.w).toBeCloseTo(b.rect.x)
  })

  it('never overlaps two slots', () => {
    const tree = split(
      'row',
      [split('column', [leaf(['editor']), leaf(['arch'])], [0.4, 0.6]), leaf(['schema'])],
      [0.6, 0.4],
    )
    const rects = computeLayout(tree, W, H).leaves.map((l) => l.rect)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlap =
          Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        expect(overlap).toBeCloseTo(0)
      }
    }
  })

  it('accounts for every pixel: slots plus splitters fill the container', () => {
    const tree = split(
      'row',
      [split('column', [leaf(['editor']), leaf(['arch'])], [0.4, 0.6]), leaf(['schema'])],
      [0.6, 0.4],
    )
    const layout = computeLayout(tree, W, H)
    const area = (r: { w: number; h: number }) => r.w * r.h
    const covered =
      layout.leaves.reduce((n, l) => n + area(l.rect), 0) +
      layout.splitters.reduce((n, s) => n + area(s.rect), 0)
    expect(covered).toBeCloseTo(W * H, 0)
  })

  it('reserves a tab strip only when a slot holds more than one pane', () => {
    const tabbed = computeLayout(leaf(['editor', 'arch']), W, H).leaves[0]
    expect(tabbed.hasTabs).toBe(true)
    expect(tabbed.content.y).toBe(TAB_BAR_PX)
    expect(tabbed.content.h).toBe(H - TAB_BAR_PX)

    const single = computeLayout(leaf(['editor']), W, H).leaves[0]
    expect(single.hasTabs).toBe(false)
    expect(single.content).toEqual(single.rect)
  })

  it('gives every pane in a tabbed slot the same box', () => {
    const layout = computeLayout(leaf(['editor', 'arch']), W, H)
    expect(layout.panes.get('editor')).toEqual(layout.panes.get('arch'))
  })

  it('maps every pane in the tree to a box', () => {
    const layout = computeLayout(defaultTree(), W, H)
    for (const pane of paneIds(defaultTree())) {
      expect(layout.panes.get(pane), pane).toBeTruthy()
    }
  })

  it('honours each pane’s own pixel minimum when there is room', () => {
    const tree = split('row', [leaf(['editor']), leaf(['arch'])], [0.99, 0.01])
    const layout = computeLayout(tree, W, H)
    const arch = layout.leaves.find((l) => l.active === 'arch')!
    expect(arch.rect.w).toBeGreaterThanOrEqual(MIN_PANE_PX.arch - 1)
  })

  it('pins only the starved child, leaving the roomy one its space', () => {
    // Clamp-then-rescale would have dragged the editor down too.
    const tree = split('row', [leaf(['editor']), leaf(['arch'])], [0.99, 0.01])
    const layout = computeLayout(tree, W, H)
    const editor = layout.leaves.find((l) => l.active === 'editor')!
    const arch = layout.leaves.find((l) => l.active === 'arch')!
    expect(arch.rect.w).toBeCloseTo(MIN_PANE_PX.arch, 0)
    expect(editor.rect.w).toBeCloseTo(W - SPLITTER_PX - MIN_PANE_PX.arch, 0)
  })

  it('reports the split’s own extent on each splitter, not the window’s', () => {
    // A splitter inside a narrow sub-split must convert a px drag against that
    // sub-split, or the pane moves faster than the pointer.
    const tree = split(
      'row',
      [split('column', [leaf(['editor']), leaf(['arch'])], [0.5, 0.5]), leaf(['schema'])],
      [0.5, 0.5],
    )
    const layout = computeLayout(tree, W, H)
    const inner = layout.splitters.find((s) => s.orientation === 'horizontal')!
    const outer = layout.splitters.find((s) => s.orientation === 'vertical')!
    expect(outer.extent).toBe(W)
    expect(inner.extent).toBe(H)
  })

  it('rounds boundaries so slots tile with no seam', () => {
    const tree = split('row', [leaf(['editor']), leaf(['arch']), leaf(['schema'])], [1 / 3, 1 / 3, 1 / 3])
    const layout = computeLayout(tree, 1001, H)
    const sorted = [...layout.leaves].sort((a, z) => a.rect.x - z.rect.x)
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].rect.x - (sorted[i].rect.x + sorted[i].rect.w)
      expect(gap).toBe(SPLITTER_PX)
    }
    for (const l of layout.leaves) expect(Number.isInteger(l.rect.x)).toBe(true)
  })

  it('stays inside the container when the minimums cannot all fit', () => {
    // Five panes at 90px minimum need 450px plus splitters; give it 200px.
    const tree = split('row', ['editor', 'sequence', 'arch', 'schema', 'inspector'].map((p) => leaf([p as PaneId])))
    const layout = computeLayout(tree, 200, H)
    const total =
      layout.leaves.reduce((n, l) => n + l.rect.w, 0) + SPLITTER_PX * layout.splitters.length
    expect(total).toBeLessThanOrEqual(200.01)
    for (const l of layout.leaves) expect(l.rect.w).toBeGreaterThan(0)
  })

  it('does not produce negative or NaN geometry at zero size', () => {
    const layout = computeLayout(defaultTree(), 0, 0)
    for (const l of layout.leaves) {
      expect(Number.isFinite(l.rect.w)).toBe(true)
      expect(l.rect.w).toBeGreaterThanOrEqual(0)
      expect(l.content.h).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('minWidthOf', () => {
  it('takes the largest minimum among the tabs sharing a slot', () => {
    expect(minWidthOf(['arch'])).toBe(MIN_PANE_PX.arch)
    expect(minWidthOf(['arch', 'inspector'])).toBe(MIN_PANE_PX.inspector)
  })
})

describe('dropTargetAt', () => {
  const leaves = computeLayout(pair(), 1000, 800).leaves
  const first = leaves[0].rect

  const at = (fx: number, fy: number) =>
    dropTargetAt(first.x + first.w * fx, first.y + first.h * fy, leaves)

  it('reports the centre for a drop in the middle', () => {
    expect(at(0.5, 0.5)).toMatchObject({ zone: 'center', path: [0] })
  })

  it.each([
    ['left', 0.03, 0.5],
    ['right', 0.97, 0.5],
    ['top', 0.5, 0.03],
    ['bottom', 0.5, 0.97],
  ] as const)('reports %s near that edge', (zone, fx, fy) => {
    expect(at(fx, fy)).toMatchObject({ zone })
  })

  it('switches from edge to centre at the band boundary', () => {
    expect(at(EDGE_BAND - 0.01, 0.5)!.zone).toBe('left')
    expect(at(EDGE_BAND + 0.01, 0.5)!.zone).toBe('center')
  })

  it('picks the nearest edge in a corner', () => {
    // Closer to the top than the left.
    expect(at(0.15, 0.02)!.zone).toBe('top')
    expect(at(0.02, 0.15)!.zone).toBe('left')
  })

  it('identifies which slot the pointer is over', () => {
    const second = leaves[1].rect
    expect(dropTargetAt(second.x + second.w / 2, second.y + second.h / 2, leaves)).toMatchObject({
      path: [1],
    })
  })

  it('returns null outside every slot', () => {
    expect(dropTargetAt(-50, -50, leaves)).toBeNull()
    expect(dropTargetAt(99999, 99999, leaves)).toBeNull()
  })

  it('returns null when there are no slots', () => {
    expect(dropTargetAt(10, 10, [])).toBeNull()
  })
})

describe('migrate', () => {
  const old = {
    visible: { editor: true, sequence: true, arch: true, schema: true, inspector: true },
    weights: { editor: 0.2, sequence: 0.28, arch: 0.28, schema: 0.24 },
    minimap: true,
  }

  it('reproduces the previous arrangement rather than resetting it', () => {
    const done = migrate(old)!
    expect(paneIds(done.root)).toEqual(['editor', 'sequence', 'arch', 'schema', 'inspector'])
    expect(done.closed).toEqual([])
  })

  it('carries the old weights across as proportions', () => {
    const done = migrate(old)!
    // editor:sequence was 0.2:0.28 and still is.
    const sizes = sizesOf(done.root)
    expect(sizes[0] / sizes[1]).toBeCloseTo(0.2 / 0.28)
  })

  it('records panes that were hidden as closed', () => {
    const done = migrate({ ...old, visible: { ...old.visible, schema: false } })!
    expect(done.closed).toEqual(['schema'])
    expect(paneIds(done.root)).not.toContain('schema')
  })

  it('omits the inspector when it was hidden', () => {
    const done = migrate({ ...old, visible: { ...old.visible, inspector: false } })!
    expect(paneIds(done.root)).not.toContain('inspector')
    expect(done.closed).toContain('inspector')
  })

  it('gives up on a layout with no visible working panes', () => {
    expect(
      migrate({
        visible: { editor: false, sequence: false, arch: false, schema: false, inspector: true },
      }),
    ).toBeNull()
  })

  it('gives up on anything that is not the old shape', () => {
    expect(migrate(null)).toBeNull()
    expect(migrate('nope')).toBeNull()
    expect(migrate({})).toBeNull()
    expect(migrate({ visible: undefined })).toBeNull()
  })
})

describe('sanitise', () => {
  it('accepts a well-formed tree unchanged', () => {
    const tree = defaultTree()
    expect(paneIds(sanitise(JSON.parse(JSON.stringify(tree)))!)).toEqual(paneIds(tree))
  })

  it('drops a pane id a newer build no longer knows', () => {
    const raw = {
      type: 'split',
      direction: 'row',
      children: [
        { type: 'leaf', panes: ['editor'], active: 'editor' },
        { type: 'leaf', panes: ['ghost'], active: 'ghost' },
      ],
      sizes: [0.5, 0.5],
    }
    expect(paneIds(sanitise(raw)!)).toEqual(['editor'])
  })

  it('keeps only the first appearance of a duplicated pane', () => {
    const raw = {
      type: 'split',
      direction: 'row',
      children: [
        { type: 'leaf', panes: ['editor'], active: 'editor' },
        { type: 'leaf', panes: ['editor'], active: 'editor' },
      ],
      sizes: [0.5, 0.5],
    }
    expect(paneIds(sanitise(raw)!)).toEqual(['editor'])
  })

  it('repairs missing or junk sizes', () => {
    const raw = {
      type: 'split',
      direction: 'row',
      children: [
        { type: 'leaf', panes: ['editor'], active: 'editor' },
        { type: 'leaf', panes: ['arch'], active: 'arch' },
      ],
    }
    expect(sum(sizesOf(sanitise(raw)!))).toBeCloseTo(1)
  })

  it('returns null when nothing usable survives', () => {
    expect(sanitise(null)).toBeNull()
    expect(sanitise({ type: 'leaf', panes: ['ghost'] })).toBeNull()
    expect(sanitise({ type: 'split', children: [] })).toBeNull()
    expect(sanitise({ nonsense: true })).toBeNull()
  })

  it('survives a deeply malformed structure without throwing', () => {
    expect(() => sanitise({ type: 'split', direction: 'row', children: [1, 'two', null] })).not.toThrow()
  })
})

describe('close and reopen', () => {
  /** Close a pane the way the store will, keeping its restore descriptor. */
  const close = (tree: DockNode, pane: PaneId) => {
    const spec = describeForRestore(tree, pane)!
    return { tree: removePane(tree, pane)!, spec }
  }

  it('returns a pane to the same slot at the same size', () => {
    const before = defaultTree()
    const widths = () =>
      new Map(computeLayout(before, 1600, 1000).leaves.map((l) => [l.active, l.rect.w]))

    const { tree, spec } = close(before, 'arch')
    expect(paneIds(tree)).not.toContain('arch')

    const after = restorePane(tree, spec)
    expect(paneIds(after)).toEqual(paneIds(before))
    // The whole arrangement comes back, not just the pane.
    const restored = new Map(
      computeLayout(after, 1600, 1000).leaves.map((l) => [l.active, l.rect.w]),
    )
    for (const [pane, width] of widths()) {
      expect(restored.get(pane), pane).toBeCloseTo(width, 0)
    }
  })

  it('returns the first pane to the front, not the end', () => {
    const before = defaultTree()
    const { tree, spec } = close(before, 'editor')
    expect(paneIds(restorePane(tree, spec))).toEqual(paneIds(before))
  })

  it('returns the last pane to the end', () => {
    const before = defaultTree()
    const { tree, spec } = close(before, 'inspector')
    expect(paneIds(restorePane(tree, spec))).toEqual(paneIds(before))
  })

  it('rejoins its old tab group', () => {
    const before = split('row', [leaf(['editor', 'arch'], 'editor'), leaf(['schema'])], [0.5, 0.5])
    const { tree, spec } = close(before, 'arch')
    expect(spec.tabbedWith).toBe('editor')
    const after = restorePane(tree, spec)
    expect(findPane(after, 'arch')!.leaf.panes.sort()).toEqual(['arch', 'editor'])
  })

  it('comes back on the axis it was closed from', () => {
    const before = split('column', [leaf(['arch']), leaf(['schema'])], [0.5, 0.5])
    const { tree, spec } = close(before, 'schema')
    expect(spec.direction).toBe('column')
    const after = restorePane(tree, spec)
    expect((after as { direction?: string }).direction).toBe('column')
  })

  it('falls back to the widest slot when every landmark has gone', () => {
    const before = defaultTree()
    const { spec } = close(before, 'arch')
    // Everything the descriptor referred to is now closed too.
    const stripped = split('row', [leaf(['editor'])], [1])
    const after = restorePane(normalise(stripped)!, spec)
    expect(paneIds(after).sort()).toEqual(['arch', 'editor'])
  })

  it('puts a pane stacked in a column back in that column', () => {
    // The bug this guards: closing a pane collapses the column it was in, so by
    // the time it reopens its neighbour's parent is a plain row again. Requiring
    // the axis to still match sent the pane to whichever slot was largest —
    // typically the far side of the workspace.
    const stacked = insertPane(
      removePane(defaultTree(), 'sequence')!,
      'sequence',
      findPane(removePane(defaultTree(), 'sequence')!, 'arch')!.path,
      'bottom',
    )
    const { tree, spec } = close(stacked, 'sequence')
    expect(spec.direction).toBe('column')

    const after = restorePane(tree, spec)
    const arch = findPane(after, 'arch')!
    const sequence = findPane(after, 'sequence')!
    // Same parent, and that parent runs top-to-bottom.
    expect(arch.path.slice(0, -1)).toEqual(sequence.path.slice(0, -1))
    expect(nodeAt(after, arch.path.slice(0, -1))).toMatchObject({ direction: 'column' })
    // And in the original order, not merely adjacent.
    expect(arch.path.at(-1)).toBeLessThan(sequence.path.at(-1)!)
  })

  it('puts the pane that hosted a column back above its stack', () => {
    const base = removePane(defaultTree(), 'sequence')!
    const stacked = insertPane(base, 'sequence', findPane(base, 'arch')!.path, 'bottom')
    const { tree, spec } = close(stacked, 'arch')
    const after = restorePane(tree, spec)
    const arch = findPane(after, 'arch')!
    const sequence = findPane(after, 'sequence')!
    expect(nodeAt(after, arch.path.slice(0, -1))).toMatchObject({ direction: 'column' })
    expect(arch.path.at(-1)).toBeLessThan(sequence.path.at(-1)!)
  })

  it('returns a tab to its own position, not the end of the strip', () => {
    // Reopening always appended, so closing the *first* tab of a group silently
    // moved it to the right-hand end of the tab bar.
    const base = removePane(defaultTree(), 'schema')!
    const grouped = insertPane(base, 'schema', findPane(base, 'arch')!.path, 'center')
    expect(findPane(grouped, 'arch')!.leaf.panes).toEqual(['arch', 'schema'])

    const { tree, spec } = close(grouped, 'arch')
    expect(spec.tabIndex).toBe(0)
    expect(findPane(restorePane(tree, spec), 'arch')!.leaf.panes).toEqual(['arch', 'schema'])
  })

  it('returns a middle tab to the middle', () => {
    let tree: DockNode = removePane(defaultTree(), 'schema')!
    tree = insertPane(tree, 'schema', findPane(tree, 'arch')!.path, 'center')
    tree = removePane(tree, 'sequence')!
    tree = insertPane(tree, 'sequence', findPane(tree, 'arch')!.path, 'center')
    const group = findPane(tree, 'arch')!.leaf.panes
    expect(group).toEqual(['arch', 'schema', 'sequence'])

    const { tree: without, spec } = close(tree, 'schema')
    expect(spec.tabIndex).toBe(1)
    expect(findPane(restorePane(without, spec), 'schema')!.leaf.panes).toEqual(group)
  })

  it('keeps a tabbed pane’s slot geometry, in case the group goes too', () => {
    const base = removePane(defaultTree(), 'schema')!
    const grouped = insertPane(base, 'schema', findPane(base, 'arch')!.path, 'center')
    const spec = describeForRestore(grouped, 'schema')!
    // Tab details *and* the slot's own position, so a vanished group is not a
    // total loss of information.
    expect(spec.tabbedWith).toBe('arch')
    expect(spec.size).toBeGreaterThan(0)
    expect(spec.before).toBe('inspector')
    // `after` must skip the pane being described, not name itself.
    expect(spec.after).not.toBe('schema')
  })

  it('restores a tabbed pane sensibly when its whole group has closed', () => {
    let tree: DockNode = removePane(defaultTree(), 'schema')!
    tree = insertPane(tree, 'schema', findPane(tree, 'arch')!.path, 'center')
    const spec = describeForRestore(tree, 'schema')!
    tree = removePane(tree, 'schema')!
    tree = removePane(tree, 'arch')!

    const after = restorePane(tree, spec)
    expect(paneIds(after)).toEqual(['editor', 'sequence', 'schema', 'inspector'])
    // And at a usable width, not squeezed to the minimum.
    const box = computeLayout(after, 1600, 1000).leaves.find((l) => l.active === 'schema')!
    expect(box.rect.w).toBeGreaterThan(MIN_PANE_PX.schema)
  })

  it('lands beside its canonical neighbour when nothing recorded survives', () => {
    // Predictable is the point: the old fallback picked whichever slot happened
    // to be largest, which is why panes appeared on the far side.
    const { spec } = close(defaultTree(), 'schema')
    const onlyEditor = leaf(['editor'])
    const after = restorePane(onlyEditor, spec)
    expect(paneIds(after).sort()).toEqual(['editor', 'schema'])
  })

  it('keeps a column’s proportions across a close and reopen', () => {
    const base = removePane(defaultTree(), 'sequence')!
    let tree = insertPane(base, 'sequence', findPane(base, 'arch')!.path, 'bottom')
    tree = resizeSplit(tree, findPane(tree, 'arch')!.path.slice(0, -1), 0, 0.15)
    const heights = () =>
      new Map(computeLayout(tree, 1600, 1000).leaves.map((l) => [l.active, Math.round(l.rect.h)]))
    const before = heights()

    const { tree: without, spec } = close(tree, 'sequence')
    tree = restorePane(without, spec)
    const restored = new Map(
      computeLayout(tree, 1600, 1000).leaves.map((l) => [l.active, Math.round(l.rect.h)]),
    )
    for (const [pane, h] of before) expect(restored.get(pane), pane).toBeCloseTo(h, 0)
  })

  it('is a no-op for a pane that is already open', () => {
    const tree = defaultTree()
    const spec = describeForRestore(tree, 'arch')!
    expect(restorePane(tree, spec)).toBe(tree)
  })

  it('describes nothing for a pane that is not in the tree', () => {
    expect(describeForRestore(pair(), 'schema')).toBeUndefined()
  })

  it('survives closing and reopening every pane in turn', () => {
    let tree: DockNode = defaultTree()
    for (const pane of paneIds(defaultTree())) {
      const spec = describeForRestore(tree, pane)!
      tree = removePane(tree, pane)!
      tree = restorePane(tree, spec)
      expect(paneIds(tree).sort()).toEqual(paneIds(defaultTree()).sort())
    }
  })
})

describe('defaultTree, given its panes', () => {
  it('lays out however many working panes it is handed', () => {
    const tree = buildDefaultTree(['a', 'b'], 'side')
    expect(paneIds(tree)).toEqual(['a', 'b', 'side'])
  })

  it('gives the side pane the share the inspector column always had', () => {
    const sizes = sizesOf(buildDefaultTree(['a', 'b'], 'side'))
    expect(sizes[sizes.length - 1]).toBeCloseTo(0.22)
  })

  it('keeps the original four weights in proportion', () => {
    const sizes = sizesOf(buildDefaultTree(WORKING, 'inspector'))
    expect(sizes[0] / sizes[1]).toBeCloseTo(0.2 / 0.28)
  })

  it('shares the whole width when there is no side pane', () => {
    expect(sum(sizesOf(buildDefaultTree(['a', 'b'])))).toBeCloseTo(1)
  })

  it('collapses to a bare leaf rather than a one-child split', () => {
    expect(buildDefaultTree(['only'])).toMatchObject({ type: 'leaf', panes: ['only'] })
    expect(buildDefaultTree([], 'side')).toMatchObject({ type: 'leaf', panes: ['side'] })
  })

  it('refuses to build a tree with nothing in it', () => {
    expect(() => buildDefaultTree([])).toThrow()
  })
})

describe('mapPanes', () => {
  it('renames every pane and leaves the arrangement alone', () => {
    const tree = defaultTree()
    const before = computeLayout(tree, 1600, 1000)
    const done = mapPanes(tree, (pane) => `x:${pane}`)!

    expect(paneIds(done)).toEqual(paneIds(tree).map((p) => `x:${p}`))
    // Same rects, so nothing moved on screen.
    expect(computeLayout(done, 1600, 1000).leaves.map((l) => l.rect)).toEqual(
      before.leaves.map((l) => l.rect),
    )
  })

  it('carries the active tab across the rename', () => {
    const tree = leaf(['editor', 'arch'], 'arch')
    expect(mapPanes(tree, (pane) => `x:${pane}`)).toMatchObject({
      panes: ['x:editor', 'x:arch'],
      active: 'x:arch',
    })
  })

  it('drops a pane whose id does not survive, pruning what that empties', () => {
    const tree = split('row', [leaf(['editor']), leaf(['arch'])], [0.5, 0.5])
    const done = mapPanes(tree, (pane) => (pane === 'arch' ? null : pane))!
    expect(done).toMatchObject({ type: 'leaf', panes: ['editor'] })
  })

  it('returns null when nothing is left, so the caller can fall back', () => {
    expect(mapPanes(leaf(['editor']), () => null)).toBeNull()
  })

  it('returns the same node when every id is unchanged', () => {
    const tree = defaultTree()
    expect(mapPanes(tree, (pane) => pane)).toBe(tree)
  })

  it('collapses two panes that a rename maps onto the same id', () => {
    // Otherwise the tree would hold one id twice, which every query assumes
    // cannot happen.
    const tree = split('row', [leaf(['editor']), leaf(['arch'])], [0.5, 0.5])
    const done = mapPanes(tree, () => 'same')!
    expect(paneIds(done)).toEqual(['same'])
  })

  it('keeps a tabbed slot tabbed', () => {
    const tree = split('row', [leaf(['editor', 'arch'], 'editor'), leaf(['schema'])], [0.5, 0.5])
    const done = mapPanes(tree, (pane) => `x:${pane}`)!
    expect(findPane(done, 'x:arch')!.leaf.panes).toEqual(['x:editor', 'x:arch'])
  })
})
