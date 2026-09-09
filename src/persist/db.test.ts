import { describe, expect, it } from 'vitest'
import { parse } from '../dsl/parser'
import { PATTERNS } from '../templates/patterns'
import { makeProject, projectFromJson, projectToJson, uniqueProjectName } from './db'

describe('project files', () => {
  const dsl = PATTERNS[1].dsl

  it('round-trips the document unchanged', () => {
    const restored = projectFromJson(projectToJson('My flow', dsl))
    expect(restored.dsl).toBe(dsl)
    expect(restored.name).toBe('My flow')
    expect(restored.version).toBe(1)
    expect(parse(restored.dsl).errors).toEqual([])
  })

  it('accepts a file with no name or timestamp', () => {
    const restored = projectFromJson(JSON.stringify({ dsl: 'sequenceDiagram\n  A->>B: x\n' }))
    expect(restored.name).toBe('Imported project')
    expect(restored.savedAt).toBeTruthy()
  })

  it('regenerates the id so importing twice makes two projects', () => {
    const json = projectToJson('My flow', dsl)
    const a = projectFromJson(json)
    const b = projectFromJson(json)
    expect(a.id).not.toBe(b.id)
    expect(a.name).toBe(b.name)
    // The original creation time is kept; the save time is this import.
    expect(a.createdAt).toBe(JSON.parse(json).createdAt)
  })

  it('rejects a file that is not a project', () => {
    expect(() => projectFromJson('[]')).toThrow(/no `dsl` field/)
    expect(() => projectFromJson('"nope"')).toThrow(/not a SeqFlow project/)
    expect(() => projectFromJson('{"dsl":"x","version":99}')).toThrow(/Unsupported project version/)
    expect(() => projectFromJson('not json')).toThrow()
  })
})

describe('project naming', () => {
  const summaries = (...names: string[]) =>
    names.map((name) => ({ ...makeProject(name, ''), dsl: undefined, version: undefined }) as never)

  it('leaves a free name alone', () => {
    expect(uniqueProjectName(summaries('Other'), 'Order flow')).toBe('Order flow')
  })

  it('numbers a collision, skipping taken numbers', () => {
    expect(uniqueProjectName(summaries('Order flow'), 'Order flow')).toBe('Order flow 2')
    expect(uniqueProjectName(summaries('Order flow', 'Order flow 2'), 'Order flow')).toBe(
      'Order flow 3',
    )
  })

  it('falls back for an empty name', () => {
    expect(uniqueProjectName([], '   ')).toBe('Untitled')
  })
})
