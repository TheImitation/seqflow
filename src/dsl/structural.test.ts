import { describe, expect, it } from 'vitest'
import {
  addBranch,
  changeBlockType,
  cloneDoc,
  duplicateMessage,
  reverseMessage,
  wrapInBlock,
} from './edit'
import { parse } from './parser'
import { serialize } from './serializer'
import { buildTree, siblingRun } from './tree'

function apply(src: string, fn: (doc: ReturnType<typeof parse>['doc']) => void): string {
  const doc = cloneDoc(parse(src).doc)
  fn(doc)
  const out = serialize(doc)
  const round = parse(out)
  expect(round.errors).toEqual([])
  expect(serialize(round.doc)).toBe(out)
  return out
}

const FLAT = `sequenceDiagram
  participant A
  participant B
  A->>B: one
  A->>B: two
  A->>B: three
  A->>B: four
`

const NESTED = `sequenceDiagram
  participant A
  participant B
  participant C
  A->>B: before
  alt happy
    B-->>A: ok
    B->>C: side
  else sad (unhappy)
    B-->>A: err
  end
  A->>C: after
`

describe('siblingRun', () => {
  it('spans two top-level messages', () => {
    const doc = parse(FLAT).doc
    const [, two, three] = doc.messages
    expect(siblingRun(buildTree(doc), two.id, three.id)).toEqual({ lo: 1, hi: 3, count: 2 })
  })

  it('is order-independent', () => {
    const doc = parse(FLAT).doc
    const a = doc.messages[3].id
    const b = doc.messages[0].id
    expect(siblingRun(buildTree(doc), a, b)).toEqual({ lo: 0, hi: 4, count: 4 })
  })

  it('spans a message and a whole block at the same level', () => {
    const doc = parse(NESTED).doc
    const before = doc.messages.find((m) => m.label === 'before')!
    const alt = doc.blocks.find((b) => b.type === 'alt')!
    expect(siblingRun(buildTree(doc), before.id, alt.id)).toEqual({
      lo: 0,
      hi: alt.endOrder,
      count: 2,
    })
  })

  it('refuses a run that crosses an else', () => {
    const doc = parse(NESTED).doc
    const ok = doc.messages.find((m) => m.label === 'ok')!
    const err = doc.messages.find((m) => m.label === 'err')!
    expect(siblingRun(buildTree(doc), ok.id, err.id)).toBeUndefined()
  })

  it('refuses a run that escapes its block', () => {
    const doc = parse(NESTED).doc
    const ok = doc.messages.find((m) => m.label === 'ok')!
    const after = doc.messages.find((m) => m.label === 'after')!
    expect(siblingRun(buildTree(doc), ok.id, after.id)).toBeUndefined()
  })
})

describe('wrapInBlock', () => {
  it('wraps a run of top-level messages', () => {
    const out = apply(FLAT, (d) => {
      expect(wrapInBlock(d, 1, 3, 'loop', 'per item').ok).toBe(true)
    })
    expect(out).toBe(`sequenceDiagram
  participant A
  participant B

  A->>B: one
  loop per item
    A->>B: two
    A->>B: three
  end
  A->>B: four
`)
  })

  it('wraps inside a branch without disturbing the outer block', () => {
    const out = apply(NESTED, (d) => {
      const ok = d.messages.find((m) => m.label === 'ok')!
      const side = d.messages.find((m) => m.label === 'side')!
      expect(wrapInBlock(d, ok.order, side.order + 1, 'opt', 'extras').ok).toBe(true)
    })
    expect(out).toContain('  alt happy\n    opt extras\n      B-->>A: ok\n      B->>C: side\n    end\n  else sad (unhappy)')
  })

  it('wraps a message together with a whole block', () => {
    const out = apply(NESTED, (d) => {
      const alt = d.blocks.find((b) => b.type === 'alt')!
      expect(wrapInBlock(d, 0, alt.endOrder, 'loop', 'retry').ok).toBe(true)
    })
    expect(out).toContain('  loop retry\n    A->>B: before\n    alt happy')
    expect(out).toContain('  A->>C: after')
  })

  it('creates one branch when wrapping in an alt', () => {
    const doc = cloneDoc(parse(FLAT).doc)
    wrapInBlock(doc, 0, 2, 'alt', 'first')
    const block = doc.blocks[0]
    expect(block.branches).toEqual([{ label: 'first', startOrder: 0, endOrder: 2 }])
  })

  it('refuses a range that lines up with no sibling level', () => {
    const doc = cloneDoc(parse(NESTED).doc)
    const side = doc.messages.find((m) => m.label === 'side')!
    const err = doc.messages.find((m) => m.label === 'err')!
    // `side` is the last step of the happy branch and `err` the only step of the
    // sad one, so the run straddles the `else`.
    const result = wrapInBlock(doc, side.order, err.order + 1, 'loop', 'x')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/crosses a block boundary/)
    expect(doc.blocks).toHaveLength(1)
  })

  it('lets a raw range that does align through, even across a block', () => {
    // `siblingRun` is the gatekeeper for what the UI offers; `wrapInBlock` only
    // asks that the range line up with whole siblings somewhere. Here [1,5)
    // happens to be exactly `alt` + `after`, which is a legal thing to wrap.
    const doc = cloneDoc(parse(NESTED).doc)
    const ok = doc.messages.find((m) => m.label === 'ok')!
    const after = doc.messages.find((m) => m.label === 'after')!
    expect(siblingRun(buildTree(doc), ok.id, after.id)).toBeUndefined()
    expect(wrapInBlock(doc, ok.order, after.order + 1, 'loop', 'x').ok).toBe(true)
    const out = serialize(doc)
    expect(parse(out).errors).toEqual([])
    expect(out).toContain('  loop x\n    alt happy')
  })

  it('refuses an empty range', () => {
    const doc = cloneDoc(parse(FLAT).doc)
    expect(wrapInBlock(doc, 2, 2, 'opt', 'x').ok).toBe(false)
  })
})

describe('addBranch', () => {
  it('appends an else with a placeholder mirroring the first branch', () => {
    const out = apply(NESTED, (d) => {
      expect(addBranch(d, d.blocks.find((b) => b.type === 'alt')!.id, '500 Error', true)).toBe(true)
    })
    expect(out).toContain('  else sad (unhappy)\n    B-->>A: err\n  else 500 Error (unhappy)\n    B-->>A: 500 Error\n  end')
    expect(out).toContain('  A->>C: after')
  })

  it('keeps the earlier branches intact', () => {
    const doc = cloneDoc(parse(NESTED).doc)
    const alt = doc.blocks.find((b) => b.type === 'alt')!
    addBranch(doc, alt.id, 'third')
    const round = parse(serialize(doc)).doc
    const block = round.blocks.find((b) => b.type === 'alt')!
    expect(block.branches!.map((b) => b.label)).toEqual(['happy', 'sad', 'third'])
    expect(round.messages.filter((m) => m.parentBlock === block.id)).toHaveLength(4)
  })

  it('refuses a non-alt block', () => {
    const doc = cloneDoc(parse('sequenceDiagram\n  opt x\n    A->>B: y\n  end\n').doc)
    expect(addBranch(doc, doc.blocks[0].id, 'else')).toBe(false)
  })
})

describe('changeBlockType', () => {
  it('promotes an opt to an alt with one branch', () => {
    const out = apply('sequenceDiagram\n  opt maybe\n    A->>B: y\n  end\n', (d) => {
      expect(changeBlockType(d, d.blocks[0].id, 'alt')).toBe(true)
    })
    expect(out).toContain('alt maybe')
  })

  it('demotes a single-branch alt to a loop', () => {
    const out = apply('sequenceDiagram\n  alt once\n    A->>B: y\n  end\n', (d) => {
      expect(changeBlockType(d, d.blocks[0].id, 'loop')).toBe(true)
    })
    expect(out).toContain('loop once')
  })

  it('refuses to demote an alt that has branches to lose', () => {
    const doc = cloneDoc(parse(NESTED).doc)
    const alt = doc.blocks.find((b) => b.type === 'alt')!
    expect(changeBlockType(doc, alt.id, 'opt')).toBe(false)
    expect(alt.type).toBe('alt')
  })
})

describe('reverse and duplicate', () => {
  it('swaps endpoints, keeping style and contract', () => {
    const out = apply('sequenceDiagram\n  A->>B: charge @C\n\ncontract C {\n  transport: http\n}\n', (d) => {
      expect(reverseMessage(d, d.messages[0].id)).toBe(true)
    })
    expect(out).toContain('B->>A: charge @C')
  })

  it('refuses to reverse a self-message', () => {
    const doc = cloneDoc(parse('sequenceDiagram\n  A->>A: retry\n').doc)
    expect(reverseMessage(doc, doc.messages[0].id)).toBe(false)
  })

  it('duplicates in place, inside the same block', () => {
    const out = apply(NESTED, (d) => {
      duplicateMessage(d, d.messages.find((m) => m.label === 'ok')!.id)
    })
    expect(out).toContain('  alt happy\n    B-->>A: ok\n    B-->>A: ok\n    B->>C: side')
  })
})
