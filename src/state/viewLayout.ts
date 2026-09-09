import { create } from 'zustand'

/**
 * How the two graph panes arrange themselves, and where the user has parked
 * individual nodes.
 *
 * Same call as `panels.ts`: this is view state, not document content, so it
 * lives outside the doc store where undo can never touch it. Unlike panel
 * layout, though, pinned positions *are* per project — a pin is a coordinate
 * for one named node, and replaying one project's pins onto another would
 * scatter boxes at random. So the mode and sticky preferences persist per
 * browser, and pins persist under the project they were placed in.
 */

export type LayoutMode = 'rigid' | 'fluid' | 'manual'
export type GraphPaneId = 'arch' | 'schema'

export interface Point {
  x: number
  y: number
}

/** Node id -> top-left position, matching what the layouts render with. */
export type PinMap = Record<string, Point>

export const LAYOUT_MODES: LayoutMode[] = ['rigid', 'fluid', 'manual']

export const MODE_LABEL: Record<LayoutMode, string> = {
  rigid: 'Rigid',
  fluid: 'Fluid',
  manual: 'Manual',
}

export const MODE_GLYPH: Record<LayoutMode, string> = {
  rigid: '▦',
  fluid: '✳',
  manual: '✥',
}

export const MODE_HINT: Record<LayoutMode, string> = {
  rigid: 'Ranked layout, recomputed on every edit',
  fluid: 'Live physics — pull a node and its neighbours follow',
  manual: 'Nodes stay exactly where you drop them',
}

/**
 * Pins for a session that has no project id yet. IndexedDB hydration is async
 * (`store.ts` leaves `projectId` null until it finishes), so a node dragged in
 * the first moments of a session has nowhere else to go; `adoptPins` moves them
 * across once the real id lands.
 */
export const UNSAVED_KEY = '__unsaved'

/** Keeps localStorage bounded for someone who accumulates a lot of projects. */
const MAX_PROJECTS = 20

const STORAGE_KEY = 'seqflow.viewLayout.v1'

interface Persisted {
  mode: Record<GraphPaneId, LayoutMode>
  sticky: Record<GraphPaneId, boolean>
  pins: Record<string, Partial<Record<GraphPaneId, PinMap>>>
  /** Project keys, most recently pinned first. Drives the trim. */
  recent: string[]
}

const DEFAULTS: Persisted = {
  // Rigid by default: it is the layout every existing diagram already has, so
  // opening this build does not rearrange anyone's work.
  mode: { arch: 'rigid', schema: 'rigid' },
  // Sticky on by default: dragging a node and watching it spring back is the
  // more surprising of the two behaviours.
  sticky: { arch: true, schema: true },
  pins: {},
  recent: [],
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const saved = JSON.parse(raw) as Partial<Persisted>
    return {
      mode: { ...DEFAULTS.mode, ...saved.mode },
      sticky: { ...DEFAULTS.sticky, ...saved.sticky },
      pins: saved.pins ?? {},
      recent: saved.recent ?? [],
    }
  } catch {
    return DEFAULTS
  }
}

function persist(state: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode, quota — the arrangement just won't survive a reload */
  }
}

/** Move `key` to the front and drop the pins of anything that falls off. */
function touch(state: Persisted, key: string): Persisted {
  const recent = [key, ...state.recent.filter((k) => k !== key)].slice(0, MAX_PROJECTS)
  const kept = new Set(recent)
  const pins: Persisted['pins'] = {}
  for (const [k, v] of Object.entries(state.pins)) {
    if (kept.has(k)) pins[k] = v
  }
  return { ...state, recent, pins }
}

interface ViewLayoutStore extends Persisted {
  setMode: (pane: GraphPaneId, mode: LayoutMode) => void
  toggleSticky: (pane: GraphPaneId) => void
  pinNode: (project: string, pane: GraphPaneId, id: string, at: Point) => void
  unpinNode: (project: string, pane: GraphPaneId, id: string) => void
  /** "Re-organise": drop every pin on this pane so the algorithm takes over. */
  clearPins: (project: string, pane: GraphPaneId) => void
  /** Carry pins placed before hydration over to the project that just loaded. */
  adoptPins: (from: string, to: string) => void
}

export const useViewLayout = create<ViewLayoutStore>((set) => ({
  ...load(),

  setMode: (pane, mode) =>
    set((prev) => {
      if (prev.mode[pane] === mode) return prev
      const next = { ...prev, mode: { ...prev.mode, [pane]: mode } }
      persist(next)
      return next
    }),

  toggleSticky: (pane) =>
    set((prev) => {
      const next = { ...prev, sticky: { ...prev.sticky, [pane]: !prev.sticky[pane] } }
      persist(next)
      return next
    }),

  pinNode: (project, pane, id, at) =>
    set((prev) => {
      const forProject = prev.pins[project] ?? {}
      const next = touch(
        {
          ...prev,
          pins: {
            ...prev.pins,
            [project]: { ...forProject, [pane]: { ...(forProject[pane] ?? {}), [id]: at } },
          },
        },
        project,
      )
      persist(next)
      return next
    }),

  unpinNode: (project, pane, id) =>
    set((prev) => {
      const forPane = prev.pins[project]?.[pane]
      if (!forPane || !(id in forPane)) return prev
      const { [id]: _dropped, ...rest } = forPane
      const next = {
        ...prev,
        pins: { ...prev.pins, [project]: { ...prev.pins[project], [pane]: rest } },
      }
      persist(next)
      return next
    }),

  clearPins: (project, pane) =>
    set((prev) => {
      const forPane = prev.pins[project]?.[pane]
      if (!forPane || !Object.keys(forPane).length) return prev
      const next = {
        ...prev,
        pins: { ...prev.pins, [project]: { ...prev.pins[project], [pane]: {} } },
      }
      persist(next)
      return next
    }),

  adoptPins: (from, to) =>
    set((prev) => {
      const source = prev.pins[from]
      if (from === to || !source || !hasAnyPin(source)) return prev
      // Anything already pinned under the real project wins: those were placed
      // deliberately against this project, the pre-hydration ones were not.
      const merged: Partial<Record<GraphPaneId, PinMap>> = { ...source }
      for (const [pane, map] of Object.entries(prev.pins[to] ?? {})) {
        const key = pane as GraphPaneId
        merged[key] = { ...(source[key] ?? {}), ...map }
      }
      const { [from]: _moved, ...others } = prev.pins
      const next = touch({ ...prev, pins: { ...others, [to]: merged } }, to)
      persist(next)
      return next
    }),
}))

/* ----------------------------------------------------------------- helpers */

function hasAnyPin(byPane: Partial<Record<GraphPaneId, PinMap>>): boolean {
  return Object.values(byPane).some((map) => map && Object.keys(map).length > 0)
}

/** The pins in force for one pane, as the Map the layouts and simulation want. */
export function pinsFor(
  pins: Persisted['pins'],
  project: string,
  pane: GraphPaneId,
): Map<string, Point> {
  return new Map(Object.entries(pins[project]?.[pane] ?? {}))
}

/** Which project key pins are filed under, given the store's async hydration. */
export function projectKey(projectId: string | null): string {
  return projectId ?? UNSAVED_KEY
}
