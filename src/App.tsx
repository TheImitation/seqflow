import { useCallback, useEffect, useMemo, useState } from 'react'
import { ContractInspector } from './contracts/ContractInspector'
import { UnhappyPathDialog } from './contracts/UnhappyPathDialog'
import {
  getCurrentProjectId,
  listProjects,
  loadProject,
  makeProject,
  saveProject,
  setCurrentProjectId,
} from './persist/db'
import { usePlaybackControls, usePlaybackSteps } from './playback/usePlayback'
import { ArchitectureCanvas } from './render/ArchitectureCanvas'
import { SchemaCanvas } from './render/SchemaCanvas'
import { SequenceCanvas } from './render/SequenceCanvas'
import { writeProject } from './state/saveCurrent'
import { useStore } from './state/store'
import { Editor } from './components/Editor'
import { Explorer } from './components/Explorer'
import { PlaybackBar } from './components/PlaybackBar'
import { DockView } from './components/DockView'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { ExplorerRail, PaneCloseButton, PaneRail } from './components/PaneRail'
import { isBackgroundTab, paneIds, usePanels, type SlotId } from './state/panels'
import {
  describeSlot,
  fileNameOf,
  isToolId,
  makeDocId,
  slotForKey,
  viewOf,
} from './state/docId'
import { projectsWithOpenTabs } from './state/explorerTree'
import type { MenuDeps } from './components/menus'

const AUTOSAVE_MS = 600

export default function App() {
  const text = useStore((s) => s.text)
  const hydrated = useStore((s) => s.hydrated)
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)

  const closed = usePanels((s) => s.closed)
  const explorerOpen = usePanels((s) => s.explorerOpen)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [saved, setSaved] = useState<string | null>(null)
  const [revealLine, setRevealLine] = useState<number | undefined>()

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list, { id, text: message }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200)
  }, [])

  /* -------------------------------------------------- shared menu context */
  const mutate = useStore((s) => s.mutate)
  const select = useStore((s) => s.select)
  const setBranchChoice = useStore((s) => s.setBranchChoice)
  const setSuggestingFor = useStore((s) => s.setSuggestingFor)
  const setStep = useStore((s) => s.setStep)
  const pause = useStore((s) => s.pause)
  const play = useStore((s) => s.play)
  const steps = usePlaybackSteps()
  const suggestingFor = useStore((s) => s.suggestingFor)

  const copy = useCallback(
    (text: string, what: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => toast(`Copied ${what}`))
        .catch(() => toast('The browser blocked clipboard access.'))
    },
    [toast],
  )

  const playFrom = useCallback(
    (messageId: string) => {
      const at = steps.findIndex((s) => s.message.id === messageId)
      if (at < 0) {
        toast('That step is not on the branch playback is walking.')
        return
      }
      pause()
      setStep(at)
      play()
    },
    [steps, pause, setStep, play, toast],
  )

  // `range` is filled in per-canvas, where the current selection is known.
  const menuDeps = useMemo<MenuDeps>(
    () => ({
      doc,
      mutate,
      select,
      toast,
      copy,
      playFrom,
      setBranchChoice,
      suggestFor: setSuggestingFor,
      // Opens or brings forward — never closes. "Reveal in sequence" used to
      // only select, which did nothing you could see with the sequence closed.
      openView: (view) => {
        const panels = usePanels.getState()
        panels.openDoc(makeDocId(panels.projectId, view))
      },
      range: null,
    }),
    [doc, mutate, select, toast, copy, playFrom, setBranchChoice, setSuggestingFor],
  )

  /* --------------------------------------------------------------- persist */
  const openProject = useStore((s) => s.openProject)
  const setProjects = useStore((s) => s.setProjects)
  const projectId = useStore((s) => s.projectId)
  const projectName = useStore((s) => s.projectName)

  const refreshProjects = useCallback(
    () => listProjects().then(setProjects),
    [setProjects],
  )

  /**
   * Boot: reopen whatever was last active, or promote the starter diagram into
   * a real project so there is always something to save into.
   *
   * The workspace is rebased onto whatever wins, which is the step that makes
   * the persisted arrangement mean anything: it was saved holding *some*
   * project's document ids, and until they are re-pointed at the project now
   * open, every tab names a document that is not the one on screen. The tree's
   * own project is consulted first — it is the arrangement the user last saw —
   * and only then the separately stored "current project".
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [id, all] = await Promise.all([getCurrentProjectId(), listProjects()])
      if (cancelled) return
      setProjects(all)

      const live = new Set(all.map((p) => p.id))
      const docked = [...projectsWithOpenTabs(paneIds(usePanels.getState().root))].find((p) =>
        live.has(p),
      )

      const candidates = [docked, id, all[0]?.id].filter(
        (candidate): candidate is string => !!candidate && live.has(candidate),
      )
      let opened: Awaited<ReturnType<typeof loadProject>> = null
      for (const candidate of candidates) {
        opened = await loadProject(candidate)
        if (opened) break
      }
      if (cancelled) return

      if (opened) {
        openProject(opened)
        usePanels.getState().rebaseTo(opened.id)
        void setCurrentProjectId(opened.id)
        return
      }

      const created = makeProject('My first diagram', useStore.getState().text)
      await saveProject(created)
      await setCurrentProjectId(created.id)
      if (cancelled) return
      openProject(created)
      usePanels.getState().rebaseTo(created.id)
      void refreshProjects()
    })()
    return () => {
      cancelled = true
    }
  }, [openProject, setProjects, refreshProjects])

  useEffect(() => {
    if (!hydrated || !projectId) return
    setSaved('saving…')
    const handle = setTimeout(() => {
      void (async () => {
        const ok = await writeProject(projectId, projectName, text)
        setSaved(
          ok
            ? `saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'browser storage unavailable',
        )
        if (ok) {
          // What storage now holds, which is what the explorer's dirty dot is
          // a comparison against.
          useStore.getState().markSaved(text)
          void refreshProjects()
        }
      })()
    }, AUTOSAVE_MS)
    return () => clearTimeout(handle)
  }, [text, hydrated, projectId, projectName, refreshProjects])

  /* ---------------------------------------- canvas selection -> editor line */
  useEffect(() => {
    if (!selection) return
    const line = (() => {
      switch (selection.type) {
        case 'message':
          return doc.messages.find((m) => m.id === selection.id)?.sourceLine
        case 'participant':
          return doc.participants.find((p) => p.id === selection.id)?.sourceLine
        case 'block':
          return doc.blocks.find((b) => b.id === selection.id)?.sourceLine
        case 'note':
          return doc.notes.find((n) => n.id === selection.id)?.sourceLine
        case 'contract':
          return doc.contracts.find((c) => c.name === selection.name)?.sourceLine
        case 'model':
          return doc.dataModels.find((m) => m.name === selection.name)?.sourceLine
        case 'table':
          return doc.tables.find((t) => t.name === selection.name)?.sourceLine
        default:
          return undefined
      }
    })()
    if (line) setRevealLine(line)
  }, [selection, doc])

  /* ------------------------------------------------------------- shortcuts */
  const controls = usePlaybackControls()
  /* -------------------------------------------------------- panel shortcuts */
  /**
   * ⌘1-4 and ⌘B mean `reach` — closed opens, a background tab comes to the
   * front, and only a pane already showing closes. The View menu means the
   * same thing, which is why it lives on the store rather than here.
   *
   * The one thing added here is the caret: these shortcuts deliberately fire
   * while typing, so a pane the caret is inside is never closed by one — ⌘1
   * would otherwise close the editor mid-sentence.
   */
  const reachPanel = useCallback((id: SlotId) => {
    const { root, reach } = usePanels.getState()
    const showing = paneIds(root).includes(id) && !isBackgroundTab(root, id)
    const focused = document.activeElement?.closest?.('.dock-pane') as HTMLElement | null
    if (showing && focused?.dataset.pane === id) return
    reach(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          !!target.closest('.cm-editor'))

      const mod = e.metaKey || e.ctrlKey

      // Panel shortcuts work while typing, the way VS Code's do. A key names a
      // *view* — "the schema of whatever is open" — so it is resolved against
      // the project the workspace currently holds.
      if (mod && !e.shiftKey && !e.altKey) {
        const slot = slotForKey(e.key)
        const project = usePanels.getState().projectId
        if (slot) {
          e.preventDefault()
          reachPanel(isToolId(slot) ? slot : makeDocId(project, slot))
          return
        }
      }

      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (typing) return

      if (e.key === ' ') {
        e.preventDefault()
        controls.toggle()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        controls.forward()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        controls.back()
      } else if (e.key === 'Escape') {
        useStore.getState().select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controls, undo, redo, reachPanel])

  /* ------------------------------------------------------------ pane content */
  /**
   * What goes in a slot. `DockView` positions these; none of them knows or
   * cares where it ended up, which is what keeps the tree out of the panes.
   *
   * Dispatched on the *view*, not the document: only one project is open at a
   * time, so `arch` means the architecture of the open project and the panes
   * read it straight from the doc store, exactly as they did when a slot was a
   * fixed pane. The document id only decides which slot is which.
   */
  const renderPane = useCallback(
    (id: SlotId): React.ReactNode => {
      if (isToolId(id)) return <ContractInspector />
      switch (viewOf(id)) {
        case 'dsl':
          return (
            <section className="pane">
              <div className="pane-head">
                <span className="pane-title">DSL</span>
                <span className="spacer" />
                <span className="pane-sub">source of truth</span>
                <PaneCloseButton view="dsl" />
              </div>
              <div className="pane-body">
                <Editor revealLine={revealLine} />
              </div>
            </section>
          )
        case 'sequence':
          return <SequenceCanvas menuDeps={menuDeps} />
        case 'arch':
          return <ArchitectureCanvas menuDeps={menuDeps} />
        case 'schema':
          return <SchemaCanvas />
        default:
          return null
      }
    },
    [menuDeps, revealLine],
  )

  /** A tab says `platform-spine.arch`; a tool says what it is. */
  const labelOf = useCallback(
    (id: SlotId) => {
      const view = viewOf(id)
      return view ? fileNameOf(projectName, view) : describeSlot(id)
    },
    [projectName],
  )

  const closedPanels = closed.map((spec) => spec.pane)

  return (
    <div className="app">
      <Toolbar onToast={toast} />

      <div className="workspace">
        {explorerOpen ? <Explorer onToast={toast} /> : <ExplorerRail />}
        <DockView renderPane={renderPane} labelOf={labelOf} />
        {closedPanels.length > 0 && (
          <div className="rail-strip">
            {closedPanels.map((id) => (
              <PaneRail key={id} id={id} />
            ))}
          </div>
        )}
      </div>

      <PlaybackBar />
      <StatusBar saved={saved} onGoToLine={setRevealLine} />

      {suggestingFor && (
        <UnhappyPathDialog
          message={doc.messages.find((m) => m.id === suggestingFor)!}
          onClose={() => setSuggestingFor(null)}
          onApplied={toast}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
