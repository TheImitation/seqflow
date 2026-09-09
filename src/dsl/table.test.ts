import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { serialize } from './serializer'

/** Parsing a serialization must be a fixed point. */
function expectRoundTrip(src: string) {
  const first = parse(src)
  expect(first.errors).toEqual([])
  const once = serialize(first.doc)
  const twice = serialize(parse(once).doc)
  expect(twice).toBe(once)
  return first
}

describe('table blocks', () => {
  const SRC = `sequenceDiagram
  participant RDS : aws:rds

table Applicants @RDS "one row per applicant" {
  applicationId: string required
  campaignId: string required
  status: enum[ready_for_analysis,analysing,complete] required
  embedding: vector(1024)
  chunk: array {
    ordinal: number required
    text: string required
  }

  primaryKey: applicationId
  foreignKey: campaignId -> Campaigns.campaignId
  index: status, campaignId
}
`

  it('parses columns exactly like model fields', () => {
    const { doc } = parse(SRC)
    const t = doc.tables[0]
    expect(t.name).toBe('Applicants')
    expect(t.participantId).toBe('RDS')
    expect(t.description).toBe('one row per applicant')
    expect(t.columns.map((c) => c.name)).toEqual([
      'applicationId',
      'campaignId',
      'status',
      'embedding',
      'chunk',
    ])
    expect(t.columns[2].enumValues).toEqual(['ready_for_analysis', 'analysing', 'complete'])
    expect(t.columns[4].children?.map((c) => c.name)).toEqual(['ordinal', 'text'])
  })

  it('parses a vector column, dimension included', () => {
    const { doc } = parse(SRC)
    const embedding = doc.tables[0].columns[3]
    expect(embedding.type).toBe('vector')
    expect(embedding.example).toBe(1024)
  })

  it('parses the primary key, foreign key and index lines as metadata, not columns', () => {
    const { doc } = parse(SRC)
    const t = doc.tables[0]
    expect(t.primaryKey).toEqual(['applicationId'])
    expect(t.foreignKeys).toEqual([
      { column: 'campaignId', refTable: 'Campaigns', refColumn: 'campaignId' },
    ])
    expect(t.indexes).toEqual([['status', 'campaignId']])
    expect(t.columns.some((c) => c.name === 'primaryKey')).toBe(false)
  })

  it('does not mistake a column merely named like a reserved key', () => {
    const { doc, errors } = parse(
      'sequenceDiagram\n  participant RDS : aws:rds\n\ntable T @RDS {\n  primaryKeyHint: string\n}\n',
    )
    expect(errors).toEqual([])
    expect(doc.tables[0].columns.map((c) => c.name)).toEqual(['primaryKeyHint'])
    expect(doc.tables[0].primaryKey).toBeUndefined()
  })

  it('allows a nested column literally named `primaryKey`', () => {
    const { doc, errors } = parse(
      'sequenceDiagram\n  participant RDS : aws:rds\n\ntable T @RDS {\n  meta: object {\n    primaryKey: string\n  }\n}\n',
    )
    expect(errors).toEqual([])
    expect(doc.tables[0].columns[0].children?.[0].name).toBe('primaryKey')
  })

  it('warns, but does not error, on a table referencing an unknown participant', () => {
    const { warnings, errors } = parse(
      'sequenceDiagram\n  A->>A: x\n\ntable T @Nope {\n  id: string\n}\n',
    )
    expect(errors).toEqual([])
    expect(warnings[0].message).toMatch(/unknown participant/)
  })

  it('round-trips', () => {
    expectRoundTrip(SRC)
  })

  it('leaves model parsing unaffected by the shared field-parsing extraction', () => {
    const { doc, errors } = parse(
      'sequenceDiagram\n  A->>B: x @C\n\nmodel M "d" {\n  a: string required = "x"\n  b: object {\n    c: number\n  }\n}\n\ncontract C {\n  transport: http\n  method: GET\n  model: M\n  responses:\n    200 OK\n}\n',
    )
    expect(errors).toEqual([])
    const m = doc.dataModels[0]
    expect(m.fields[0]).toMatchObject({ name: 'a', type: 'string', required: true, example: 'x' })
    expect(m.fields[1].children?.[0]).toMatchObject({ name: 'c', type: 'number' })
  })
})
