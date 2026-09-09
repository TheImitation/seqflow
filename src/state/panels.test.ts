import { beforeEach, describe, expect, it } from 'vitest'
import { computeLayout, findPane, paneIds, type PaneId } from './dockTree'
import {
  isBackgroundTab,
  openPanels,
  PANE_ORDER,
  usePanels,
  visiblePanes,
} from './panels'

const reset = () => usePanels.getState().resetLayout()
const root = () => usePanels.getState().root
const shown = () => visiblePanes(root())

describe('panel visibility', () => {
  beforeEach(reset)

  it('starts with everything on screen', () => {
    expect(shown()).toEqual(['editor', 'sequence', 'arch', 'schema'])
    expect(openPanels(root())).toContain('inspector')
  })

  it('toggles a pane off and back on', () => {
    usePanels.getState().toggle('sequence')
    expect(shown()).toEqual(['editor', 'arch', 'schema'])
    usePanels.getState().toggle('sequence')
    expect(shown()).toEqual(['editor', 'sequence', 'arch', 'schema'])
  })

  it('refuses to close the last remaining panel', () => {
    for (const id of [...PANE_ORDER, 'inspector' as PaneId]) usePanels.getState().hide(id)
    expect(paneIds(root())).toHaveLength(1)
  })

  it('holds the inspector to the same last-panel rule as any other pane', () => {
    // It used to be exempt, because it was not one of the fractional panes.
    // As an ordinary dockable pane it can no longer empty the workspace.
    for (const id of PANE_ORDER) usePanels.getState().hide(id)
    const survivor = paneIds(root())
    expect(survivor).toHaveLength(1)
    usePanels.getState().hide(survivor[0])
    expect(paneIds(root())).toEqual(survivor)
  })

  it('ignores hiding a pane that is already closed', () => {
    usePanels.getState().hide('schema')
    const before = root()
    usePanels.getState().hide('schema')
    expect(root()).toBe(before)
  })

  it('ignores showing a pane that is already open', () => {
    const before = root()
    usePanels.getState().show('schema')
    expect(root()).toBe(before)
  })

  it('returns a reopened pane to its old position and size', () => {
    // The rule the flat store kept each hidden pane's weight for.
    const widths = () =>
      new Map(computeLayout(root(), 1600, 1000).leaves.map((l) => [l.active, Math.round(l.rect.w)]))
    const before = widths()

    usePanels.getState().hide('arch')
    usePanels.getState().show('arch')

    expect(shown()).toEqual(['editor', 'sequence', 'arch', 'schema'])
    expect([...widths().entries()]).toEqual([...before.entries()])
  })
})

describe('tabs', () => {
  beforeEach(reset)

  it('stacks two panes into one slot on a centre drop', () => {
    const target = findPane(root(), 'arch')!.path
    usePanels.getState().dockPane('schema', target, 'center')
    expect(findPane(root(), 'schema')!.leaf.panes).toEqual(['arch', 'schema'])
    expect(shown()).toEqual(['editor', 'sequence', 'arch', 'schema'])
  })

  it('reports a pane hidden behind another tab', () => {
    const target = findPane(root(), 'arch')!.path
    usePanels.getState().dockPane('schema', target, 'center')
    // The dropped pane becomes active, so its host is the one in the background.
    expect(isBackgroundTab(root(), 'arch')).toBe(true)
    expect(isBackgroundTab(root(), 'schema')).toBe(false)
  })

  it('does not call a pane alone in its slot a background tab', () => {
    expect(isBackgroundTab(root(), 'editor')).toBe(false)
  })

  it('switches the active tab', () => {
    const target = findPane(root(), 'arch')!.path
    usePanels.getState().dockPane('schema', target, 'center')
    const slot = findPane(root(), 'arch')!.path
    usePanels.getState().setActive(slot, 'arch')
    expect(isBackgroundTab(root(), 'arch')).toBe(false)
    expect(isBackgroundTab(root(), 'schema')).toBe(true)
  })
})

describe('docking', () => {
  beforeEach(reset)

  it('stacks a pane below another on a bottom drop', () => {
    const target = findPane(root(), 'arch')!.path
    usePanels.getState().dockPane('schema', target, 'bottom')
    const arch = findPane(root(), 'arch')!.path
    const schema = findPane(root(), 'schema')!.path
    expect(arch.slice(0, -1)).toEqual(schema.slice(0, -1))
  })

  it('never loses a pane, whatever it is dropped on', () => {
    const moves: [PaneId, PaneId, 'left' | 'bottom' | 'center'][] = [
      ['schema', 'arch', 'bottom'],
      ['editor', 'sequence', 'center'],
      ['inspector', 'schema', 'left'],
    ]
    for (const [pane, onto, zone] of moves) {
      usePanels.getState().dockPane(pane, findPane(root(), onto)!.path, zone)
      expect(paneIds(root()).sort()).toEqual(
        ['arch', 'editor', 'inspector', 'schema', 'sequence'].sort(),
      )
    }
  })

  it('ignores a drop that would change nothing', () => {
    const before = root()
    usePanels.getState().dockPane('arch', findPane(before, 'arch')!.path, 'center')
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
    usePanels.getState().hide('schema')
    usePanels.getState().setRoot(before)
    expect(shown()).toEqual(['editor', 'sequence', 'arch', 'schema'])
  })

  it('forgets a closed pane that the restored tree brings back', () => {
    const before = root()
    usePanels.getState().hide('schema')
    expect(usePanels.getState().closed.map((c) => c.pane)).toContain('schema')
    usePanels.getState().setRoot(before)
    expect(usePanels.getState().closed.map((c) => c.pane)).not.toContain('schema')
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
    usePanels.getState().hide('schema')
    usePanels.getState().toggleMinimap()
    reset()
    expect(shown()).toEqual(['editor', 'sequence', 'arch', 'schema'])
    expect(usePanels.getState().closed).toEqual([])
    expect(usePanels.getState().minimap).toBe(true)
  })
})
