import {
  contractByName,
  type ArchEdge,
  type ArchNode,
  type MessageStyle,
  type SequenceDoc,
} from './ast'

export interface ArchGraph {
  nodes: ArchNode[]
  edges: ArchEdge[]
  /** Edge id -> the ids of the messages that produced it. */
  edgeMessages: Map<string, string[]>
}

export function edgeId(from: string, to: string): string {
  return `${from} ${to}`
}

/**
 * The whole "infer the microservices diagram" feature: one node per participant,
 * one edge per unique (from, to) pair. Derived on every change, never stored.
 */
export function inferArchitecture(doc: SequenceDoc): ArchGraph {
  const nodes: ArchNode[] = doc.participants.map((p) => ({
    participantId: p.id,
    kind: p.kind,
  }))

  const byPair = new Map<string, ArchEdge>()
  const edgeMessages = new Map<string, string[]>()

  for (const m of doc.messages) {
    if (m.from === m.to) continue // a self-call is not an architecture link
    const id = edgeId(m.from, m.to)

    let edge = byPair.get(id)
    if (!edge) {
      edge = {
        from: m.from,
        to: m.to,
        interactionCount: 0,
        styles: new Set<MessageStyle>(),
        messageLabels: [],
        hasUnhappyPath: false,
        declaredFailures: 0,
      }
      byPair.set(id, edge)
      edgeMessages.set(id, [])
    }

    edge.interactionCount++
    edge.styles.add(m.style)
    if (m.label && !edge.messageLabels.includes(m.label)) edge.messageLabels.push(m.label)
    edgeMessages.get(id)!.push(m.id)

    const failures = messageFailures(doc, m)
    if (failures.realised) edge.hasUnhappyPath = true
    edge.declaredFailures += failures.declared
  }

  return { nodes, edges: [...byPair.values()], edgeMessages }
}

/** What a single message says about failure. */
export interface FailureSignal {
  /**
   * The message sits inside an `(unhappy)` block or branch — a path that exists
   * in order-space, that playback can walk, and whose consequences are drawn.
   */
  realised: boolean
  /**
   * Failure responses declared on the attached contract. Metadata about one
   * call: no position in the sequence, nothing to animate, no consequence
   * modelled anywhere. Declaring a 429 costs one line and buys no coverage.
   */
  declared: number
}

/**
 * These two used to be one boolean, which meant "this contract mentions an
 * error code" and "this failure is actually modelled" were indistinguishable —
 * and the first is nearly free to satisfy, so coverage read far higher than it
 * was. They are kept apart now.
 */
export function messageFailures(
  doc: SequenceDoc,
  message: { id: string; order: number; parentBlock?: string; contractRef?: string },
): FailureSignal {
  const contract = contractByName(doc, message.contractRef)
  const declared = contract?.responses.filter((r) => !r.isHappyPath).length ?? 0
  return { realised: isInsideUnhappyBranch(doc, message), declared }
}

/** True only for a message on a drawn failure branch. */
export function messageIsOnUnhappyPath(
  doc: SequenceDoc,
  message: { id: string; order: number; parentBlock?: string; contractRef?: string },
): boolean {
  return isInsideUnhappyBranch(doc, message)
}

function isInsideUnhappyBranch(
  doc: SequenceDoc,
  message: { order: number; parentBlock?: string },
): boolean {
  let current = message.parentBlock
  let order = message.order
  const guard = new Set<string>()

  while (current && !guard.has(current)) {
    guard.add(current)
    const block = doc.blocks.find((b) => b.id === current)
    if (!block) break
    if (block.isUnhappy) return true
    const branch = block.branches?.find(
      (b) => order >= b.startOrder && order < b.endOrder,
    )
    if (branch?.isUnhappy) return true
    // Walk out to the parent using the block's own position in the outer range.
    order = block.startOrder
    current = block.parentBlock
  }
  return false
}
