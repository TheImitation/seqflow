import { create } from 'zustand'
import {
  docIdsOf,
  isSlotId,
  isToolId,
  legacySlotId,
  makeDocId,
  minPxOf,
  PENDING_PROJECT_ID,
  projectOf,
  rebaseSlot,
  slotOrder,
  VIEWS,
  viewOf,
  type SlotId,
  type ViewKind,
} from './docId'
import {
  computeLayout as computeLayoutRaw,
  defaultTree,
  describeForRestore,
  findPane,
  mapPanes,
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
 * Which documents are on screen, and how they are arranged.
 *
 * This is workspace chrome, not document content: it lives outside the doc
 * store so undo never touches it, and it persists per browser rather than per
 * project — same call VS Code makes about its own layout.
 *
 * The arrangement itself is a docking tree (`dockTree.ts`), which is where all
 * the logic and all the tests live. What remains here is the store: persistence,
 * and the small imperative API — `show`, `hide`, `toggle` — that the rest of the
 * app already speaks. Keeping that API is deliberate; six files and the report
 * exporter call it, and none of them need to learn about trees.
 *
 * What changed when slots started holding documents: a slot id is no longer one
 * of five literals but `${projectId}#${view}` (`docId.ts`), so this store also
 * records **which project** those ids name. One project's documents are open at
 * a time — the explorer lists every project's files whether or not they have a
 * tab, so nothing is unreachable — and switching project is a rename of every
 * id rather than a rearrangement, which is why the workspace does not move.
 */

export type { PaneId } from './dockTree'
export type { SlotId, ViewKind } from './docId'

const STORAGE_KEY = 'seqflow.dock.v2'
/** Trees keyed by pane name, from the build before slots held documents. */
const DOCK_V1_KEY = 'seqflow.dock.v1'
/** The flat `{ visible, weights }` layout that preceded docking. Read, never written. */
const LEGACY_KEY = 'seqflow.layout.v1'

interface Persisted {
  version: 2
  /** The project whose documents the ids in `root` and `closed` name. */
  projectId: string
  root: DockNode
  /** Closed slots, each with enough detail to come back where it was. */
  closed: RestoreSpec[]
  /** Project ids whose files are showing in the explorer. */
  expanded: string[]
  /** The document the toolbar, status bar and inspector are bound to. */
  activeId: SlotId | null
  /**
   * Whether the file explorer is showing.
   *
   * A plain boolean rather than a slot in the tree: the explorer is not a
   * document and not a tool either — it is how documents are *reached*, so
   * docking it inside the thing it navigates would let it be closed out from
   * under itself, with the way back only in a menu.
   */
  explorerOpen: boolean
  /** Minimaps only appear on a diagram too big for its pane; this turns the
   *  whole feature off for people who would rather have the corner back. */
  minimap: boolean
}

function defaults(projectId = PENDING_PROJECT_ID): Persisted {
  return {
    version: 2,
    projectId,
    root: defaultTree(docIdsOf(projectId), 'inspector'),
    closed: [],
    expanded: [projectId],
    activeId: makeDocId(projectId, 'dsl'),
    explorerOpen: true,
    minimap: true,
  }
}

/**
 * Put a loaded tree into a consistent state: a rail for every slot that is not
 * on screen, and no stale entry for one that is.
 *
 * The "every slot this build knows" pass matters more than it did: a layout
 * saved before a view existed has never heard of it, and without a rail there
 * would be no way to reach it at all.
 */
function settle(projectId: string, root: DockNode, saved: Partial<Persisted>): Persisted {
  const open = new Set(paneIds(root))
  const closed = (Array.isArray(saved.closed) ? saved.closed : []).filter(
    (spec): spec is RestoreSpec =>
      !!spec && typeof spec === 'object' && !open.has((spec as RestoreSpec).pane),
  )
  for (const slot of slotOrder(projectId)) {
    if (!open.has(slot) && !closed.some((c) => c.pane === slot)) {
      closed.push({ pane: slot, size: 0.2, direction: 'row' })
    }
  }

  // Expansion is remembered per project on purpose — collapsing one and coming
  // back to it later should find it collapsed — so an id for a project that is
  // not open is kept rather than pruned. The placeholder is the exception: it
  // never names a real project, so it would accumulate and never match a row.
  const expanded = (Array.isArray(saved.expanded) ? saved.expanded : []).filter(
    (id): id is string => typeof id === 'string' && id !== PENDING_PROJECT_ID,
  )
  const activeId =
    typeof saved.activeId === 'string' && open.has(saved.activeId)
      ? saved.activeId
      : (paneIds(root).find((id) => !isToolId(id)) ?? null)

  return {
    version: 2,
    projectId,
    root,
    closed,
    expanded: expanded.includes(projectId) ? expanded : [...expanded, projectId],
    activeId,
    explorerOpen: saved.explorerOpen ?? true,
    minimap: saved.minimap ?? true,
  }
}

function load(): Persisted {
  try {
    const current = localStorage.getItem(STORAGE_KEY)
    if (current) {
      const saved = JSON.parse(current) as Partial<Persisted>
      // A tree from another build can name slots this one cannot read, so it is
      // rebuilt rather than trusted.
      const root = sanitise(saved.root, isSlotId)
      if (root) {
        const projectId =
          typeof saved.projectId === 'string' && saved.projectId ? saved.projectId : PENDING_PROJECT_ID
        return settle(projectId, root, saved)
      }
    }

    // A tree keyed by pane name, from before a slot held a document. The
    // arrangement is still meaningful; only the vocabulary changed.
    const v1 = localStorage.getItem(DOCK_V1_KEY)
    if (v1) {
      const saved = JSON.parse(v1) as Partial<Persisted> & { closed?: { pane: string }[] }
      const cleaned = sanitise(saved.root)
      const root =
        cleaned && mapPanes(cleaned, (pane) => legacySlotId(pane, PENDING_PROJECT_ID))
      if (root) {
        return settle(PENDING_PROJECT_ID, root, {
          minimap: saved.minimap,
          closed: (Array.isArray(saved.closed) ? saved.closed : []).map((spec) => ({
            ...(spec as RestoreSpec),
            pane: legacySlotId(spec.pane, PENDING_PROJECT_ID),
          })),
        })
      }
    }

    // First run on this build: carry the old flat layout across so an upgrade
    // preserves the arrangement instead of resetting it.
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const converted = migrate(JSON.parse(legacy), (pane) =>
        legacySlotId(pane, PENDING_PROJECT_ID),
      )
      if (converted) {
        const previous = JSON.parse(legacy) as { minimap?: boolean }
        return settle(PENDING_PROJECT_ID, converted.root, {
          minimap: previous.minimap,
          closed: converted.closed.map((pane) => ({ pane, size: 0.2, direction: 'row' as const })),
        })
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
  toggle: (id: SlotId) => void
  show: (id: SlotId) => void
  hide: (id: SlotId) => void
  /** Move `delta`, a fraction of that split's own extent, across a boundary. */
  resizeSplit: (path: DockPath, index: number, delta: number) => void
  /** Drag-and-drop: put a slot somewhere else in the tree. */
  dockPane: (pane: SlotId, target: DockPath, zone: DropZone) => void
  setActive: (path: DockPath, pane: SlotId) => void
  /** Used by the report exporter to put the whole arrangement back at once. */
  setRoot: (root: DockNode) => void
  toggleMinimap: () => void
  toggleExplorer: () => void
  resetLayout: () => void

  /* ------------------------------------------------------------ documents */
  /**
   * Point the same arrangement at another project's documents.
   *
   * Every document id is rewritten and every tool left alone, so a switch keeps
   * the workspace exactly as it was — which is the behaviour a file explorer
   * implies and the reason `mapPanes` exists.
   */
  rebaseTo: (projectId: string) => void
  /** Open a document, or bring it forward if it already has a tab. */
  openDoc: (id: SlotId) => void
  /** Expand or collapse a project's files in the explorer. */
  toggleProject: (projectId: string) => void
  /** Open a document *and* make sure the explorer is showing it. */
  reveal: (id: SlotId) => void
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
        root: restorePane(prev.root, spec, slotOrder(prev.projectId)),
        closed: prev.closed.filter((c) => c.pane !== id),
        activeId: isToolId(id) ? prev.activeId : id,
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

      const next: Persisted = {
        ...prev,
        root,
        closed: [...prev.closed, spec],
        activeId: prev.activeId === id ? nextActive(root, prev.activeId) : prev.activeId,
      }
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
      const next = { ...prev, root, activeId: isToolId(pane) ? prev.activeId : pane }
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

  toggleExplorer: () =>
    set((prev) => {
      const next = { ...prev, explorerOpen: !prev.explorerOpen }
      persist(next)
      return next
    }),

  resetLayout: () =>
    set((prev) => {
      // Everything the panel store holds, for the project that is open — the
      // arrangement, the rails, the minimap and the explorer together.
      const fresh = defaults(prev.projectId)
      persist(fresh)
      return fresh
    }),

  rebaseTo: (projectId) =>
    set((prev) => {
      if (projectId === prev.projectId) return prev

      const root = mapPanes(prev.root, (pane) => rebaseSlot(pane, projectId))
      const next: Persisted = {
        ...prev,
        projectId,
        // A tree of nothing but unreadable ids cannot be rebased at all, so the
        // project gets the default arrangement rather than an empty workspace.
        ...(root
          ? {
              root,
              closed: prev.closed.flatMap((spec) => {
                const pane = rebaseSlot(spec.pane, projectId)
                return pane ? [{ ...spec, pane, ...rebaseLandmarks(spec, projectId) }] : []
              }),
              activeId: prev.activeId ? rebaseSlot(prev.activeId, projectId) : null,
            }
          : defaults(projectId)),
        expanded: [
          ...prev.expanded.filter((id) => id !== PENDING_PROJECT_ID && id !== projectId),
          projectId,
        ],
        explorerOpen: prev.explorerOpen,
        minimap: prev.minimap,
      }
      persist(next)
      return next
    }),

  openDoc: (id) => {
    const { root, show, setActive } = get()
    const home = findPane(root, id)
    if (!home) {
      show(id)
      return
    }
    // Already open. Bring it to the front of its slot if it is behind a tab,
    // and bind the chrome to it either way.
    if (home.leaf.active !== id) {
      setActive(home.path, id)
      return
    }
    set((prev) => {
      if (isToolId(id) || prev.activeId === id) return prev
      const next = { ...prev, activeId: id }
      persist(next)
      return next
    })
  },

  toggleProject: (projectId) =>
    set((prev) => {
      const expanded = prev.expanded.includes(projectId)
        ? prev.expanded.filter((id) => id !== projectId)
        : [...prev.expanded, projectId]
      const next = { ...prev, expanded }
      persist(next)
      return next
    }),

  reveal: (id) => {
    const project = projectOf(id)
    if (project && !get().expanded.includes(project)) get().toggleProject(project)
    get().openDoc(id)
  },
}))

/* ----------------------------------------------------------------- helpers */

/** The document the chrome falls back to when the active one closes. */
function nextActive(root: DockNode, closing: SlotId | null): SlotId | null {
  return paneIds(root).find((id) => !isToolId(id) && id !== closing) ?? null
}

/**
 * A restore descriptor names its neighbours by id, so those have to move to the
 * new project too — otherwise reopening a pane after a switch would look for
 * landmarks that are no longer in the tree and fall back to the canonical order.
 */
function rebaseLandmarks(spec: RestoreSpec, projectId: string): Partial<RestoreSpec> {
  const at = (id: SlotId | undefined) => (id ? (rebaseSlot(id, projectId) ?? undefined) : undefined)
  return { tabbedWith: at(spec.tabbedWith), after: at(spec.after), before: at(spec.before) }
}

/** Layout with the real per-slot minimum widths, which only `docId` knows. */
export function computeLayout(root: DockNode, width: number, height: number) {
  return computeLayoutRaw(root, width, height, minPxOf)
}

/**
 * The views on screen, in their canonical order.
 *
 * Order comes from `VIEWS` rather than from the tree, so it stays stable
 * however the documents are arranged — callers use this to decide what exists,
 * not where it is.
 */
export function visibleViews(root: DockNode): ViewKind[] {
  const open = new Set(paneIds(root).flatMap((id) => viewOf(id) ?? []))
  return VIEWS.filter((view) => open.has(view))
}

/** Every slot on screen, tools included, in canonical order. */
export function openSlots(root: DockNode, projectId: string): SlotId[] {
  const open = new Set(paneIds(root))
  return slotOrder(projectId).filter((id) => open.has(id))
}

/** Whether a slot is on screen but behind another tab in its own slot. */
export function isBackgroundTab(root: DockNode, pane: PaneId): boolean {
  const home = findPane(root, pane)
  return !!home && home.leaf.panes.length > 1 && home.leaf.active !== pane
}

export { findPane, paneIds }
