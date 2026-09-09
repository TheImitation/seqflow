import { describe, expect, it } from 'vitest'
import { inferArchitecture } from '../dsl/architecture'
import { parse } from '../dsl/parser'
import { PATTERNS } from '../templates/patterns'
import { toAsyncApi } from './toAsyncApi'
import { toCdk } from './toCdk'
import { toDrawio } from './toDrawio'
import { toMermaid } from './toMermaid'
import { toOpenApi } from './toOpenApi'
import { toPlantUML } from './toPlantUML'
import { ALL_SECTIONS, buildReport } from './reportContent'

const fanOut = parse(PATTERNS.find((p) => p.id === 'async-fan-out')!.dsl).doc
const syncRest = parse(PATTERNS.find((p) => p.id === 'sync-rest')!.dsl).doc
const bare = parse('sequenceDiagram\n  A->>B: hello\n').doc

describe('mermaid', () => {
  it('drops the kind tags but keeps structure', () => {
    const out = toMermaid(fanOut)
    expect(out).not.toContain('aws:')
    expect(out).toContain('participant APIGW as API Gateway')
    expect(out).toContain('actor Client')
    expect(out).toContain('  Client->>APIGW: POST /orders')
    expect(out).toContain('  alt 200 OK')
    expect(out).toContain('  else 402 PaymentRequired (unhappy)')
    expect(out).toContain('  opt processing failure (unhappy)')
  })

  it('re-imports through our own parser without loss of shape', () => {
    const round = parse(toMermaid(fanOut))
    expect(round.errors).toEqual([])
    expect(round.doc.messages).toHaveLength(fanOut.messages.length)
    expect(round.doc.blocks).toHaveLength(fanOut.blocks.length)
  })
})

describe('plantuml', () => {
  it('emits a well-formed diagram with kind-appropriate keywords', () => {
    const out = toPlantUML(fanOut)
    expect(out.startsWith('@startuml')).toBe(true)
    expect(out.trimEnd().endsWith('@enduml')).toBe(true)
    expect(out).toContain('actor "Client" as Client')
    expect(out).toContain('queue "OrderEvents" as Topic <<sns>>')
    expect(out).toContain('database "OrdersTable" as DB <<dynamodb>>')
    expect(out).toContain('Client -> APIGW : POST /orders')
    expect(out).toContain('Topic --> Queue : Fan-out')
    expect(out.match(/^\s*alt /gm)?.length).toBe(1)
    expect(out.match(/^\s*end$/gm)?.length).toBe(2)
  })
})

describe('draw.io', () => {
  it('emits mxGraph XML with one cell per node and edge', () => {
    const out = toDrawio(fanOut)
    expect(out).toContain('<mxfile host="seqflow"')
    expect(out).toContain('</mxfile>')
    expect(out.match(/vertex="1"/g)).toHaveLength(fanOut.participants.length)
    expect(out).toContain('dashed=1')
    expect(out).toContain('&#10;aws:sns')
    // Labels are escaped, never raw.
    expect(out).not.toMatch(/value="[^"]*[<>]/)
  })
})

describe('cdk', () => {
  it('emits one construct per aws participant plus inferred wiring', () => {
    const out = toCdk(fanOut)
    expect(out).toContain('STARTER SCAFFOLD')
    expect(out).toContain("import * as sns from 'aws-cdk-lib/aws-sns'")
    expect(out).toContain("import * as sqs from 'aws-cdk-lib/aws-sqs'")
    // The participant's own id becomes the CDK logical id, un-recased.
    expect(out).toContain("const apigw = new apigateway.RestApi(this, 'APIGW'")
    expect(out).toContain("const db = new dynamodb.Table(this, 'DB'")
    expect(out).toContain("const dlq = new sqs.Queue(this, 'DLQ'")
    expect(out).toContain('topic.addSubscription(new subscriptions.SqsSubscription(queue))')
    expect(out).toContain('// Not managed by this stack:')
  })

  it('wires lambda grants and event sources from edge direction', () => {
    const out = toCdk(parse(PATTERNS.find((p) => p.id === 'streaming')!.dsl).doc)
    expect(out).toContain('eventsources.KinesisEventSource(stream')
    expect(out).toContain('table.grantReadWriteData(consumer)')
  })

  it('says so plainly when there is nothing to generate', () => {
    expect(toCdk(bare)).toContain('No aws:* participants in this diagram yet')
  })
})

describe('openapi', () => {
  it('emits a path per attached http contract, happy and unhappy', () => {
    const spec = JSON.parse(toOpenApi(syncRest))
    expect(spec.openapi).toBe('3.0.3')

    const op = spec.paths['/orders/{id}'].get
    expect(op.operationId).toBe('GetOrder')
    expect(Object.keys(op.responses).sort()).toEqual(['200', '404', '429', '503'])
    expect(op.responses['404']['x-seqflow-unhappy-path']).toBe(true)
    expect(op.responses['200']['x-seqflow-unhappy-path']).toBeUndefined()
    expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/Order',
    )
    expect(op.parameters.map((p: { name: string }) => p.name)).toEqual([
      'Accept',
      'X-Correlation-Id',
    ])
    expect(spec.components.schemas.Order.properties.status.enum).toEqual([
      'pending',
      'paid',
      'shipped',
    ])
  })

  it('carries a request body for POST and skips non-numeric codes', () => {
    const spec = JSON.parse(toOpenApi(fanOut))
    const op = spec.paths['/payments'].post
    expect(op.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/PaymentRequest',
    )
    expect(Object.keys(op.responses).sort()).toEqual(['200', '402', '409', '503'])
    // The SNS contract is not an HTTP path.
    expect(Object.keys(spec.paths)).toEqual(['/payments'])
  })

  it('degrades to a valid empty spec with no contracts', () => {
    const spec = JSON.parse(toOpenApi(bare))
    expect(spec.paths).toEqual({})
    expect(spec.components.schemas).toEqual({})
  })
})

describe('asyncapi', () => {
  it('emits a channel per attached async contract', () => {
    const spec = JSON.parse(toAsyncApi(fanOut))
    expect(spec.asyncapi).toBe('2.6.0')
    expect(Object.keys(spec.channels)).toEqual(['OrderEvents'])

    const channel = spec.channels.OrderEvents
    expect(channel.bindings.sns).toEqual({})
    expect(channel.publish.message.$ref).toBe(
      '#/components/messages/PublishOrderCreatedMessage',
    )
    expect(channel['x-seqflow-failure-modes']).toEqual([
      { code: 'retry', description: 'Delivery retried per policy' },
      { code: 'DLQ', description: 'Moved to dead-letter queue' },
    ])
    expect(
      spec.components.messages.PublishOrderCreatedMessage.payload.$ref,
    ).toBe('#/components/schemas/OrderCreated')
    expect(spec.components.schemas.OrderCreated.properties.items.type).toBe('array')
    expect(spec.components.schemas.OrderCreated.properties.items.items.properties.qty.example).toBe(1)
  })

  it('degrades to a valid empty spec with no async contracts', () => {
    const spec = JSON.parse(toAsyncApi(bare))
    expect(spec.channels).toEqual({})
    expect(spec.servers).toBeUndefined()
  })
})

describe('every template exports without throwing', () => {
  it.each(PATTERNS)('$name', (pattern) => {
    const doc = parse(pattern.dsl).doc
    expect(() => toMermaid(doc)).not.toThrow()
    expect(() => toPlantUML(doc)).not.toThrow()
    expect(() => toDrawio(doc)).not.toThrow()
    expect(() => toCdk(doc)).not.toThrow()
    expect(() => JSON.parse(toOpenApi(doc))).not.toThrow()
    expect(() => JSON.parse(toAsyncApi(doc))).not.toThrow()

    // The report needs the inferred architecture and a date, so it does not
    // fit the `(doc) => string` shape the others share.
    const report = buildReport({
      doc,
      arch: inferArchitecture(doc),
      projectName: pattern.name,
      generatedAt: new Date('2026-09-08T12:00:00Z'),
      sections: ALL_SECTIONS,
    })
    // "Did not throw" is weak for a content generator.
    expect(report.blocks.length).toBeGreaterThan(0)
    expect(report.title).toBeTruthy()
  })
})
