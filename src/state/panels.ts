import { create } from 'zustand'
import {
  computeLayout,
  defaultTree,
  describeForRestore,
  findPane,
  migrate,
  movePane,
  normalise,
  paneIds,
  removePane,
  resizeSplit,
  restorePane,
  sanitise,
  setActiveTab,
  type DockNode,
  type DockPath,
  type DropZone,
  type PaneId,
  type RestoreSpec,
} from './dockTree'

/**
 * Which panels are on screen, and how they are arranged.
 *
 * This is workspace chrome, not document content: it lives outside the doc
 * store so undo never touches it, and it persists per browser rather than per
 * project — same call VS Code makes about its own layout.
 *
 * The arrangement itself is a docking tree (`dockTree.ts`), which is where all
 * the logic and all the tests live. What remains here is the store: persistence,
 * and the small imperative API — `show`, `hide`, `toggle`, `visiblePanes` — that
 * the rest of the app already speaks. Keeping that API is deliberate; six files
 * and the report exporter call it, and none of them need to learn about trees.
 */

export type { PaneId } from './dockTree'
/**
 * Previously `PaneId | 'inspector'`, because the inspector was not one of the
 * fractional panes. It is an ordinary dockable pane now, so the two are the
 * same type and the alias only survives to spare its callers a rename.
 */
export type PanelId = PaneId

export const PANE_ORDER: PaneId[] = ['editor', 'sequence', 'arch', 'schema']
/** Every panel, in the order menus and shortcuts present them. */
export const PANEL_ORDER: PaneId[] = [...PANE_ORDER, 'inspector']

export const PANEL_LABEL: Record<PanelId, string> = {
  editor: 'DSL',
  sequence: 'Sequence',
  arch: 'Architecture',
  schema: 'Schema',
  inspector: 'Inspector',
}

/** ⌘1/2/3/4 pick a pane, ⌘B the inspector — the keys VS Code uses. */
export const PANEL_SHORTCUT: Record<PanelId, string> = {
  editor: '⌘1',
  sequence: '⌘2',
  arch: '⌘3',
  schema: '⌘4',
  inspector: '⌘B',
}

const STORAGE_KEY = 'seqflow.dock.v1'
/** The flat `{ visible, weights }` layout this replaced. Read once, never written. */
const LEGACY_KEY = 'seqflow.layout.v1'

interface Persisted {
  version: 1
  root: DockNode
  /** Closed panes, each with enough detail to come back where it was. */
  closed: RestoreSpec[]
  /** Minimaps only appear on a diagram too big for its pane; this turns the
   *  whole feature off for people who would rather have the corner back. */
  minimap: boolean
}

function defaults(): Persisted {
  return { version: 1, root: defaultTree(), closed: [], minimap: true }
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Persisted>
      // A tree from another build can name panes this one does not have, so it
      // is rebuilt rather than trusted.
      const root = sanitise(saved.root)
      if (root) {
        const open = new Set(paneIds(root))
        const closed = (Array.isArray(saved.closed) ? saved.closed : []).filter(
          (spec): spec is RestoreSpec =>
            !!spec && typeof spec === 'object' && !open.has((spec as RestoreSpec).pane),
        )
        // A pane this build knows but the saved layout has never heard of must
        // still be reachable, so it lands in `closed` and gets a rail.
        for (const pane of PANEL_ORDER) {
          if (!open.has(pane) && !closed.some((c) => c.pane === pane)) {
            closed.push({ pane, size: 0.2, direction: 'row' })
          }
        }
        return { version: 1, root, closed, minimap: saved.minimap ?? true }
      }
    }

    // First run on this build: carry the old flat layout across so an upgrade
    // preserves the arrangement instead of resetting it.
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const converted = migrate(JSON.parse(legacy))
      if (converted) {
        const previous = JSON.parse(legacy) as { minimap?: boolean }
        return {
          version: 1,
          root: converted.root,
          closed: converted.closed.map((pane) => ({ pane, size: 0.2, direction: 'row' as const })),
          minimap: previous.minimap ?? true,
        }
      }
    }
  } catch {
    /* corrupt or unreadable — fall through to the defaults */
  }
  return defaults()
}

function persist(state: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode, quota — the layout just won't survive a reload */
  }
}

interface PanelStore extends Persisted {
  toggle: (id: PanelId) => void
  show: (id: PanelId) => void
  hide: (id: PanelId) => void
  /** Move `delta`, a fraction of that split's own extent, across a boundary. */
  resizeSplit: (path: DockPath, index: number, delta: number) => void
  /** Drag-and-drop: put a pane somewhere else in the tree. */
  dockPane: (pane: PaneId, target: DockPath, zone: DropZone) => void
  setActive: (path: DockPath, pane: PaneId) => void
  /** Used by the report exporter to put the whole arrangement back at once. */
  setRoot: (root: DockNode) => void
  toggleMinimap: () => void
  resetLayout: () => void
}

export const usePanels = create<PanelStore>((set, get) => ({
  ...load(),

  toggle: (id) => (paneIds(get().root).includes(id) ? get().hide(id) : get().show(id)),

  show: (id) =>
    set((prev) => {
      if (paneIds(prev.root).includes(id)) return prev
      const spec = prev.closed.find((c) => c.pane === id) ?? {
        pane: id,
        size: 0.2,
        direction: 'row' as const,
      }
      const next: Persisted = {
        ...prev,
        root: restorePane(prev.root, spec),
        closed: prev.closed.filter((c) => c.pane !== id),
      }
      persist(next)
      return next
    }),

  hide: (id) =>
    set((prev) => {
      if (!paneIds(prev.root).includes(id)) return prev
      // Never close the last panel: there would be nothing left to work in, and
      // a workspace showing only rails is unrecoverable from the rails alone.
      // The inspector used to be exempt because it was not a pane; now that it
      // is one, it obeys the same rule.
      if (paneIds(prev.root).length === 1) return prev

      const spec = describeForRestore(prev.root, id)
      const root = removePane(prev.root, id)
      if (!root || !spec) return prev

      const next: Persisted = { ...prev, root, closed: [...prev.closed, spec] }
      persist(next)
      return next
    }),

  resizeSplit: (path, index, delta) =>
    set((prev) => {
      const root = resizeSplit(prev.root, path, index, delta)
      if (root === prev.root) return prev
      const next = { ...prev, root }
      persist(next)
      return next
    }),

  dockPane: (pane, target, zone) =>
    set((prev) => {
      const root = movePane(prev.root, pane, target, zone)
      if (root === prev.root) return prev
      const next = { ...prev, root }
      persist(next)
      return next
    }),

  setActive: (path, pane) =>
    set((prev) => {
      const root = setActiveTab(prev.root, path, pane)
      if (root === prev.root) return prev
      const next = { ...prev, root }
      persist(next)
      return next
    }),

  setRoot: (root) =>
    set((prev) => {
      const clean = normalise(root)
      if (!clean) return prev
      const open = new Set(paneIds(clean))
      const next: Persisted = {
        ...prev,
        root: clean,
        closed: prev.closed.filter((c) => !open.has(c.pane)),
      }
      persist(next)
      return next
    }),

  toggleMinimap: () =>
    set((prev) => {
      const next = { ...prev, minimap: !prev.minimap }
      persist(next)
      return next
    }),

  resetLayout: () => {
    const fresh = defaults()
    persist(fresh)
    set({ ...fresh })
  },
}))

/* ----------------------------------------------------------------- helpers */

/**
 * The working panes currently on screen, in their canonical order.
 *
 * Order comes from `PANE_ORDER` rather than from the tree, so it stays stable
 * however the panes are arranged — callers use this to decide what exists, not
 * where it is.
 */
export function visiblePanes(root: DockNode): PaneId[] {
  const open = new Set(paneIds(root))
  return PANE_ORDER.filter((id) => open.has(id))
}

/** Every panel on screen, inspector included. */
export function openPanels(root: DockNode): PaneId[] {
  const open = new Set(paneIds(root))
  return PANEL_ORDER.filter((id) => open.has(id))
}

/** Whether a pane is on screen but behind another tab in its slot. */
export function isBackgroundTab(root: DockNode, pane: PaneId): boolean {
  const home = findPane(root, pane)
  return !!home && home.leaf.panes.length > 1 && home.leaf.active !== pane
}

export { computeLayout, findPane, paneIds }
