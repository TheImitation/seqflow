import { describe, expect, it } from 'vitest'
import { inferArchitecture } from '../dsl/architecture'
import { emptyDoc } from '../dsl/ast'
import { parse } from '../dsl/parser'
import { PATTERNS } from '../templates/patterns'
import {
  ALL_SECTIONS,
  buildReport,
  count,
  SECTION_LABEL,
  type ReportBlock,
  type ReportDocument,
  type ReportInput,
  type SectionId,
} from './reportContent'

const GENERATED = new Date('2026-09-08T12:00:00Z')

function report(dsl: string, overrides: Partial<ReportInput> = {}): ReportDocument {
  const doc = parse(dsl).doc
  return buildReport({
    doc,
    arch: inferArchitecture(doc),
    projectName: 'Test project',
    generatedAt: GENERATED,
    sections: ALL_SECTIONS,
    captured: ['sequence', 'architecture', 'schema'],
    ...overrides,
  })
}

const text = (r: ReportDocument): string =>
  r.blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading':
          return b.text
        case 'para':
        case 'callout':
          return b.text
        case 'bullets':
          return b.items.join('\n')
        case 'metrics':
          return b.items.map((m) => `${m.label} ${m.value} ${m.note ?? ''}`).join('\n')
        case 'table':
          return [b.caption ?? '', ...b.head, ...b.rows.flat()].join(' ')
        case 'image':
          return b.caption
      }
    })
    .join('\n')

const tables = (r: ReportDocument) =>
  r.blocks.filter((b): b is Extract<ReportBlock, { kind: 'table' }> => b.kind === 'table')
const captionOf = (r: ReportDocument, caption: string) =>
  tables(r).find((t) => t.caption === caption)

const SIMPLE = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  Client->>API: POST /orders
`

const BRANCHING = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  participant DB as Orders: aws:dynamodb
  contract PlaceOrder {
    transport: http
    method: POST
    path: /orders
    responses:
      200 Created (happy)
      409 Conflict (unhappy)
      503 ServiceUnavailable (unhappy)
  }
  Client->>API: POST /orders @PlaceOrder
  alt 200 Created
    API->>DB: PutItem(order)
  else 409 Conflict (unhappy)
    API-->>Client: rejected
  end
`

describe('buildReport — document shell', () => {
  it('titles the document from the project name', () => {
    const r = report(SIMPLE)
    expect(r.title).toBe('Test project')
    expect(r.subtitle).toBe('Architecture design review')
  })

  it('prefers an explicit document title over the project name', () => {
    expect(report(SIMPLE, { documentTitle: 'Checkout redesign' }).title).toBe('Checkout redesign')
  })

  it('falls back to the project name when the title is blank', () => {
    expect(report(SIMPLE, { documentTitle: '   ' }).title).toBe('Test project')
  })

  it('dates the byline and names the author when given one', () => {
    const r = report(SIMPLE, { author: 'N. Defaux', savedAt: '2026-09-01T09:00:00Z' })
    expect(r.byline).toContain('8 September 2026')
    expect(r.byline).toContain('N. Defaux')
    expect(r.byline).toContain('1 September 2026')
  })

  it('omits the author from the byline when none is given', () => {
    expect(report(SIMPLE).byline).not.toContain('·undefined')
    expect(report(SIMPLE).byline).toContain('Generated')
  })
})

describe('buildReport — section selection', () => {
  it('emits a heading for every requested section', () => {
    const r = report(BRANCHING)
    for (const id of ALL_SECTIONS) {
      expect(text(r)).toContain(SECTION_LABEL[id])
    }
  })

  it('omits the sections that were not asked for', () => {
    const r = report(BRANCHING, { sections: ['glance'] })
    expect(text(r)).toContain(SECTION_LABEL.glance)
    expect(text(r)).not.toContain(SECTION_LABEL.outcomes)
    expect(text(r)).not.toContain(SECTION_LABEL.data)
  })

  it('produces only the shell when no sections are requested', () => {
    const r = report(BRANCHING, { sections: [] })
    expect(r.blocks).toHaveLength(0)
    expect(r.title).toBe('Test project')
  })

  it('still reports stats for a section set that excludes the glance', () => {
    const r = report(BRANCHING, { sections: ['outcomes'] as SectionId[] })
    expect(r.stats.participants).toBe(3)
  })
})

describe('buildReport — at a glance', () => {
  it('counts participants, steps and links from the document', () => {
    const r = report(BRANCHING)
    expect(r.stats.participants).toBe(3)
    expect(r.stats.messages).toBe(3)
    expect(text(r)).toContain('3 participants')
  })

  it('reports coverage as modelled-of-declared, never conflating the two', () => {
    const r = report(BRANCHING)
    expect(r.stats.declaredFailures).toBe(2)
    // 409 is named by a branch; 503 is declared and nothing follows from it.
    expect(r.stats.modelledFailures).toBe(1)
    expect(text(r)).toContain('declared but nothing on the diagram follows from')
  })

  it('says so plainly when nothing declares a failure', () => {
    expect(text(report(SIMPLE))).toContain('No failure responses are declared')
  })

  it('warns in the document when the source did not parse cleanly', () => {
    const r = report(SIMPLE, { errors: [{ line: 3, message: 'unexpected token' }] })
    const warn = r.blocks.find((b) => b.kind === 'callout' && b.tone === 'warn')
    expect(warn).toBeTruthy()
    expect(text(r)).toContain('did not parse cleanly')
  })

  it('notes warnings without escalating them to an error', () => {
    const r = report(SIMPLE, { warnings: [{ line: 2, message: 'unused contract' }] })
    expect(text(r)).toContain('parsed with 1 warning')
    expect(r.blocks.some((b) => b.kind === 'callout' && b.tone === 'warn')).toBe(false)
  })
})

describe('buildReport — system overview', () => {
  it('lists participants with a readable kind name, not the raw DSL kind', () => {
    const r = report(BRANCHING)
    const table = captionOf(r, 'Participants')!
    expect(table.rows.map((row) => row[1])).toContain('DynamoDB')
    expect(text(r)).not.toContain('aws:dynamodb')
  })

  it('characterises who starts the flow and who only receives', () => {
    const table = captionOf(report(SIMPLE), 'Participants')!
    const roles = new Map(table.rows.map((row) => [row[0], row[2]]))
    expect(roles.get('Web Client')).toBe('Initiator')
    expect(roles.get('Order API')).toBe('Terminal dependency')
  })

  it('names a datastore as such rather than by its position in the graph', () => {
    const roles = new Map(
      captionOf(report(BRANCHING), 'Participants')!.rows.map((row) => [row[0], row[2]]),
    )
    expect(roles.get('Orders')).toBe('Datastore')
  })

  it('states for each dependency whether a failure branch is actually drawn', () => {
    const table = captionOf(report(BRANCHING), 'Dependencies')!
    const column = table.head.indexOf('Failure branch drawn')
    expect(table.rows.some((row) => row[column] === 'yes')).toBe(true)
  })

  it('never pluralises or lowercases a technology name', () => {
    // The regression: `KIND_LABEL` values are proper nouns, so counting them
    // through an English pluraliser produced "4 ekses" and "2 sqses", and
    // lowercasing produced "api gateway" and "dynamodb".
    const dsl = `sequenceDiagram
  participant W as Worker: aws:eks
  participant W2 as Worker two: aws:eks
  participant Q as Queue: aws:sqs
  participant G as Gateway: aws:apigateway
  participant D as Store: aws:dynamodb
  W->>Q: enqueue
  G->>D: PutItem
`
    const prose = text(report(dsl))
    for (const wrong of ['ekses', 'sqses', 'api gateway', 'dynamodb', 'apigateway']) {
      expect(prose).not.toContain(wrong)
    }
    expect(prose).toContain('2 EKS')
    expect(prose).toContain('1 API Gateway')
    expect(prose).toContain('1 DynamoDB')
  })

  it('reads a reply as a reply, not as an inbound call', () => {
    // A browser that receives an async reply is still the initiator; counting
    // replies as inbound calls made almost every row read "Intermediary".
    const dsl = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  participant DB as Orders: aws:dynamodb
  Client->>API: POST /orders
  API->>DB: PutItem
  API-->>Client: created
`
    const roles = new Map(
      captionOf(report(dsl), 'Participants')!.rows.map((row) => [row[0], row[2]]),
    )
    expect(roles.get('Web Client')).toBe('Initiator')
    expect(roles.get('Order API')).toBe('Intermediary')
    expect(roles.get('Orders')).toBe('Datastore')
  })

  it('gives the diagram notes their own heading rather than trailing a table', () => {
    const dsl = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  Client->>API: POST /orders
  note over Client,API: idempotency key required
`
    const r = report(dsl)
    const headings = r.blocks
      .filter((b): b is Extract<ReportBlock, { kind: 'heading' }> => b.kind === 'heading')
      .map((b) => b.text)
    expect(headings).toContain('Annotations')
    expect(text(r)).toContain('idempotency key required')
  })

  it('calls out a participant that takes no part in any interaction', () => {
    const dsl = `${SIMPLE}  participant Idle as Spare Service: service\n`
    expect(text(report(dsl))).toContain('no part in any interaction')
  })
})

describe('buildReport — outcomes', () => {
  it('enumerates every distinct path when the diagram branches', () => {
    const r = report(BRANCHING)
    const table = captionOf(r, 'Every distinct path')!
    expect(table.rows.length).toBeGreaterThan(1)
    expect(text(r)).toContain('distinct path')
  })

  it('marks which paths end in failure', () => {
    const table = captionOf(report(BRANCHING), 'Every distinct path')!
    const column = table.head.indexOf('Outcome')
    expect(table.rows.map((row) => row[column])).toContain('Failure')
  })

  it('says there is a single path instead of showing an empty table', () => {
    const r = report(SIMPLE)
    expect(text(r)).toContain('exactly one path')
    expect(captionOf(r, 'Every distinct path')).toBeUndefined()
  })
})

describe('buildReport — failure coverage', () => {
  it('names the branch that models a declared response', () => {
    const table = captionOf(report(BRANCHING), 'Declared failures by contract')!
    const flat = table.rows.flat().join(' ')
    expect(flat).toContain('modelled')
    expect(flat).toContain('409')
  })

  it('flags a declared response that nothing follows from', () => {
    const table = captionOf(report(BRANCHING), 'Declared failures by contract')!
    const row = table.rows.find((r) => r[2].startsWith('503'))!
    expect(row[row.length - 1]).toBe('declared only')
  })

  it('explains itself when there are no contracts at all', () => {
    const r = report(SIMPLE)
    expect(text(r)).toContain('No contracts are defined')
    expect(captionOf(r, 'Declared failures by contract')).toBeUndefined()
  })

  it('lists an orphaned contract as a loose end', () => {
    const dsl = `${SIMPLE}
  contract Unused {
    transport: http
    method: GET
    path: /health
    responses:
      200 OK (happy)
  }
`
    const r = report(dsl)
    expect(text(r)).toContain('Loose ends')
    expect(text(r)).toContain('attached to no step')
  })

  it('does not name a block twice when it is named by its only branch', () => {
    const dsl = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  Client->>API: POST /orders
  opt 503 refused by the gate (unhappy)
    API-->>Client: unavailable
  end
`
    const prose = text(report(dsl))
    expect(prose).toContain('The failure path "503 refused by the gate" is drawn')
    expect(prose).not.toContain('in 503 refused by the gate')
  })

  it('confirms cleanliness when there is nothing loose', () => {
    const dsl = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  contract PlaceOrder {
    transport: http
    method: POST
    path: /orders
    responses:
      200 Created (happy)
      409 Conflict (unhappy)
  }
  Client->>API: POST /orders @PlaceOrder
  alt 200 Created
    API-->>Client: created
  else 409 Conflict (unhappy)
    API-->>Client: rejected
  end
`
    expect(text(report(dsl))).toContain('Every drawn failure branch has a declared response')
  })
})

describe('buildReport — data and contracts', () => {
  const WITH_TABLES = `sequenceDiagram
  participant API as Order API: service
  participant DB as Orders: aws:dynamodb
  API->>DB: PutItem(order)
  table Orders @DB "One row per placed order" {
    id: string required
    customer_id: string required
    primaryKey: id
    foreignKey: customer_id -> Customers.id
  }
  table Customers @DB {
    id: string required
    email: string required
    primaryKey: id
  }
`

  it('quotes the author-written table description rather than inventing one', () => {
    expect(text(report(WITH_TABLES))).toContain('One row per placed order')
  })

  it('marks quoted author prose so a reader can tell it from generated text', () => {
    const quoted = report(WITH_TABLES).blocks.filter(
      (b): b is Extract<ReportBlock, { kind: 'para' }> => b.kind === 'para' && !!b.quoted,
    )
    expect(quoted.map((b) => b.text)).toContain('One row per placed order')
    // Generated sentences must not be marked as quoted.
    const generated = report(WITH_TABLES).blocks.filter(
      (b): b is Extract<ReportBlock, { kind: 'para' }> => b.kind === 'para' && !b.quoted,
    )
    expect(generated.length).toBeGreaterThan(0)
  })

  it('does not caption a figure with the heading directly above it', () => {
    const r = report(WITH_TABLES)
    const headings = new Set(
      r.blocks
        .filter((b): b is Extract<ReportBlock, { kind: 'heading' }> => b.kind === 'heading')
        .map((b) => b.text),
    )
    for (const image of r.blocks.filter(
      (b): b is Extract<ReportBlock, { kind: 'image' }> => b.kind === 'image',
    )) {
      expect(headings.has(image.caption)).toBe(false)
    }
  })

  it('marks primary and foreign keys per column', () => {
    const r = report(WITH_TABLES)
    const flat = tables(r).flatMap((t) => t.rows.flat()).join(' ')
    expect(flat).toContain('PK')
    expect(flat).toContain('FK → Customers.id')
  })

  it('surfaces a foreign key pointing at a table that does not exist', () => {
    const dsl = `sequenceDiagram
  participant DB as Orders: aws:dynamodb
  table Orders @DB {
    id: string required
    ghost_id: string required
    foreignKey: ghost_id -> Missing.id
  }
`
    const r = report(dsl)
    expect(text(r)).toContain('Unresolved references')
    expect(text(r)).toContain('Missing')
  })

  it('says so when there are no tables', () => {
    expect(text(report(SIMPLE))).toContain('No database tables are defined')
  })

  it('lists contracts that are actually attached to a step', () => {
    const table = captionOf(report(BRANCHING), 'Interaction contracts in use')!
    expect(table.rows.map((r) => r[0])).toContain('PlaceOrder')
    expect(table.rows.flat().join(' ')).toContain('POST /orders')
  })
})

describe('buildReport — diagrams', () => {
  it('emits an image block for each captured diagram the document can show', () => {
    const r = report(BRANCHING)
    const images = r.blocks.filter(
      (b): b is Extract<ReportBlock, { kind: 'image' }> => b.kind === 'image',
    )
    // No `table` blocks in this fixture, so there is no schema figure to place.
    expect(images.map((i) => i.id).sort()).toEqual(['architecture', 'sequence'])
  })

  it('explains a missing diagram rather than leaving a silent hole', () => {
    const r = report(BRANCHING, { captured: ['architecture'] })
    expect(r.blocks.some((b) => b.kind === 'image' && b.id === 'sequence')).toBe(false)
    expect(text(r)).toContain('could not be captured')
  })

  it('emits no image blocks when nothing was captured', () => {
    const r = report(BRANCHING, { captured: [] })
    expect(r.blocks.some((b) => b.kind === 'image')).toBe(false)
  })
})

describe('buildReport — degenerate documents', () => {
  it('returns a single warning for a completely empty document', () => {
    const r = buildReport({
      doc: emptyDoc(),
      arch: inferArchitecture(emptyDoc()),
      projectName: 'Blank',
      generatedAt: GENERATED,
      sections: ALL_SECTIONS,
    })
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0]).toMatchObject({ kind: 'callout', tone: 'warn' })
    expect(text(r)).toContain('empty')
  })

  it('handles a document with participants but no steps', () => {
    const dsl = `sequenceDiagram
  participant A as Alpha: service
`
    expect(() => report(dsl)).not.toThrow()
    expect(text(report(dsl))).toContain('No steps are defined')
  })

  it('never emits an undefined cell in any table', () => {
    for (const pattern of PATTERNS) {
      const r = report(pattern.dsl)
      for (const table of tables(r)) {
        for (const row of table.rows) {
          expect(row.every((cell) => typeof cell === 'string' && cell.length > 0)).toBe(true)
          expect(row).toHaveLength(table.head.length)
        }
      }
    }
  })

  it('is deterministic — the same input gives byte-identical output', () => {
    expect(JSON.stringify(report(BRANCHING))).toBe(JSON.stringify(report(BRANCHING)))
  })
})

describe('buildReport — claims it must not overstate', () => {
  it('reports coverage as not applicable, never 100%, when nothing is declared', () => {
    const r = report(SIMPLE)
    expect(r.stats.coveragePct).toBeNull()
    const metrics = r.blocks.find(
      (b): b is Extract<ReportBlock, { kind: 'metrics' }> => b.kind === 'metrics',
    )!
    const coverage = metrics.items.find((m) => m.label === 'Failure coverage')!
    expect(coverage.value).toBe('n/a')
    expect(text(r)).not.toContain('100%')
  })

  it('does not reassure that nothing is loose when there are no contracts', () => {
    expect(text(report(SIMPLE))).not.toContain('Every drawn failure branch has a declared')
  })

  it('distinguishes contracts that declare no failures from having no contracts', () => {
    const dsl = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  contract Ping {
    transport: http
    method: GET
    path: /ping
    responses:
      200 OK (happy)
  }
  Client->>API: GET /ping @Ping
`
    expect(text(report(dsl))).toContain('declare no failure responses')
  })

  it('reports a step pointing at a contract that does not exist', () => {
    // `buildCoverage` only walks defined contracts, so this gap is invisible
    // unless `danglingContractRefs` is consulted separately.
    const dsl = `sequenceDiagram
  participant Client as Web Client: client
  participant API as Order API: service
  Client->>API: POST /orders @Ghost
`
    const r = report(dsl)
    expect(text(r)).toContain('Loose ends')
    expect(text(r)).toContain('Ghost')
  })
})

describe('count', () => {
  it('singularises and pluralises', () => {
    expect(count(1, 'step')).toBe('1 step')
    expect(count(2, 'step')).toBe('2 steps')
    expect(count(0, 'step')).toBe('0 steps')
  })

  it('handles the nouns this report actually uses', () => {
    expect(count(2, 'distinct path')).toBe('2 distinct paths')
    expect(count(2, 'dependency')).toBe('2 dependencies')
    expect(count(2, 'foreign key')).toBe('2 foreign keys')
    expect(count(2, 'response')).toBe('2 responses')
  })
})
