import type { ArchGraph } from '../dsl/architecture'
import {
  isDatabaseKind,
  type DataModelField,
  type DatabaseTable,
  type SequenceDoc,
} from '../dsl/ast'
import { buildCoverage, danglingContractRefs, type ResponseState } from '../dsl/coverage'
import { enumerateOutcomes } from '../dsl/outcomes'
import { inferSchemaGraph } from '../dsl/schema'
import type { ParseIssue } from '../dsl/parser'
import { KIND_LABEL } from '../render/aws-icons/labels'
import { STATUS_BY_CODE } from '../contracts/unhappyPathRules'
import { TRANSPORTS } from '../contracts/contractStore'
import { usedContracts } from './toOpenApi'
import { summaryStats, type SummaryStats } from './reportSummary'

/**
 * The design-review document, assembled from what the app already measures.
 *
 * Pure and synchronous: no DOM, no Word writer, no network. That is the point —
 * `toDocx.ts` only knows how to render the block list this produces, so every
 * sentence and every figure in the report can be asserted in the node-only test
 * environment without a browser or `docx` in the loop.
 *
 * The prose is templated from real values rather than written by a model, so
 * the same document always produces the same report, it works offline, and it
 * cannot claim something the diagram does not support. The app's central
 * distinction — a *declared* failure response is not a *modelled* one — is
 * preserved in the wording throughout, because collapsing the two would
 * overstate how much of the failure behaviour has actually been designed.
 */

export type DiagramId = 'sequence' | 'architecture' | 'schema'

export type SectionId =
  | 'glance'
  | 'overview'
  | 'sequence'
  | 'outcomes'
  | 'coverage'
  | 'data'

export const ALL_SECTIONS: SectionId[] = [
  'glance',
  'overview',
  'sequence',
  'outcomes',
  'coverage',
  'data',
]

export const SECTION_LABEL: Record<SectionId, string> = {
  glance: 'At a glance',
  overview: 'System overview',
  sequence: 'Interaction sequence',
  outcomes: 'Outcomes',
  coverage: 'Failure coverage',
  data: 'Data and contracts',
}

export const SECTION_HINT: Record<SectionId, string> = {
  glance: 'Headline counts and parse status',
  overview: 'Participants, architecture diagram, dependency table',
  sequence: 'Sequence diagram and the step-by-step table',
  outcomes: 'Every distinct path through the flow',
  coverage: 'Which declared failures are modelled, and the gaps',
  data: 'Schema diagram, table columns, contract definitions',
}

/** Which diagram each section needs captured, for the capture step to read. */
export const SECTION_DIAGRAM: Partial<Record<SectionId, DiagramId>> = {
  overview: 'architecture',
  sequence: 'sequence',
  data: 'schema',
}

export type ReportBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'para'; text: string; /** Author-written prose quoted from the document. */ quoted?: boolean }
  | { kind: 'table'; caption?: string; head: string[]; rows: string[][] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'image'; id: DiagramId; caption: string; alt: string }
  | { kind: 'metrics'; items: { label: string; value: string; note?: string }[] }
  | { kind: 'callout'; tone: 'note' | 'warn'; text: string }

export interface ReportDocument {
  title: string
  subtitle: string
  /** Rendered under the title: "Generated 8 September 2026 · last saved …". */
  byline: string
  blocks: ReportBlock[]
  stats: SummaryStats
}

export interface ReportInput {
  doc: SequenceDoc
  /** Already derived in the store — never re-inferred here. */
  arch: ArchGraph
  projectName: string
  /** Free-text override for the document title. Falls back to the project name. */
  documentTitle?: string
  author?: string
  createdAt?: string
  savedAt?: string
  generatedAt: Date
  sections: SectionId[]
  errors?: ParseIssue[]
  warnings?: ParseIssue[]
  /** Diagrams the capture step actually managed to get. */
  captured?: DiagramId[]
}

const TRANSPORT_LABEL = new Map(TRANSPORTS.map((t) => [t.value, t.label]))

/** Beyond this the path table stops being readable and starts being a dump. */
const OUTCOME_TABLE_LIMIT = 40

const STATE_WORD: Record<ResponseState, string> = {
  modelled: 'modelled',
  'on-failure-path': 'on a failure path',
  'declared-only': 'declared only',
}

export function buildReport(input: ReportInput): ReportDocument {
  const { doc, arch, sections } = input
  const stats = summaryStats(doc, arch)
  const wanted = new Set(sections)
  const captured = new Set(input.captured ?? [])
  const blocks: ReportBlock[] = []

  const title = (input.documentTitle?.trim() || input.projectName || 'Untitled').trim()

  if (!doc.participants.length && !doc.messages.length) {
    blocks.push({
      kind: 'callout',
      tone: 'warn',
      text: 'This document is empty — there are no participants or steps to review yet.',
    })
    return { title, subtitle: 'Architecture design review', byline: byline(input), blocks, stats }
  }

  if (wanted.has('glance')) pushGlance(blocks, input, stats)
  if (wanted.has('overview')) pushOverview(blocks, input, captured)
  if (wanted.has('sequence')) pushSequence(blocks, input, captured)
  if (wanted.has('outcomes')) pushOutcomes(blocks, input)
  if (wanted.has('coverage')) pushCoverage(blocks, input, stats)
  if (wanted.has('data')) pushData(blocks, input, captured)

  return { title, subtitle: 'Architecture design review', byline: byline(input), blocks, stats }
}

/* ------------------------------------------------------------------ byline */

function byline(input: ReportInput): string {
  const parts = [`Generated ${longDate(input.generatedAt)}`]
  if (input.author?.trim()) parts.push(input.author.trim())
  if (input.savedAt) parts.push(`document last saved ${longDate(new Date(input.savedAt))}`)
  return parts.join(' · ')
}

/* ------------------------------------------------------------- at a glance */

function pushGlance(blocks: ReportBlock[], input: ReportInput, stats: SummaryStats): void {
  blocks.push({ kind: 'heading', level: 1, text: SECTION_LABEL.glance })

  blocks.push({
    kind: 'metrics',
    items: [
      { label: 'Participants', value: String(stats.participants) },
      { label: 'Steps', value: String(stats.messages) },
      { label: 'Links', value: String(stats.links), note: `${stats.linksOnFailurePath} with a failure branch drawn` },
      { label: 'Distinct outcomes', value: String(stats.outcomes), note: `${stats.unhappyOutcomes} end in failure` },
      stats.coveragePct === null
        ? {
            label: 'Failure coverage',
            value: 'n/a',
            note: 'no failure responses declared, so there is nothing to measure',
          }
        : {
            label: 'Failure coverage',
            value: `${stats.coveragePct}%`,
            note: `${stats.modelledFailures} of ${stats.declaredFailures} declared failures modelled`,
          },
      { label: 'Contracts', value: String(stats.contracts) },
      { label: 'Data models', value: String(stats.models) },
      { label: 'Tables', value: String(stats.tables), note: `${stats.foreignKeys} foreign keys` },
    ],
  })

  blocks.push({ kind: 'para', text: glanceProse(stats) })

  const errors = input.errors ?? []
  const warnings = input.warnings ?? []
  if (errors.length) {
    blocks.push({
      kind: 'callout',
      tone: 'warn',
      text: `The source did not parse cleanly when this report was generated: ${count(errors.length, 'error')}${
        warnings.length ? ` and ${count(warnings.length, 'warning')}` : ''
      }. Sections below describe only what could be parsed.`,
    })
  } else if (warnings.length) {
    blocks.push({
      kind: 'callout',
      tone: 'note',
      text: `The source parsed with ${count(warnings.length, 'warning')}.`,
    })
  }
}

/**
 * The one paragraph most readers will actually read. Every clause is a measured
 * value, and the failure sentence is deliberately careful about the difference
 * between a declared response and a drawn path.
 */
function glanceProse(stats: SummaryStats): string {
  const parts: string[] = []

  parts.push(
    `The flow involves ${count(stats.participants, 'participant')} exchanging ${count(
      stats.messages,
      'step',
    )} across ${count(stats.links, 'distinct link')}.`,
  )

  if (stats.outcomes > 1) {
    parts.push(
      `Branching produces ${count(stats.outcomes, 'distinct path')} through the diagram, ${
        stats.unhappyOutcomes === 0
          ? 'none of which end in a failure branch'
          : `${stats.unhappyOutcomes} of which end in a failure branch`
      }.`,
    )
  } else {
    parts.push('There is a single path through the diagram — nothing branches.')
  }

  if (stats.declaredFailures === 0) {
    parts.push(
      'No failure responses are declared on any contract, so there is no failure behaviour to review.',
    )
  } else if (stats.modelledFailures === stats.declaredFailures) {
    parts.push(
      `All ${count(stats.declaredFailures, 'declared failure response')} ${
        stats.declaredFailures === 1 ? 'is' : 'are'
      } modelled as a path that playback can walk.`,
    )
  } else {
    const gap = stats.declaredFailures - stats.modelledFailures
    parts.push(
      `Of ${count(stats.declaredFailures, 'declared failure response')}, ${
        stats.modelledFailures
      } ${stats.modelledFailures === 1 ? 'is' : 'are'} modelled as a walkable path (${
        stats.coveragePct ?? 0
      }%); the remaining ${gap} ${gap === 1 ? 'is' : 'are'} declared but nothing on the diagram follows from ${
        gap === 1 ? 'it' : 'them'
      }.`,
    )
  }

  return parts.join(' ')
}

/* -------------------------------------------------------- system overview */

function pushOverview(
  blocks: ReportBlock[],
  input: ReportInput,
  captured: Set<DiagramId>,
): void {
  const { doc, arch } = input
  blocks.push({ kind: 'heading', level: 1, text: SECTION_LABEL.overview })

  // Grouped by kind so the reader gets the shape of the system before the
  // detail — "three services, one queue, two datastores".
  const byKind = new Map<string, string[]>()
  for (const p of doc.participants) {
    const label = KIND_LABEL[p.kind] ?? p.kind
    const list = byKind.get(label)
    if (list) list.push(p.label)
    else byKind.set(label, [p.label])
  }
  if (byKind.size) {
    // Counted proper nouns, largest group first — `KIND_LABEL` values are
    // names ('EKS', 'API Gateway', 'DynamoDB'), so they are never lowercased
    // and never pluralised.
    const breakdown = [...byKind.entries()]
      .sort((a, z) => z[1].length - a[1].length || a[0].localeCompare(z[0]))
      .map(([kind, names]) => `${names.length} ${kind}`)
    blocks.push({
      kind: 'para',
      text: `${count(doc.participants.length, 'participant')} take part: ${breakdown.join(', ')}.`,
    })
    blocks.push({
      kind: 'table',
      caption: 'Participants',
      head: ['Participant', 'Kind', 'Role'],
      rows: doc.participants.map((p) => [
        p.label,
        KIND_LABEL[p.kind] ?? p.kind,
        roleOf(doc, arch, p.id),
      ]),
    })
  }

  pushDiagram(blocks, captured, 'architecture', 'Inferred architecture', SECTION_LABEL.overview)

  if (arch.edges.length) {
    blocks.push({
      kind: 'table',
      caption: 'Dependencies',
      head: ['Caller', 'Callee', 'Calls', 'Style', 'Failure branch drawn'],
      rows: arch.edges.map((e) => [
        labelOf(doc, e.from),
        labelOf(doc, e.to),
        String(e.interactionCount),
        [...e.styles].map(styleWord).join(', '),
        e.hasUnhappyPath
          ? 'yes'
          : e.declaredFailures > 0
            ? `no — ${count(e.declaredFailures, 'response')} declared only`
            : 'no failures declared',
      ]),
    })

    const busiest = [...arch.edges].sort((a, z) => z.interactionCount - a.interactionCount)[0]
    const fanOut = new Map<string, number>()
    for (const e of arch.edges) fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1)
    const hub = [...fanOut.entries()].sort((a, z) => z[1] - a[1])[0]

    const notes: string[] = []
    if (hub && hub[1] > 1) {
      notes.push(
        `${labelOf(doc, hub[0])} has the widest fan-out, calling ${count(hub[1], 'dependency')}.`,
      )
    }
    if (busiest && busiest.interactionCount > 1) {
      notes.push(
        `The busiest link is ${labelOf(doc, busiest.from)} → ${labelOf(
          doc,
          busiest.to,
        )}, carrying ${count(busiest.interactionCount, 'call')}.`,
      )
    }
    const isolated = doc.participants.filter(
      (p) => !arch.edges.some((e) => e.from === p.id || e.to === p.id),
    )
    if (isolated.length) {
      notes.push(
        `${joinList(isolated.map((p) => p.label))} ${
          isolated.length === 1 ? 'takes' : 'take'
        } no part in any interaction.`,
      )
    }
    if (notes.length) blocks.push({ kind: 'para', text: notes.join(' ') })
  }
}

/**
 * A one-word characterisation of what a participant does in this flow.
 *
 * Only *sync* edges count as being called: an async edge back to a caller is a
 * reply, not an inbound request. Counting replies made almost every row read
 * "Intermediary" — including the browser that starts the whole flow — which is
 * a column carrying no information.
 */
function roleOf(doc: SequenceDoc, arch: ArchGraph, id: string): string {
  const participant = doc.participants.find((p) => p.id === id)
  if (participant && isDatabaseKind(participant.kind)) return 'Datastore'

  const touches = arch.edges.some((e) => e.from === id || e.to === id)
  if (!touches) return 'Not referenced'

  const calls = arch.edges.some((e) => e.from === id && e.styles.has('sync'))
  const called = arch.edges.some((e) => e.to === id && e.styles.has('sync'))

  if (called && !calls) return 'Terminal dependency'
  if (calls && !called) return 'Initiator'
  if (calls && called) return 'Intermediary'
  // Only ever on the receiving end of async traffic.
  return 'Event consumer'
}

/* ------------------------------------------------------ interaction steps */

function pushSequence(
  blocks: ReportBlock[],
  input: ReportInput,
  captured: Set<DiagramId>,
): void {
  const { doc } = input
  blocks.push({ kind: 'heading', level: 1, text: SECTION_LABEL.sequence })

  pushDiagram(blocks, captured, 'sequence', 'Sequence diagram', SECTION_LABEL.sequence)

  if (!doc.messages.length) {
    blocks.push({ kind: 'para', text: 'No steps are defined.' })
    return
  }

  const ordered = [...doc.messages].sort((a, z) => a.order - z.order)
  blocks.push({
    kind: 'table',
    caption: 'Steps in order',
    head: ['#', 'From', 'To', 'Step', 'Style', 'Contract'],
    rows: ordered.map((m, i) => [
      String(i + 1),
      labelOf(doc, m.from),
      labelOf(doc, m.to),
      m.label || '—',
      styleWord(m.style),
      m.contractRef ?? '—',
    ]),
  })

  if (doc.blocks.length) {
    blocks.push({
      kind: 'table',
      caption: 'Control flow',
      head: ['Construct', 'Label', 'Branches'],
      rows: doc.blocks.map((b) => [
        b.type,
        b.label || '—',
        b.branches?.length
          ? b.branches.map((br) => `${br.label}${br.isUnhappy ? ' (failure)' : ''}`).join(' | ')
          : '—',
      ]),
    })
  }

  if (doc.notes.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Annotations' })
    blocks.push({
      kind: 'para',
      text: `${count(doc.notes.length, 'note')} on the diagram, quoted as written.`,
    })
    blocks.push({
      kind: 'bullets',
      items: doc.notes.map(
        (n) => `${n.over.map((id) => labelOf(doc, id)).join(', ')} — ${n.text}`,
      ),
    })
  }
}

/* ----------------------------------------------------------------- outcomes */

function pushOutcomes(blocks: ReportBlock[], input: ReportInput): void {
  const { doc } = input
  const outcomes = enumerateOutcomes(doc)
  blocks.push({ kind: 'heading', level: 1, text: SECTION_LABEL.outcomes })

  if (outcomes.length <= 1) {
    blocks.push({
      kind: 'para',
      text:
        'The diagram has no alternative branches, so there is exactly one path through it. ' +
        'Every run reaches the same steps in the same order.',
    })
    return
  }

  const unhappy = outcomes.filter((o) => o.isUnhappy).length
  blocks.push({
    kind: 'para',
    text: `There are ${count(outcomes.length, 'distinct path')} through this flow. ${
      unhappy === 0
        ? 'None of them end in a branch marked as a failure.'
        : `${unhappy} of them end in a branch marked as a failure.`
    } Paths are listed happy-first, then longest-first.`,
  })

  // A deeply nested diagram can produce hundreds of paths. Failure paths are
  // kept in full because they are the point of the review; success paths are
  // truncated, and the truncation is stated rather than left to be noticed.
  const shown =
    outcomes.length <= OUTCOME_TABLE_LIMIT
      ? outcomes
      : [
          ...outcomes.filter((o) => o.isUnhappy),
          ...outcomes.filter((o) => !o.isUnhappy),
        ].slice(0, OUTCOME_TABLE_LIMIT)

  blocks.push({
    kind: 'table',
    caption: 'Every distinct path',
    head: ['#', 'Decisions taken', 'Steps', 'Ends at', 'Outcome', 'Undrawn failures'],
    rows: shown.map((o, i) => [
      String(i + 1),
      o.decisions.length ? o.decisions.map((d) => d.branchLabel).join(' → ') : 'single path',
      String(o.stepCount),
      o.endsAt ? labelOf(doc, o.endsAt) : '—',
      o.isUnhappy ? 'Failure' : 'Success',
      o.declaredFailures ? String(o.declaredFailures) : '—',
    ]),
  })

  if (shown.length < outcomes.length) {
    blocks.push({
      kind: 'callout',
      tone: 'note',
      text: `Showing ${shown.length} of ${outcomes.length} paths — every failure path, then the longest successes. Path enumeration is itself capped, so a very deeply nested diagram may have more.`,
    })
  }

  const withUndrawn = outcomes.filter((o) => o.declaredFailures > 0).length
  if (withUndrawn) {
    blocks.push({
      kind: 'callout',
      tone: 'note',
      text: `The final column counts failure responses declared on steps along that path but never drawn as a branch. ${count(
        withUndrawn,
        'path',
      )} ${withUndrawn === 1 ? 'carries' : 'carry'} at least one — those failures can happen at runtime with nothing in this design describing what follows.`,
    })
  }
}

/* ---------------------------------------------------------------- coverage */

function pushCoverage(
  blocks: ReportBlock[],
  input: ReportInput,
  stats: SummaryStats,
): void {
  const { doc } = input
  const coverage = buildCoverage(doc)
  const dangling = danglingContractRefs(doc)
  blocks.push({ kind: 'heading', level: 1, text: SECTION_LABEL.coverage })

  if (stats.declaredFailures === 0) {
    blocks.push({
      kind: 'para',
      text: doc.contracts.length
        ? 'The contracts in this design declare no failure responses, so there is no failure ' +
          'behaviour to measure. Coverage is not applicable rather than complete.'
        : 'No contracts are defined, so no failure responses are declared and there is nothing ' +
          'to measure coverage against. Attaching a contract to a step is what lets the design ' +
          'state which failures that step can return.',
    })
    // Falls through deliberately: a step can reference a contract that was
    // never defined even when no contract declares a failure, and that gap is
    // exactly what a design review should catch.
  } else {
    blocks.push({
      kind: 'para',
      text: `${stats.modelledFailures} of ${count(
        stats.declaredFailures,
        'declared failure response',
      )} ${stats.modelledFailures === 1 ? 'is' : 'are'} modelled as a path (${
        stats.coveragePct ?? 0
      }%). A declared response is a statement about what a call can return; it becomes part of the design only when a branch follows from it.`,
    })
  }

  const detailed = coverage.contracts.filter((c) => c.declared > 0)
  if (detailed.length) {
    blocks.push({
      kind: 'table',
      caption: 'Declared failures by contract',
      head: ['Contract', 'Used by', 'Response', 'Meaning', 'Status'],
      rows: detailed.flatMap((c) =>
        c.responses.map((r) => [
          c.contract.name,
          c.messages.length ? count(c.messages.length, 'step') : 'nothing',
          `${r.response.code}${r.response.label ? ` ${r.response.label}` : ''}`,
          STATUS_BY_CODE.get(r.response.code)?.meaning ?? '—',
          r.state === 'modelled' && r.matchedBranch
            ? `modelled — "${r.matchedBranch}"`
            : STATE_WORD[r.state],
        ]),
      ),
    })
  }

  const loose: string[] = []
  for (const b of coverage.undeclaredBranches) {
    // A wholesale-unhappy `opt` block is named by its own only branch, so
    // naming both would repeat the same phrase twice in one sentence.
    const where =
      b.blockLabel === b.branchLabel
        ? `The failure path "${b.branchLabel}"`
        : `The branch "${b.branchLabel}" in ${b.blockLabel}`
    loose.push(
      `${where} is drawn, but no contract declares a response behind it.`,
    )
  }
  for (const name of coverage.orphanContracts) {
    loose.push(
      `Contract ${name} is defined but attached to no step, so it describes nothing in this flow.`,
    )
  }
  for (const ref of dangling) {
    loose.push(`A step references contract ${ref}, which is not defined.`)
  }

  if (loose.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Loose ends' })
    blocks.push({ kind: 'bullets', items: loose })
  } else if (doc.contracts.length) {
    blocks.push({
      kind: 'para',
      text: 'Every drawn failure branch has a declared response behind it, every contract is attached to at least one step, and no step references a contract that does not exist.',
    })
  }
}

/* -------------------------------------------------------- data + contracts */

function pushData(blocks: ReportBlock[], input: ReportInput, captured: Set<DiagramId>): void {
  const { doc } = input
  blocks.push({ kind: 'heading', level: 1, text: SECTION_LABEL.data })

  const schema = inferSchemaGraph(doc)

  if (doc.tables.length) {
    blocks.push({
      kind: 'para',
      text: `The design defines ${count(doc.tables.length, 'table')} joined by ${count(
        schema.edges.length,
        'foreign key',
      )}.`,
    })
    pushDiagram(blocks, captured, 'schema', 'Entity relationships', SECTION_LABEL.data)

    for (const table of doc.tables) {
      blocks.push({ kind: 'heading', level: 3, text: table.name })
      if (table.description) {
        blocks.push({ kind: 'para', text: table.description, quoted: true })
      }
      blocks.push({
        kind: 'table',
        head: ['Column', 'Type', 'Required', 'Key'],
        rows: table.columns.map((c) => [
          c.name,
          fieldType(c),
          c.required ? 'yes' : 'no',
          keyRole(table, c.name),
        ]),
      })
    }

    // `inferSchemaGraph` silently drops a foreign key pointing at a table that
    // does not exist. Nothing else in the app surfaces that, so the report does.
    const names = new Set(doc.tables.map((t) => t.name))
    const broken = doc.tables.flatMap((t) =>
      t.foreignKeys
        .filter((fk) => !names.has(fk.refTable))
        .map((fk) => `${t.name}.${fk.column} references ${fk.refTable}, which is not defined.`),
    )
    if (broken.length) {
      blocks.push({ kind: 'heading', level: 2, text: 'Unresolved references' })
      blocks.push({ kind: 'bullets', items: broken })
    }
  } else {
    blocks.push({ kind: 'para', text: 'No database tables are defined.' })
  }

  const contracts = usedContracts(doc)
  if (contracts.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Contracts' })
    blocks.push({
      kind: 'table',
      caption: 'Interaction contracts in use',
      head: ['Contract', 'Transport', 'Operation', 'Request', 'Responses'],
      rows: contracts.map((c) => [
        c.name,
        TRANSPORT_LABEL.get(c.transport) ?? c.transport,
        [c.method, c.path].filter(Boolean).join(' ') || '—',
        c.modelName ?? '—',
        c.responses.length
          ? c.responses
              .map((r) => `${r.code}${r.isHappyPath ? '' : ' (failure)'}`)
              .join(', ')
          : '—',
      ]),
    })
  }

  if (doc.dataModels.length) {
    blocks.push({ kind: 'heading', level: 2, text: 'Data models' })
    for (const model of doc.dataModels) {
      blocks.push({ kind: 'heading', level: 3, text: model.name })
      if (model.description) {
        blocks.push({ kind: 'para', text: model.description, quoted: true })
      }
      blocks.push({
        kind: 'table',
        head: ['Field', 'Type', 'Required', 'Example'],
        rows: flattenFields(model.fields).map(({ path, field }) => [
          path,
          fieldType(field),
          field.required ? 'yes' : 'no',
          exampleText(field.example),
        ]),
      })
    }
  }
}

/** Nested fields flattened to dotted paths, so a table can show them at all. */
function flattenFields(
  fields: DataModelField[],
  prefix = '',
): { path: string; field: DataModelField }[] {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name
    return [
      { path, field },
      ...(field.children?.length ? flattenFields(field.children, path) : []),
    ]
  })
}

/** `example` is `unknown` on the AST, so it has to be rendered defensively. */
function exampleText(example: unknown): string {
  if (example === undefined || example === null || example === '') return '—'
  if (typeof example === 'object') return JSON.stringify(example)
  return String(example)
}

function fieldType(field: DataModelField): string {
  if (field.type === 'enum' && field.enumValues?.length) {
    return `enum(${field.enumValues.join(' | ')})`
  }
  return field.type
}

function keyRole(table: DatabaseTable, column: string): string {
  const pk = table.primaryKey?.includes(column)
  const fk = table.foreignKeys.find((f) => f.column === column)
  if (pk && fk) return `PK, FK → ${fk.refTable}.${fk.refColumn}`
  if (pk) return 'PK'
  if (fk) return `FK → ${fk.refTable}.${fk.refColumn}`
  return '—'
}

/* ----------------------------------------------------------------- helpers */

/**
 * An image block, or an honest note in its place. A capture can fail — the
 * pane may not have rendered, or the browser may refuse to rasterise a very
 * large diagram — and a silently missing figure in a circulated document is
 * worse than a sentence saying why it is missing.
 */
function pushDiagram(
  blocks: ReportBlock[],
  captured: Set<DiagramId>,
  id: DiagramId,
  caption: string,
  section: string,
): void {
  if (captured.has(id)) {
    blocks.push({ kind: 'image', id, caption, alt: `${caption} diagram` })
  } else {
    blocks.push({
      kind: 'callout',
      tone: 'note',
      text: `The ${caption.toLowerCase()} diagram could not be captured for this report, so the ${section} section is described in text only.`,
    })
  }
}

function labelOf(doc: SequenceDoc, id: string): string {
  return doc.participants.find((p) => p.id === id)?.label ?? id
}

function styleWord(style: string): string {
  if (style === 'sync') return 'sync'
  if (style === 'async') return 'async'
  return 'fire-and-forget'
}

export function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : plural(noun)}`
}

/** Enough pluralisation for the nouns this report actually uses. */
function plural(noun: string): string {
  if (/(s|x|ch|sh)$/.test(noun)) return `${noun}es`
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`
  return `${noun}s`
}

function joinList(items: string[]): string {
  if (items.length === 0) return 'nothing'
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function longDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
