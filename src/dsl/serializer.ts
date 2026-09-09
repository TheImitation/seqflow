import {
  isDefaultBody,
  type Block,
  type Contract,
  type DataModel,
  type DataModelField,
  type DatabaseTable,
  type Message,
  type MessageStyle,
  type Note,
  type SequenceDoc,
} from './ast'
import { buildTree, type SeqNode } from './tree'

const ARROW_FOR: Record<MessageStyle, string> = {
  sync: '->>',
  async: '-->>',
  fireAndForget: '-x',
}

const INDENT = '  '

/** Serialize a `SequenceDoc` back to DSL text. Round-trips through `parse`. */
export function serialize(doc: SequenceDoc): string {
  const out: string[] = ['sequenceDiagram']

  for (const p of doc.participants) {
    let line = `${INDENT}participant ${p.id}`
    if (p.label && p.label !== p.id) line += ` as ${p.label}`
    if (p.kind !== 'service') line += ` : ${p.kind}`
    out.push(line)
  }

  const tree = buildTree(doc)
  if (tree.length) out.push('')
  writeNodes(tree, out, 1)

  for (const model of doc.dataModels) {
    out.push('')
    writeModel(model, out)
  }

  for (const contract of doc.contracts) {
    out.push('')
    writeContract(contract, out)
  }

  for (const table of doc.tables) {
    out.push('')
    writeTable(table, out)
  }

  return out.join('\n') + '\n'
}

function writeNodes(nodes: SeqNode[], out: string[], depth: number): void {
  const pad = INDENT.repeat(depth)
  for (const node of nodes) {
    switch (node.kind) {
      case 'message':
        out.push(pad + messageLine(node.message))
        break
      case 'note':
        out.push(pad + noteLine(node.note))
        break
      case 'block':
        writeBlock(node.block, node.branches, out, depth)
        break
    }
  }
}

function writeBlock(
  block: Block,
  branches: { label: string; isUnhappy?: boolean; children: SeqNode[] }[],
  out: string[],
  depth: number,
): void {
  const pad = INDENT.repeat(depth)
  const head = branches[0]
  out.push(
    `${pad}${block.type}${labelSuffix(head?.label ?? block.label, head?.isUnhappy ?? block.isUnhappy)}`,
  )
  writeNodes(head?.children ?? [], out, depth + 1)

  for (let i = 1; i < branches.length; i++) {
    const b = branches[i]
    out.push(`${pad}else${labelSuffix(b.label, b.isUnhappy)}`)
    writeNodes(b.children, out, depth + 1)
  }
  out.push(`${pad}end`)
}

function labelSuffix(label: string, isUnhappy?: boolean): string {
  const parts: string[] = []
  if (label) parts.push(label)
  if (isUnhappy) parts.push('(unhappy)')
  return parts.length ? ' ' + parts.join(' ') : ''
}

export function messageLine(m: Message): string {
  const ref = m.contractRef ? ` @${m.contractRef}` : ''
  return `${m.from}${ARROW_FOR[m.style]}${m.to}: ${m.label}${ref}`
}

function noteLine(n: Note): string {
  const placement =
    n.placement === 'over' ? 'over' : n.placement === 'left' ? 'left of' : 'right of'
  return `Note ${placement} ${n.over.join(',')}: ${n.text}`
}

/* ------------------------------------------------------------------ models */

function writeModel(model: DataModel, out: string[]): void {
  const desc = model.description ? ` "${model.description}"` : ''
  out.push(`model ${model.name}${desc} {`)
  writeFields(model.fields, out, 1)
  out.push('}')
}

function writeFields(fields: DataModelField[], out: string[], depth: number): void {
  const pad = INDENT.repeat(depth)
  for (const f of fields) {
    let type: string = f.type
    if (f.type === 'enum') type = `enum[${(f.enumValues ?? []).join(',')}]`
    if (f.type === 'vector') type = `vector(${f.example})`

    let line = `${pad}${f.name}: ${type}`
    if (f.required) line += ' required'
    // The dimension is already folded into the type token above.
    if (f.example !== undefined && f.type !== 'vector') line += ` = ${JSON.stringify(f.example)}`

    if (f.children?.length) {
      out.push(`${line} {`)
      writeFields(f.children, out, depth + 1)
      out.push(`${pad}}`)
    } else {
      out.push(line)
    }
  }
}

/* --------------------------------------------------------------- contracts */

function writeContract(c: Contract, out: string[]): void {
  out.push(`contract ${c.name} {`)
  out.push(`${INDENT}transport: ${c.transport}`)
  if (c.method) out.push(`${INDENT}method: ${c.method}`)
  if (c.path) out.push(`${INDENT}path: ${c.path}`)
  if (c.modelName) out.push(`${INDENT}model: ${c.modelName}`)
  // Only written when it is not what the model's presence already implies.
  if (!isDefaultBody(c)) out.push(`${INDENT}body: ${c.body}`)

  if (c.headers.length) {
    out.push(`${INDENT}headers:`)
    for (const h of c.headers) {
      out.push(`${INDENT}${INDENT}${h.key}: ${h.value}${h.required ? ' required' : ''}`)
    }
  }

  if (c.responses.length) {
    out.push(`${INDENT}responses:`)
    for (const r of c.responses) {
      let line = `${INDENT}${INDENT}${r.code}`
      if (r.label) line += ` ${r.label}`
      if (!r.isHappyPath) line += ' (unhappy)'
      if (!isDefaultBody(r)) line += ` as ${r.body}`
      if (r.modelName) line += ` -> ${r.modelName}`
      out.push(line)
    }
  }

  out.push('}')
}

/* ------------------------------------------------------------------ tables */

function writeTable(table: DatabaseTable, out: string[]): void {
  const ref = table.participantId ? ` @${table.participantId}` : ''
  const desc = table.description ? ` "${table.description}"` : ''
  out.push(`table ${table.name}${ref}${desc} {`)
  writeFields(table.columns, out, 1)
  if (table.primaryKey?.length) {
    out.push(`${INDENT}primaryKey: ${table.primaryKey.join(', ')}`)
  }
  for (const fk of table.foreignKeys) {
    out.push(`${INDENT}foreignKey: ${fk.column} -> ${fk.refTable}.${fk.refColumn}`)
  }
  for (const idx of table.indexes) {
    out.push(`${INDENT}index: ${idx.join(', ')}`)
  }
  out.push('}')
}
