import {
  contractByName,
  participantById,
  type Contract,
  type Message,
  type ParticipantKind,
  type ResponseSpec,
  type SequenceDoc,
} from '../dsl/ast'
import { buildTree, type BranchNode, type SeqNode } from '../dsl/tree'

/**
 * Delivery tickets derived from the diagram.
 *
 * A story is a journey the document already groups. Every top-level `opt` and
 * `loop` becomes one; everything left at the top level forms the root story —
 * *including* a top-level `alt`, because an alt is a fork in a journey already
 * under way, not a journey of its own. Splitting on it would turn "the upload
 * succeeded" and "the upload was infected" into two unrelated stories.
 *
 * Within a story, one ticket per participant that carries work. Participants
 * you call but do not build get none: consuming a model endpoint is already
 * work inside the caller's ticket, and raising "Bedrock Embedding Endpoint —
 * be available" helps nobody.
 */

/** Called, not built. No ticket is raised for these. */
export const NON_DELIVERABLE_KINDS: ParticipantKind[] = [
  'external',
  'aws:bedrock',
  'aws:bedrockagent',
  'aws:knowledgebase',
  'aws:sagemaker',
  'aws:textract',
  'aws:comprehend',
  'aws:rekognition',
]

const NON_DELIVERABLE = new Set<string>(NON_DELIVERABLE_KINDS)

/**
 * `->>` parses to sync and `-->>` to async, and this document set uses the
 * dashed arrow for replies. Treating async as an outcome rather than an
 * inbound call is therefore a reading of a convention, not a guarantee —
 * a genuinely asynchronous *request* drawn with `-->>` would be read as a
 * reply here. `fireAndForget` is a real call, so it counts as inbound work.
 */
function isRequest(m: Message): boolean {
  return m.style !== 'async'
}

export interface Criterion {
  scenario: string
  given: string
  when: string
  then: string[]
  kind: 'happy' | 'unhappy'
  /** Declared on a contract, but no branch in the diagram follows from it. */
  unmodelled?: boolean
}

/**
 * One interaction this component takes part in, with the failures that belong
 * to *that* interaction rather than to the ticket as a whole. Steps run in
 * diagram order, and each one's Given is the previous one's success, so the
 * ticket reads as a sequence: this call has to land before the next is reached.
 */
export interface TicketStep {
  /** Position in the diagram, so the sequence is the diagram's own. */
  order: number
  /** 1-based position within this ticket. */
  index: number
  title: string
  /**
   * Set when the step lives inside a failure branch. Such a step is recovery
   * work, not part of the mainline: its precondition is that the branch was
   * taken, so chaining it onto the last successful step would claim the upload
   * records a rejection *after* it succeeded.
   */
  onFailurePath?: string
  happy: Criterion
  unhappy: Criterion[]
}

export interface Ticket {
  id: string
  storyId: string
  participantId: string
  participantLabel: string
  /** Jira-style one-liner. */
  summary: string
  responsibilities: string[]
  contracts: string[]
  steps: TicketStep[]
}

export interface Story {
  id: string
  title: string
  narrative: string
  /** Absent on the root story, which has no block of its own. */
  blockId?: string
  steps: number
  tickets: Ticket[]
}

/** Every criterion in a ticket, flattened in reading order. */
export function allCriteria(ticket: Ticket): Criterion[] {
  return ticket.steps.flatMap((s) => [s.happy, ...s.unhappy])
}

type Role = 'serve' | 'call' | 'internal' | 'emit'

export function buildTickets(doc: SequenceDoc, rootTitle?: string): Story[] {
  const rootNodes: SeqNode[] = []
  const groups: { id: string; title: string; nodes: SeqNode[]; blockId?: string }[] = []

  for (const node of buildTree(doc)) {
    if (node.kind === 'block' && node.block.type !== 'alt') {
      groups.push({
        id: node.block.id,
        title: sentence(node.block.label),
        nodes: [node],
        blockId: node.block.id,
      })
    } else {
      rootNodes.push(node)
    }
  }

  if (messagesOf(rootNodes).length) {
    groups.unshift({
      id: 'root',
      title: rootTitle?.trim() || defaultRootTitle(doc, rootNodes),
      nodes: rootNodes,
    })
  }

  const stories: Story[] = []
  for (const group of groups) {
    const messages = messagesOf(group.nodes)
    if (!messages.length) continue

    // Only branches inside this story can follow from a call inside it. Asking
    // the document-wide matcher would attach the export block's "409 campaign
    // still analysing" to every unrelated 409 in the file — tolerable in a
    // coverage table, actively wrong in an acceptance criterion.
    const branches = unhappyBranches(group.nodes)
    const failurePaths = failureMembership(group.nodes)

    const tickets: Ticket[] = []
    for (const id of participantsIn(messages)) {
      const participant = participantById(doc, id)
      if (!participant || NON_DELIVERABLE.has(participant.kind)) continue
      tickets.push(
        buildTicket(
          doc,
          branches,
          failurePaths,
          group.id,
          group.title,
          id,
          participant.label,
          messages,
        ),
      )
    }

    stories.push({
      id: group.id,
      title: group.title,
      narrative: narrativeFor(doc, messages, tickets.length),
      blockId: group.blockId,
      steps: messages.length,
      tickets,
    })
  }
  return stories
}

/* ------------------------------------------------------------------ tickets */

function buildTicket(
  doc: SequenceDoc,
  branches: UnhappyBranch[],
  failurePaths: Map<string, string>,
  storyId: string,
  storyTitle: string,
  id: string,
  label: string,
  messages: Message[],
): Ticket {
  // Everything this component takes part in, in diagram order. A reply arrow
  // it receives is somebody else's outcome, not work of its own.
  //
  // A reply it *sends* is only a step when it carries a contract or a step
  // number — otherwise it is the acknowledgement of a call already in the
  // sequence, and the two arms of an alt ("Accepted" / "Rejected") would
  // otherwise land as consecutive steps implying one follows the other.
  const mine = messages
    .filter((m) => {
      if (m.to === id && isRequest(m)) return true
      if (m.from !== id) return false
      return roleOf(m, id) !== 'emit' || Boolean(m.contractRef) || isNumbered(m)
    })
    .sort((a, b) => a.order - b.order)

  const responsibilities: string[] = []
  for (const m of mine) {
    switch (roleOf(m, id)) {
      case 'serve':
        responsibilities.push(`Serve "${stepText(m)}" for ${labelOf(doc, m.from)}${suffix(doc, m)}`)
        break
      case 'internal':
        responsibilities.push(stepText(m))
        break
      case 'call':
        responsibilities.push(`${stepText(m)} — calls ${labelOf(doc, m.to)}${suffix(doc, m)}`)
        break
      case 'emit':
        responsibilities.push(`Emit "${stepText(m)}" to ${labelOf(doc, m.to)}${suffix(doc, m)}`)
        break
    }
  }

  // Steps inside a failure branch are recovery work. They are sequenced among
  // themselves, under the branch that reaches them, rather than being chained
  // onto the mainline — the two are alternatives, not a continuation.
  const groups = new Map<string, Message[]>()
  for (const m of mine) {
    const key = failurePaths.get(m.id) ?? ''
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }
  const ordered = [
    ...(groups.get('') ?? []),
    ...[...groups.entries()].filter(([k]) => k).flatMap(([, v]) => v),
  ]

  const steps: TicketStep[] = []
  ordered.forEach((m) => {
    const branch = failurePaths.get(m.id)
    const siblings = groups.get(branch ?? '') as Message[]
    const i = siblings.indexOf(m)
    const role = roleOf(m, id)
    const contract = m.contractRef ? contractByName(doc, m.contractRef) : undefined
    const ok = contract?.responses.find((r) => r.isHappyPath)
    const title = stepText(m)
    const previous = i > 0 ? siblings[i - 1] : undefined
    const next = siblings[i + 1]

    // The inbound call opens the sequence but its reply is drawn at the end,
    // so claiming the happy response here would put the 200 before the work.
    const repliesLater = siblings
      .slice(i + 1)
      .some((x) => roleOf(x, id) === 'emit' && x.to === m.from)

    const outcome = ((): string => {
      switch (role) {
        case 'serve':
          if (repliesLater) return `${label} accepts the request and begins work`
          return ok ? `${label} responds ${responseText(ok)}` : `${label} accepts the request`
        case 'call':
          return ok
            ? `${labelOf(doc, m.to)} responds ${responseText(ok)}`
            : `the call to ${labelOf(doc, m.to)} succeeds`
        case 'emit':
          return ok
            ? `${labelOf(doc, m.to)} receives ${responseText(ok)}`
            : `${labelOf(doc, m.to)} receives it`
        case 'internal':
          return `${label} completes "${title}"`
      }
    })()

    const when = ((): string => {
      switch (role) {
        case 'serve':
          return contract
            ? `${labelOf(doc, m.from)} calls ${callText(doc, m)}`
            : `${labelOf(doc, m.from)} asks ${label} to ${lower(title)}`
        case 'call':
          return contract
            ? `${label} calls ${labelOf(doc, m.to)} — ${callText(doc, m)}`
            : `${label} asks ${labelOf(doc, m.to)} to ${lower(title)}`
        case 'emit':
          return `${label} emits "${title}" to ${labelOf(doc, m.to)}`
        case 'internal':
          // Step labels are imperative ("Parse the workbook"), so splicing one
          // into a sentence gives "Pre-processing Container parse the …".
          // Quoting it sidesteps conjugation entirely.
          return `${label} runs "${title}"`
      }
    })()

    steps.push({
      order: m.order,
      index: steps.length + 1,
      title,
      onFailurePath: branch,
      happy: {
        scenario: title,
        given: previous
          ? `"${stepText(previous)}" succeeded`
          : branch
            ? `the "${branch}" path was taken`
            : role === 'serve'
              ? `${lower(storyTitle)}, and the request is valid`
              : lower(storyTitle),
        when,
        then: [
          outcome,
          // The point of the chain: success here is what unlocks the next step.
          next
            ? `"${stepText(next)}" can proceed`
            : branch
              ? `the "${branch}" path is complete`
              : `${label} has finished its part`,
        ],
        kind: 'happy',
      },
      unhappy: contract ? failuresFor(doc, branches, contract, m, id, label) : [],
    })
  })

  return {
    id: `${storyId}/${id}`,
    storyId,
    participantId: id,
    participantLabel: label,
    summary: `${label} — ${lower(storyTitle)}`,
    responsibilities: dedupe(responsibilities),
    contracts: unique(mine.filter((m) => m.contractRef).map((m) => m.contractRef as string)),
    steps,
  }
}

function roleOf(m: Message, id: string): Role {
  if (m.from === id && m.to === id) return 'internal'
  if (m.to === id) return 'serve'
  return isRequest(m) ? 'call' : 'emit'
}

/**
 * The failures of one interaction, worded from this component's side: whoever
 * produces the response returns it, whoever made the call handles it. On a
 * reply arrow the producer is the sender, so a contract on `Pre-->>UI` belongs
 * to Pre and gives UI nothing to return.
 */
function failuresFor(
  doc: SequenceDoc,
  branches: UnhappyBranch[],
  contract: Contract,
  m: Message,
  id: string,
  label: string,
): Criterion[] {
  const producer = isRequest(m) ? m.to : m.from
  const returns = producer === id
  const out: Criterion[] = []

  for (const response of contract.responses) {
    if (response.isHappyPath) continue
    const branch = branchFor(branches, m, response)
    out.push(
      returns
        ? {
            scenario: `${label} returns ${responseText(response)}`,
            given: `${labelOf(doc, m.from)} has called ${callText(doc, m)}`,
            when: condition(response),
            then: [
              `${label} responds ${responseText(response)}${
                response.modelName ? ` with ${response.modelName}` : ''
              }`,
            ],
            kind: 'unhappy',
            unmodelled: !branch,
          }
        : {
            scenario: `${contract.name} returns ${responseText(response)}`,
            given: `${label} has called ${labelOf(doc, m.to)} (${callText(doc, m)})`,
            when: `${labelOf(doc, m.to)} responds ${responseText(response)}`,
            then: [
              branch
                ? `the "${branch}" path is taken`
                : 'the failure is handled and reported to the caller — the diagram draws no path for it, so confirm the intended behaviour',
            ],
            kind: 'unhappy',
            unmodelled: !branch,
          },
    )
  }
  return out
}

/* ------------------------------------------------------------------ helpers */

interface UnhappyBranch {
  label: string
  /** Where the block owning this branch opens. */
  blockStart: number
  /** Every message inside that block, so ancestry is a set lookup. */
  contains: Set<string>
}

/**
 * Which messages sit inside a failure branch, and which branch reaches them.
 * The innermost branch wins, so a step nested two deep is attributed to the
 * condition that actually guards it.
 */
function failureMembership(
  nodes: SeqNode[],
  out: Map<string, string> = new Map(),
): Map<string, string> {
  for (const node of nodes) {
    if (node.kind !== 'block') continue
    for (const branch of node.branches as BranchNode[]) {
      failureMembership(branch.children, out)
      if (!branch.isUnhappy || !branch.label) continue
      for (const m of messagesOf(branch.children)) {
        if (!out.has(m.id)) out.set(m.id, branch.label)
      }
    }
  }
  return out
}

/**
 * Unhappy branches inside one story. `buildTree` synthesises a single branch
 * for a non-alt block, so an `opt … (unhappy)` is collected here too.
 */
function unhappyBranches(nodes: SeqNode[], out: UnhappyBranch[] = []): UnhappyBranch[] {
  for (const node of nodes) {
    if (node.kind !== 'block') continue
    let contains: Set<string> | undefined
    for (const branch of node.branches as BranchNode[]) {
      if (!branch.isUnhappy || !branch.label) continue
      contains ??= new Set(messagesOf([node]).map((m) => m.id))
      out.push({ label: branch.label, blockStart: node.block.startOrder, contains })
    }
    for (const branch of node.branches) unhappyBranches(branch.children, out)
  }
  return out
}

/**
 * A branch follows from a response when it names the code *and* is reachable
 * from the call: either the call sits inside that block, or the block opens
 * after the call — which is the `call, then alt on the result` shape. A branch
 * that closed before the call was made cannot be its consequence.
 */
function branchFor(
  branches: UnhappyBranch[],
  m: Message,
  r: ResponseSpec,
): string | undefined {
  const code = r.code.trim().toLowerCase()
  if (!code) return undefined
  // Word boundary so `40` never matches `404`.
  const named = new RegExp(`(^|[^\\w])${escapeRegExp(code)}([^\\w]|$)`)
  return branches.find(
    (b) =>
      named.test(b.label.toLowerCase()) && (b.contains.has(m.id) || b.blockStart >= m.order),
  )?.label
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function messagesOf(nodes: SeqNode[], out: Message[] = []): Message[] {
  for (const node of nodes) {
    if (node.kind === 'message') out.push(node.message)
    else if (node.kind === 'block') {
      for (const branch of node.branches) messagesOf(branch.children, out)
    }
  }
  return out
}

function participantsIn(messages: Message[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of messages) {
    for (const id of [m.from, m.to]) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

function defaultRootTitle(doc: SequenceDoc, nodes: SeqNode[]): string {
  const first = messagesOf(nodes).find((m) => {
    const p = participantById(doc, m.from)
    return p?.kind === 'client' && isRequest(m)
  })
  return first ? sentence(stepText(first)) : 'Main flow'
}

/**
 * Deliberately not "As a … I want … so that …". A story title here is a block
 * label, which is a description rather than a goal, so the template produces
 * broken English ("I want to maintaining the bank") and a benefit clause the
 * diagram cannot know. Stating who starts the journey and how big it is says
 * only what is true; the goal is the writer's to add.
 */
function narrativeFor(doc: SequenceDoc, messages: Message[], components: number): string {
  const starter =
    messages.find((m) => participantById(doc, m.from)?.kind === 'client' && isRequest(m)) ??
    messages[0]
  return [
    `Initiated by ${labelOf(doc, starter.from)}`,
    plural(messages.length, 'step'),
    plural(components, 'component'),
  ].join(' · ')
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** A numbered step is one the author marked as significant. */
function isNumbered(m: Message): boolean {
  return /^\s*\(\d+\)/.test(m.label)
}

/** Strips the leading step number: "(7) Embed the chunks" -> "Embed the chunks". */
function stepText(m: Message): string {
  return m.label.replace(/^\s*\(\d+\)\s*/, '').trim() || m.label.trim()
}

function callText(doc: SequenceDoc, m: Message): string {
  const contract = m.contractRef ? contractByName(doc, m.contractRef) : undefined
  if (!contract) return stepText(m)
  return httpLine(contract) ?? contract.name
}

function httpLine(contract: Contract): string | undefined {
  if (contract.transport !== 'http' || !contract.path) return undefined
  return `${contract.method ?? 'GET'} ${contract.path}`
}

function suffix(doc: SequenceDoc, m: Message): string {
  if (!m.contractRef) return ''
  const contract = contractByName(doc, m.contractRef)
  if (!contract) return ''
  const http = httpLine(contract)
  return http ? ` — ${http} (${contract.name})` : ` — ${contract.name}`
}

function responseText(r: ResponseSpec): string {
  return r.label ? `${r.code} ${r.label}` : r.code
}

/**
 * Turns a response into a plain-English trigger for the When line. A numeric
 * code says nothing a reader needs here, but a worded one carries half the
 * meaning — `pii detected` reduced to "detected" loses the subject.
 */
function condition(r: ResponseSpec): string {
  const code = r.code.trim()
  const worded = /^\d+$/.test(code) ? '' : code
  const label = [worded, r.label.trim()].filter(Boolean).join(' ')
  if (!label) return `the call cannot be completed (${r.code})`
  const spaced = label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
  return `the request meets the "${spaced}" condition`
}

function labelOf(doc: SequenceDoc, id: string): string {
  return participantById(doc, id)?.label ?? id
}

function sentence(text: string): string {
  const t = text.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

function lower(text: string): string {
  const t = text.trim()
  // Leaves acronyms and proper nouns alone: only a plain capital is folded.
  return t && t[0] === t[0].toUpperCase() && t[1] !== t[1]?.toUpperCase()
    ? t[0].toLowerCase() + t.slice(1)
    : t
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter((i) => (seen.has(i) ? false : (seen.add(i), true)))
}
