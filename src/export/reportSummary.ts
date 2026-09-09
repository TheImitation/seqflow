import type { ArchGraph } from '../dsl/architecture'
import type { SequenceDoc } from '../dsl/ast'
import { buildCoverage } from '../dsl/coverage'
import { enumerateOutcomes } from '../dsl/outcomes'

/**
 * The counts the app already shows, in one place.
 *
 * Every number here was previously computed inline in `StatusBar`'s JSX, which
 * meant a report quoting the same figures would have been a second, drifting
 * implementation of the same arithmetic. Both read this now.
 */
export interface SummaryStats {
  participants: number
  messages: number
  blocks: number
  notes: number
  /** Architecture nodes: participants that survived inference. */
  nodes: number
  /** Unique caller→callee links. */
  links: number
  /** Links with a failure branch actually drawn on them. */
  linksOnFailurePath: number
  contracts: number
  models: number
  tables: number
  foreignKeys: number
  /** Distinct paths through the diagram. */
  outcomes: number
  unhappyOutcomes: number
  /** Failure responses declared on contracts. */
  declaredFailures: number
  /** Of those, the ones a drawn branch names. */
  modelledFailures: number
  /**
   * Percentage of declared failures that are modelled, or **null when nothing
   * is declared** and the figure is therefore not measurable.
   *
   * The coverage dialog reports 100% in that case, which reads fine as live UI
   * — but copied into a circulated document it becomes "100% of declared
   * failures are modelled" for a design that declares none, which is a claim a
   * reviewer would act on. Null forces every caller to say something true.
   */
  coveragePct: number | null
}

export function summaryStats(doc: SequenceDoc, arch: ArchGraph): SummaryStats {
  const coverage = buildCoverage(doc)
  const outcomes = enumerateOutcomes(doc)

  return {
    participants: doc.participants.length,
    messages: doc.messages.length,
    blocks: doc.blocks.length,
    notes: doc.notes.length,
    nodes: arch.nodes.length,
    links: arch.edges.length,
    linksOnFailurePath: arch.edges.filter((e) => e.hasUnhappyPath).length,
    contracts: doc.contracts.length,
    models: doc.dataModels.length,
    tables: doc.tables.length,
    foreignKeys: doc.tables.reduce((n, t) => n + t.foreignKeys.length, 0),
    outcomes: outcomes.length,
    unhappyOutcomes: outcomes.filter((o) => o.isUnhappy).length,
    declaredFailures: coverage.declared,
    modelledFailures: coverage.modelled,
    coveragePct: coverage.declared
      ? Math.round((coverage.modelled / coverage.declared) * 100)
      : null,
  }
}
