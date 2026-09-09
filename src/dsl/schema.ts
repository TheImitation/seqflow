import type { DatabaseTable, SequenceDoc } from './ast'

/**
 * Every `table` names the participant it belongs to explicitly (`@RDS`), so
 * this is a filter, not a derivation — unlike `inferArchitecture`, there is
 * nothing to infer. A table with no `@participant` simply isn't shown yet;
 * guessing which database it belongs to would be worse than leaving it out.
 */
export function tablesForParticipant(doc: SequenceDoc, participantId: string): DatabaseTable[] {
  return doc.tables.filter((t) => t.participantId === participantId)
}

export interface SchemaEdge {
  /** Unique per foreign key, not per table pair — two FKs between the same
   *  pair of tables must not collapse into one edge. */
  id: string
  from: string
  to: string
  column: string
  refColumn: string
}

export interface SchemaGraph {
  nodes: DatabaseTable[]
  edges: SchemaEdge[]
}

/**
 * The whole-document ER graph: every table as a node, every foreign key as
 * an edge. Unlike `tablesForParticipant`, this is a derivation — it walks
 * every table's `foreignKeys` and drops any that point at a table that
 * doesn't exist, the same tolerance `inferArchitecture` already has for a
 * message whose endpoint got renamed out from under it.
 */
export function inferSchemaGraph(doc: SequenceDoc): SchemaGraph {
  const names = new Set(doc.tables.map((t) => t.name))
  const edges: SchemaEdge[] = []
  for (const t of doc.tables) {
    for (const fk of t.foreignKeys) {
      if (!names.has(fk.refTable)) continue
      edges.push({
        id: `${t.name}.${fk.column}->${fk.refTable}.${fk.refColumn}`,
        from: t.name,
        to: fk.refTable,
        column: fk.column,
        refColumn: fk.refColumn,
      })
    }
  }
  return { nodes: doc.tables, edges }
}
