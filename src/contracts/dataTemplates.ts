import {
  BODY_MEDIA_TYPE,
  isStructuredBody,
  type BodyKind,
  type Contract,
  type DataModel,
  type DataModelField,
  type SequenceDoc,
} from '../dsl/ast'
import { uniqueModelName } from './modelEdit'

/**
 * Two reusable libraries.
 *
 * `BODY_TEMPLATES` answer "how is this sent" — the encoding, its `Content-Type`
 * and a starter shape. `SHAPE_TEMPLATES` answer "what is in it" — field groups
 * that recur across requests, dropped into whatever model you are editing.
 */

/* ------------------------------------------------------------ body kinds */

export interface BodyTemplate {
  id: string
  name: string
  blurb: string
  kind: BodyKind
  /** Fields for the starter model; absent means the payload is opaque. */
  fields?: DataModelField[]
  /** Suffix for the generated model name, e.g. `ChargeCardUpload`. */
  modelSuffix?: string
}

const f = (
  name: string,
  type: DataModelField['type'],
  required = false,
  extra: Partial<DataModelField> = {},
): DataModelField => ({ name, type, required, ...extra })

export const BODY_TEMPLATES: BodyTemplate[] = [
  {
    id: 'json-object',
    name: 'JSON object',
    blurb: 'A single structured resource. The default for most REST calls.',
    kind: 'json',
    modelSuffix: 'Body',
    fields: [f('id', 'string', true), f('name', 'string', true)],
  },
  {
    id: 'json-collection',
    name: 'JSON collection',
    blurb: 'A page of items with a total — for bulk writes and list responses.',
    kind: 'json',
    modelSuffix: 'Page',
    fields: [
      f('items', 'array', true, { children: [f('id', 'string', true), f('name', 'string')] }),
      f('total', 'number', true),
    ],
  },
  {
    id: 'file-upload',
    name: 'File upload',
    blurb: 'One binary part. `multipart/form-data`.',
    kind: 'multipart',
    modelSuffix: 'Upload',
    fields: [f('file', 'file', true)],
  },
  {
    id: 'file-with-metadata',
    name: 'File + metadata',
    blurb: 'A binary part alongside ordinary form fields.',
    kind: 'multipart',
    modelSuffix: 'Upload',
    fields: [
      f('file', 'file', true),
      f('filename', 'string', true),
      f('contentType', 'string', true, { example: 'image/png' }),
      f('tags', 'array', false, { children: [f('name', 'string', true)] }),
    ],
  },
  {
    id: 'multi-file',
    name: 'Multiple files',
    blurb: 'A repeated binary part, each with its own name.',
    kind: 'multipart',
    modelSuffix: 'Upload',
    fields: [
      f('files', 'array', true, {
        children: [f('file', 'file', true), f('filename', 'string', true)],
      }),
    ],
  },
  {
    id: 'form',
    name: 'Form fields',
    blurb: 'Flat key/value pairs. `application/x-www-form-urlencoded`.',
    kind: 'form',
    modelSuffix: 'Form',
    fields: [f('username', 'string', true), f('password', 'string', true)],
  },
  {
    id: 'text',
    name: 'Raw text',
    blurb: 'An opaque `text/plain` payload — logs, markdown, a query string.',
    kind: 'text',
  },
  {
    id: 'xml',
    name: 'XML document',
    blurb: 'An `application/xml` payload. Common with legacy and SOAP-ish partners.',
    kind: 'xml',
  },
  {
    id: 'csv',
    name: 'CSV upload',
    blurb: 'A `text/csv` payload — bulk import and export.',
    kind: 'csv',
  },
  {
    id: 'binary',
    name: 'Binary stream',
    blurb: 'An `application/octet-stream` payload with no declared shape.',
    kind: 'binary',
  },
  {
    id: 'none',
    name: 'No body',
    blurb: 'Nothing sent — normal for GET and DELETE.',
    kind: 'none',
  },
]

/* --------------------------------------------------------- reusable shapes */

export interface ShapeTemplate {
  id: string
  name: string
  blurb: string
  fields: DataModelField[]
}

export const SHAPE_TEMPLATES: ShapeTemplate[] = [
  {
    id: 'error',
    name: 'Error',
    blurb: 'code, message and per-field details.',
    fields: [
      f('code', 'string', true, { example: 'PAYMENT_DECLINED' }),
      f('message', 'string', true),
      f('details', 'array', false, {
        children: [f('field', 'string', true), f('reason', 'string', true)],
      }),
    ],
  },
  {
    id: 'page',
    name: 'Offset pagination',
    blurb: 'page, pageSize, total, hasMore.',
    fields: [
      f('page', 'number', true, { example: 1 }),
      f('pageSize', 'number', true, { example: 25 }),
      f('total', 'number', true),
      f('hasMore', 'boolean', true, { example: false }),
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor pagination',
    blurb: 'cursor, limit, nextCursor.',
    fields: [
      f('cursor', 'string'),
      f('limit', 'number', true, { example: 50 }),
      f('nextCursor', 'string'),
    ],
  },
  {
    id: 'money',
    name: 'Money',
    blurb: 'A minor-unit amount with a currency.',
    fields: [
      f('amount', 'number', true, { example: 4250 }),
      f('currency', 'enum', true, { enumValues: ['GBP', 'USD', 'EUR'] }),
    ],
  },
  {
    id: 'address',
    name: 'Postal address',
    blurb: 'line1 through country.',
    fields: [
      f('line1', 'string', true),
      f('line2', 'string'),
      f('city', 'string', true),
      f('postcode', 'string', true),
      f('country', 'string', true, { example: 'GB' }),
    ],
  },
  {
    id: 'timestamps',
    name: 'Timestamps',
    blurb: 'createdAt and updatedAt.',
    fields: [f('createdAt', 'date', true), f('updatedAt', 'date', true)],
  },
  {
    id: 'audit',
    name: 'Audit trail',
    blurb: 'Who changed it and when.',
    fields: [
      f('createdBy', 'string', true),
      f('createdAt', 'date', true),
      f('updatedBy', 'string'),
      f('updatedAt', 'date'),
    ],
  },
  {
    id: 'file-meta',
    name: 'File metadata',
    blurb: 'filename, contentType, size and checksum.',
    fields: [
      f('filename', 'string', true),
      f('contentType', 'string', true, { example: 'application/pdf' }),
      f('sizeBytes', 'number', true),
      f('checksum', 'string'),
    ],
  },
  {
    id: 'geo',
    name: 'Geo point',
    blurb: 'lat and lng.',
    fields: [f('lat', 'number', true), f('lng', 'number', true)],
  },
  {
    id: 'identity',
    name: 'Identity',
    blurb: 'An internal id alongside an external one.',
    fields: [f('id', 'string', true), f('externalId', 'string')],
  },
  {
    id: 'trace',
    name: 'Trace context',
    blurb: 'Correlation and causation ids for a distributed trace.',
    fields: [
      f('correlationId', 'string', true),
      f('causationId', 'string'),
      f('traceparent', 'string'),
    ],
  },
]

/* ------------------------------------------------------------------ apply */

export interface ApplyBodyResult {
  modelName?: string
  createdModel?: string
}

/**
 * Stamp a body template onto a contract: the kind, the matching `Content-Type`,
 * and a starter model when the kind has a shape. An existing model is kept —
 * changing how something is sent should not throw away what is in it.
 */
export function applyBodyTemplate(
  doc: SequenceDoc,
  contract: Contract,
  template: BodyTemplate,
  baseName: string,
): ApplyBodyResult {
  contract.body = template.kind

  setContentType(contract, template.kind)

  if (!isStructuredBody(template.kind)) {
    contract.modelName = undefined
    return {}
  }

  if (contract.modelName && doc.dataModels.some((m) => m.name === contract.modelName)) {
    return { modelName: contract.modelName }
  }

  const name = uniqueModelName(doc, `${baseName}${template.modelSuffix ?? 'Body'}`)
  const model: DataModel = {
    name,
    fields: structuredClone(template.fields ?? []),
  }
  doc.dataModels.push(model)
  contract.modelName = name
  return { modelName: name, createdModel: name }
}

/** Keep the declared header honest about the encoding. */
export function setContentType(contract: Contract, kind: BodyKind): void {
  const existing = contract.headers.findIndex(
    (h) => h.key.toLowerCase() === 'content-type',
  )
  if (kind === 'none') {
    if (existing >= 0) contract.headers.splice(existing, 1)
    return
  }
  const value = BODY_MEDIA_TYPE[kind]
  if (existing >= 0) contract.headers[existing].value = value
  else contract.headers.unshift({ key: 'Content-Type', value, required: true })
}

/**
 * A `Content-Type` that disagrees with the body kind is a real bug in a spec,
 * and an easy one to leave behind after switching template.
 */
export function contentTypeMismatch(contract: Contract): string | undefined {
  const kind = contract.body ?? (contract.modelName ? 'json' : 'none')
  const header = contract.headers.find((h) => h.key.toLowerCase() === 'content-type')
  if (kind === 'none') {
    return header ? `Body is "none" but Content-Type is set to ${header.value}.` : undefined
  }
  if (!header) return undefined
  const expected = BODY_MEDIA_TYPE[kind]
  if (header.value.split(';')[0].trim().toLowerCase() === expected) return undefined
  return `Content-Type is ${header.value}, but a ${kind} body is sent as ${expected}.`
}

/** Insert a shape's fields into a list, renaming around any collisions. */
export function insertShape(into: DataModelField[], shape: ShapeTemplate): string[] {
  const added: string[] = []
  for (const field of structuredClone(shape.fields)) {
    let name = field.name
    let n = 2
    while (into.some((f) => f.name === name)) name = `${field.name}${n++}`
    into.push({ ...field, name })
    added.push(name)
  }
  return added
}
