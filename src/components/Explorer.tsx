import { useMemo } from 'react'
import { buildExplorerTree, type ExplorerRow } from '../state/explorerTree'
import { paneIds, usePanels } from '../state/panels'
import { switchToProject } from '../state/switchProject'
import { useStore } from '../state/store'

/**
 * The file explorer: every project, and the four views each one has.
 *
 * The rows come from `explorerTree.buildExplorerTree`, which is pure and
 * node-testable; this component does nothing but draw them and turn a click
 * into a store call. That division is the same one `dockTree`/`DockView` make,
 * and for the same reason — ordering, dirty marks and open state are exactly
 * the sort of thing that is quietly wrong and cannot be tested through JSX.
 *
 * A file is listed whether or not it has a tab: **closing a tab closes the
 * view, not the file**. That is the whole point of having an explorer at all,
 * and it is why the dock only ever holds one project's documents — anything
 * else is one click away here, so nothing is lost by not keeping a tab for it.
 */
export function Explorer({ onToast }: { onToast: (message: string) => void }) {
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
  const text = useStore((s) => s.text)
  const savedText = useStore((s) => s.savedText)

  const root = usePanels((s) => s.root)
  const activeId = usePanels((s) => s.activeId)
  const expanded = usePanels((s) => s.expanded)
  const toggleProject = usePanels((s) => s.toggleProject)

  const rows = useMemo(
    () =>
      buildExplorerTree({
        projects,
        openIds: new Set(paneIds(root)),
        activeId,
        expanded: new Set(expanded),
        // Only the open project can differ from storage; the others are
        // whatever was last written, by definition.
        dirtyProjects: new Set(
          projectId && savedText !== null && text !== savedText ? [projectId] : [],
        ),
      }),
    [projects, root, activeId, expanded, projectId, text, savedText],
  )

  /** Open a file, switching project first when it belongs to another one. */
  const openFile = async (row: ExplorerRow) => {
    if (!row.docId) return
    if (row.projectId !== projectId) {
      const opened = await switchToProject(row.projectId)
      if (!opened) {
        onToast('That project could not be read.')
        return
      }
      onToast(`Opened “${opened.name}”`)
    }
    usePanels.getState().reveal(row.docId)
  }

  return (
    <section className="pane explorer">
      <div className="pane-head">
        Explorer
        <span className="spacer" />
        <span className="explorer-count">
          {projects.length} {projects.length === 1 ? 'project' : 'projects'}
        </span>
      </div>

      <div className="pane-body">
        {rows.length === 0 ? (
          <p className="explorer-empty">No projects yet.</p>
        ) : (
          <div className="explorer-rows" role="tree" aria-label="Projects and files">
            {rows.map((row) =>
              row.kind === 'project' ? (
                <button
                  key={row.key}
                  className={`explorer-row project${row.openCount ? ' has-open' : ''}`}
                  role="treeitem"
                  aria-expanded={row.expanded}
                  aria-level={1}
                  onClick={() => toggleProject(row.projectId)}
                  title={row.projectName}
                >
                  <span className="twisty">{row.expanded ? '▾' : '▸'}</span>
                  <span className="explorer-label">{row.label}</span>
                  {/* Collapsed, the folder carries the dot — otherwise an
                      unsaved change hides behind the twisty. */}
                  {row.dirty && <span className="dot" title="Unsaved changes" />}
                  {!row.expanded && row.openCount > 0 && (
                    <span className="open-count" title={`${row.openCount} open`}>
                      {row.openCount}
                    </span>
                  )}
                </button>
              ) : (
                <FileRow key={row.key} row={row} onOpen={() => void openFile(row)} />
              ),
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function FileRow({ row, onOpen }: { row: ExplorerRow; onOpen: () => void }) {
  const hide = usePanels((s) => s.hide)
  const onlyPane = usePanels((s) => paneIds(s.root).length === 1)

  const title = row.readOnly
    ? `${row.label} — derived from the DSL, read-only`
    : row.derived
      ? `${row.label} — derived from the DSL, editable through its right-click menus`
      : row.label

  return (
    <div
      className={[
        'explorer-row file',
        row.open ? 'open' : '',
        row.active ? 'active' : '',
        row.derived ? 'derived' : '',
      ]
        .join(' ')
        .trim()}
      role="treeitem"
      aria-level={2}
      aria-selected={row.active}
    >
      <button className="explorer-open" onClick={onOpen} title={title}>
        <span className="explorer-label">{row.label}</span>
        {row.dirty && <span className="dot" title="Unsaved changes" />}
        {row.readOnly && <span className="ro" title="Read-only">RO</span>}
      </button>

      {row.open && row.docId && (
        <button
          className="explorer-close"
          onClick={() => hide(row.docId!)}
          disabled={onlyPane}
          title={onlyPane ? 'This is the only pane left open' : 'Close this tab'}
          aria-label={`Close ${row.label}`}
        >
          ×
        </button>
      )}
    </div>
  )
}
