import { create } from 'zustand'
import { inferArchitecture, type ArchGraph } from '../dsl/architecture'
import type { SequenceDoc } from '../dsl/ast'
import { cloneDoc } from '../dsl/edit'
import { parse, type ParseIssue } from '../dsl/parser'
import { serialize } from '../dsl/serializer'
import type { ProjectSummary } from '../persist/db'
import { defaultDsl } from '../templates/patterns'

export type Selection =
  | { type: 'message'; id: string }
  | { type: 'participant'; id: string }
  | { type: 'block'; id: string; branchIndex?: number }
  | { type: 'note'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'contract'; name: string }
  | { type: 'model'; name: string }
  | { type: 'table'; name: string }

export type TextSource = 'editor' | 'canvas' | 'command'

export interface PlaybackState {
  playing: boolean
  index: number
  /** Steps per second. */
  speed: number
  /** blockId -> which `alt` branch playback walks. */
  branchChoice: Record<string, number>
}

const HISTORY_LIMIT = 120
/** Keystrokes closer together than this coalesce into one undo entry. */
const COALESCE_MS = 600

interface Derived {
  doc: SequenceDoc
  errors: ParseIssue[]
  warnings: ParseIssue[]
  arch: ArchGraph
}

function derive(text: string): Derived {
  const { doc, errors, warnings } = parse(text)
  return { doc, errors, warnings, arch: inferArchitecture(doc) }
}

export interface AppState extends Derived {
  text: string
  selection: Selection | null
  /**
   * Where a shift-click range started. Held separately from `selection` so the
   * focused item stays the thing the inspector edits, while the range is what
   * "wrap in a block" acts on.
   */
  anchorId: string | null
  /** Message the unhappy-path dialog is open for, if any. */
  suggestingFor: string | null
  /**
   * Message ids of the outcome being traced, or null. Everything off the set
   * dims in both canvases. Held as a set of ids rather than a branch choice so
   * a reparse cannot silently retarget it — a stale id simply matches nothing.
   */
  focusPath: { id: string; messageIds: Set<string> } | null
  archDirection: 'LR' | 'TB'
  schemaDirection: 'LR' | 'TB'
  playback: PlaybackState
  past: string[]
  future: string[]
  lastEditAt: number
  /** Set once IndexedDB has been read, so autosave never clobbers on boot. */
  hydrated: boolean

  /* ------------------------------------------------------------- projects */
  /** Id of the project autosave writes to. Null until hydration finishes. */
  projectId: string | null
  projectName: string
  /** Every stored project, for the switcher and the explorer. */
  projects: ProjectSummary[]
  /**
   * The text as storage last saw it, so "unsaved" is a comparison rather than a
   * flag that has to be cleared correctly from three places. Null until the
   * first write of a session — the explorer treats that as clean, because
   * autosave is 600ms away and a project is not dirty for having been opened.
   */
  savedText: string | null

  setText: (text: string, source?: TextSource) => void
  /**
   * The canvas-edit path: mutate a draft AST, then re-serialize. Both views
   * always come back out of the same document.
   *
   * Message, block and note ids are positional — a reparse renumbers them — so
   * an id captured inside `fn` is stale by the time it returns. `after` runs
   * against the freshly parsed doc, which is where anything that needs to
   * select what it just created should look it up by position.
   */
  mutate: (fn: (draft: SequenceDoc) => void, after?: (doc: SequenceDoc) => void) => void
  replaceDoc: (doc: SequenceDoc) => void

  undo: () => void
  redo: () => void

  /** Used by "Play from here", which jumps to a step and starts. */
  play: () => void
  select: (selection: Selection | null) => void
  /** Shift-click: keep the anchor, move the focus. */
  extendSelection: (selection: Selection) => void
  setArchDirection: (direction: 'LR' | 'TB') => void
  setSchemaDirection: (direction: 'LR' | 'TB') => void
  setSuggestingFor: (messageId: string | null) => void
  setFocusPath: (path: { id: string; messageIds: string[] } | null) => void

  pause: () => void
  togglePlay: () => void
  setStep: (index: number) => void
  setSpeed: (speed: number) => void
  setBranchChoice: (blockId: string, branchIndex: number) => void
  resetPlayback: () => void

  setProjects: (projects: ProjectSummary[]) => void
  /** Called after a successful write, with the text that was written. */
  markSaved: (text: string) => void
  /** Point the session at a project and load its text, without touching disk. */
  openProject: (project: { id: string; name: string; dsl: string }) => void
  renameProject: (name: string) => void
}

const INITIAL_TEXT = defaultDsl()

export const useStore = create<AppState>((set, get) => ({
  text: INITIAL_TEXT,
  ...derive(INITIAL_TEXT),
  selection: null,
  anchorId: null,
  suggestingFor: null,
  focusPath: null,
  // A tall narrow pane suits a top-to-bottom graph; LR is one click away.
  archDirection: 'TB',
  // Same reasoning as archDirection — also the more conventional ERD layout.
  schemaDirection: 'TB',
  playback: { playing: false, index: -1, speed: 1.4, branchChoice: {} },
  past: [],
  future: [],
  lastEditAt: 0,
  hydrated: false,
  projectId: null,
  projectName: 'Untitled',
  projects: [],
  savedText: null,

  setText: (text, source = 'editor') => {
    const state = get()
    if (text === state.text) return

    const now = Date.now()
    const coalesce = source === 'editor' && now - state.lastEditAt < COALESCE_MS
    const past = coalesce
      ? state.past
      : [...state.past, state.text].slice(-HISTORY_LIMIT)

    const next = derive(text)
    set({
      text,
      ...next,
      past,
      future: [],
      lastEditAt: now,
      ...prunedFor(state, next.doc),
      playback: clampPlayback(state.playback, next.doc),
    })
  },

  mutate: (fn, after) => {
    const draft = cloneDoc(get().doc)
    fn(draft)
    get().setText(serialize(draft), 'canvas')
    after?.(get().doc)
  },

  replaceDoc: (doc) => get().setText(serialize(doc), 'canvas'),

  undo: () => {
    const state = get()
    if (!state.past.length) return
    const previous = state.past[state.past.length - 1]
    const next = derive(previous)
    set({
      text: previous,
      ...next,
      past: state.past.slice(0, -1),
      future: [state.text, ...state.future].slice(0, HISTORY_LIMIT),
      lastEditAt: 0,
      ...prunedFor(state, next.doc),
      playback: clampPlayback(state.playback, next.doc),
    })
  },

  redo: () => {
    const state = get()
    if (!state.future.length) return
    const [head, ...rest] = state.future
    const next = derive(head)
    set({
      text: head,
      ...next,
      past: [...state.past, state.text].slice(-HISTORY_LIMIT),
      future: rest,
      lastEditAt: 0,
      ...prunedFor(state, next.doc),
      playback: clampPlayback(state.playback, next.doc),
    })
  },

  select: (selection) =>
    set({ selection, anchorId: anchorFor(selection) }),

  extendSelection: (selection) =>
    set((s) => ({
      selection,
      anchorId: s.anchorId ?? anchorFor(selection),
    })),

  setArchDirection: (archDirection) => set({ archDirection }),
  setSchemaDirection: (schemaDirection) => set({ schemaDirection }),
  setSuggestingFor: (suggestingFor) => set({ suggestingFor }),
  setFocusPath: (path) =>
    set({
      focusPath: path ? { id: path.id, messageIds: new Set(path.messageIds) } : null,
    }),

  play: () => set((s) => ({ playback: { ...s.playback, playing: true } })),
  pause: () => set((s) => ({ playback: { ...s.playback, playing: false } })),
  togglePlay: () =>
    set((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } })),
  setStep: (index) => set((s) => ({ playback: { ...s.playback, index } })),
  setSpeed: (speed) => set((s) => ({ playback: { ...s.playback, speed } })),
  setBranchChoice: (blockId, branchIndex) =>
    set((s) => ({
      playback: {
        ...s.playback,
        index: -1,
        branchChoice: { ...s.playback.branchChoice, [blockId]: branchIndex },
      },
    })),
  resetPlayback: () =>
    set((s) => ({ playback: { ...s.playback, playing: false, index: -1 } })),

  setProjects: (projects) => set({ projects }),

  markSaved: (savedText) => set({ savedText }),

  openProject: ({ id, name, dsl }) => {
    const next = derive(dsl)
    set({
      text: dsl,
      ...next,
      projectId: id,
      projectName: name,
      // Freshly loaded text *is* what storage holds.
      savedText: dsl,
      // History is per-project: undoing across a switch would write one
      // project's text into another.
      past: [],
      future: [],
      lastEditAt: 0,
      selection: null,
      anchorId: null,
      suggestingFor: null,
      playback: { playing: false, index: -1, speed: get().playback.speed, branchChoice: {} },
      hydrated: true,
    })
  },

  renameProject: (projectName) => set({ projectName }),

}))

/* ----------------------------------------------------------------- helpers */

/** Only message and block ids can anchor a range; everything else clears it. */
function anchorFor(selection: Selection | null): string | null {
  if (selection?.type === 'message' || selection?.type === 'block') return selection.id
  return null
}

/**
 * A reparse can delete what was selected or open in a dialog, and renumbers ids
 * so a surviving id may now mean a different element. Selection is checked by
 * existence; the range anchor is collapsed outright, because a stale range
 * would silently make "wrap these steps" act on the wrong ones.
 */
function prunedFor(
  state: AppState,
  doc: SequenceDoc,
): Pick<AppState, 'selection' | 'anchorId' | 'suggestingFor' | 'focusPath'> {
  const selection = pruneSelection(state.selection, doc)
  return {
    selection,
    anchorId: anchorFor(selection),
    suggestingFor:
      state.suggestingFor && doc.messages.some((m) => m.id === state.suggestingFor)
        ? state.suggestingFor
        : null,
    // An edit can add or remove steps on the traced path, so the trace is
    // dropped outright rather than left pointing at a path that no longer runs.
    focusPath: null,
  }
}

/** Drop a selection whose target no longer exists after a reparse. */
function pruneSelection(selection: Selection | null, doc: SequenceDoc): Selection | null {
  if (!selection) return null
  switch (selection.type) {
    case 'message':
      return doc.messages.some((m) => m.id === selection.id) ? selection : null
    case 'participant':
      return doc.participants.some((p) => p.id === selection.id) ? selection : null
    case 'block':
      return doc.blocks.some((b) => b.id === selection.id) ? selection : null
    case 'note':
      return doc.notes.some((n) => n.id === selection.id) ? selection : null
    case 'contract':
      return doc.contracts.some((c) => c.name === selection.name) ? selection : null
    case 'model':
      return doc.dataModels.some((m) => m.name === selection.name) ? selection : null
    case 'table':
      return doc.tables.some((t) => t.name === selection.name) ? selection : null
    case 'edge': {
      const [from, to] = selection.id.split(' ')
      return doc.messages.some((m) => m.from === from && m.to === to) ? selection : null
    }
  }
}

function clampPlayback(playback: PlaybackState, doc: SequenceDoc): PlaybackState {
  if (playback.index >= doc.messages.length) {
    return { ...playback, index: -1, playing: false }
  }
  return playback
}
