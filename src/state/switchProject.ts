import { loadProject, setCurrentProjectId } from '../persist/db'
import { usePanels } from './panels'
import { saveCurrent } from './saveCurrent'
import { useStore } from './store'

/**
 * Opening another project, everywhere it can happen.
 *
 * Three things have to occur in one order and none of them is optional: flush
 * the open project (autosave is debounced, so the last keystrokes may not have
 * landed), load the target, and re-point the workspace at *its* documents. Miss
 * the flush and you lose edits; miss the rebase and the dock is left holding
 * documents of a project that is no longer open, which renders as tabs whose
 * content belongs to something else.
 *
 * The project menu and the file explorer are both ways of doing the same thing,
 * so the sequence lives here rather than in either of them — the same argument
 * `saveCurrent.ts` makes about the write itself.
 */
export async function switchToProject(id: string): Promise<{ name: string } | null> {
  if (id === useStore.getState().projectId) {
    usePanels.getState().rebaseTo(id)
    return { name: useStore.getState().projectName }
  }

  await saveCurrent()
  const target = await loadProject(id)
  if (!target) return null

  useStore.getState().openProject(target)
  usePanels.getState().rebaseTo(target.id)
  await setCurrentProjectId(target.id)
  return { name: target.name }
}
