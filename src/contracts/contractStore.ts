import {
  type Contract,
  type DataModel,
  type HttpMethod,
  type Message,
  type SequenceDoc,
  type Transport,
} from '../dsl/ast'
import { inferMethod, inferPath, inferTransport } from './unhappyPathRules'

/**
 * Contracts and models are keyed by name, not by position — so reordering a
 * message or editing its label never orphans its contract, and the same
 * contract can sit on as many arrows as apply.
 */

export function contractUsage(doc: SequenceDoc, name: string): Message[] {
  return doc.messages.filter((m) => m.contractRef === name)
}

/** A unique, readable contract name derived from the message it will sit on. */
export function suggestContractName(doc: SequenceDoc, message: Message): string {
  const base =
    pascal(message.label) || `${pascal(message.from)}To${pascal(message.to)}` || 'Contract'
  if (!doc.contracts.some((c) => c.name === base)) return base
  let n = 2
  while (doc.contracts.some((c) => c.name === `${base}${n}`)) n++
  return `${base}${n}`
}

export function suggestModelName(doc: SequenceDoc, base: string): string {
  const clean = pascal(base) || 'Payload'
  if (!doc.dataModels.some((m) => m.name === clean)) return clean
  let n = 2
  while (doc.dataModels.some((m) => m.name === `${clean}${n}`)) n++
  return `${clean}${n}`
}

/** Build a contract pre-filled from what the message already implies. */
export function draftContract(doc: SequenceDoc, message: Message): Contract {
  const transport = inferTransport(doc, message)
  const isHttp = transport === 'http'

  return {
    name: suggestContractName(doc, message),
    transport,
    ...(isHttp
      ? { method: inferMethod(doc, message) as HttpMethod, path: inferPath(message) }
      : {}),
    headers: isHttp
      ? [
          { key: 'Content-Type', value: 'application/json', required: true },
          { key: 'X-Correlation-Id', value: 'string', required: true },
        ]
      : [{ key: 'x-correlation-id', value: 'string', required: true }],
    responses: isHttp
      ? [{ code: defaultHappyCode(message, doc), label: 'OK', isHappyPath: true }]
      : [{ code: 'delivered', label: 'Accepted by the broker', isHappyPath: true }],
  }
}

function defaultHappyCode(message: Message, doc: SequenceDoc): string {
  const method = inferMethod(doc, message)
  if (method === 'POST') return '201'
  if (method === 'DELETE') return '204'
  return '200'
}

export function emptyModel(name: string): DataModel {
  return {
    name,
    fields: [{ name: 'id', type: 'string', required: true }],
  }
}

export const TRANSPORTS: { value: Transport; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'sqs', label: 'SQS' },
  { value: 'sns', label: 'SNS' },
  { value: 'eventbridge', label: 'EventBridge' },
  { value: 'kinesis', label: 'Kinesis' },
  { value: 'generic-async', label: 'Generic async' },
]

/** Rename a contract everywhere it is referenced. */
export function renameContract(doc: SequenceDoc, from: string, to: string): boolean {
  const trimmed = to.trim()
  if (!trimmed || /[^\w-]/.test(trimmed) || trimmed === from) return false
  if (doc.contracts.some((c) => c.name === trimmed)) return false

  const contract = doc.contracts.find((c) => c.name === from)
  if (!contract) return false
  contract.name = trimmed
  for (const m of doc.messages) if (m.contractRef === from) m.contractRef = trimmed
  return true
}

function pascal(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
    .replace(/^[0-9]+/, '')
}
