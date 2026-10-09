import { describe, expect, it } from 'vitest'
import { ALL_KINDS, AWS_KINDS, DATABASE_KINDS, isAwsKind, isDatabaseKind, KIND_GROUPS } from './ast'
import { KIND_LABEL } from '../render/aws-icons/labels'
import { parse } from './parser'
import { serialize } from './serializer'

describe('kind vocabulary', () => {
  it('groups every kind exactly once', () => {
    const grouped = KIND_GROUPS.flatMap((g) => g.kinds)
    expect([...grouped].sort()).toEqual([...ALL_KINDS].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('labels every kind distinctly', () => {
    const labels = ALL_KINDS.map((k) => KIND_LABEL[k])
    expect(labels.every(Boolean)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('round-trips every kind through the DSL', () => {
    for (const kind of ALL_KINDS) {
      const src = `sequenceDiagram\n  participant P : ${kind}\n  P->>P: ping\n`
      const { doc, errors } = parse(src)
      expect(errors, kind).toEqual([])
      expect(doc.participants[0].kind, kind).toBe(kind)
      // `service` is the default and is omitted on the way out.
      expect(serialize(doc), kind).toContain(
        kind === 'service' ? 'participant P\n' : `participant P : ${kind}`,
      )
    }
  })

  it('keeps the aws prefix consistent', () => {
    expect(AWS_KINDS.every((k) => k.startsWith('aws:'))).toBe(true)
    expect(AWS_KINDS.every(isAwsKind)).toBe(true)
    expect(ALL_KINDS.filter(isAwsKind)).toHaveLength(AWS_KINDS.length)
  })

  it('narrows database kinds to ones that actually hold a schema', () => {
    for (const kind of DATABASE_KINDS) {
      expect(isDatabaseKind(kind), kind).toBe(true)
    }
    // Blob store, ephemeral cache, and query/ETL engines don't hold a
    // row-and-column schema in the sense a `table` block means.
    for (const excluded of ['aws:s3', 'aws:elasticache', 'aws:athena', 'aws:glue', 'service']) {
      expect(isDatabaseKind(excluded as (typeof ALL_KINDS)[number]), excluded).toBe(false)
    }
  })

  it('accepts friendly spellings for the ones people abbreviate', () => {
    const cases: [string, string][] = [
      ['vectorsearch', 'aws:opensearch'],
      ['aws:vectorstore', 'aws:opensearch'],
      ['aws:aoss', 'aws:opensearch'],
      ['kb', 'aws:knowledgebase'],
      ['aws:knowledge-base', 'aws:knowledgebase'],
      ['bedrock', 'aws:bedrock'],
      ['aws:bedrock-agent', 'aws:bedrockagent'],
      ['kafka', 'aws:msk'],
      ['redis', 'aws:elasticache'],
      ['pgvector', 'aws:aurora'],
      ['aws:x-ray', 'aws:xray'],
      ['elb', 'aws:alb'],
      ['aws:nlb', 'aws:alb'],
      ['loadbalancer', 'aws:alb'],
      ['firehose', 'aws:firehose'],
      ['aws:kinesis-firehose', 'aws:firehose'],
      ['aws:data-firehose', 'aws:firehose'],
      ['avp', 'aws:verifiedpermissions'],
      ['cedar', 'aws:verifiedpermissions'],
      ['aws:verified-permissions', 'aws:verifiedpermissions'],
      ['sts', 'aws:iam'],
      ['aws:role', 'aws:iam'],
      ['registry', 'aws:ecr'],
      ['aws:blue-green', 'aws:codedeploy'],
    ]
    for (const [written, expected] of cases) {
      const { doc, errors } = parse(`sequenceDiagram\n  participant P : ${written}\n`)
      expect(errors, written).toEqual([])
      expect(doc.participants[0].kind, written).toBe(expected)
    }
  })
})
