import type { MessageStyle, ParticipantKind, SequenceDoc } from '../dsl/ast'
import { buildTree, type SeqNode } from '../dsl/tree'

/**
 * PlantUML sequence syntax. Participant kinds map onto PlantUML's own keywords
 * (actor / database / queue) where one fits, and become a stereotype otherwise
 * so the AWS service is still visible in the output.
 */

const PLANTUML_KEYWORD: Partial<Record<ParticipantKind, string>> = {
  client: 'actor',
  database: 'database',
  external: 'boundary',
  'aws:dynamodb': 'database',
  'aws:rds': 'database',
  'aws:s3': 'database',
  'aws:sqs': 'queue',
  'aws:sns': 'queue',
  'aws:kinesis': 'queue',
  'aws:firehose': 'queue',
  'aws:eventbridge': 'queue',
  'aws:msk': 'queue',
  'aws:mq': 'queue',
  'aws:aurora': 'database',
  'aws:elasticache': 'database',
  'aws:neptune': 'database',
  'aws:redshift': 'database',
  'aws:opensearch': 'database',
  'aws:knowledgebase': 'database',
  'aws:cloudfront': 'boundary',
  'aws:waf': 'boundary',
  'aws:alb': 'boundary',
  'aws:bedrock': 'entity',
  'aws:bedrockagent': 'control',
  'aws:sagemaker': 'entity',
  'aws:iam': 'control',
  'aws:verifiedpermissions': 'control',
  'aws:codedeploy': 'control',
  'aws:ecr': 'database',
}

const PLANTUML_ARROW: Record<MessageStyle, string> = {
  sync: '->',
  async: '-->',
  fireAndForget: '->x',
}

export function toPlantUML(doc: SequenceDoc, title = 'Sequence'): string {
  const out: string[] = ['@startuml', `title ${title}`, '']

  for (const p of doc.participants) {
    const keyword = PLANTUML_KEYWORD[p.kind] ?? 'participant'
    const stereotype = p.kind.startsWith('aws:') ? ` <<${p.kind.slice(4)}>>` : ''
    out.push(`${keyword} "${p.label}" as ${p.id}${stereotype}`)
  }
  out.push('')

  writeUml(buildTree(doc), out, 0)
  out.push('', '@enduml')
  return out.join('\n') + '\n'
}

function label(text: string, isUnhappy?: boolean): string {
  return isUnhappy ? `${text} (unhappy)`.trim() : text
}

function writeUml(nodes: SeqNode[], out: string[], depth: number): void {
  const pad = '  '.repeat(depth)
  for (const node of nodes) {
    if (node.kind === 'message') {
      const m = node.message
      const ref = m.contractRef ? ` [@${m.contractRef}]` : ''
      out.push(`${pad}${m.from} ${PLANTUML_ARROW[m.style]} ${m.to} : ${m.label}${ref}`)
      continue
    }
    if (node.kind === 'note') {
      const n = node.note
      const placement =
        n.placement === 'over'
          ? `over ${n.over.join(', ')}`
          : `${n.placement} of ${n.over[0] ?? ''}`
      out.push(`${pad}note ${placement} : ${n.text}`)
      continue
    }

    const head = node.branches[0]
    out.push(`${pad}${node.block.type} ${label(head?.label ?? node.block.label, head?.isUnhappy)}`)
    writeUml(head?.children ?? [], out, depth + 1)
    for (let i = 1; i < node.branches.length; i++) {
      out.push(`${pad}else ${label(node.branches[i].label, node.branches[i].isUnhappy)}`)
      writeUml(node.branches[i].children, out, depth + 1)
    }
    out.push(`${pad}end`)
  }
}
