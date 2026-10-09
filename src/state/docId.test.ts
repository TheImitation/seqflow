import { describe, expect, it } from 'vitest'
import {
  VIEWS,
  VIEW_META,
  baseName,
  describeSlot,
  docIdsOf,
  fileNameOf,
  isDerived,
  isDocId,
  isSlotId,
  isToolId,
  isViewKind,
  legacySlotId,
  makeDocId,
  minPxOf,
  parseDocId,
  projectOf,
  rebaseSlot,
  shortLabelOf,
  shortcutOf,
  slotForKey,
  slotOrder,
  viewOf,
} from './docId'

/** A realistic project id — `persist/db.ts` mints `p_<base36>_<base36>`. */
const PID = 'p_mtitqdzs_ihhz30'

describe('makeDocId and parseDocId', () => {
  it('round-trips every view', () => {
    for (const view of VIEWS) {
      expect(parseDocId(makeDocId(PID, view)), view).toEqual({ projectId: PID, view })
    }
  })

  it('rejects an id with no separator', () => {
    expect(parseDocId('inspector')).toBeUndefined()
    expect(parseDocId(PID)).toBeUndefined()
  })

  it('rejects a view it does not know', () => {
    expect(parseDocId(`${PID}#timeline`)).toBeUndefined()
  })

  it('rejects an empty project id', () => {
    expect(parseDocId('#arch')).toBeUndefined()
  })

  it('splits on the first separator, so a stray one cannot shift the view', () => {
    // Project ids cannot contain `#`, but a corrupted layout might.
    expect(parseDocId('p_a#b#arch')).toBeUndefined()
  })
})

describe('docIdsOf', () => {
  it('lists every view once, in explorer order', () => {
    expect(docIdsOf(PID)).toEqual([
      `${PID}#dsl`,
      `${PID}#sequence`,
      `${PID}#arch`,
      `${PID}#schema`,
    ])
  })
})

describe('classification', () => {
  it('knows a tool from a document', () => {
    expect(isToolId('inspector')).toBe(true)
    expect(isToolId(`${PID}#dsl`)).toBe(false)
    expect(isDocId(`${PID}#dsl`)).toBe(true)
    expect(isDocId('inspector')).toBe(false)
  })

  it('accepts both as slot ids and nothing else', () => {
    expect(isSlotId('inspector')).toBe(true)
    expect(isSlotId(`${PID}#schema`)).toBe(true)
    expect(isSlotId('editor')).toBe(false)
    expect(isSlotId(42)).toBe(false)
    expect(isSlotId(null)).toBe(false)
    expect(isSlotId(undefined)).toBe(false)
  })

  it('validates a view kind', () => {
    expect(isViewKind('arch')).toBe(true)
    expect(isViewKind('editor')).toBe(false)
  })

  it('reads the project and the view back off an id', () => {
    expect(projectOf(`${PID}#sequence`)).toBe(PID)
    expect(viewOf(`${PID}#sequence`)).toBe('sequence')
    expect(projectOf('inspector')).toBeUndefined()
    expect(viewOf('inspector')).toBeUndefined()
  })
})

describe('isDerived', () => {
  it('marks the two projections and nothing else', () => {
    expect(isDerived(`${PID}#arch`)).toBe(true)
    expect(isDerived(`${PID}#schema`)).toBe(true)
    expect(isDerived(`${PID}#dsl`)).toBe(false)
    expect(isDerived(`${PID}#sequence`)).toBe(false)
  })

  it('treats a tool as not derived rather than throwing', () => {
    expect(isDerived('inspector')).toBe(false)
  })
})

describe('minPxOf', () => {
  it('gives the DSL more room than a canvas', () => {
    expect(minPxOf(`${PID}#dsl`)).toBeGreaterThan(minPxOf(`${PID}#arch`))
  })

  it('gives the inspector the widest floor, as it did as a fixed column', () => {
    const doc = Math.max(...VIEWS.map((v) => VIEW_META[v].minPx))
    expect(minPxOf('inspector')).toBeGreaterThan(doc)
  })

  it('falls back rather than returning NaN for an id it cannot read', () => {
    expect(minPxOf('nonsense')).toBeGreaterThan(0)
  })
})

describe('baseName', () => {
  it('slugs a plain name', () => {
    expect(baseName('Order flow')).toBe('order-flow')
  })

  it('collapses runs of punctuation into one separator', () => {
    expect(baseName('Phase 1 — Ingest')).toBe('phase-1-ingest')
  })

  it('keeps the tail when a name is too long, because names differ at the end', () => {
    // Every agentic-platform project starts "Agentic — ", so truncating the
    // head is what keeps them apart — and it keeps the leading number, which
    // is the part a reader actually navigates by.
    expect(baseName('Agentic — 00 Platform spine')).toBe('00-platform-spine')
    expect(baseName('Agentic — 01 Identity and RBAC')).toBe('01-identity-and-rbac')
  })

  it('never truncates into a leading fragment of a word', () => {
    // A blind slice would give "tic-00-platform-spine"; the cut moves to the
    // next separator instead.
    expect(baseName('Agentic — 00 Platform spine')).not.toMatch(/^[a-z]*-0/)
    expect(baseName('Agentic — 01 Identity and RBAC').startsWith('c-')).toBe(false)
  })

  it('keeps names that share a long prefix distinguishable', () => {
    const names = [
      'Agentic — 00 Platform spine',
      'Agentic — 01 Identity and RBAC',
      'Agentic — 12 Agent subagent handoff',
    ].map((n) => baseName(n))
    expect(new Set(names).size).toBe(names.length)
  })

  it('never returns an empty stem', () => {
    expect(baseName('')).toBe('untitled')
    expect(baseName('!!!')).toBe('untitled')
    expect(baseName('   ')).toBe('untitled')
  })

  it('respects a caller-supplied length', () => {
    expect(baseName('Agentic — 00 Platform spine', 60)).toBe('agentic-00-platform-spine')
  })
})

describe('fileNameOf', () => {
  it('reads as a file name', () => {
    expect(fileNameOf('Order flow', 'arch')).toBe('order-flow.arch')
    expect(fileNameOf('Order flow', 'dsl')).toBe('order-flow.dsl')
  })

  it('gives every view of one project a distinct name', () => {
    const names = VIEWS.map((v) => fileNameOf('Order flow', v))
    expect(new Set(names).size).toBe(VIEWS.length)
  })
})

describe('describeSlot', () => {
  it('names the tool', () => {
    expect(describeSlot('inspector')).toBe('Inspector')
  })

  it('qualifies a document with its project when one is known', () => {
    expect(describeSlot(`${PID}#arch`, 'Order flow')).toBe('Order flow — Architecture')
    expect(describeSlot(`${PID}#arch`)).toBe('Architecture')
  })

  it('returns an unreadable id unchanged rather than inventing a label', () => {
    expect(describeSlot('nonsense')).toBe('nonsense')
  })
})

describe('shortcuts', () => {
  it('maps the keys the README documents', () => {
    expect(slotForKey('1')).toBe('dsl')
    expect(slotForKey('4')).toBe('schema')
    expect(slotForKey('b')).toBe('inspector')
    expect(slotForKey('B')).toBe('inspector')
  })

  it('claims no other key', () => {
    expect(slotForKey('5')).toBeUndefined()
    expect(slotForKey('z')).toBeUndefined()
  })

  it('reads a shortcut off a document id, not just off a view', () => {
    expect(shortcutOf(makeDocId('p_a', 'arch'))).toBe('⌘3')
    expect(shortcutOf('inspector')).toBe('⌘B')
    expect(shortcutOf('nonsense')).toBeUndefined()
  })

  it('gives the short label a tab strip and a menu can fit', () => {
    expect(shortLabelOf(makeDocId('p_a', 'dsl'))).toBe('DSL')
    expect(shortLabelOf('inspector')).toBe('Inspector')
  })
})

describe('rebaseSlot', () => {
  it('moves a document to another project, keeping its view', () => {
    expect(rebaseSlot(makeDocId('p_a', 'arch'), 'p_b')).toBe(makeDocId('p_b', 'arch'))
  })

  it('leaves a tool alone, because it belongs to no project', () => {
    expect(rebaseSlot('inspector', 'p_b')).toBe('inspector')
  })

  it('returns null for an id it cannot read, which drops the pane', () => {
    expect(rebaseSlot('nonsense', 'p_b')).toBeNull()
  })

  it('is idempotent for a document already in that project', () => {
    const id = makeDocId('p_b', 'schema')
    expect(rebaseSlot(id, 'p_b')).toBe(id)
  })
})

describe('slotOrder', () => {
  it('lists the four documents then the tools', () => {
    expect(slotOrder('p_a')).toEqual([...docIdsOf('p_a'), 'inspector'])
  })
})

describe('legacySlotId', () => {
  it('translates the pre-document pane names', () => {
    expect(legacySlotId('editor', 'p_a')).toBe(makeDocId('p_a', 'dsl'))
    expect(legacySlotId('arch', 'p_a')).toBe(makeDocId('p_a', 'arch'))
  })

  it('keeps the inspector a tool rather than making it a file', () => {
    expect(legacySlotId('inspector', 'p_a')).toBe('inspector')
  })

  it('lands an unreadable name on the DSL rather than dropping it', () => {
    expect(legacySlotId('whatever', 'p_a')).toBe(makeDocId('p_a', 'dsl'))
  })
})
