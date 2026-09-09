import { useEffect, useRef, useState } from 'react'
import {
  deleteProject,
  listProjects,
  loadProject,
  makeProject,
  saveProject,
  setCurrentProjectId,
  uniqueProjectName,
  type ProjectSummary,
} from '../persist/db'
import { useStore } from '../state/store'
import { defaultDsl } from '../templates/patterns'
import { useDismiss } from './useDismiss'

/**
 * Projects live in IndexedDB; this is the only place that creates, switches or
 * removes them. Switching always flushes the open project first, because
 * autosave is debounced and the last few keystrokes may not have landed yet.
 */
export function ProjectMenu({ onToast }: { onToast: (m: string) => void }) {
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
  const projectName = useStore((s) => s.projectName)
  const text = useStore((s) => s.text)
  const openProject = useStore((s) => s.openProject)
  const setProjects = useStore((s) => s.setProjects)
  const renameProject = useStore((s) => s.renameProject)

  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ProjectSummary | null>(null)
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const refresh = async () => setProjects(await listProjects())

  /** Write the open project synchronously, ahead of any switch. */
  const flush = async () => {
    if (!projectId) return
    const existing = await loadProject(projectId)
    await saveProject({
      version: 1,
      id: projectId,
      name: projectName,
      dsl: text,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      savedAt: new Date().toISOString(),
    })
  }

  const switchTo = async (id: string) => {
    if (id === projectId) {
      setOpen(false)
      return
    }
    await flush()
    const target = await loadProject(id)
    if (!target) {
      onToast('That project could not be read.')
      await refresh()
      return
    }
    openProject(target)
    await setCurrentProjectId(id)
    await refresh()
    setOpen(false)
    onToast(`Opened “${target.name}”`)
  }

  const create = async (dsl: string, baseName: string) => {
    await flush()
    const all = await listProjects()
    const project = makeProject(uniqueProjectName(all, baseName), dsl)
    await saveProject(project)
    await setCurrentProjectId(project.id)
    openProject(project)
    await refresh()
    setOpen(false)
    onToast(`Created “${project.name}”`)
  }

  const remove = async (target: ProjectSummary) => {
    await deleteProject(target.id)
    const all = await listProjects()
    setProjects(all)
    setConfirmDelete(null)
    setOpen(false)

    if (target.id !== projectId) {
      onToast(`Deleted “${target.name}”`)
      return
    }
    // Deleting the open one has to leave something open.
    const next = all[0] ? await loadProject(all[0].id) : null
    if (next) {
      openProject(next)
      await setCurrentProjectId(next.id)
    } else {
      const fresh = makeProject('Untitled', defaultDsl())
      await saveProject(fresh)
      await setCurrentProjectId(fresh.id)
      openProject(fresh)
      setProjects(await listProjects())
    }
    onToast(`Deleted “${target.name}”`)
  }

  return (
    <div className="dropdown" ref={host}>
      <button
        className={`btn project-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Switch, create or delete a project"
      >
        <span className="project-name">{projectName}</span>
        <span style={{ color: 'var(--text-faint)' }}>▾</span>
      </button>

      {open && (
        <div className="menu" style={{ left: 0, right: 'auto', minWidth: 288 }} role="menu">
          <div className="group-label">
            Projects{projects.length ? ` (${projects.length})` : ''}
          </div>

          {!projects.length && (
            <div className="ctx-label" style={{ textTransform: 'none', letterSpacing: 0 }}>
              Nothing saved yet.
            </div>
          )}

          {projects.map((p) => (
            <div key={p.id} className="project-row">
              <button className="project-open" onClick={() => void switchTo(p.id)}>
                <span className="ctx-tick">{p.id === projectId ? '✓' : ''}</span>
                <span className="ctx-text">{p.name}</span>
                <small>{relative(p.savedAt)}</small>
              </button>
              <button
                className="btn ghost sm danger"
                title={`Delete “${p.name}”`}
                aria-label={`Delete ${p.name}`}
                onClick={() => setConfirmDelete(p)}
              >
                ✕
              </button>
            </div>
          ))}

          <div className="divider" />
          <button onClick={() => void create(defaultDsl(), 'Untitled')}>
            New project <small>from the starter</small>
          </button>
          <button onClick={() => void create('sequenceDiagram\n', 'Blank')}>
            New blank project
          </button>
          <button onClick={() => void create(text, `${projectName} copy`)}>
            Duplicate this one
          </button>
          <button
            onClick={() => {
              setRenaming(true)
              setOpen(false)
            }}
          >
            Rename…
          </button>
        </div>
      )}

      {renaming && (
        <RenameDialog
          current={projectName}
          onClose={() => setRenaming(false)}
          onSave={async (name) => {
            renameProject(name)
            if (projectId) {
              const existing = await loadProject(projectId)
              if (existing) await saveProject({ ...existing, name, savedAt: new Date().toISOString() })
            }
            await refresh()
            setRenaming(false)
            onToast(`Renamed to “${name}”`)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDelete
          project={confirmDelete}
          isCurrent={confirmDelete.id === projectId}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove(confirmDelete)}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- dialogs */

function RenameDialog({
  current,
  onClose,
  onSave,
}: {
  current: string
  onClose: () => void
  onSave: (name: string) => void
}) {
  useDismiss(onClose)
  const [name, setName] = useState(current)
  const trimmed = name.trim()

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }} role="dialog" aria-label="Rename project">
        <header>
          <h2>Rename project</h2>
        </header>
        <div className="body">
          <label className="field">
            <span>NAME</span>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmed) onSave(trimmed)
              }}
            />
          </label>
        </div>
        <footer>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!trimmed} onClick={() => onSave(trimmed)}>
            Rename
          </button>
        </footer>
      </div>
    </div>
  )
}

function ConfirmDelete({
  project,
  isCurrent,
  onCancel,
  onConfirm,
}: {
  project: ProjectSummary
  isCurrent: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useDismiss(onCancel)

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 440 }} role="alertdialog" aria-label="Delete project">
        <header>
          <h2>Delete “{project.name}”?</h2>
        </header>
        <div className="body">
          <p className="hint">
            This removes it from browser storage and cannot be undone. Export it first if
            you want a copy.
            {isCurrent && (
              <>
                <br />
                <br />
                It is the project you have open, so another one will be opened in its
                place.
              </>
            )}
          </p>
        </div>
        <footer>
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger-solid" onClick={onConfirm}>
            Delete
          </button>
        </footer>
      </div>
    </div>
  )
}

function relative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
