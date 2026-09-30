import type { ProjectSummary } from '../persist/db'
import {
  VIEWS,
  VIEW_META,
  fileNameOf,
  makeDocId,
  parseDocId,
  type DocId,
  type ViewKind,
} from './docId'

/**
 * What the explorer draws, as a flat list of rows.
 *
 * Flat rather than nested for the same reason `dockTree.computeLayout` returns
 * boxes rather than JSX: the component then has no decisions left to make, and
 * every decision that matters — ordering, which files a project has, what is
 * open, what is dirty — is testable in a node-only suite.
 *
 * Two levels, and the nesting is inherent rather than authored. A project is a
 * folder because it *contains* four views; nobody creates or moves one, and
 * `StoredProject` is unchanged.
 */

export type ExplorerRowKind = 'project' | 'file'

export interface ExplorerRow {
  /** Stable React key, and the thing the row acts on. */
  key: string
  kind: ExplorerRowKind
  depth: number
  /** What the row shows: a project name, or a file name. */
  label: string
  projectId: string
  projectName: string

  /* ------------------------------------------------------------ file rows */
  docId?: DocId
  view?: ViewKind
  /** A projection of the DSL. Presentational only — see `VIEW_META.readOnly`. */
  derived: boolean
  readOnly: boolean
  /** Has a tab somewhere in the dock. */
  open: boolean
  /** Is the tab the chrome is currently bound to. */
  active: boolean
  /** Unsaved. Never true for a derived row, which has nothing of its own to save. */
  dirty: boolean

  /* --------------------------------------------------------- project rows */
  expanded: boolean
  /** How many of this project's four views are open. Drives the collapsed hint. */
  openCount: number
}

export interface ExplorerInput {
  projects: readonly ProjectSummary[]
  /** Doc ids with a tab in the dock tree. */
  openIds: ReadonlySet<string>
  /** The doc id the toolbar, status bar and inspector are bound to. */
  activeId: string | null
  /** Project ids whose children are showing. */
  expanded: ReadonlySet<string>
  /** Project ids whose text differs from what was last written to storage. */
  dirtyProjects: ReadonlySet<string>
}

/**
 * Sorted by name, deliberately **not** by `savedAt`.
 *
 * `listProjects()` returns most-recently-saved first, which is right for a
 * switcher and wrong for a sidebar: autosave fires every 600ms while you type,
 * so the list would reshuffle under the cursor. Numeric collation so `10` sorts
 * after `9` rather than after `1`.
 */
export function sortProjects(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((a, z) =>
    a.name.localeCompare(z.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

export function buildExplorerTree(input: ExplorerInput): ExplorerRow[] {
  const { projects, openIds, activeId, expanded, dirtyProjects } = input
  const rows: ExplorerRow[] = []

  for (const project of sortProjects(projects)) {
    const docIds = VIEWS.map((view) => makeDocId(project.id, view))
    const openCount = docIds.filter((id) => openIds.has(id)).length
    const isExpanded = expanded.has(project.id)
    const dirty = dirtyProjects.has(project.id)

    rows.push({
      key: project.id,
      kind: 'project',
      depth: 0,
      label: project.name,
      projectId: project.id,
      projectName: project.name,
      derived: false,
      readOnly: false,
      open: openCount > 0,
      // A project row is never "the active tab" — only a file can be.
      active: false,
      // Collapsed, the folder carries the dot so an unsaved change is not
      // hidden behind a twisty.
      dirty: dirty && !isExpanded,
      expanded: isExpanded,
      openCount,
    })

    if (!isExpanded) continue

    for (const view of VIEWS) {
      const docId = makeDocId(project.id, view)
      const meta = VIEW_META[view]
      rows.push({
        key: docId,
        kind: 'file',
        depth: 1,
        label: fileNameOf(project.name, view),
        projectId: project.id,
        projectName: project.name,
        docId,
        view,
        derived: meta.derived,
        readOnly: meta.readOnly,
        open: openIds.has(docId),
        active: activeId === docId,
        // Only the source file can be dirty. The projections have nothing of
        // their own to save, so a dot on them would be meaningless.
        dirty: dirty && view === 'dsl',
        expanded: false,
        openCount: 0,
      })
    }
  }

  return rows
}

/**
 * The expansion set needed to make a file visible.
 *
 * Revealing a file that lives in a collapsed project has to open the project
 * first, or the reveal scrolls to nothing. Returns the same set when it is
 * already expanded, so a caller can skip the write.
 */
export function expandedForReveal(
  expanded: ReadonlySet<string>,
  docId: string,
): ReadonlySet<string> {
  const parsed = parseDocId(docId)
  if (!parsed || expanded.has(parsed.projectId)) return expanded
  return new Set([...expanded, parsed.projectId])
}

/** Every project that has at least one open tab — what the boot sequence loads. */
export function projectsWithOpenTabs(openIds: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const id of openIds) {
    const parsed = parseDocId(id)
    if (parsed) out.add(parsed.projectId)
  }
  return out
}
