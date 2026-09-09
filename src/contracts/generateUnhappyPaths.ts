import {
  contractByName,
  participantById,
  type Block,
  type Branch,
  type ParticipantKind,
  type SequenceDoc,
} from '../dsl/ast'
import {
  cloneDoc,
  insertMessage,
  insertNote,
  nextBlockId,
  reparentInto,
} from '../dsl/edit'
import { splitUnhappy } from '../dsl/parser'
import {
  HTTP_METHODS,
  suggestionContext,
  type Ref,
  type UnhappySuggestion,
} from './unhappyPathRules'

export interface ApplyOptions {
  /** Label for the surviving happy branch, e.g. `200 OK`. */
  happyLabel?: string
  /** Reply message generated for the happy branch when none exists yet. */
  happyReply?: string
  /** Also record each branch as a response on the message's contract. */
  addContractResponses: boolean
  /** Reuse this participant instead of creating a dead-letter queue. */
  dlqParticipantId?: string
}

export interface ApplyResult {
  doc: SequenceDoc
  createdParticipantId?: string
  addedResponses: number
  addedBranches: number
  addedBlocks: number
}

/** Suggest a happy-branch label from the contract, then the method table. */
export function defaultHappyLabel(doc: SequenceDoc, messageId: string): string {
  const m = doc.messages.find((x) => x.id === messageId)
  if (!m) return 'success'

  const contract = contractByName(doc, m.contractRef)
  const happy = contract?.responses.find((r) => r.isHappyPath)
  if (happy) return `${happy.code} ${happy.label}`.trim()

  const ctx = suggestionContext(doc, m)
  if (ctx.transport !== 'http') return 'delivered'
  const info = HTTP_METHODS.find((x) => x.method === ctx.method)
  const code = info?.happy ?? '200'
  return `${code} ${code === '201' ? 'Created' : code === '204' ? 'No Content' : 'OK'}`
}

/** An existing dead-letter-ish participant, if the diagram already has one. */
export function findDlqParticipant(doc: SequenceDoc): string | undefined {
  return doc.participants.find(
    (p) => /dlq|dead[- ]?letter/i.test(p.id) || /dlq|dead[- ]?letter/i.test(p.label),
  )?.id
}

/**
 * Turn ticked suggestions into real `alt` / `opt` blocks in the AST. Sync HTTP
 * branches hang off the existing reply; async transports get a trailing `opt`
 * carrying the retry/DLQ messages.
 */
export function applyUnhappyPaths(
  doc: SequenceDoc,
  messageId: string,
  chosen: UnhappySuggestion[],
  options: ApplyOptions,
): ApplyResult {
  const next = cloneDoc(doc)
  const m = next.messages.find((x) => x.id === messageId)
  if (!m || !chosen.length) {
    return { doc: next, addedResponses: 0, addedBranches: 0, addedBlocks: 0 }
  }

  const parent = m.parentBlock
  let createdParticipantId: string | undefined

  /* ---------------------------------------------------- resolve placeholders */
  const needsDlq = chosen.some((s) => s.needsParticipant)
  let dlqId = options.dlqParticipantId ?? findDlqParticipant(next)
  if (needsDlq && !dlqId) {
    const spec = chosen.find((s) => s.needsParticipant)!.needsParticipant!
    dlqId = uniqueId(next, spec.idHint)
    next.participants.push({
      id: dlqId,
      label: spec.labelHint,
      kind: spec.kind as ParticipantKind,
    })
    createdParticipantId = dlqId
  }

  const ctx = suggestionContext(next, m)
  const resolve = (ref: Ref): string => {
    switch (ref) {
      case 'source':
        return m.from
      case 'target':
        return m.to
      case 'dlq':
        return dlqId ?? m.to
      case 'broker':
        return ctx.brokerId ?? m.to
      case 'consumer':
        return ctx.consumerId ?? m.from
    }
  }

  /* ------------------------------------------------------------- emit steps */
  let cursor = m.order + 1
  const emit = (suggestion: UnhappySuggestion): void => {
    for (const step of suggestion.steps) {
      if (step.kind === 'message') {
        insertMessage(next, cursor, {
          from: resolve(step.from),
          to: resolve(step.to),
          label: step.label,
          style: step.style,
          parentBlock: parent,
        })
      } else {
        insertNote(next, cursor, {
          over: dedupe(step.over.map(resolve)),
          text: step.text,
          placement: 'over',
          parentBlock: parent,
        })
      }
      cursor++
    }
  }

  const altSuggestions = chosen.filter((s) => s.shape === 'alt')
  const optSuggestions = chosen.filter((s) => s.shape === 'opt')
  let addedBranches = 0
  let addedBlocks = 0

  /* ------------------------------------------------------- the alt (sync)  */
  if (altSuggestions.length) {
    const blockStart = cursor
    const happyLabel = options.happyLabel ?? defaultHappyLabel(next, messageId)

    const existingReply = next.messages.find(
      (x) =>
        x.order === cursor &&
        x.parentBlock === parent &&
        x.from === m.to &&
        x.to === m.from &&
        sameBranch(next, parent, m.order, x.order),
    )
    if (existingReply) {
      cursor++
    } else {
      insertMessage(next, cursor, {
        from: m.to,
        to: m.from,
        label: options.happyReply ?? happyLabel,
        style: 'async',
        parentBlock: parent,
      })
      cursor++
    }

    const branches: Branch[] = [
      { label: happyLabel, startOrder: blockStart, endOrder: cursor },
    ]

    for (const s of altSuggestions) {
      const start = cursor
      emit(s)
      const { label, isUnhappy } = splitUnhappy(s.label)
      branches.push({
        label,
        startOrder: start,
        endOrder: cursor,
        isUnhappy: isUnhappy ?? true,
      })
      addedBranches++
    }

    const block: Block = {
      id: nextBlockId(next),
      type: 'alt',
      label: happyLabel,
      startOrder: blockStart,
      endOrder: cursor,
      parentBlock: parent,
      branches,
    }
    next.blocks.push(block)
    reparentInto(next, block, parent, blockStart, cursor)
    addedBlocks++
  }

  /* ------------------------------------------------------ the opts (async) */
  for (const s of optSuggestions) {
    const start = cursor
    emit(s)
    const { label, isUnhappy } = splitUnhappy(s.label)
    const block: Block = {
      id: nextBlockId(next),
      type: 'opt',
      label,
      startOrder: start,
      endOrder: cursor,
      parentBlock: parent,
      isUnhappy: isUnhappy ?? true,
    }
    next.blocks.push(block)
    reparentInto(next, block, parent, start, cursor)
    addedBlocks++
  }

  /* --------------------------------------------------------------- contract */
  let addedResponses = 0
  const contract = contractByName(next, m.contractRef)
  if (options.addContractResponses && contract) {
    for (const s of chosen) {
      if (!s.response) continue
      if (contract.responses.some((r) => r.code === s.response!.code)) continue
      contract.responses.push({
        code: s.response.code,
        label: s.response.label,
        isHappyPath: false,
      })
      addedResponses++
    }
  }

  next.blocks.sort((a, z) => a.startOrder - z.startOrder || z.endOrder - a.endOrder)
  return { doc: next, createdParticipantId, addedResponses, addedBranches, addedBlocks }
}

/* ----------------------------------------------------------------- helpers */

/** Two orders sit in the same branch of their shared enclosing block. */
function sameBranch(
  doc: SequenceDoc,
  parentId: string | undefined,
  a: number,
  b: number,
): boolean {
  if (!parentId) return true
  const block = doc.blocks.find((x) => x.id === parentId)
  if (!block?.branches?.length) return true
  const idx = (o: number) =>
    block.branches!.findIndex((br) => o >= br.startOrder && o < br.endOrder)
  return idx(a) === idx(b)
}

function uniqueId(doc: SequenceDoc, hint: string): string {
  if (!participantById(doc, hint)) return hint
  let n = 2
  while (participantById(doc, `${hint}${n}`)) n++
  return `${hint}${n}`
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)]
}
