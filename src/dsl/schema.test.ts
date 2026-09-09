import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { inferSchemaGraph, tablesForParticipant } from './schema'

describe('tablesForParticipant', () => {
  const SRC = `sequenceDiagram
  participant RDS : aws:rds
  participant Cache : aws:elasticache

table Applicants @RDS {
  applicationId: string required
}

table KnownExamples @RDS {
  knownExampleId: string required
}

table Unassigned {
  id: string required
}
`

  it('returns only the tables referencing the given participant', () => {
    const { doc } = parse(SRC)
    const names = tablesForParticipant(doc, 'RDS').map((t) => t.name)
    expect(names).toEqual(['Applicants', 'KnownExamples'])
  })

  it('shows a table with no @participant under nothing, and a participant with no tables gets nothing', () => {
    const { doc } = parse(SRC)
    expect(doc.tables.find((t) => t.name === 'Unassigned')?.participantId).toBeUndefined()
    expect(tablesForParticipant(doc, 'Cache')).toEqual([])
    expect(tablesForParticipant(doc, 'Unassigned')).toEqual([])
  })
})

describe('inferSchemaGraph', () => {
  const SRC = `sequenceDiagram
  participant RDS : aws:rds

table Campaigns @RDS {
  campaignId: string required
}

table Matches @RDS {
  matchId: string required
  homeTeamId: string required
  awayTeamId: string required
  campaignId: string required

  foreignKey: homeTeamId -> Campaigns.campaignId
  foreignKey: awayTeamId -> Campaigns.campaignId
  foreignKey: campaignId -> Campaigns.campaignId
  foreignKey: matchId -> Nowhere.id
}
`

  it('emits one edge per foreign key, keyed by column so parallel FKs stay distinct', () => {
    const { doc } = parse(SRC)
    const graph = inferSchemaGraph(doc)
    expect(graph.nodes).toBe(doc.tables)
    const ids = graph.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(graph.edges.filter((e) => e.from === 'Matches' && e.to === 'Campaigns')).toHaveLength(3)
  })

  it('drops a foreign key whose referenced table does not exist', () => {
    const { doc } = parse(SRC)
    const graph = inferSchemaGraph(doc)
    expect(graph.edges.some((e) => e.to === 'Nowhere')).toBe(false)
  })
})
