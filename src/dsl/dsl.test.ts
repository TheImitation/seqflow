import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { serialize } from './serializer'
import { buildTree, collectAltBlocks, flattenSteps } from './tree'

const ORDER_FLOW = `sequenceDiagram
  participant Client
  participant APIGW as API Gateway : aws:apigateway
  participant OrderSvc as Order Service
  participant Topic as OrderEvents : aws:sns
  participant Queue as PaymentQueue : aws:sqs
  participant PaymentSvc as Payment Service
  participant DB as OrdersTable : aws:dynamodb

  Client->>APIGW: POST /orders
  APIGW->>OrderSvc: CreateOrder(payload)
  OrderSvc->>DB: PutItem(order)
  OrderSvc->>Topic: Publish(OrderCreated)
  Topic-->>Queue: Fan-out
  Queue-->>PaymentSvc: OrderCreated
  PaymentSvc-->>OrderSvc: PaymentConfirmed
`

/** Parsing a serialization must be a fixed point. */
function expectRoundTrip(src: string) {
  const first = parse(src)
  expect(first.errors).toEqual([])
  const once = serialize(first.doc)
  const twice = serialize(parse(once).doc)
  expect(twice).toBe(once)
  return first
}

describe('participants', () => {
  it('parses ids, labels and kinds', () => {
    const { doc } = parse(ORDER_FLOW)
    expect(doc.participants).toHaveLength(7)
    expect(doc.participants[1]).toMatchObject({
      id: 'APIGW',
      label: 'API Gateway',
      kind: 'aws:apigateway',
      sourceLine: 3,
    })
    expect(doc.participants[0]).toMatchObject({
      id: 'Client',
      label: 'Client',
      kind: 'service',
    })
  })

  it('auto-creates participants referenced only by a message', () => {
    const { doc, errors } = parse('sequenceDiagram\n  A->>B: hi')
    expect(errors).toEqual([])
    expect(doc.participants.map((p) => p.id)).toEqual(['A', 'B'])
  })

  it('rejects an unknown kind', () => {
    const { errors } = parse('sequenceDiagram\n  participant A : aws:quantum')
    expect(errors[0].message).toMatch(/Unknown participant kind/)
  })
})

describe('messages', () => {
  it('maps arrow tokens to styles', () => {
    const { doc } = parse(
      'sequenceDiagram\n  A->>B: s\n  A-->>B: a\n  A-xB: f\n  A->B: s2\n  A--)B: f2',
    )
    expect(doc.messages.map((m) => m.style)).toEqual([
      'sync',
      'async',
      'fireAndForget',
      'sync',
      'fireAndForget',
    ])
  })

  it('keeps colons inside a label', () => {
    const { doc } = parse('sequenceDiagram\n  A->>B: GET /v1/x: ok')
    expect(doc.messages[0].label).toBe('GET /v1/x: ok')
  })

  it('tolerates mermaid activation suffixes', () => {
    const { doc, errors } = parse('sequenceDiagram\n  A->>+B: go\n  B-->>-A: done')
    expect(errors).toEqual([])
    expect(doc.messages.map((m) => m.to)).toEqual(['B', 'A'])
  })

  it('extracts a contract reference off the label', () => {
    const { doc } = parse('sequenceDiagram\n  A->>B: ChargeCard @ChargeCardRequest')
    expect(doc.messages[0].label).toBe('ChargeCard')
    expect(doc.messages[0].contractRef).toBe('ChargeCardRequest')
  })
})

describe('blocks', () => {
  const NESTED = `sequenceDiagram
  A->>B: start
  loop retry
    A->>B: attempt
    alt 200 OK
      B-->>A: ok
    else 503 ServiceUnavailable (unhappy)
      B-->>A: boom
      opt fallback (unhappy)
        A->>C: degrade
      end
    end
  end
  A->>B: done
`

  it('records ranges, nesting and unhappy markers', () => {
    const { doc, errors } = parse(NESTED)
    expect(errors).toEqual([])

    const loop = doc.blocks.find((b) => b.type === 'loop')!
    const alt = doc.blocks.find((b) => b.type === 'alt')!
    const opt = doc.blocks.find((b) => b.type === 'opt')!

    expect(loop.parentBlock).toBeUndefined()
    expect(alt.parentBlock).toBe(loop.id)
    expect(opt.parentBlock).toBe(alt.id)
    expect(alt.branches).toHaveLength(2)
    expect(alt.branches![1].isUnhappy).toBe(true)
    expect(opt.isUnhappy).toBe(true)
    expect(doc.messages).toHaveLength(6)
  })

  it('rebuilds the nesting from the flat arrays', () => {
    const { doc } = parse(NESTED)
    const tree = buildTree(doc)
    expect(tree.map((n) => n.kind)).toEqual(['message', 'block', 'message'])

    const loop = tree[1]
    if (loop.kind !== 'block') throw new Error('expected block')
    expect(loop.block.type).toBe('loop')
    expect(loop.branches[0].children.map((n) => n.kind)).toEqual(['message', 'block'])
  })

  it('round-trips', () => {
    expectRoundTrip(NESTED)
    expect(serialize(parse(NESTED).doc)).toContain('else 503 ServiceUnavailable (unhappy)')
  })

  it('flags an unbalanced block', () => {
    const { errors } = parse('sequenceDiagram\n  opt x\n  A->>B: y')
    expect(errors[0].message).toMatch(/never closed/)
  })

  it('flags a stray else', () => {
    const { errors } = parse('sequenceDiagram\n  opt x\n  else y\n  end')
    expect(errors[0].message).toMatch(/only valid inside an `alt`/)
  })

  it('keeps unsupported mermaid blocks inline with a warning', () => {
    const { doc, errors, warnings } = parse(
      'sequenceDiagram\n  par both\n    A->>B: x\n  and\n    A->>C: y\n  end',
    )
    expect(errors).toEqual([])
    expect(warnings[0].message).toMatch(/not part of the SeqFlow grammar/)
    expect(doc.messages).toHaveLength(2)
  })
})

describe('models and contracts', () => {
  const SRC = `sequenceDiagram
  OrderSvc->>PaymentSvc: ChargeCard @ChargeCardRequest

model PaymentRequest "charge body" {
  cardToken: string required
  amount: number required = 12.5
  currency: enum[GBP,USD,EUR] required
  meta: object {
    trace: string
  }
}

model PaymentConfirmation {
  paymentId: string required
  status: enum[settled,pending] required
}

contract ChargeCardRequest {
  transport: http
  method: POST
  path: /payments
  model: PaymentRequest
  headers:
    Content-Type: application/json required
    Idempotency-Key: string required
  responses:
    200 OK -> PaymentConfirmation
    402 PaymentRequired (unhappy) -> PaymentConfirmation
    503 ServiceUnavailable (unhappy)
}
`

  it('parses nested fields, enums and examples', () => {
    const { doc, errors } = parse(SRC)
    expect(errors).toEqual([])
    const m = doc.dataModels[0]
    expect(m.description).toBe('charge body')
    expect(m.fields.map((f) => f.name)).toEqual([
      'cardToken',
      'amount',
      'currency',
      'meta',
    ])
    expect(m.fields[1].example).toBe(12.5)
    expect(m.fields[2].enumValues).toEqual(['GBP', 'USD', 'EUR'])
    expect(m.fields[3].children![0].name).toBe('trace')
    expect(m.fields[3].children![0].required).toBe(false)
  })

  it('parses headers and responses, inferring happy/unhappy', () => {
    const { doc } = parse(SRC)
    const c = doc.contracts[0]
    expect(c.transport).toBe('http')
    expect(c.method).toBe('POST')
    expect(c.path).toBe('/payments')
    expect(c.headers).toEqual([
      { key: 'Content-Type', value: 'application/json', required: true },
      { key: 'Idempotency-Key', value: 'string', required: true },
    ])
    expect(c.responses.map((r) => [r.code, r.isHappyPath])).toEqual([
      ['200', true],
      ['402', false],
      ['503', false],
    ])
    expect(c.responses[0].modelName).toBe('PaymentConfirmation')
  })

  it('treats async pseudo-codes as unhappy', () => {
    const { doc } = parse(
      'sequenceDiagram\n  A->>B: x\n\ncontract C {\n  transport: sqs\n  responses:\n    DLQ moved to dead-letter\n    delivered ok\n}',
    )
    expect(doc.contracts[0].responses.map((r) => r.isHappyPath)).toEqual([false, true])
  })

  it('warns about a dangling contract reference', () => {
    const { warnings } = parse('sequenceDiagram\n  A->>B: x @Nope')
    expect(warnings[0].message).toMatch(/unknown contract/)
  })

  it('round-trips', () => {
    expectRoundTrip(SRC)
  })
})

describe('the order-flow example', () => {
  it('round-trips unchanged in structure', () => {
    const { doc } = expectRoundTrip(ORDER_FLOW)
    expect(doc.messages).toHaveLength(7)
    expect(serialize(doc).trim()).toBe(ORDER_FLOW.trim())
  })
})

describe('playback flattening', () => {
  const SRC = `sequenceDiagram
  A->>B: one
  alt happy
    B-->>A: ok
  else sad (unhappy)
    B-->>A: err
    B->>C: alert
  end
  A->>B: two
`

  it('walks the first branch by default', () => {
    const tree = buildTree(parse(SRC).doc)
    expect(flattenSteps(tree).map((s) => s.message.label)).toEqual(['one', 'ok', 'two'])
  })

  it('walks a chosen unhappy branch instead', () => {
    const doc = parse(SRC).doc
    const tree = buildTree(doc)
    const alt = collectAltBlocks(tree)[0]
    expect(alt.branches.map((b) => b.label)).toEqual(['happy', 'sad'])
    expect(
      flattenSteps(tree, { [alt.block.id]: 1 }).map((s) => s.message.label),
    ).toEqual(['one', 'err', 'alert', 'two'])
  })

  it('reports the enclosing block path', () => {
    const tree = buildTree(parse(SRC).doc)
    const steps = flattenSteps(tree)
    expect(steps[0].blockPath).toEqual([])
    expect(steps[1].blockPath[0].branch.label).toBe('happy')
  })
})

describe('mermaid compatibility', () => {
  it('imports a plain mermaid sequence diagram unchanged', () => {
    const src = `sequenceDiagram
    autonumber
    actor Alice
    participant Bob
    Alice->>Bob: Hello Bob, how are you?
    activate Bob
    Note right of Bob: Bob thinks
    Bob-->>Alice: I am good thanks!
    deactivate Bob
`
    const { doc, errors } = parse(src)
    expect(errors).toEqual([])
    expect(doc.participants.map((p) => p.kind)).toEqual(['client', 'service'])
    expect(doc.messages).toHaveLength(2)
    expect(doc.notes[0].placement).toBe('right')
    expect(doc.notes[0].order).toBe(1)
  })
})
