import type { DataModel, DataModelField, SequenceDoc } from '../dsl/ast'

export type JsonSchema = Record<string, unknown>

/** One `DataModelField` as a JSON Schema fragment. */
export function fieldSchema(field: DataModelField): JsonSchema {
  const base: JsonSchema = (() => {
    switch (field.type) {
      case 'string':
        return { type: 'string' }
      case 'number':
        return { type: 'number' }
      case 'boolean':
        return { type: 'boolean' }
      case 'date':
        return { type: 'string', format: 'date-time' }
      case 'enum':
        return { type: 'string', enum: field.enumValues ?? [] }
      case 'file':
        // The OpenAPI spelling for an uploaded part.
        return { type: 'string', format: 'binary' }
      case 'object':
        return objectSchema(field.children ?? [])
      case 'array':
        return {
          type: 'array',
          items: field.children?.length ? objectSchema(field.children) : {},
        }
      case 'vector': {
        const dimensions = typeof field.example === 'number' ? field.example : undefined
        return {
          type: 'array',
          items: { type: 'number' },
          ...(dimensions !== undefined ? { minItems: dimensions, maxItems: dimensions } : {}),
        }
      }
    }
  })()

  // A vector's `example` is its dimension, not an example value — already
  // folded into minItems/maxItems above.
  if (field.example !== undefined && field.type !== 'vector') base.example = field.example
  return base
}

function objectSchema(fields: DataModelField[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const f of fields) {
    properties[f.name] = fieldSchema(f)
    if (f.required) required.push(f.name)
  }
  const schema: JsonSchema = { type: 'object', properties }
  if (required.length) schema.required = required
  return schema
}

export function modelSchema(model: DataModel): JsonSchema {
  const schema = objectSchema(model.fields)
  if (model.description) schema.description = model.description
  return schema
}

/** `#/components/schemas/X` entries for every model the doc declares. */
export function schemaComponents(doc: SequenceDoc): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {}
  for (const m of doc.dataModels) out[m.name] = modelSchema(m)
  return out
}

export function schemaRef(
  doc: SequenceDoc,
  modelName: string | undefined,
): JsonSchema | undefined {
  if (!modelName) return undefined
  if (!doc.dataModels.some((m) => m.name === modelName)) return undefined
  return { $ref: `#/components/schemas/${modelName}` }
}

/** A concrete example object built from the model's declared examples. */
export function exampleFor(
  doc: SequenceDoc,
  modelName: string | undefined,
): Record<string, unknown> | undefined {
  const model = doc.dataModels.find((m) => m.name === modelName)
  if (!model) return undefined
  return exampleFields(model.fields)
}

function exampleFields(fields: DataModelField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f.name] = exampleValue(f)
  return out
}

export function exampleValue(field: DataModelField): unknown {
  // A vector's `example` is its dimension, not an example value.
  if (field.type === 'vector') {
    const dimensions = typeof field.example === 'number' ? field.example : 0
    return Array.from({ length: dimensions }, () => 0)
  }
  if (field.example !== undefined) return field.example
  switch (field.type) {
    case 'string':
      return `<${field.name}>`
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'date':
      return '1970-01-01T00:00:00Z'
    case 'enum':
      return field.enumValues?.[0] ?? ''
    case 'file':
      return `<${field.name}>`
    case 'object':
      return exampleFields(field.children ?? [])
    case 'array':
      return field.children?.length ? [exampleFields(field.children)] : []
  }
}
