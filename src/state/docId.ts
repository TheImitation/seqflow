/**
 * What a dock slot holds, now that it holds documents.
 *
 * A slot used to be one of five fixed panes. It is now either a **document** —
 * one view of one project, `p_abc123#arch` — or a **tool**, of which there is
 * currently one. The distinction matters because documents come and go with the
 * projects they belong to, while a tool is always addressable.
 *
 * Everything that knows the shape of a slot id lives here. `dockTree.ts`
 * deliberately does not: the tree treats an id as opaque, which is what let the
 * whole vocabulary widen from five literals to an open set without touching a
 * single tree operation.
 */

export const VIEWS = ['dsl', 'sequence', 'arch', 'schema'] as const
export type ViewKind = (typeof VIEWS)[number]

/** Panels that are not documents. They never appear in the explorer. */
export const TOOL_IDS = ['inspector'] as const
export type ToolId = (typeof TOOL_IDS)[number]

/** `${projectId}#${ViewKind}`. Kept as a plain string so the tree stays generic. */
export type DocId = string
export type SlotId = DocId | ToolId

/**
 * Project ids are `p_<base36>_<base36>` (`persist/db.ts:newProjectId`), so `#`
 * cannot occur in one and needs no escaping.
 */
const SEP = '#'

export interface ViewMeta {
  /** The extension shown in the explorer and on the tab. */
  ext: ViewKind
  /** Long form, for menus and the accessible name. */
  label: string
  /**
   * A projection of the DSL rather than something anyone types into. The
   * README is explicit that the architecture is "derived on every change …
   * never edited directly", and the schema graph is the same kind of thing.
   * Shown dimmed and never marked dirty, the way an editor shows build output.
   */
  derived: boolean
  /**
   * Genuinely cannot write back — a narrower thing than `derived`, and only the
   * schema view qualifies. The architecture view is a projection you can still
   * edit *through*: its right-click menus (`canvasMenu`, `archEdgeMenu`,
   * `participantMenu`) all call `mutate` and land in the DSL. Treating derived
   * as read-only would have removed that.
   */
  readOnly: boolean
  /** Floor for a slot holding this view, in px. */
  minPx: number
}

export const VIEW_META: Record<ViewKind, ViewMeta> = {
  dsl: { ext: 'dsl', label: 'DSL', derived: false, readOnly: false, minPx: 200 },
  sequence: { ext: 'sequence', label: 'Sequence', derived: false, readOnly: false, minPx: 130 },
  arch: { ext: 'arch', label: 'Architecture', derived: true, readOnly: false, minPx: 130 },
  schema: { ext: 'schema', label: 'Schema', derived: true, readOnly: true, minPx: 130 },
}

export const TOOL_META: Record<ToolId, { label: string; minPx: number }> = {
  inspector: { label: 'Inspector', minPx: 260 },
}

/** Anything unrecognised still has to be laid out rather than crash. */
const FALLBACK_MIN_PX = 130

/* -------------------------------------------------------------------- codec */

export function makeDocId(projectId: string, view: ViewKind): DocId {
  return `${projectId}${SEP}${view}`
}

/** Every view of one project, in the order the explorer lists them. */
export function docIdsOf(projectId: string): DocId[] {
  return VIEWS.map((view) => makeDocId(projectId, view))
}

export function parseDocId(id: string): { projectId: string; view: ViewKind } | undefined {
  const cut = id.indexOf(SEP)
  if (cut <= 0) return undefined
  const projectId = id.slice(0, cut)
  const view = id.slice(cut + 1)
  if (!isViewKind(view)) return undefined
  return { projectId, view }
}

export function isViewKind(value: string): value is ViewKind {
  return (VIEWS as readonly string[]).includes(value)
}

export function isToolId(id: string): id is ToolId {
  return (TOOL_IDS as readonly string[]).includes(id)
}

export function isDocId(id: string): boolean {
  return parseDocId(id) !== undefined
}

/** A slot id is valid if it names a tool or parses as a document. */
export function isSlotId(value: unknown): value is SlotId {
  return typeof value === 'string' && (isToolId(value) || isDocId(value))
}

export function projectOf(id: string): string | undefined {
  return parseDocId(id)?.projectId
}

export function viewOf(id: string): ViewKind | undefined {
  return parseDocId(id)?.view
}

export function isDerived(id: string): boolean {
  const view = viewOf(id)
  return view ? VIEW_META[view].derived : false
}

/* ------------------------------------------------------------------ display */

export function minPxOf(id: string): number {
  if (isToolId(id)) return TOOL_META[id].minPx
  const view = viewOf(id)
  return view ? VIEW_META[view].minPx : FALLBACK_MIN_PX
}

/**
 * The stem of a file name, from the project it belongs to.
 *
 * Long enough to tell two projects apart and short enough to fit a tab. The
 * *tail* of a name survives truncation rather than the head, because project
 * names in practice share a prefix and differ at the end — "Agentic — 00
 * Platform spine" and "Agentic — 01 Identity" are identical for eight
 * characters.
 */
export function baseName(projectName: string, max = 22): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  if (slug.length <= max) return slug
  const tail = slug.slice(slug.length - max)
  const boundary = tail.indexOf('-')
  return boundary > 0 && boundary < 8 ? tail.slice(boundary + 1) : tail
}

/** `platform-spine.arch` — what the explorer row and the tab both show. */
export function fileNameOf(projectName: string, view: ViewKind): string {
  return `${baseName(projectName)}.${VIEW_META[view].ext}`
}

/** Long form for a title attribute or an accessible name. */
export function describeSlot(id: string, projectName?: string): string {
  if (isToolId(id)) return TOOL_META[id].label
  const view = viewOf(id)
  if (!view) return id
  return projectName ? `${projectName} — ${VIEW_META[view].label}` : VIEW_META[view].label
}

/* -------------------------------------------------------------- shortcuts */

/**
 * `⌘1`–`⌘4` reach a view and `⌘B` the inspector — the keys VS Code uses, and
 * the ones the README documents. Keyed by view rather than by document,
 * because a shortcut means "the schema of whatever is open", not "this file".
 */
export const VIEW_SHORTCUT: Record<ViewKind, string> = {
  dsl: '⌘1',
  sequence: '⌘2',
  arch: '⌘3',
  schema: '⌘4',
}

export const TOOL_SHORTCUT: Record<ToolId, string> = { inspector: '⌘B' }

/** The view or tool a shortcut key reaches, or undefined for any other key. */
export function slotForKey(key: string): ViewKind | ToolId | undefined {
  const lower = key.toLowerCase()
  const view = VIEWS.find((v) => VIEW_SHORTCUT[v] === `⌘${lower}`)
  if (view) return view
  return lower === 'b' ? 'inspector' : undefined
}

export function shortcutOf(id: string): string | undefined {
  if (isToolId(id)) return TOOL_SHORTCUT[id]
  const view = viewOf(id)
  return view ? VIEW_SHORTCUT[view] : undefined
}

/** The short form: what a tab strip and a menu row show. */
export function shortLabelOf(id: string): string {
  if (isToolId(id)) return TOOL_META[id].label
  const view = viewOf(id)
  return view ? VIEW_META[view].label : id
}

/* ------------------------------------------------------------- re-pointing */

/**
 * The same slot, in another project.
 *
 * Switching project keeps the arrangement and changes which documents fill it,
 * which is a rename of every id rather than a rearrangement — see
 * `dockTree.mapPanes`. A tool belongs to no project and passes through
 * unchanged; an id this cannot read returns null, which drops the pane.
 */
export function rebaseSlot(id: string, projectId: string): SlotId | null {
  if (isToolId(id)) return id
  const view = viewOf(id)
  return view ? makeDocId(projectId, view) : null
}

/**
 * Every slot of one project in canonical order, tools last.
 *
 * `dockTree.restorePane` falls back to this when none of a closed pane's
 * recorded neighbours are still open: it lands next to the nearest slot in this
 * order, which is predictable in a way that picking the largest slot is not.
 */
export function slotOrder(projectId: string): SlotId[] {
  return [...docIdsOf(projectId), ...TOOL_IDS]
}

/* -------------------------------------------------------------- migration */

/**
 * The project id a tree carries before boot has decided which project is open.
 *
 * The layout store is created at module load and the project list is read from
 * IndexedDB, so for the first few frames there is an arrangement but nothing to
 * put in it. Rather than modelling the tree as nullable — which every consumer
 * would then have to handle — it is built against this placeholder and rebased
 * once the real project id is known. The panes render the store's starter
 * document in the meantime, which is exactly what they did before any of this.
 */
export const PENDING_PROJECT_ID = 'p_pending'

/** What the pre-document layout called each pane. */
const LEGACY_VIEW: Record<string, ViewKind> = {
  editor: 'dsl',
  sequence: 'sequence',
  arch: 'arch',
  schema: 'schema',
}

/**
 * A pane name from a stored layout, as a slot id of `projectId`.
 *
 * Total rather than partial: `dockTree.migrate` only ever passes the five names
 * the old format could hold, and an unreadable one is better landed on the DSL
 * than dropped silently.
 */
export function legacySlotId(legacy: string, projectId: string): SlotId {
  if (isToolId(legacy)) return legacy
  return makeDocId(projectId, LEGACY_VIEW[legacy] ?? 'dsl')
}
