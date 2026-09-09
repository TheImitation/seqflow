import type { MessageStyle, SequenceDoc } from '../dsl/ast'
import { buildTree, type SeqNode } from '../dsl/tree'

const ARROW: Record<MessageStyle, string> = {
  sync: '->>',
  async: '-->>',
  fireAndForget: '-x',
}

/**
 * Valid `sequenceDiagram` text: the `: <kind>` tags come off, models and
 * contracts are dropped, everything else survives verbatim.
 */
export function toMermaid(doc: SequenceDoc): string {
  const out: string[] = ['sequenceDiagram']

  for (const p of doc.participants) {
    const keyword = p.kind === 'client' ? 'actor' : 'participant'
    out.push(
      p.label && p.label !== p.id
        ? `  ${keyword} ${p.id} as ${p.label}`
        : `  ${keyword} ${p.id}`,
    )
  }

  write(buildTree(doc), out, 1)
  return out.join('\n') + '\n'
}

function write(nodes: SeqNode[], out: string[], depth: number): void {
  const pad = '  '.repeat(depth)
  for (const node of nodes) {
    if (node.kind === 'message') {
      const m = node.message
      const ref = m.contractRef ? ` @${m.contractRef}` : ''
      out.push(`${pad}${m.from}${ARROW[m.style]}${m.to}: ${m.label}${ref}`)
      continue
    }
    if (node.kind === 'note') {
      const n = node.note
      const placement =
        n.placement === 'over' ? 'over' : n.placement === 'left' ? 'left of' : 'right of'
      out.push(`${pad}Note ${placement} ${n.over.join(',')}: ${n.text}`)
      continue
    }

    const head = node.branches[0]
    out.push(`${pad}${node.block.type} ${label(head?.label ?? node.block.label, head?.isUnhappy)}`)
    write(head?.children ?? [], out, depth + 1)
    for (let i = 1; i < node.branches.length; i++) {
      out.push(`${pad}else ${label(node.branches[i].label, node.branches[i].isUnhappy)}`)
      write(node.branches[i].children, out, depth + 1)
    }
    out.push(`${pad}end`)
  }
}

function label(text: string, isUnhappy?: boolean): string {
  return isUnhappy ? `${text} (unhappy)`.trim() : text
}
