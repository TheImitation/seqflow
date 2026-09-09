import { contractByName, type SequenceDoc } from './ast'
import { messageFailures } from './architecture'
import { buildTree, collectAltBlocks, flattenSteps, type BranchNode } from './tree'
import type { Block } from './ast'

/**
 * Every distinct way the diagram can play out.
 *
 * Playback already walks one path at a time, chosen by `branchChoice`. An
 * outcome is just a `branchChoice` that has been named: enumerate the choices,
 * run each through `flattenSteps`, and keep the ones that produce a different
 * sequence of messages. Nesting means the count is usually far below the raw
 * product — a choice inside a branch nobody took changes nothing.
 */

export interface Decision {
  blockId: string
  /** The `alt` this decision belongs to, named by its first branch. */
  blockLabel: string
  branchIndex: number
  branchLabel: string
  isUnhappy: boolean
}

export interface Outcome {
  /** Stable across reparses: built from branch labels, not positional ids. */
  id: string
  /** Feed straight to `setBranchChoice` to make playback walk this path. */
  choice: Record<string, number>
  /** Only the decisions this path actually reached. */
  decisions: Decision[]
  messageIds: string[]
  stepCount: number
  /** True when the path ends on a branch marked `(unhappy)`. */
  isUnhappy: boolean
  /** Participant the last message lands on — where this path leaves you. */
  endsAt?: string
  /** Failure responses declared but never drawn, on this path's messages. */
  declaredFailures: number
}

const MAX_COMBOS = 4096

export function enumerateOutcomes(doc: SequenceDoc): Outcome[] {
  const tree = buildTree(doc)
  const alts = collectAltBlocks(tree)
  if (!alts.length) return [outcomeFrom(doc, tree, {}, alts)]

  // Guard against a pathological diagram: 12 nested alts is already 4096.
  let combos: Record<string, number>[] = [{}]
  for (const { block, branches } of alts) {
    const next: Record<string, number>[] = []
    for (const base of combos) {
      for (let i = 0; i < branches.length; i++) next.push({ ...base, [block.id]: i })
    }
    combos = next
    if (combos.length > MAX_COMBOS) break
  }

  const byPath = new Map<string, Outcome>()
  for (const choice of combos) {
    const outcome = outcomeFrom(doc, tree, choice, alts)
    // Two choices that produce the same walk are the same outcome: the extra
    // decision was inside a branch this path never entered.
    const key = outcome.messageIds.join('>')
    if (!byPath.has(key)) byPath.set(key, outcome)
  }

  return [...byPath.values()].sort(
    (a, z) => Number(a.isUnhappy) - Number(z.isUnhappy) || z.stepCount - a.stepCount,
  )
}

function outcomeFrom(
  doc: SequenceDoc,
  tree: ReturnType<typeof buildTree>,
  choice: Record<string, number>,
  alts: { block: Block; branches: BranchNode[] }[],
): Outcome {
  const steps = flattenSteps(tree, choice)
  const messageIds = steps.map((s) => s.message.id)

  // Only decisions on the walked path have blockPath entries, so this drops the
  // choices that were never reached.
  const seen = new Map<string, Decision>()
  for (const step of steps) {
    for (const { block, branch } of step.blockPath) {
      if (block.type !== 'alt' || seen.has(block.id)) continue
      const alt = alts.find((a) => a.block.id === block.id)
      seen.set(block.id, {
        blockId: block.id,
        blockLabel: alt?.branches[0]?.label || block.label || block.id,
        branchIndex: branch.index,
        branchLabel: branch.label || `branch ${branch.index + 1}`,
        isUnhappy: !!branch.isUnhappy,
      })
    }
  }
  const decisions = [...seen.values()]

  let declaredFailures = 0
  for (const step of steps) {
    if (!contractByName(doc, step.message.contractRef)) continue
    declaredFailures += messageFailures(doc, step.message).declared
  }

  const last = steps.at(-1)?.message
  return {
    id: decisions.length
      ? decisions.map((d) => `${d.blockLabel}=${d.branchLabel}`).join(' · ')
      : 'single path',
    choice: Object.fromEntries(decisions.map((d) => [d.blockId, d.branchIndex])),
    decisions,
    messageIds,
    stepCount: messageIds.length,
    isUnhappy: decisions.some((d) => d.isUnhappy),
    endsAt: last?.to,
    declaredFailures,
  }
}
