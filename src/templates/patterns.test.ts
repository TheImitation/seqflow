import { describe, expect, it } from 'vitest'
import { inferArchitecture } from '../dsl/architecture'
import { parse } from '../dsl/parser'
import { serialize } from '../dsl/serializer'
import { PATTERNS } from './patterns'

describe.each(PATTERNS)('template $name', (pattern) => {
  it('parses with no errors or warnings', () => {
    const { errors, warnings } = parse(pattern.dsl)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('round-trips through the serializer', () => {
    const once = serialize(parse(pattern.dsl).doc)
    expect(serialize(parse(once).doc)).toBe(once)
  })

  it('infers a connected architecture', () => {
    const { doc } = parse(pattern.dsl)
    const arch = inferArchitecture(doc)
    expect(arch.nodes.length).toBeGreaterThan(2)
    expect(arch.edges.length).toBeGreaterThan(1)
    const touched = new Set(arch.edges.flatMap((e) => [e.from, e.to]))
    expect([...touched].sort()).toEqual(
      arch.nodes.map((n) => n.participantId).sort(),
    )
  })
})

it('the default template covers both an HTTP and an async contract', () => {
  const { doc } = parse(PATTERNS.find((p) => p.id === 'async-fan-out')!.dsl)
  expect(doc.contracts.map((c) => c.transport).sort()).toEqual(['http', 'sns'])
  expect(doc.contracts.every((c) => c.responses.some((r) => !r.isHappyPath))).toBe(true)
  const arch = inferArchitecture(doc)
  expect(arch.edges.filter((e) => e.hasUnhappyPath).length).toBeGreaterThan(0)
})
