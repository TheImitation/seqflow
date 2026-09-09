import { describe, expect, it } from 'vitest'
import { cloneDoc, moveStepToSlot } from './edit'
import { parse } from './parser'
import { serialize } from './serializer'

const SRC = `sequenceDiagram
  participant A
  participant B
  participant C
  A->>B: one
  A->>B: two
  alt happy
    B-->>A: ok
  else sad (unhappy)
    B-->>A: err
  end
  A->>C: last
`

function move(id: string, slot: { order: number; parentBlock?: string }) {
  const doc = cloneDoc(parse(SRC).doc)
  const target = doc.messages.find((m) => m.label === id)!
  const moved = moveStepToSlot(doc, target.id, slot)
  const out = serialize(doc)
  const round = parse(out)
  expect(round.errors).toEqual([])
  expect(serialize(round.doc)).toBe(out)
  return { moved, out }
}

const blockId = (label: string) => {
  const doc = parse(SRC).doc
  return doc.blocks.find((b) => b.branches?.some((x) => x.label === label))!.id
}

describe('moveStepToSlot', () => {
  it('moves a top-level step later', () => {
    const { moved, out } = move('one', { order: 2 })
    expect(moved).toBe(true)
    expect(out).toContain('  A->>B: two\n  A->>B: one\n  alt happy')
  })

  it('moves a step into a block branch', () => {
    const { moved, out } = move('one', { order: 3, parentBlock: blockId('happy') })
    expect(moved).toBe(true)
    expect(out).toContain('  alt happy\n    B-->>A: ok\n    A->>B: one\n  else sad')
  })

  it('moves a step out of a block to the top level', () => {
    const { moved, out } = move('err', { order: 0 })
    expect(moved).toBe(true)
    // It becomes the first step, ahead of everything that was there.
    const steps = out.split('\n').filter((l) => l.trim() && !l.includes('participant') && l !== 'sequenceDiagram')
    expect(steps[0]).toBe('  B-->>A: err')
    // The branch it left is now empty but still well-formed.
    expect(out).toContain('else sad (unhappy)\n  end')
  })

  it('moves between branches of the same alt', () => {
    const { moved, out } = move('ok', { order: 4, parentBlock: blockId('sad') })
    expect(moved).toBe(true)
    expect(out).toContain('  alt happy\n  else sad (unhappy)\n    B-->>A: err\n    B-->>A: ok')
  })

  it('treats a drop either side of its own position as a no-op', () => {
    const doc = cloneDoc(parse(SRC).doc)
    const two = doc.messages.find((m) => m.label === 'two')!
    expect(moveStepToSlot(doc, two.id, { order: two.order })).toBe(false)
    expect(moveStepToSlot(doc, two.id, { order: two.order + 1 })).toBe(false)
    expect(serialize(doc)).toBe(serialize(parse(SRC).doc))
  })

  it('moves a note as readily as a message', () => {
    const doc = cloneDoc(
      parse('sequenceDiagram\n  A->>B: one\n  Note over A,B: hi\n  A->>B: two\n').doc,
    )
    expect(moveStepToSlot(doc, doc.notes[0].id, { order: 0 })).toBe(true)
    const out = serialize(doc)
    expect(parse(out).errors).toEqual([])
    expect(out).toContain('  Note over A,B: hi\n  A->>B: one\n  A->>B: two')
  })
})
