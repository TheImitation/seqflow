import { describe, expect, it } from 'vitest'
import { parse } from '../dsl/parser'
import { serialize } from '../dsl/serializer'
import { applyUnhappyPaths } from './generateUnhappyPaths'
import { suggestUnhappyPaths } from './unhappyPathRules'

function reparse(dsl: string) {
  const r = parse(dsl)
  expect(r.errors).toEqual([])
  return r.doc
}

describe('sync HTTP', () => {
  const SRC = `sequenceDiagram
  participant OrderSvc as Order Service
  participant PaymentSvc as Payment Service

  OrderSvc->>PaymentSvc: ChargeCard @ChargeCardRequest
  PaymentSvc-->>OrderSvc: PaymentConfirmed

contract ChargeCardRequest {
  transport: http
  method: POST
  path: /payments
  responses:
    200 OK
}
`

  it('suggests the POST rule set', () => {
    const doc = reparse(SRC)
    const { context, suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(context.transport).toBe('http')
    expect(context.method).toBe('POST')
    const codes = suggestions.map((s) => s.response?.code)
    expect(codes).toEqual(
      expect.arrayContaining(['400', '409', '422', '429', '503', '504']),
    )
    expect(codes).not.toContain('200') // already declared
  })

  it('wraps the existing reply in an alt and appends else-branches', () => {
    const doc = reparse(SRC)
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    const chosen = suggestions.filter((s) =>
      ['http-402', 'http-409', 'http-503'].includes(s.id),
    )
    expect(chosen.length).toBeGreaterThan(0)

    const result = applyUnhappyPaths(doc, doc.messages[0].id, chosen, {
      addContractResponses: true,
    })
    const dsl = serialize(result.doc)

    expect(dsl).toContain('alt 200 OK')
    expect(dsl).toContain('    PaymentSvc-->>OrderSvc: PaymentConfirmed')
    expect(dsl).toContain('else 409 Conflict (unhappy)')
    expect(dsl).toContain('else 503 ServiceUnavailable (unhappy)')
    expect(dsl).toContain('    503 ServiceUnavailable (unhappy)')

    // The generated text must itself be valid DSL.
    const round = reparse(dsl)
    expect(serialize(round)).toBe(dsl)

    const alt = round.blocks.find((b) => b.type === 'alt')!
    expect(alt.branches).toHaveLength(1 + chosen.length)
    expect(alt.branches![0].isUnhappy).toBeFalsy()
    expect(alt.branches!.slice(1).every((b) => b.isUnhappy)).toBe(true)
    expect(result.addedResponses).toBe(chosen.length)
  })

  it('generates a happy reply when the message has none', () => {
    const doc = reparse(
      'sequenceDiagram\n  A->>B: POST /things\n  A->>C: unrelated\n',
    )
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    const result = applyUnhappyPaths(
      doc,
      doc.messages[0].id,
      suggestions.filter((s) => s.id === 'http-400'),
      { addContractResponses: false },
    )
    const dsl = serialize(result.doc)
    expect(dsl).toContain('alt 201 Created')
    expect(dsl).toContain('B-->>A: 201 Created')
    expect(dsl).toContain('else 400 BadRequest (unhappy)')
    // The unrelated message stays outside the block, in its original position.
    expect(dsl.trimEnd().split('\n').at(-1)).toBe('  A->>C: unrelated')
    reparse(dsl)
  })
})

describe('async transports', () => {
  const SRC = `sequenceDiagram
  participant OrderSvc as Order Service
  participant Queue as PaymentQueue : aws:sqs
  participant PaymentSvc as Payment Service

  OrderSvc->>Queue: SendMessage(OrderCreated)
  Queue-->>PaymentSvc: OrderCreated
`

  it('suggests the SQS redelivery rule and needs a DLQ', () => {
    const doc = reparse(SRC)
    const { context, suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(context.transport).toBe('sqs')
    const sqs = suggestions.find((s) => s.id === 'sqs-dlq')!
    expect(sqs.shape).toBe('opt')
    expect(sqs.needsParticipant?.kind).toBe('aws:sqs')
  })

  it('emits a trailing opt block and creates the DLQ participant', () => {
    const doc = reparse(SRC)
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    const chosen = suggestions.filter((s) => s.id === 'sqs-dlq')

    const result = applyUnhappyPaths(doc, doc.messages[0].id, chosen, {
      addContractResponses: false,
    })
    expect(result.createdParticipantId).toBe('DLQ')

    const dsl = serialize(result.doc)
    expect(dsl).toContain('participant DLQ as DeadLetterQueue : aws:sqs')
    expect(dsl).toContain('opt processing failure (unhappy)')
    // The redelivery targets the queue's consumer, not the producer that
    // happened to be selected.
    expect(dsl).toContain('    Queue->>PaymentSvc: Deliver (attempt 1..N)')
    expect(dsl).toContain('    Note over Queue,PaymentSvc: after maxReceiveCount exceeded')
    expect(dsl).toContain('    Queue->>DLQ: Move to dead-letter queue')

    const round = reparse(dsl)
    expect(serialize(round)).toBe(dsl)
    const opt = round.blocks.find((b) => b.type === 'opt')!
    expect(opt.isUnhappy).toBe(true)
    expect(round.notes).toHaveLength(1)
  })

  it('generates the same story from the consumer-side message', () => {
    const doc = reparse(SRC)
    const consumerSide = doc.messages[1]
    const { context, suggestions } = suggestUnhappyPaths(doc, consumerSide)
    expect(context.brokerId).toBe('Queue')
    expect(context.consumerId).toBe('PaymentSvc')

    const result = applyUnhappyPaths(
      doc,
      consumerSide.id,
      suggestions.filter((s) => s.id === 'sqs-dlq'),
      { addContractResponses: false },
    )
    const dsl = serialize(result.doc)
    expect(dsl).toContain('    Queue->>PaymentSvc: Deliver (attempt 1..N)')
    expect(dsl).toContain('    Queue->>DLQ: Move to dead-letter queue')
    reparse(dsl)
  })

  it('reuses an existing dead-letter queue instead of adding one', () => {
    const doc = reparse(SRC + '  participant PaymentDLQ as PaymentDLQ : aws:sqs\n')
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    const result = applyUnhappyPaths(
      doc,
      doc.messages[0].id,
      suggestions.filter((s) => s.id === 'sqs-dlq'),
      { addContractResponses: false },
    )
    expect(result.createdParticipantId).toBeUndefined()
    expect(serialize(result.doc)).toContain('Queue->>PaymentDLQ: Move to dead-letter queue')
  })
})

describe('target-kind rules', () => {
  it.each([
    ['aws:lambda', ['lambda-429', 'lambda-timeout', 'lambda-unhandled']],
    ['aws:dynamodb', ['ddb-conditional', 'ddb-throughput', 'ddb-notfound']],
    ['aws:stepfunctions', ['sfn-taskfailed']],
    ['aws:s3', ['s3-403', 's3-404', 's3-503']],
    ['aws:eventbridge', ['eb-dlq']],
    ['aws:sns', ['sns-dlq']],
    ['aws:kinesis', ['kinesis-retry', 'kinesis-throttle']],
  ])('offers the %s rules', (kind, ids) => {
    const doc = reparse(
      `sequenceDiagram\n  participant A\n  participant B : ${kind}\n  A->>B: do it\n`,
    )
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(suggestions.map((s) => s.id)).toEqual(expect.arrayContaining(ids))
  })

  it('always offers the cross-cutting failures', () => {
    const doc = reparse('sequenceDiagram\n  A->>B: do it\n')
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(suggestions.map((s) => s.id)).toEqual(
      expect.arrayContaining(['x-timeout', 'x-refused', 'x-breaker']),
    )
  })
})

describe('inside an existing block', () => {
  it('keeps the generated alt within the enclosing branch', () => {
    const doc = reparse(`sequenceDiagram
  participant A
  participant B
  participant C
  alt first
    A->>B: POST /x
  else second
    A->>C: other
  end
`)
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    const result = applyUnhappyPaths(
      doc,
      doc.messages[0].id,
      suggestions.filter((s) => s.id === 'http-409'),
      { addContractResponses: false },
    )
    const dsl = serialize(result.doc)
    const round = reparse(dsl)
    expect(serialize(round)).toBe(dsl)

    // The outer alt still has exactly its two branches, and `other` is still in
    // the second one.
    const outer = round.blocks.find((b) => b.label === 'first')!
    expect(outer.branches).toHaveLength(2)
    const other = round.messages.find((m) => m.label === 'other')!
    expect(other.order).toBeGreaterThanOrEqual(outer.branches![1].startOrder)
    expect(other.order).toBeLessThan(outer.branches![1].endOrder)
  })
})

describe('deduping against what is already modelled', () => {
  it('hides an alt branch whose response code the contract already declares', () => {
    const doc = reparse(`sequenceDiagram
  A->>B: POST /things @C

contract C {
  transport: http
  method: POST
  responses:
    201 Created
    409 Conflict (unhappy)
}
`)
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(suggestions.map((s) => s.id)).not.toContain('http-409')
    expect(suggestions.map((s) => s.id)).toContain('http-400')
  })

  it('still offers the DLQ block when only the response code is declared', () => {
    const doc = reparse(`sequenceDiagram
  participant Producer
  participant Queue : aws:sqs
  participant Consumer
  Producer->>Queue: SendMessage @C
  Queue-->>Consumer: Delivered

contract C {
  transport: sqs
  responses:
    delivered Accepted
    DLQ Moved to dead-letter queue (unhappy)
}
`)
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(suggestions.map((s) => s.id)).toContain('sqs-dlq')
  })

  it('hides the DLQ block once that block exists in the diagram', () => {
    const doc = reparse(`sequenceDiagram
  participant Producer
  participant Queue : aws:sqs
  participant Consumer
  participant DLQ : aws:sqs
  Producer->>Queue: SendMessage
  Queue-->>Consumer: Delivered
  opt processing failure (unhappy)
    Queue->>DLQ: Move to dead-letter queue
  end
`)
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(suggestions.map((s) => s.id)).not.toContain('sqs-dlq')
  })
})

describe('AI and search rules', () => {
  it.each([
    ['aws:bedrock', ['bedrock-throttle', 'bedrock-context', 'bedrock-timeout']],
    ['aws:bedrockagent', ['bedrock-throttle', 'bedrock-guardrail']],
    ['aws:knowledgebase', ['kb-empty', 'kb-stale', 'kb-throttle']],
    ['aws:opensearch', ['aoss-429', 'aoss-index-missing', 'aoss-dimension']],
    ['aws:sagemaker', ['sm-throttle', 'sm-cold']],
  ])('offers the %s rules', (kind, ids) => {
    const doc = reparse(
      `sequenceDiagram\n  participant A\n  participant B : ${kind}\n  A->>B: call\n`,
    )
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(suggestions.map((s) => s.id)).toEqual(expect.arrayContaining(ids))
  })

  it('generates a retrieval-miss branch that round-trips', () => {
    const doc = reparse(`sequenceDiagram
  participant Fn as AnswerFn : aws:lambda
  participant KB as Docs : aws:knowledgebase
  Fn->>KB: Retrieve(question)
`)
    const { suggestions } = suggestUnhappyPaths(doc, doc.messages[0])
    const result = applyUnhappyPaths(
      doc,
      doc.messages[0].id,
      suggestions.filter((s) => s.id === 'kb-empty'),
      { addContractResponses: false },
    )
    const dsl = serialize(result.doc)
    expect(dsl).toContain('else No relevant passages (unhappy)')
    expect(dsl).toContain('KB-->>Fn: retrievalResults: []')
    reparse(dsl)
  })

  it('treats MSK and MQ as brokers, so redelivery is offered from either side', () => {
    const doc = reparse(`sequenceDiagram
  participant Producer
  participant Topic as Events : aws:msk
  participant Consumer
  Producer->>Topic: Produce(event)
  Topic-->>Consumer: Consume
`)
    const { context } = suggestUnhappyPaths(doc, doc.messages[0])
    expect(context.brokerId).toBe('Topic')
    expect(context.consumerId).toBe('Consumer')
    expect(context.transport).toBe('generic-async')
  })
})
