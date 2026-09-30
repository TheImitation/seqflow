import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '../persist/db'
import { makeDocId } from './docId'
import {
  buildExplorerTree,
  expandedForReveal,
  projectsWithOpenTabs,
  sortProjects,
  type ExplorerInput,
} from './explorerTree'

/** `savedAt` descending is the order `listProjects()` actually returns. */
const project = (id: string, name: string, savedAt = '2026-01-01T00:00:00.000Z'): ProjectSummary => ({
  id,
  name,
  createdAt: '2025-01-01T00:00:00.000Z',
  savedAt,
})

const PROJECTS = [
  project('p_b', 'Beta flow', '2026-03-03T00:00:00.000Z'),
  project('p_a', 'Alpha flow', '2026-01-01T00:00:00.000Z'),
]

const input = (over: Partial<ExplorerInput> = {}): ExplorerInput => ({
  projects: PROJECTS,
  openIds: new Set(),
  activeId: null,
  expanded: new Set(),
  dirtyProjects: new Set(),
  ...over,
})

describe('sortProjects', () => {
  it('sorts by name, not by when it was last saved', () => {
    // The input is savedAt-descending, which is what listProjects() gives.
    expect(sortProjects(PROJECTS).map((p) => p.name)).toEqual(['Alpha flow', 'Beta flow'])
  })

  it('sorts numbers the way a reader reads them', () => {
    const numbered = ['09 Nine', '10 Ten', '1 One', '2 Two'].map((n, i) => project(`p${i}`, n))
    expect(sortProjects(numbered).map((p) => p.name)).toEqual([
      '1 One',
      '2 Two',
      '09 Nine',
      '10 Ten',
    ])
  })

  it('does not mutate its input', () => {
    const before = PROJECTS.map((p) => p.name)
    sortProjects(PROJECTS)
    expect(PROJECTS.map((p) => p.name)).toEqual(before)
  })
})

describe('buildExplorerTree', () => {
  it('lists one row per project when nothing is expanded', () => {
    const rows = buildExplorerTree(input())
    expect(rows.map((r) => r.label)).toEqual(['Alpha flow', 'Beta flow'])
    expect(rows.every((r) => r.kind === 'project' && r.depth === 0)).toBe(true)
  })

  it('adds the four files under an expanded project', () => {
    const rows = buildExplorerTree(input({ expanded: new Set(['p_a']) }))
    expect(rows.map((r) => r.label)).toEqual([
      'Alpha flow',
      'alpha-flow.dsl',
      'alpha-flow.sequence',
      'alpha-flow.arch',
      'alpha-flow.schema',
      'Beta flow',
    ])
    expect(rows.filter((r) => r.kind === 'file').every((r) => r.depth === 1)).toBe(true)
  })

  it('lists every file whether or not any of them are open', () => {
    // The point of the explorer: closing a tab closes the view, not the file.
    const rows = buildExplorerTree(input({ expanded: new Set(['p_a']) }))
    expect(rows.filter((r) => r.kind === 'file')).toHaveLength(4)
    expect(rows.filter((r) => r.open)).toHaveLength(0)
  })

  it('marks the open files and counts them on the folder', () => {
    const rows = buildExplorerTree(
      input({
        expanded: new Set(['p_a']),
        openIds: new Set([makeDocId('p_a', 'dsl'), makeDocId('p_a', 'arch')]),
      }),
    )
    const folder = rows.find((r) => r.key === 'p_a')!
    expect(folder.openCount).toBe(2)
    expect(folder.open).toBe(true)
    expect(rows.filter((r) => r.open && r.kind === 'file').map((r) => r.view)).toEqual([
      'dsl',
      'arch',
    ])
  })

  it('counts open files for a collapsed project too', () => {
    const rows = buildExplorerTree(input({ openIds: new Set([makeDocId('p_b', 'schema')]) }))
    expect(rows.find((r) => r.key === 'p_b')!.openCount).toBe(1)
  })

  it('marks exactly one row active', () => {
    const active = makeDocId('p_a', 'sequence')
    const rows = buildExplorerTree(
      input({ expanded: new Set(['p_a']), openIds: new Set([active]), activeId: active }),
    )
    expect(rows.filter((r) => r.active).map((r) => r.docId)).toEqual([active])
  })

  it('never marks a project row active, because a folder is not a tab', () => {
    const rows = buildExplorerTree(input({ activeId: makeDocId('p_a', 'dsl') }))
    expect(rows.filter((r) => r.kind === 'project').every((r) => !r.active)).toBe(true)
  })

  it('flags the derived views, and only the schema as read-only', () => {
    const rows = buildExplorerTree(input({ expanded: new Set(['p_a']) }))
    const byView = Object.fromEntries(
      rows.filter((r) => r.kind === 'file').map((r) => [r.view, r]),
    )
    expect(byView.dsl.derived).toBe(false)
    expect(byView.sequence.derived).toBe(false)
    expect(byView.arch.derived).toBe(true)
    expect(byView.schema.derived).toBe(true)

    // The architecture view edits the DSL through its right-click menus, so
    // derived must not imply read-only.
    expect(byView.arch.readOnly).toBe(false)
    expect(byView.schema.readOnly).toBe(true)
  })

  it('puts the dirty dot on the source file, never on a projection', () => {
    const rows = buildExplorerTree(
      input({ expanded: new Set(['p_a']), dirtyProjects: new Set(['p_a']) }),
    )
    expect(rows.filter((r) => r.dirty).map((r) => r.view)).toEqual(['dsl'])
  })

  it('moves the dirty dot to the folder when it is collapsed', () => {
    // Otherwise an unsaved change hides behind a twisty.
    const rows = buildExplorerTree(input({ dirtyProjects: new Set(['p_a']) }))
    const folder = rows.find((r) => r.key === 'p_a')!
    expect(folder.dirty).toBe(true)
  })

  it('gives every row a unique key', () => {
    const rows = buildExplorerTree(input({ expanded: new Set(['p_a', 'p_b']) }))
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('returns nothing at all for an empty workspace', () => {
    expect(buildExplorerTree(input({ projects: [] }))).toEqual([])
  })
})

describe('expandedForReveal', () => {
  it('opens the project a file lives in', () => {
    const next = expandedForReveal(new Set(), makeDocId('p_a', 'arch'))
    expect([...next]).toEqual(['p_a'])
  })

  it('returns the same set when it is already open, so the caller can skip the write', () => {
    const expanded = new Set(['p_a'])
    expect(expandedForReveal(expanded, makeDocId('p_a', 'arch'))).toBe(expanded)
  })

  it('leaves the set alone for an id it cannot read', () => {
    const expanded = new Set(['p_a'])
    expect(expandedForReveal(expanded, 'inspector')).toBe(expanded)
  })
})

describe('projectsWithOpenTabs', () => {
  it('collapses several views of one project to one project', () => {
    const open = [makeDocId('p_a', 'dsl'), makeDocId('p_a', 'arch'), makeDocId('p_b', 'dsl')]
    expect([...projectsWithOpenTabs(open)].sort()).toEqual(['p_a', 'p_b'])
  })

  it('ignores tool panes', () => {
    expect([...projectsWithOpenTabs(['inspector'])]).toEqual([])
  })
})
