import type { SequenceDoc } from './ast'
import type { ValidationResult } from '../components/DraftField'

/**
 * Why identifiers are constrained: the DSL splits message lines on whitespace
 * (`A->>B: label`) and contract references on `@Name`, so an id containing a
 * space or punctuation would not survive a round-trip. Rather than reject
 * silently, each rule explains itself and offers the nearest legal value.
 */

const RESERVED_IDS = new Set([
  'sequenceDiagram',
  'participant',
  'actor',
  'loop',
  'alt',
  'else',
  'opt',
  'end',
  'note',
  'model',
  'contract',
  'table',
  'autonumber',
  'activate',
  'deactivate',
])

/** `Mobile Client` -> `MobileClient`, `payment-svc!` -> `payment-svc`. */
export function toIdentifier(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
}

export function validateParticipantId(
  doc: SequenceDoc,
  currentId: string,
  next: string,
): ValidationResult | undefined {
  const trimmed = next.trim()
  if (trimmed === currentId) return undefined

  if (!trimmed) {
    return { error: 'An id is required.', suggestion: currentId }
  }
  if (/\s/.test(trimmed)) {
    return {
      error: 'Ids cannot contain spaces — message lines split on them. Put the spaced version in Label instead.',
      suggestion: toIdentifier(trimmed),
    }
  }
  if (/[^\w-]/.test(trimmed)) {
    return {
      error: 'Ids can use letters, digits, underscore and hyphen only.',
      suggestion: toIdentifier(trimmed) || undefined,
    }
  }
  if (/^[0-9]/.test(trimmed)) {
    return { error: 'Ids cannot start with a digit.', suggestion: `_${trimmed}` }
  }
  if (RESERVED_IDS.has(trimmed) || RESERVED_IDS.has(trimmed.toLowerCase())) {
    return {
      error: `"${trimmed}" is a DSL keyword.`,
      suggestion: `${trimmed}Svc`,
    }
  }
  if (doc.participants.some((p) => p.id === trimmed)) {
    return {
      error: `"${trimmed}" is already used by another participant.`,
      suggestion: uniqueParticipantId(doc, trimmed),
    }
  }
  return undefined
}

export function validateContractName(
  doc: SequenceDoc,
  currentName: string,
  next: string,
): ValidationResult | undefined {
  const trimmed = next.trim()
  if (trimmed === currentName) return undefined

  if (!trimmed) return { error: 'A contract needs a name.', suggestion: currentName }
  if (/\s/.test(trimmed)) {
    return {
      error: 'Contract names cannot contain spaces — arrows reference them as @Name.',
      suggestion: toIdentifier(trimmed),
    }
  }
  if (/[^\w-]/.test(trimmed)) {
    return {
      error: 'Contract names can use letters, digits, underscore and hyphen only.',
      suggestion: toIdentifier(trimmed) || undefined,
    }
  }
  if (doc.contracts.some((c) => c.name === trimmed)) {
    return {
      error: `"${trimmed}" is already used by another contract.`,
      suggestion: uniqueContractName(doc, trimmed),
    }
  }
  return undefined
}

function uniqueParticipantId(doc: SequenceDoc, base: string): string {
  let n = 2
  while (doc.participants.some((p) => p.id === `${base}${n}`)) n++
  return `${base}${n}`
}

function uniqueContractName(doc: SequenceDoc, base: string): string {
  let n = 2
  while (doc.contracts.some((c) => c.name === `${base}${n}`)) n++
  return `${base}${n}`
}
