import { describe, expect, it } from 'vitest'
import { effectiveBody, isDefaultBody, type DataModelField } from '../dsl/ast'
import { cloneDoc } from '../dsl/edit'
import { parse } from '../dsl/parser'
import { serialize } from '../dsl/serializer'
import { toAsyncApi } from '../export/toAsyncApi'
import { toOpenApi } from '../export/toOpenApi'
import {
  applyBodyTemplate,
  BODY_TEMPLATES,
  contentTypeMismatch,
  insertShape,
  setContentType,
  SHAPE_TEMPLATES,
} from './dataTemplates'

const SRC = `sequenceDiagram
  App->>Api: POST /avatar @Upload

contract Upload {
  transport: http
  method: POST
  path: /avatar
  headers:
    Content-Type: application/json required
  responses:
    201 Created
}
`

const template = (id: string) => BODY_TEMPLATES.find((t) => t.id === id)!
const shape = (id: string) => SHAPE_TEMPLATES.find((s) => s.id === id)!

function apply(id: string) {
  const doc = cloneDoc(parse(SRC).doc)
  const result = applyBodyTemplate(doc, doc.contracts[0], template(id), 'Upload')
  const out = serialize(doc)
  const round = parse(out)
  expect(round.errors).toEqual([])
  expect(serialize(round.doc)).toBe(out)
  return { doc: round.doc, out, result }
}

/* ------------------------------------------------------------------ dsl */

describe('body kind in the DSL', () => {
  it('round-trips a non-default kind on a contract and a response', () => {
    const src = `sequenceDiagram
  A->>B: go @C

contract C {
  transport: http
  method: POST
  body: multipart
  responses:
    200 OK as binary
    204 NoContent
    415 Unsupported (unhappy) as text -> Err
}

model Err {
  message: string required
}
`
    const { doc, errors } = parse(src)
    expect(errors).toEqual([])
    expect(doc.contracts[0].body).toBe('multipart')
    expect(doc.contracts[0].responses.map((r) => [r.code, r.body, r.modelName])).toEqual([
      ['200', 'binary', undefined],
      ['204', undefined, undefined],
      ['415', 'text', 'Err'],
    ])
    expect(serialize(doc)).toBe(serialize(parse(serialize(doc)).doc))
    expect(serialize(doc)).toContain('415 Unsupported (unhappy) as text -> Err')
  })

  it('omits the kind when it is what the model already implies', () => {
    const doc = parse(
      'sequenceDiagram\n  A->>B: go @C\n\ncontract C {\n  transport: http\n  model: M\n}\n\nmodel M {\n  id: string\n}\n',
    ).doc
    doc.contracts[0].body = 'json'
    expect(isDefaultBody(doc.contracts[0])).toBe(true)
    expect(serialize(doc)).not.toContain('body:')
  })

  it('defaults to json with a model and none without', () => {
    expect(effectiveBody({ modelName: 'M' })).toBe('json')
    expect(effectiveBody({})).toBe('none')
    expect(effectiveBody({ body: 'text', modelName: 'M' })).toBe('text')
  })

  it('rejects an unknown kind with a helpful message', () => {
    const { errors } = parse(
      'sequenceDiagram\n  A->>B: go @C\n\ncontract C {\n  transport: http\n  body: yaml\n}\n',
    )
    expect(errors[0].message).toMatch(/Unknown body kind "yaml"/)
  })

  it('leaves a label that merely ends in "as ..." alone', () => {
    const doc = parse(
      'sequenceDiagram\n  A->>B: go @C\n\ncontract C {\n  transport: http\n  responses:\n    200 Served as cached\n}\n',
    ).doc
    expect(doc.contracts[0].responses[0].label).toBe('Served as cached')
    expect(doc.contracts[0].responses[0].body).toBeUndefined()
  })

  it('parses the file field type', () => {
    const doc = parse(
      'sequenceDiagram\n  A->>B: go\n\nmodel M {\n  avatar: file required\n}\n',
    ).doc
    expect(doc.dataModels[0].fields[0].type).toBe('file')
    expect(serialize(doc)).toContain('  avatar: file required')
  })
})

/* ------------------------------------------------------------- templates */

describe('body templates', () => {
  it('stamps kind, Content-Type and a starter model', () => {
    const { doc, out, result } = apply('file-upload')
    expect(doc.contracts[0].body).toBe('multipart')
    expect(out).toContain('  body: multipart')
    expect(out).toContain('Content-Type: multipart/form-data required')
    expect(result.createdModel).toBe('UploadUpload')
    expect(out).toContain('model UploadUpload {\n  file: file required\n}')
  })

  it('drops the model and the header for an opaque kind', () => {
    const { doc, out } = apply('binary')
    expect(doc.contracts[0].modelName).toBeUndefined()
    expect(out).toContain('Content-Type: application/octet-stream')
    expect(out).toContain('  body: binary')
  })

  it('removes Content-Type entirely for "no body"', () => {
    const { doc, out } = apply('none')
    expect(doc.contracts[0].headers.some((h) => h.key === 'Content-Type')).toBe(false)
    expect(out).not.toContain('Content-Type')
  })

  it('keeps an existing shape when only the encoding changes', () => {
    const doc = cloneDoc(parse(SRC).doc)
    applyBodyTemplate(doc, doc.contracts[0], template('json-object'), 'Upload')
    const first = doc.contracts[0].modelName
    applyBodyTemplate(doc, doc.contracts[0], template('file-upload'), 'Upload')
    expect(doc.contracts[0].modelName).toBe(first)
    expect(doc.dataModels).toHaveLength(1)
  })

  it('every template round-trips', () => {
    for (const t of BODY_TEMPLATES) {
      const { out } = apply(t.id)
      expect(parse(out).errors, t.id).toEqual([])
    }
  })
})

describe('content type mismatch', () => {
  it('spots a stale header and stays quiet once fixed', () => {
    const doc = cloneDoc(parse(SRC).doc)
    const c = doc.contracts[0]
    c.body = 'multipart'
    expect(contentTypeMismatch(c)).toMatch(/multipart\/form-data/)
    setContentType(c, 'multipart')
    expect(contentTypeMismatch(c)).toBeUndefined()
  })

  it('ignores charset parameters', () => {
    const doc = cloneDoc(parse(SRC).doc)
    const c = doc.contracts[0]
    c.headers[0].value = 'application/json; charset=utf-8'
    c.body = 'json'
    expect(contentTypeMismatch(c)).toBeUndefined()
  })
})

describe('shape templates', () => {
  it('inserts fields and renames around collisions', () => {
    const fields: DataModelField[] = [{ name: 'code', type: 'string', required: true }]
    const added = insertShape(fields, shape('error'))
    expect(added).toEqual(['code2', 'message', 'details'])
    expect(fields.map((f) => f.name)).toEqual(['code', 'code2', 'message', 'details'])
  })

  it('deep-copies, so editing one insertion cannot alter another', () => {
    const first: DataModelField[] = []
    const second: DataModelField[] = []
    insertShape(first, shape('error'))
    insertShape(second, shape('error'))

    // `details` is an array with its own children — the case a shallow copy
    // would share between the two models and the template itself.
    const details = first.find((f) => f.name === 'details')!
    details.children!.push({ name: 'extra', type: 'string', required: false })

    expect(second.find((f) => f.name === 'details')!.children).toHaveLength(2)
    expect(shape('error').fields.find((f) => f.name === 'details')!.children).toHaveLength(2)
  })

  it('every shape survives a round-trip inside a model', () => {
    for (const s of SHAPE_TEMPLATES) {
      const doc = cloneDoc(parse(SRC).doc)
      doc.dataModels.push({ name: 'M', fields: [] })
      insertShape(doc.dataModels[0].fields, s)
      const out = serialize(doc)
      expect(parse(out).errors, s.id).toEqual([])
      expect(serialize(parse(out).doc), s.id).toBe(out)
    }
  })
})

/* --------------------------------------------------------------- exports */

describe('exports honour the body kind', () => {
  const withBody = (id: string) => {
    const doc = cloneDoc(parse(SRC).doc)
    applyBodyTemplate(doc, doc.contracts[0], template(id), 'Upload')
    return parse(serialize(doc)).doc
  }

  it('emits multipart with a binary part', () => {
    const spec = JSON.parse(toOpenApi(withBody('file-upload')))
    const body = spec.paths['/avatar'].post.requestBody
    expect(Object.keys(body.content)).toEqual(['multipart/form-data'])
    expect(spec.components.schemas.UploadUpload.properties.file).toEqual({
      type: 'string',
      format: 'binary',
    })
  })

  it('emits an opaque schema for text and binary', () => {
    const text = JSON.parse(toOpenApi(withBody('text')))
    expect(text.paths['/avatar'].post.requestBody.content).toEqual({
      'text/plain': { schema: { type: 'string' } },
    })

    const binary = JSON.parse(toOpenApi(withBody('binary')))
    expect(binary.paths['/avatar'].post.requestBody.content['application/octet-stream']).toEqual(
      { schema: { type: 'string', format: 'binary' } },
    )
  })

  it('omits requestBody entirely for "no body"', () => {
    const spec = JSON.parse(toOpenApi(withBody('none')))
    expect(spec.paths['/avatar'].post.requestBody).toBeUndefined()
  })

  it('emits the response media type from its own kind', () => {
    const doc = parse(`sequenceDiagram
  A->>B: GET /report @R

contract R {
  transport: http
  method: GET
  path: /report
  responses:
    200 OK as csv
    404 NotFound (unhappy) -> Err
}

model Err {
  message: string required
}
`).doc
    const spec = JSON.parse(toOpenApi(doc))
    const op = spec.paths['/report'].get
    expect(Object.keys(op.responses['200'].content)).toEqual(['text/csv'])
    expect(Object.keys(op.responses['404'].content)).toEqual(['application/json'])
  })

  it('carries the kind into AsyncAPI contentType', () => {
    const doc = parse(`sequenceDiagram
  A->>Q: publish @E

contract E {
  transport: sqs
  body: text
  responses:
    delivered ok
}
`).doc
    const spec = JSON.parse(toAsyncApi(doc))
    expect(spec.components.messages.EMessage.contentType).toBe('text/plain')
  })
})
