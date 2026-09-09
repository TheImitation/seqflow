import { describe, expect, it } from 'vitest'
import { cloneDoc } from '../dsl/edit'
import { parse } from '../dsl/parser'
import { serialize } from '../dsl/serializer'
import {
  addField,
  fieldAt,
  moveField,
  removeField,
  updateField,
  validateFieldName,
} from './modelEdit'

const SRC = `sequenceDiagram
  A->>B: go @C

model Payload {
  id: string required
  amount: number = 4
  meta: object {
    trace: string
    tags: array {
      name: string required
    }
  }
}

contract C {
  transport: http
  model: Payload
}
`

/** Every field edit has to survive the round-trip, same as any other edit. */
function edit(fn: (m: ReturnType<typeof parse>['doc']['dataModels'][number]) => void) {
  const doc = cloneDoc(parse(SRC).doc)
  fn(doc.dataModels[0])
  const out = serialize(doc)
  const round = parse(out)
  expect(round.errors).toEqual([])
  expect(serialize(round.doc)).toBe(out)
  return { out, model: round.doc.dataModels[0] }
}

const model = () => cloneDoc(parse(SRC).doc).dataModels[0]

describe('paths', () => {
  it('addresses nested fields', () => {
    expect(fieldAt(model(), [0])?.name).toBe('id')
    expect(fieldAt(model(), [2, 1])?.name).toBe('tags')
    expect(fieldAt(model(), [2, 1, 0])?.name).toBe('name')
    expect(fieldAt(model(), [9])).toBeUndefined()
    expect(fieldAt(model(), [0, 0])).toBeUndefined()
  })
})

describe('addField', () => {
  it('appends at the root with a free name', () => {
    const { out } = edit((m) => {
      expect(addField(m, [])).toBe('field')
      expect(addField(m, [])).toBe('field2')
    })
    expect(out).toContain('  field: string\n  field2: string\n}')
  })

  it('appends inside a nested container', () => {
    const { out } = edit((m) => addField(m, [2, 1]))
    expect(out).toContain('    tags: array {\n      name: string required\n      field: string\n    }')
  })
})

describe('updateField', () => {
  it('renames and retypes', () => {
    const { out } = edit((m) => updateField(m, [0], { name: 'orderId', required: false }))
    expect(out).toContain('  orderId: string\n')
  })

  it('adds enum values when switching to enum, and drops them on the way out', () => {
    const toEnum = edit((m) => updateField(m, [0], { type: 'enum' }))
    expect(toEnum.out).toContain('  id: enum[a,b] required')

    const back = edit((m) => {
      updateField(m, [0], { type: 'enum' })
      updateField(m, [0], { type: 'string' })
    })
    expect(back.out).toContain('  id: string required')
    expect(back.out).not.toContain('enum[')
  })

  it('drops children when a container becomes a scalar', () => {
    const { out, model: after } = edit((m) => updateField(m, [2], { type: 'string' }))
    expect(out).toContain('  meta: string\n')
    expect(out).not.toContain('trace')
    expect(after.fields[2].children).toBeUndefined()
  })

  it('gives a scalar an empty child list when it becomes a container', () => {
    const { out } = edit((m) => {
      updateField(m, [0], { type: 'object' })
      addField(m, [0])
    })
    expect(out).toContain('  id: object required {\n    field: string\n  }')
  })
})

describe('removeField and moveField', () => {
  it('removes a nested field', () => {
    const { out } = edit((m) => removeField(m, [2, 0]))
    expect(out).not.toContain('trace')
    expect(out).toContain('tags: array')
  })

  it('reorders within its own list only', () => {
    const { out } = edit((m) => moveField(m, [1], -1))
    expect(out).toContain('  amount: number = 4\n  id: string required')

    const doc = model()
    expect(moveField(doc, [0], -1)).toBe(false)
    expect(moveField(doc, [2], 1)).toBe(false)
  })
})

describe('validateFieldName', () => {
  it('accepts a free name and the unchanged one', () => {
    expect(validateFieldName(model(), [0], 'id')).toBeUndefined()
    expect(validateFieldName(model(), [0], 'orderId')).toBeUndefined()
  })

  it('rejects a sibling collision but allows the same name at another level', () => {
    expect(validateFieldName(model(), [0], 'amount')!.suggestion).toBe('amount2')
    // `name` lives under meta.tags, so it is free at the root.
    expect(validateFieldName(model(), [0], 'name')).toBeUndefined()
  })

  it('rejects punctuation and an empty name', () => {
    expect(validateFieldName(model(), [0], 'a b')!.suggestion).toBe('ab')
    expect(validateFieldName(model(), [0], '2fa')!.suggestion).toBe('_2fa')
    expect(validateFieldName(model(), [0], '')!.error).toMatch(/needs a name/)
  })
})
