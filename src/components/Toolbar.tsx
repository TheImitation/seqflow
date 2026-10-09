import { useRef, useState } from 'react'
import { addParticipant } from '../dsl/edit'
import {
  listProjects,
  projectFromJson,
  saveProject,
  setCurrentProjectId,
  uniqueProjectName,
} from '../persist/db'
import { useStore } from '../state/store'
import { AIPromptBar } from './AIPromptBar'
import { ExportMenu } from './ExportMenu'
import { ProjectMenu } from './ProjectMenu'
import { ViewMenu } from './ViewMenu'
import { TemplateGallery } from './TemplateGallery'

/**
 * AI-assist is the one feature that needs a process beyond the static SPA — a
 * local proxy holding the Anthropic key. A hosted build has no proxy to reach,
 * so the prompt bar would be a button that can only fail. It is on by default
 * in dev and off in a build unless you opt in with VITE_AI_ASSIST=true, which
 * is what you want when self-hosting the app alongside your own proxy.
 */
const AI_ASSIST = import.meta.env.DEV || import.meta.env.VITE_AI_ASSIST === 'true'

export function Toolbar({ onToast }: { onToast: (m: string) => void }) {
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const mutate = useStore((s) => s.mutate)
  const select = useStore((s) => s.select)
  const openProject = useStore((s) => s.openProject)
  const setProjects = useStore((s) => s.setProjects)

  const [galleryOpen, setGalleryOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  // An import becomes its own project — it should never quietly replace what
  // you have open.
  const importProject = async (file: File) => {
    try {
      const parsed = projectFromJson(await file.text())
      const all = await listProjects()
      const project = { ...parsed, name: uniqueProjectName(all, parsed.name) }
      await saveProject(project)
      await setCurrentProjectId(project.id)
      openProject(project)
      setProjects(await listProjects())
      onToast(`Imported “${project.name}”`)
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not read that file.')
    }
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <span>
          Seq<span className="mark">Flow</span>
        </span>
        <span className="sub">sequence ↔ architecture</span>
      </div>

      <ProjectMenu onToast={onToast} />

      <button className="btn" onClick={() => setGalleryOpen(true)}>
        Templates
      </button>

      <button
        className="btn"
        onClick={() => {
          let id = ''
          mutate((draft) => {
            id = addParticipant(draft).id
          })
          if (id) select({ type: 'participant', id })
        }}
        title="Add a participant, then set its kind in the inspector"
      >
        + Participant
      </button>

      <button
        className="btn icon"
        onClick={undo}
        disabled={!past}
        title="Undo (⌘Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        className="btn icon"
        onClick={redo}
        disabled={!future}
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
      >
        ↷
      </button>

      <span className="spacer" />
      {AI_ASSIST && <AIPromptBar onToast={onToast} />}
      <span className="spacer" />

      <button className="btn" onClick={() => fileInput.current?.click()}>
        Import
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importProject(file)
          e.target.value = ''
        }}
      />

      <ExportMenu onToast={onToast} />
      <ViewMenu />

      {galleryOpen && <TemplateGallery onClose={() => setGalleryOpen(false)} />}
    </header>
  )
}
