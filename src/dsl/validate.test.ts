import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { toIdentifier, validateContractName, validateParticipantId } from './validate'

const doc = parse(`sequenceDiagram
  participant Client
  participant APIGW as API Gateway : aws:apigateway

  Client->>APIGW: go @Charge

contract Charge {
  transport: http
}

contract Other {
  transport: http
}
`).doc

describe('toIdentifier', () => {
  it.each([
    ['Mobile Client', 'MobileClient'],
    ['  order   service  ', 'orderService'],
    ['payment-svc!', 'payment-svc'],
    ['2fa gateway', '_2faGateway'],
    ['Client', 'Client'],
  ])('%s -> %s', (input, expected) => {
    expect(toIdentifier(input)).toBe(expected)
  })
})

describe('validateParticipantId', () => {
  it('accepts the unchanged id and a clean new one', () => {
    expect(validateParticipantId(doc, 'Client', 'Client')).toBeUndefined()
    expect(validateParticipantId(doc, 'Client', 'Web')).toBeUndefined()
    expect(validateParticipantId(doc, 'Client', 'order_svc-2')).toBeUndefined()
  })

  it('explains a space and offers the joined form', () => {
    const r = validateParticipantId(doc, 'Client', 'Mobile Client')!
    expect(r.error).toMatch(/cannot contain spaces/)
    expect(r.error).toMatch(/Label/)
    expect(r.suggestion).toBe('MobileClient')
  })

  it('rejects punctuation, a leading digit and an empty value', () => {
    expect(validateParticipantId(doc, 'Client', 'a.b')!.suggestion).toBe('ab')
    expect(validateParticipantId(doc, 'Client', '2fa')!.error).toMatch(/start with a digit/)
    expect(validateParticipantId(doc, 'Client', '2fa')!.suggestion).toBe('_2fa')
    expect(validateParticipantId(doc, 'Client', '   ')!.error).toMatch(/required/)
  })

  it('rejects a collision and suggests a free name', () => {
    const r = validateParticipantId(doc, 'Client', 'APIGW')!
    expect(r.error).toMatch(/already used/)
    expect(r.suggestion).toBe('APIGW2')
  })

  it('rejects a DSL keyword', () => {
    expect(validateParticipantId(doc, 'Client', 'loop')!.error).toMatch(/keyword/)
    expect(validateParticipantId(doc, 'Client', 'end')!.suggestion).toBe('endSvc')
  })
})

describe('validateContractName', () => {
  it('accepts a clean name', () => {
    expect(validateContractName(doc, 'Charge', 'Charge')).toBeUndefined()
    expect(validateContractName(doc, 'Charge', 'ChargeCard')).toBeUndefined()
  })

  it('explains a space in terms of the @Name reference', () => {
    const r = validateContractName(doc, 'Charge', 'Charge Card')!
    expect(r.error).toMatch(/@Name/)
    expect(r.suggestion).toBe('ChargeCard')
  })

  it('rejects a collision and an empty name', () => {
    expect(validateContractName(doc, 'Charge', 'Other')!.suggestion).toBe('Other2')
    expect(validateContractName(doc, 'Charge', '')!.error).toMatch(/needs a name/)
  })
})
