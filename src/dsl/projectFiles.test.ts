import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { serialize } from './serializer'

/**
 * `projects/` is local design work and is gitignored, so a fresh clone has none.
 * When it is present, every `.dsl` in it must parse cleanly and round-trip —
 * which is what stops a hand-written diagram rotting against a grammar change.
 */
const ROOT = join(import.meta.dirname, '..', '..', 'projects')

function dslFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? dslFiles(join(dir, e.name))
      : e.name.endsWith('.dsl')
        ? [join(dir, e.name)]
        : [],
  )
}

const files = dslFiles(ROOT)

describe.skipIf(files.length === 0)('local .dsl project files', () => {
  for (const file of files) {
    const rel = file.slice(ROOT.length + 1)

    it(`${rel} parses with no errors or warnings`, () => {
      const { errors, warnings } = parse(readFileSync(file, 'utf8'))
      // Reported as one object so a failure names the file, not just the line.
      expect({ file: rel, errors, warnings }).toEqual({ file: rel, errors: [], warnings: [] })
    })

    it(`${rel} round-trips`, () => {
      const once = serialize(parse(readFileSync(file, 'utf8')).doc)
      expect(serialize(parse(once).doc)).toBe(once)
    })
  }
})
