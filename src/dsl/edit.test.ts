import { describe, expect, it } from 'vitest'
import {
  cloneDoc,
  insertMessage,
  moveParticipant,
  moveStep,
  removeBlock,
  removeMessage,
  removeParticipant,
  renameParticipant,
  reorderParticipant,
} from './edit'
import { parse } from './parser'
import { serialize } from './serializer'

/** Every structural edit must leave text that parses back to itself. */
function apply(src: string, fn: (doc: ReturnType<typeof parse>['doc']) => void): string {
  const doc = cloneDoc(parse(src).doc)
  fn(doc)
  const out = serialize(doc)
  const round = parse(out)
  expect(round.errors).toEqual([])
  expect(serialize(round.doc)).toBe(out)
  return out
}

const NESTED = `sequenceDiagram
  participant A
  participant B
  participant C
  A->>B: one
  alt happy
    B-->>A: ok
    opt retry
      B->>C: nudge
    end
  else sad (unhappy)
    B-->>A: err
  end
  A->>C: last
`

describe('participants', () => {
  it('reorders by index and by delta', () => {
    expect(apply(NESTED, (d) => reorderParticipant(d, 'C', 0))).toContain(
      'participant C\n  participant A',
    )
    expect(apply(NESTED, (d) => moveParticipant(d, 'A', 1))).toContain(
      'participant B\n  participant A',
    )
  })

  it('renames everywhere the id is referenced', () => {
    const out = apply(NESTED, (d) => {
      expect(renameParticipant(d, 'B', 'Backend')).toBe(true)
    })
    // The label followed the id because it had never been customised.
    expect(out).toContain('participant Backend\n')
    expect(out).toContain('A->>Backend: one')
    expect(out).not.toMatch(/(^|[^\w])B([^\w]|$)/m)
  })

  it('keeps a custom label when the id is renamed', () => {
    const out = apply('sequenceDiagram\n  participant B as Backend Service\n  A->>B: hi\n', (d) => {
      expect(renameParticipant(d, 'B', 'Api')).toBe(true)
    })
    expect(out).toContain('participant Api as Backend Service')
    expect(out).toContain('A->>Api: hi')
  })

  it('refuses an id that collides or contains a space', () => {
    const doc = cloneDoc(parse(NESTED).doc)
    expect(renameParticipant(doc, 'B', 'C')).toBe(false)
    expect(renameParticipant(doc, 'B', 'two words')).toBe(false)
    expect(doc.participants.map((p) => p.id)).toEqual(['A', 'B', 'C'])
  })

  it('deleting a participant takes its messages with it', () => {
    const out = apply(NESTED, (d) => removeParticipant(d, 'C'))
    expect(out).not.toContain('C')
    expect(out).not.toContain('nudge')
    expect(out).not.toContain('last')
    expect(out).toContain('opt retry')
    expect(out).toContain('A->>B: one')
  })
})

describe('messages', () => {
  it('inserts inside a block and grows the block range', () => {
    const out = apply(NESTED, (d) => {
      const ok = d.messages.find((m) => m.label === 'ok')!
      insertMessage(d, ok.order + 1, {
        from: 'A',
        to: 'B',
        label: 'extra',
        style: 'sync',
        parentBlock: ok.parentBlock,
      })
    })
    const lines = out.split('\n')
    const okLine = lines.findIndex((l) => l.includes('ok'))
    expect(lines[okLine + 1]).toBe('    A->>B: extra')
    // Still inside the happy branch, i.e. before the `else`.
    expect(lines.findIndex((l) => l.includes('else sad'))).toBeGreaterThan(okLine + 1)
  })

  it('deletes without disturbing surrounding blocks', () => {
    const out = apply(NESTED, (d) => {
      removeMessage(d, d.messages.find((m) => m.label === 'nudge')!.id)
    })
    expect(out).toContain('opt retry')
    expect(out).not.toContain('nudge')
    expect(out).toContain('else sad (unhappy)')
    expect(out).toContain('A->>C: last')
  })

  it('moves a step within its branch and stops at the boundary', () => {
    const doc = cloneDoc(parse(NESTED).doc)
    const ok = doc.messages.find((m) => m.label === 'ok')!
    // `ok` is first in its branch, so it cannot move earlier.
    expect(moveStep(doc, ok.id, -1)).toBe(false)
    // It can swap with the `opt` block that follows it.
    expect(moveStep(doc, ok.id, 1)).toBe(true)

    const out = serialize(doc)
    expect(parse(out).errors).toEqual([])
    const lines = out.split('\n')
    expect(lines.findIndex((l) => l.includes('opt retry'))).toBeLessThan(
      lines.findIndex((l) => l.includes('B-->>A: ok')),
    )
  })

  it('moves a top-level step past a whole block', () => {
    const out = apply(NESTED, (d) => {
      expect(moveStep(d, d.messages.find((m) => m.label === 'one')!.id, 1)).toBe(true)
    })
    const lines = out.split('\n')
    expect(lines.findIndex((l) => l.includes('A->>B: one'))).toBeGreaterThan(
      lines.findIndex((l) => l.includes('end')),
    )
  })
})

describe('blocks', () => {
  it('unwraps, keeping the children in place', () => {
    const out = apply(NESTED, (d) => {
      removeBlock(d, d.blocks.find((b) => b.type === 'opt')!.id, true)
    })
    expect(out).not.toContain('opt retry')
    expect(out).toContain('B->>C: nudge')
    expect(out).toContain('else sad (unhappy)')
  })

  it('deletes the block and everything inside it', () => {
    const out = apply(NESTED, (d) => {
      removeBlock(d, d.blocks.find((b) => b.type === 'alt')!.id, false)
    })
    expect(out).not.toContain('alt')
    expect(out).not.toContain('nudge')
    expect(out).not.toContain('ok')
    expect(out).toContain('A->>B: one')
    expect(out).toContain('A->>C: last')
  })
})
