import type { DataModel, DataModelField, FieldType, SequenceDoc } from '../dsl/ast'

/**
 * Field edits addressed by index path — `[2, 0]` is the first child of the
 * third field. `model` blocks are the one part of the DSL with no other UI, so
 * these back an inspector that can build one from nothing.
 */
export type FieldPath = number[]

export const FIELD_TYPES: FieldType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'enum',
  'object',
  'array',
]

/** The list a path's field lives in, or undefined if the path is stale. */
function containerOf(
  model: DataModel,
  path: FieldPath,
): DataModelField[] | undefined {
  let list = model.fields
  for (const index of path.slice(0, -1)) {
    const child = list[index]
    if (!child?.children) return undefined
    list = child.children
  }
  return list
}

export function fieldAt(model: DataModel, path: FieldPath): DataModelField | undefined {
  const list = containerOf(model, path)
  return list?.[path[path.length - 1]]
}

/** `path` is the container: `[]` for the model root, `[1]` for field 1's children. */
export function addField(model: DataModel, path: FieldPath): string {
  let list = model.fields
  for (const index of path) {
    const child = list[index]
    if (!child) return ''
    child.children ??= []
    list = child.children
  }
  const name = uniqueFieldName(list)
  list.push({ name, type: 'string', required: false })
  return name
}

export function updateField(
  model: DataModel,
  path: FieldPath,
  patch: Partial<DataModelField>,
): boolean {
  const field = fieldAt(model, path)
  if (!field) return false
  Object.assign(field, patch)

  // Only container types carry children; switching away drops them rather than
  // leaving orphans the serializer would emit as a stray brace.
  if (field.type === 'object' || field.type === 'array') field.children ??= []
  else delete field.children

  if (field.type === 'enum') field.enumValues ??= ['a', 'b']
  else delete field.enumValues

  return true
}

export function removeField(model: DataModel, path: FieldPath): boolean {
  const list = containerOf(model, path)
  const index = path[path.length - 1]
  if (!list || !list[index]) return false
  list.splice(index, 1)
  return true
}

export function moveField(model: DataModel, path: FieldPath, dir: -1 | 1): boolean {
  const list = containerOf(model, path)
  const index = path[path.length - 1]
  const target = index + dir
  if (!list || !list[index] || target < 0 || target >= list.length) return false
  const [field] = list.splice(index, 1)
  list.splice(target, 0, field)
  return true
}

/** Field names must be unique within their own object, not globally. */
export function validateFieldName(
  model: DataModel,
  path: FieldPath,
  next: string,
): { error?: string; suggestion?: string } | undefined {
  const trimmed = next.trim()
  const current = fieldAt(model, path)
  if (!current || trimmed === current.name) return undefined

  if (!trimmed) return { error: 'A field needs a name.', suggestion: current.name }
  if (!/^[A-Za-z_][\w-]*$/.test(trimmed)) {
    const cleaned = trimmed.replace(/[^\w-]/g, '') || 'field'
    return {
      error: 'Field names start with a letter and use letters, digits, _ or -.',
      suggestion: /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned,
    }
  }

  const siblings = containerOf(model, path) ?? []
  if (siblings.some((f, i) => f.name === trimmed && i !== path[path.length - 1])) {
    return {
      error: `"${trimmed}" is already used here.`,
      suggestion: uniqueFieldName(siblings, trimmed),
    }
  }
  return undefined
}

function uniqueFieldName(list: DataModelField[], base = 'field'): string {
  if (!list.some((f) => f.name === base)) return base
  let n = 2
  while (list.some((f) => f.name === `${base}${n}`)) n++
  return `${base}${n}`
}

/** A model name that does not collide, for the "create a model" button. */
export function uniqueModelName(doc: SequenceDoc, base: string): string {
  const clean = base.replace(/[^\w]/g, '') || 'Payload'
  if (!doc.dataModels.some((m) => m.name === clean)) return clean
  let n = 2
  while (doc.dataModels.some((m) => m.name === `${clean}${n}`)) n++
  return `${clean}${n}`
}
