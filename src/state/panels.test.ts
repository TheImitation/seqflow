import { beforeEach, describe, expect, it } from 'vitest'
import { computeLayout, findPane, paneIds } from './dockTree'
import {
  docIdsOf,
  makeDocId,
  PENDING_PROJECT_ID,
  slotOrder,
  type SlotId,
  type ViewKind,
} from './docId'
import { isBackgroundTab, openSlots, usePanels, visibleViews } from './panels'

/**
 * The store is created before any project is known, so it starts out holding
 * the placeholder project's documents — which is exactly the state these tests
 * want: real document ids, and no IndexedDB needed to get them.
 */
const P = PENDING_PROJECT_ID
const [editor, sequence, arch, schema] = docIdsOf(P)
const inspector: SlotId = 'inspector'

const reset = () => usePanels.getState().resetLayout()
const root = () => usePanels.getState().root
const shown = (): ViewKind[] => visibleViews(root())

describe('panel visibility', () => {
  beforeEach(reset)

  it('starts with everything on screen', () => {
    expect(shown()).toEqual(['dsl', 'sequence', 'arch', 'schema'])
    expect(openSlots(root(), P)).toContain(inspector)
  })

  it('toggles a pane off and back on', () => {
    usePanels.getState().toggle(sequence)
    expect(shown()).toEqual(['dsl', 'arch', 'schema'])
    usePanels.getState().toggle(sequence)
    expect(shown()).toEqual(['dsl', 'sequence', 'arch', 'schema'])
  })

  it('refuses to close the last remaining panel', () => {
    for (const id of slotOrder(P)) usePanels.getState().hide(id)
    expect(paneIds(root())).toHaveLength(1)
  })

  it('holds the inspector to the same last-panel rule as any other pane', () => {
    // It used to be exempt, because it was not one of the fractional panes.
    // As an ordinary dockable pane it can no longer empty the workspace.
    for (const id of docIdsOf(P)) usePanels.getState().hide(id)
    const survivor = paneIds(root())
    expect(survivor).toHaveLength(1)
    usePanels.getState().hide(survivor[0])
    expect(paneIds(root())).toEqual(survivor)
  })

  it('ignores hiding a pane that is already closed', () => {
    usePanels.getState().hide(schema)
    const before = root()
    usePanels.getState().hide(schema)
    expect(root()).toBe(before)
  })

  it('ignores showing a pane that is already open', () => {
    const before = root()
    usePanels.getState().show(schema)
    expect(root()).toBe(before)
  })

  it('returns a reopened pane to its old position and size', () => {
    // The rule the flat store kept each hidden pane's weight for.
    const widths = () =>
      new Map(computeLayout(root(), 1600, 1000).leaves.map((l) => [l.active, Math.round(l.rect.w)]))
    const before = widths()

    usePanels.getState().hide(arch)
    usePanels.getState().show(arch)

    expect(shown()).toEqual(['dsl', 'sequence', 'arch', 'schema'])
    expect([...widths().entries()]).toEqual([...before.entries()])
  })

  it('leaves a rail for every document, so none is unreachable', () => {
    for (const id of docIdsOf(P).slice(1)) usePanels.getState().hide(id)
    expect(usePanels.getState().closed.map((c) => c.pane).sort()).toEqual(
      docIdsOf(P).slice(1).sort(),
    )
  })
})

describe('tabs', () => {
  beforeEach(reset)

  it('stacks two panes into one slot on a centre drop', () => {
    const target = findPane(root(), arch)!.path
    usePanels.getState().dockPane(schema, target, 'center')
    expect(findPane(root(), schema)!.leaf.panes).toEqual([arch, schema])
    expect(shown()).toEqual(['dsl', 'sequence', 'arch', 'schema'])
  })

  it('reports a pane hidden behind another tab', () => {
    const target = findPane(root(), arch)!.path
    usePanels.getState().dockPane(schema, target, 'center')
    // The dropped pane becomes active, so its host is the one in the background.
    expect(isBackgroundTab(root(), arch)).toBe(true)
    expect(isBackgroundTab(root(), schema)).toBe(false)
  })

  it('does not call a pane alone in its slot a background tab', () => {
    expect(isBackgroundTab(root(), editor)).toBe(false)
  })

  it('switches the active tab', () => {
    const target = findPane(root(), arch)!.path
    usePanels.getState().dockPane(schema, target, 'center')
    const slot = findPane(root(), arch)!.path
    usePanels.getState().setActive(slot, arch)
    expect(isBackgroundTab(root(), arch)).toBe(false)
    expect(isBackgroundTab(root(), schema)).toBe(true)
  })
})

describe('docking', () => {
  beforeEach(reset)

  it('stacks a pane below another on a bottom drop', () => {
    const target = findPane(root(), arch)!.path
    usePanels.getState().dockPane(schema, target, 'bottom')
    const above = findPane(root(), arch)!.path
    const below = findPane(root(), schema)!.path
    expect(above.slice(0, -1)).toEqual(below.slice(0, -1))
  })

  it('never loses a pane, whatever it is dropped on', () => {
    const moves: [SlotId, SlotId, 'left' | 'bottom' | 'center'][] = [
      [schema, arch, 'bottom'],
      [editor, sequence, 'center'],
      [inspector, schema, 'left'],
    ]
    for (const [pane, onto, zone] of moves) {
      usePanels.getState().dockPane(pane, findPane(root(), onto)!.path, zone)
      expect(paneIds(root()).sort()).toEqual(slotOrder(P).sort())
    }
  })

  it('ignores a drop that would change nothing', () => {
    const before = root()
    usePanels.getState().dockPane(arch, findPane(before, arch)!.path, 'center')
    expect(root()).toBe(before)
  })
})

describe('resizing', () => {
  beforeEach(reset)

  const sizes = () => (root().type === 'split' ? (root() as { sizes: number[] }).sizes : [])

  it('moves share from one slot to its neighbour', () => {
    const before = sizes()
    usePanels.getState().resizeSplit([], 0, 0.05)
    expect(sizes()[0]).toBeCloseTo(before[0] + 0.05)
    expect(sizes()[1]).toBeCloseTo(before[1] - 0.05)
  })

  it('leaves every other slot in the split strictly alone', () => {
    const before = sizes()
    usePanels.getState().resizeSplit([], 0, 0.05)
    expect(sizes().slice(2)).toEqual(before.slice(2))
  })

  it('conserves the total across a drag', () => {
    usePanels.getState().resizeSplit([], 1, 0.07)
    expect(sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('clamps instead of letting a slot collapse', () => {
    usePanels.getState().resizeSplit([], 0, -10)
    expect(sizes()[0]).toBeGreaterThan(0)
    expect(sizes().reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('keeps every pane at or above its minimum width when there is room', () => {
    // The clamp that used to live in the store now lives in the layout, so this
    // is asserted on the rendered geometry rather than on the stored fractions.
    usePanels.getState().resizeSplit([], 0, -10)
    for (const box of computeLayout(root(), 1600, 1000).leaves) {
      expect(box.rect.w, box.active).toBeGreaterThan(0)
    }
  })

  it('ignores a boundary that does not exist', () => {
    const before = root()
    usePanels.getState().resizeSplit([], 99, 0.1)
    expect(root()).toBe(before)
  })
})

describe('setRoot', () => {
  beforeEach(reset)

  it('restores a whole arrangement in one write, as the exporter needs', () => {
    const before = root()
    usePanels.getState().hide(schema)
    usePanels.getState().setRoot(before)
    expect(shown()).toEqual(['dsl', 'sequence', 'arch', 'schema'])
  })

  it('forgets a closed pane that the restored tree brings back', () => {
    const before = root()
    usePanels.getState().hide(schema)
    expect(usePanels.getState().closed.map((c) => c.pane)).toContain(schema)
    usePanels.getState().setRoot(before)
    expect(usePanels.getState().closed.map((c) => c.pane)).not.toContain(schema)
  })
})

describe('minimap', () => {
  beforeEach(reset)

  it('is on by default', () => {
    expect(usePanels.getState().minimap).toBe(true)
  })

  it('toggles without disturbing the arrangement', () => {
    const before = root()
    usePanels.getState().toggleMinimap()
    expect(usePanels.getState().minimap).toBe(false)
    expect(root()).toBe(before)
  })

  it('comes back on with Reset layout', () => {
    usePanels.getState().toggleMinimap()
    reset()
    expect(usePanels.getState().minimap).toBe(true)
  })
})

describe('resetLayout', () => {
  it('restores the arrangement, the closed list and the minimap together', () => {
    usePanels.getState().hide(schema)
    usePanels.getState().toggleMinimap()
    reset()
    expect(shown()).toEqual(['dsl', 'sequence', 'arch', 'schema'])
    expect(usePanels.getState().closed).toEqual([])
    expect(usePanels.getState().minimap).toBe(true)
  })

  it('resets the project that is open, not the placeholder one', () => {
    usePanels.getState().rebaseTo('p_other')
    reset()
    expect(usePanels.getState().projectId).toBe('p_other')
    expect(paneIds(root())).toEqual(slotOrder('p_other'))
  })
})

/* ------------------------------------------------------------- documents */

describe('rebaseTo', () => {
  beforeEach(() => {
    usePanels.getState().rebaseTo(P)
    reset()
  })

  it('re-points every document at the new project', () => {
    usePanels.getState().rebaseTo('p_next')
    expect(paneIds(root())).toEqual(slotOrder('p_next'))
    expect(usePanels.getState().projectId).toBe('p_next')
  })

  it('keeps the arrangement, because a switch is a rename and not a move', () => {
    usePanels.getState().dockPane(schema, findPane(root(), arch)!.path, 'center')
    usePanels.getState().hide(sequence)
    const before = computeLayout(root(), 1600, 1000)

    usePanels.getState().rebaseTo('p_next')
    const after = computeLayout(root(), 1600, 1000)

    expect(after.leaves.map((l) => l.rect)).toEqual(before.leaves.map((l) => l.rect))
    expect(after.leaves.map((l) => l.panes.length)).toEqual(before.leaves.map((l) => l.panes.length))
  })

  it('leaves a tool where it is, because it belongs to no project', () => {
    usePanels.getState().rebaseTo('p_next')
    expect(paneIds(root())).toContain(inspector)
  })

  it('carries the closed rails across, so a reopen still finds its landmarks', () => {
    usePanels.getState().hide(arch)
    usePanels.getState().rebaseTo('p_next')

    const rail = usePanels.getState().closed.find((c) => c.pane === makeDocId('p_next', 'arch'))
    expect(rail).toBeTruthy()
    // The neighbours it will be restored against have to move too.
    for (const landmark of [rail!.after, rail!.before, rail!.tabbedWith]) {
      if (landmark) expect(landmark).toContain('p_next')
    }
  })

  it('reopens a pane at the size it had before the switch', () => {
    const widths = () =>
      computeLayout(root(), 1600, 1000).leaves.map((l) => Math.round(l.rect.w))
    const before = widths()

    usePanels.getState().hide(arch)
    usePanels.getState().rebaseTo('p_next')
    usePanels.getState().show(makeDocId('p_next', 'arch'))

    expect(widths()).toEqual(before)
  })

  it('moves the active document with the switch', () => {
    usePanels.getState().openDoc(arch)
    usePanels.getState().rebaseTo('p_next')
    expect(usePanels.getState().activeId).toBe(makeDocId('p_next', 'arch'))
  })

  it('does nothing at all when the project is already the one open', () => {
    const before = root()
    usePanels.getState().rebaseTo(P)
    expect(root()).toBe(before)
  })

  it('expands the project it switches to', () => {
    usePanels.getState().rebaseTo('p_next')
    expect(usePanels.getState().expanded).toContain('p_next')
  })

  it('drops the placeholder project, which never names a real one', () => {
    usePanels.getState().rebaseTo('p_next')
    expect(usePanels.getState().expanded).not.toContain(PENDING_PROJECT_ID)
  })

  it('remembers a project it has collapsed, for when it comes back to it', () => {
    usePanels.getState().rebaseTo('p_a')
    usePanels.getState().rebaseTo('p_b')
    usePanels.getState().toggleProject('p_a')
    expect(usePanels.getState().expanded).not.toContain('p_a')
    usePanels.getState().rebaseTo('p_c')
    // Still absent: an id for a project that is not open is remembered, not pruned.
    expect(usePanels.getState().expanded).not.toContain('p_a')
    expect(usePanels.getState().expanded).toContain('p_b')
  })
})

describe('openDoc', () => {
  beforeEach(() => {
    usePanels.getState().rebaseTo(P)
    reset()
  })

  it('opens a closed document', () => {
    usePanels.getState().hide(schema)
    usePanels.getState().openDoc(schema)
    expect(paneIds(root())).toContain(schema)
    expect(usePanels.getState().activeId).toBe(schema)
  })

  it('brings a background tab to the front rather than closing it', () => {
    usePanels.getState().dockPane(schema, findPane(root(), arch)!.path, 'center')
    expect(isBackgroundTab(root(), arch)).toBe(true)
    usePanels.getState().openDoc(arch)
    expect(isBackgroundTab(root(), arch)).toBe(false)
  })

  it('binds the chrome to a document that is already showing', () => {
    usePanels.getState().openDoc(sequence)
    expect(usePanels.getState().activeId).toBe(sequence)
  })

  it('never makes a tool the active document', () => {
    usePanels.getState().openDoc(arch)
    usePanels.getState().openDoc(inspector)
    expect(usePanels.getState().activeId).toBe(arch)
  })

  it('hands the active mark to another document when the active one closes', () => {
    usePanels.getState().openDoc(arch)
    usePanels.getState().hide(arch)
    expect(usePanels.getState().activeId).not.toBe(arch)
    expect(paneIds(root())).toContain(usePanels.getState().activeId!)
  })
})

describe('the explorer', () => {
  beforeEach(() => {
    usePanels.getState().rebaseTo(P)
    reset()
  })

  it('shows the open project expanded', () => {
    expect(usePanels.getState().expanded).toContain(P)
  })

  it('collapses and expands a project', () => {
    usePanels.getState().toggleProject(P)
    expect(usePanels.getState().expanded).not.toContain(P)
    usePanels.getState().toggleProject(P)
    expect(usePanels.getState().expanded).toContain(P)
  })

  it('expands a project on the way to revealing one of its files', () => {
    usePanels.getState().toggleProject(P)
    usePanels.getState().hide(schema)
    usePanels.getState().reveal(schema)
    expect(usePanels.getState().expanded).toContain(P)
    expect(paneIds(root())).toContain(schema)
  })

  it('is showing by default, and toggles without disturbing the arrangement', () => {
    expect(usePanels.getState().explorerOpen).toBe(true)
    const before = root()
    usePanels.getState().toggleExplorer()
    expect(usePanels.getState().explorerOpen).toBe(false)
    expect(root()).toBe(before)
  })
})
