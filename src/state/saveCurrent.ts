import { loadProject, saveProject } from '../persist/db'
import { useStore } from './store'

/**
 * Writing the open project to storage, now rather than on the autosave timer.
 *
 * Autosave is debounced and keyed on which project is open, so anything that
 * changes that cancels a pending write — and the last few keystrokes go with
 * it. Every path that switches away has to flush first, which is only safe if
 * there is one flush to call.
 *
 * This used to be the same `StoredProject` literal written out in three places:
 * the autosave effect, the project switcher, and rename. Two of those were one
 * edit away from disagreeing about the field that cannot be derived — a write
 * has to read `createdAt` back before it can preserve it, and a literal that
 * forgets stamps the project as newly created every time it is saved.
 */

/** Read-modify-write, purely so `createdAt` survives. */
export async function writeProject(id: string, name: string, dsl: string): Promise<boolean> {
  const existing = await loadProject(id)
  const now = new Date().toISOString()
  return saveProject({
    version: 1,
    id,
    name,
    dsl,
    createdAt: existing?.createdAt ?? now,
    savedAt: now,
  })
}

/**
 * Flush whatever is open. Resolves `false` when there is nothing to save yet —
 * before IndexedDB hydration finishes there is no project to write into, and a
 * caller switching away from nothing is not an error.
 */
export async function saveCurrent(): Promise<boolean> {
  const { projectId, projectName, text } = useStore.getState()
  if (!projectId) return false
  return writeProject(projectId, projectName, text)
}
