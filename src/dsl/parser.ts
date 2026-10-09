import {
  ALL_KINDS,
  BODY_KINDS,
  emptyDoc,
  type Block,
  type Branch,
  type Contract,
  type ContractHeader,
  type DataModel,
  type DataModelField,
  type DatabaseTable,
  type FieldType,
  type ForeignKey,
  type HttpMethod,
  type BodyKind,
  type Message,
  type MessageStyle,
  type ParticipantKind,
  type ResponseSpec,
  type SequenceDoc,
  type Transport,
} from './ast'

export interface ParseIssue {
  line: number
  message: string
}

export interface ParseResult {
  doc: SequenceDoc
  errors: ParseIssue[]
  warnings: ParseIssue[]
}

/* ------------------------------------------------------------------ tables */

const KIND_SET = new Set<string>(ALL_KINDS)

/** Forgiving spellings for participant kinds. */
const KIND_ALIASES: Record<string, ParticipantKind> = {
  'aws:api-gateway': 'aws:apigateway',
  'aws:apigw': 'aws:apigateway',
  'aws:step-functions': 'aws:stepfunctions',
  'aws:sfn': 'aws:stepfunctions',
  'aws:dynamo': 'aws:dynamodb',
  'aws:ddb': 'aws:dynamodb',
  'aws:fargate': 'aws:ecs',
  apigateway: 'aws:apigateway',
  apigw: 'aws:apigateway',
  lambda: 'aws:lambda',
  sqs: 'aws:sqs',
  sns: 'aws:sns',
  eventbridge: 'aws:eventbridge',
  stepfunctions: 'aws:stepfunctions',
  dynamodb: 'aws:dynamodb',
  s3: 'aws:s3',
  kinesis: 'aws:kinesis',
  cognito: 'aws:cognito',
  appsync: 'aws:appsync',
  ecs: 'aws:ecs',
  rds: 'aws:rds',
  // AI & search
  'aws:bedrock-agent': 'aws:bedrockagent',
  'aws:agent': 'aws:bedrockagent',
  'aws:kb': 'aws:knowledgebase',
  'aws:knowledge-base': 'aws:knowledgebase',
  'aws:aoss': 'aws:opensearch',
  'aws:opensearch-serverless': 'aws:opensearch',
  'aws:vectorstore': 'aws:opensearch',
  'aws:vectorsearch': 'aws:opensearch',
  'aws:elasticsearch': 'aws:opensearch',
  bedrock: 'aws:bedrock',
  bedrockagent: 'aws:bedrockagent',
  knowledgebase: 'aws:knowledgebase',
  kb: 'aws:knowledgebase',
  opensearch: 'aws:opensearch',
  vectorstore: 'aws:opensearch',
  vectorsearch: 'aws:opensearch',
  kendra: 'aws:kendra',
  sagemaker: 'aws:sagemaker',
  textract: 'aws:textract',
  comprehend: 'aws:comprehend',
  rekognition: 'aws:rekognition',
  llm: 'aws:bedrock',
  // Compute
  'aws:kubernetes': 'aws:eks',
  'aws:app-runner': 'aws:apprunner',
  eks: 'aws:eks',
  batch: 'aws:batch',
  apprunner: 'aws:apprunner',
  // Messaging
  'aws:kafka': 'aws:msk',
  kafka: 'aws:msk',
  msk: 'aws:msk',
  mq: 'aws:mq',
  rabbitmq: 'aws:mq',
  // Storage & data
  'aws:pgvector': 'aws:aurora',
  'aws:redis': 'aws:elasticache',
  aurora: 'aws:aurora',
  pgvector: 'aws:aurora',
  elasticache: 'aws:elasticache',
  redis: 'aws:elasticache',
  neptune: 'aws:neptune',
  redshift: 'aws:redshift',
  athena: 'aws:athena',
  glue: 'aws:glue',
  // Edge & ops
  'aws:secrets-manager': 'aws:secretsmanager',
  'aws:x-ray': 'aws:xray',
  cloudfront: 'aws:cloudfront',
  cdn: 'aws:cloudfront',
  waf: 'aws:waf',
  secretsmanager: 'aws:secretsmanager',
  secrets: 'aws:secretsmanager',
  kms: 'aws:kms',
  cloudwatch: 'aws:cloudwatch',
  xray: 'aws:xray',
  // Load balancing — 'elb' and 'alb' are used interchangeably in practice.
  'aws:elb': 'aws:alb',
  'aws:elbv2': 'aws:alb',
  'aws:load-balancer': 'aws:alb',
  'aws:loadbalancer': 'aws:alb',
  'aws:nlb': 'aws:alb',
  alb: 'aws:alb',
  elb: 'aws:alb',
  loadbalancer: 'aws:alb',
  // Delivery streams — renamed from Kinesis Data Firehose to Amazon Data
  // Firehose, so both spellings have to land in the same place.
  'aws:kinesis-firehose': 'aws:firehose',
  'aws:kinesisfirehose': 'aws:firehose',
  'aws:data-firehose': 'aws:firehose',
  'aws:datafirehose': 'aws:firehose',
  firehose: 'aws:firehose',
  kinesisfirehose: 'aws:firehose',
  // Authorization — people write the product, the acronym or the language.
  'aws:verified-permissions': 'aws:verifiedpermissions',
  'aws:avp': 'aws:verifiedpermissions',
  'aws:cedar': 'aws:verifiedpermissions',
  verifiedpermissions: 'aws:verifiedpermissions',
  avp: 'aws:verifiedpermissions',
  cedar: 'aws:verifiedpermissions',
  pdp: 'aws:verifiedpermissions',
  // Identity — STS is the token-issuing half of the same thing.
  'aws:sts': 'aws:iam',
  'aws:iam-role': 'aws:iam',
  'aws:role': 'aws:iam',
  iam: 'aws:iam',
  sts: 'aws:iam',
  // Delivery
  'aws:container-registry': 'aws:ecr',
  'aws:registry': 'aws:ecr',
  ecr: 'aws:ecr',
  registry: 'aws:ecr',
  'aws:code-deploy': 'aws:codedeploy',
  'aws:bluegreen': 'aws:codedeploy',
  'aws:blue-green': 'aws:codedeploy',
  codedeploy: 'aws:codedeploy',
  db: 'database',
  queue: 'aws:sqs',
  topic: 'aws:sns',
  user: 'client',
  actor: 'client',
  browser: 'client',
  api: 'service',
  thirdparty: 'external',
  'third-party': 'external',
}

const ARROW_STYLES: Record<string, MessageStyle> = {
  '->>': 'sync',
  '->': 'sync',
  '-->>': 'async',
  '-->': 'async',
  '-x': 'fireAndForget',
  '--x': 'fireAndForget',
  '-)': 'fireAndForget',
  '--)': 'fireAndForget',
}

/** Longest-first so `-->>` never loses to `->`. */
const ARROW_RE =
  /^(\S+?)\s*(-->>|--x|--\)|-->|->>|-x|-\)|->)\s*([+-]?)\s*([^:]+?)\s*:\s*(.*)$/

const NOTE_RE = /^note\s+(over|left of|right of)\s+([^:]+):\s*(.*)$/i
const MODEL_OPEN_RE = /^model\s+([A-Za-z_][\w-]*)\s*(?:"([^"]*)")?\s*\{\s*$/
const CONTRACT_OPEN_RE = /^contract\s+([A-Za-z_][\w-]*)\s*\{\s*$/
const TABLE_OPEN_RE =
  /^table\s+([A-Za-z_][\w-]*)\s*(?:@([A-Za-z_][\w-]*))?\s*(?:"([^"]*)")?\s*\{\s*$/
const FIELD_LINE_RE = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/
const RESERVED_TABLE_KEYS = new Set(['primaryKey', 'foreignKey', 'index'])
const BLOCK_OPEN_RE = /^(loop|alt|opt)\b\s*(.*)$/i
const IGNORED_BLOCK_RE = /^(par|rect|critical|break|box)\b\s*(.*)$/i

const FIELD_TYPES = new Set<string>([
  'string',
  'number',
  'int',
  'float',
  'boolean',
  'object',
  'array',
  'date',
  'enum',
  'file',
  'vector',
])

const VECTOR_RE = /^vector\s*\((\d+)\)$/i

const BODY_KIND_SET = new Set<string>(BODY_KINDS)

const TRANSPORTS = new Set<string>([
  'http',
  'sqs',
  'sns',
  'eventbridge',
  'kinesis',
  'generic-async',
])

const HTTP_METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/* ----------------------------------------------------------------- helpers */

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1)
  }
  return t
}

function indentOf(raw: string): number {
  const m = /^\s*/.exec(raw)
  return m ? m[0].length : 0
}

/** Pull a trailing `(unhappy)` / `(happy)` marker off a label. */
export function splitUnhappy(label: string): { label: string; isUnhappy?: boolean } {
  const m = /^(.*?)\s*\((unhappy|happy)\)\s*$/i.exec(label)
  if (!m) return { label: label.trim() }
  return { label: m[1].trim(), isUnhappy: m[2].toLowerCase() === 'unhappy' }
}

function parseLiteral(raw: string): unknown {
  const t = raw.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return unquote(t)
  }
}

function normalizeKind(raw: string): ParticipantKind | undefined {
  const k = raw.trim().toLowerCase()
  if (KIND_SET.has(k)) return k as ParticipantKind
  return KIND_ALIASES[k]
}

/** A 4xx/5xx code is unhappy unless explicitly marked otherwise. */
export function inferHappyPath(code: string, marker?: boolean): boolean {
  if (marker !== undefined) return !marker
  const n = Number(code)
  if (Number.isFinite(n)) return n < 400
  // Async pseudo-codes: DLQ / retry / failure are failure states by nature.
  return !/^(dlq|retry|fail|failed|failure|timeout|throttle|error)/i.test(code)
}

/* ------------------------------------------------------------------ frames */

type Frame =
  | { kind: 'block'; block: Block }
  | { kind: 'ignored'; keyword: string; line: number }

/* ------------------------------------------------------------------ parser */

export function parse(text: string): ParseResult {
  const doc = emptyDoc()
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []

  const rawLines = text.replace(/\r\n?/g, '\n').split('\n')
  const stack: Frame[] = []

  let order = 0
  let msgSeq = 0
  let blockSeq = 0
  let noteSeq = 0

  const err = (line: number, message: string) => errors.push({ line, message })
  const warn = (line: number, message: string) => warnings.push({ line, message })

  const openBlockFrame = (): Block | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i]
      if (f.kind === 'block') return f.block
    }
    return undefined
  }

  const ensureParticipant = (id: string): void => {
    if (!doc.participants.some((p) => p.id === id)) {
      doc.participants.push({ id, label: id, kind: 'service' })
    }
  }

  let i = 0
  while (i < rawLines.length) {
    const raw = rawLines[i]
    const lineNo = i + 1
    const line = raw.trim()
    i++

    if (!line) continue
    if (line.startsWith('%%') || line.startsWith('//') || line.startsWith('#')) continue
    if (/^sequenceDiagram\b/i.test(line)) continue
    if (/^autonumber\b/i.test(line)) continue
    if (/^(activate|deactivate)\b/i.test(line)) continue
    if (/^(links|link|properties|title|accTitle|accDescr)\b/i.test(line)) continue

    /* ---------------------------------------------------------- participant */
    const partMatch = /^(participant|actor)\s+(.+)$/i.exec(line)
    if (partMatch) {
      const isActor = partMatch[1].toLowerCase() === 'actor'
      let rest = partMatch[2].trim()
      let kind: ParticipantKind | undefined

      const kindMatch = /\s*:\s*([A-Za-z0-9:_-]+)\s*$/.exec(rest)
      if (kindMatch) {
        const resolved = normalizeKind(kindMatch[1])
        if (resolved) {
          kind = resolved
          rest = rest.slice(0, kindMatch.index).trim()
        } else {
          err(lineNo, `Unknown participant kind "${kindMatch[1]}".`)
          rest = rest.slice(0, kindMatch.index).trim()
        }
      }

      const asMatch = /^(\S+)\s+as\s+(.+)$/i.exec(rest)
      const id = unquote(asMatch ? asMatch[1] : rest)
      const label = unquote(asMatch ? asMatch[2] : id)

      if (!id) {
        err(lineNo, 'Participant is missing an id.')
        continue
      }

      const existing = doc.participants.find((p) => p.id === id)
      if (existing) {
        existing.label = label
        existing.kind = kind ?? existing.kind
        existing.sourceLine = lineNo
      } else {
        doc.participants.push({
          id,
          label,
          kind: kind ?? (isActor ? 'client' : 'service'),
          sourceLine: lineNo,
        })
      }
      continue
    }

    /* ---------------------------------------------------------------- model */
    const modelOpen = MODEL_OPEN_RE.exec(line)
    if (modelOpen) {
      const { model, next } = parseModelBlock(
        rawLines,
        i,
        modelOpen[1],
        modelOpen[2],
        err,
      )
      if (doc.dataModels.some((m) => m.name === model.name)) {
        err(lineNo, `Duplicate model "${model.name}".`)
      } else {
        model.sourceLine = lineNo
        doc.dataModels.push(model)
      }
      i = next
      continue
    }

    /* ------------------------------------------------------------- contract */
    const contractOpen = CONTRACT_OPEN_RE.exec(line)
    if (contractOpen) {
      const { contract, next } = parseContractBlock(
        rawLines,
        i,
        contractOpen[1],
        err,
        warn,
      )
      if (doc.contracts.some((c) => c.name === contract.name)) {
        err(lineNo, `Duplicate contract "${contract.name}".`)
      } else {
        contract.sourceLine = lineNo
        doc.contracts.push(contract)
      }
      i = next
      continue
    }

    /* ----------------------------------------------------------------- table */
    const tableOpen = TABLE_OPEN_RE.exec(line)
    if (tableOpen) {
      const { table, next } = parseTableBlock(
        rawLines,
        i,
        tableOpen[1],
        tableOpen[2],
        tableOpen[3],
        err,
      )
      if (doc.tables.some((t) => t.name === table.name)) {
        err(lineNo, `Duplicate table "${table.name}".`)
      } else {
        table.sourceLine = lineNo
        doc.tables.push(table)
      }
      i = next
      continue
    }

    /* ----------------------------------------------------------------- end */
    if (/^end\b/i.test(line)) {
      const frame = stack.pop()
      if (!frame) {
        err(lineNo, '`end` without a matching block.')
        continue
      }
      if (frame.kind === 'ignored') continue
      const b = frame.block
      b.endOrder = order
      if (b.branches && b.branches.length) {
        b.branches[b.branches.length - 1].endOrder = order
      }
      doc.blocks.push(b)
      continue
    }

    /* --------------------------------------------------------- block opener */
    const blockOpen = BLOCK_OPEN_RE.exec(line)
    if (blockOpen) {
      const type = blockOpen[1].toLowerCase() as Block['type']
      const { label, isUnhappy } = splitUnhappy(blockOpen[2] ?? '')
      const block: Block = {
        id: `b${blockSeq++}`,
        type,
        label,
        startOrder: order,
        endOrder: order,
        parentBlock: openBlockFrame()?.id,
        isUnhappy,
        sourceLine: lineNo,
      }
      if (type === 'alt') {
        block.branches = [{ label, startOrder: order, endOrder: order, isUnhappy }]
      }
      stack.push({ kind: 'block', block })
      continue
    }

    /* -------------------------------------------------------------- `else` */
    if (/^else\b/i.test(line)) {
      const frame = stack[stack.length - 1]
      if (!frame || frame.kind !== 'block' || frame.block.type !== 'alt') {
        err(lineNo, '`else` is only valid inside an `alt` block.')
        continue
      }
      const branches = frame.block.branches as Branch[]
      branches[branches.length - 1].endOrder = order
      const { label, isUnhappy } = splitUnhappy(line.replace(/^else\b\s*/i, ''))
      branches.push({ label, startOrder: order, endOrder: order, isUnhappy })
      continue
    }

    /* ------------------------------------------- unsupported mermaid blocks */
    const ignoredOpen = IGNORED_BLOCK_RE.exec(line)
    if (ignoredOpen) {
      const kw = ignoredOpen[1].toLowerCase()
      warn(
        lineNo,
        `\`${kw}\` is not part of the SeqFlow grammar — its contents are kept inline.`,
      )
      stack.push({ kind: 'ignored', keyword: kw, line: lineNo })
      continue
    }
    if (/^and\b/i.test(line) && stack.some((f) => f.kind === 'ignored')) {
      continue
    }

    /* ----------------------------------------------------------------- note */
    const noteMatch = NOTE_RE.exec(line)
    if (noteMatch) {
      const placement = noteMatch[1].toLowerCase().startsWith('left')
        ? 'left'
        : noteMatch[1].toLowerCase().startsWith('right')
          ? 'right'
          : 'over'
      const over = noteMatch[2]
        .split(',')
        .map((s) => unquote(s))
        .filter(Boolean)
      over.forEach(ensureParticipant)
      doc.notes.push({
        id: `n${noteSeq++}`,
        over,
        text: noteMatch[3].trim(),
        order: order++,
        placement,
        parentBlock: openBlockFrame()?.id,
        sourceLine: lineNo,
      })
      continue
    }

    /* -------------------------------------------------------------- message */
    const arrow = ARROW_RE.exec(line)
    if (arrow) {
      const from = unquote(arrow[1])
      const style = ARROW_STYLES[arrow[2]]
      const to = unquote(arrow[4])
      let label = arrow[5].trim()

      let contractRef: string | undefined
      const refMatch = /\s*@([A-Za-z_][\w-]*)\s*$/.exec(label)
      if (refMatch) {
        contractRef = refMatch[1]
        label = label.slice(0, refMatch.index).trim()
      }

      if (!from || !to) {
        err(lineNo, 'Message is missing a source or target participant.')
        continue
      }
      ensureParticipant(from)
      ensureParticipant(to)

      const msg: Message = {
        id: `m${msgSeq++}`,
        from,
        to,
        label,
        style,
        order: order++,
        parentBlock: openBlockFrame()?.id,
        contractRef,
        sourceLine: lineNo,
      }
      doc.messages.push(msg)
      continue
    }

    err(lineNo, `Could not parse: "${line}"`)
  }

  /* --------------------------------------------------------- unclosed blocks */
  while (stack.length) {
    const frame = stack.pop()!
    if (frame.kind === 'ignored') {
      warn(frame.line, `\`${frame.keyword}\` block was never closed with \`end\`.`)
      continue
    }
    const b = frame.block
    b.endOrder = order
    if (b.branches?.length) b.branches[b.branches.length - 1].endOrder = order
    doc.blocks.push(b)
    err(0, `Block \`${b.type} ${b.label}\` was never closed with \`end\`.`)
  }

  doc.blocks.sort((a, z) => a.startOrder - z.startOrder || z.endOrder - a.endOrder)

  /* ------------------------------------------------------ referential checks */
  const contractNames = new Set(doc.contracts.map((c) => c.name))
  const modelNames = new Set(doc.dataModels.map((m) => m.name))
  for (const m of doc.messages) {
    if (m.contractRef && !contractNames.has(m.contractRef)) {
      warn(0, `Message "${m.label}" references unknown contract "@${m.contractRef}".`)
    }
  }
  for (const c of doc.contracts) {
    if (c.modelName && !modelNames.has(c.modelName)) {
      warn(0, `Contract "${c.name}" references unknown model "${c.modelName}".`)
    }
    for (const r of c.responses) {
      if (r.modelName && !modelNames.has(r.modelName)) {
        warn(
          0,
          `Contract "${c.name}" response ${r.code} references unknown model "${r.modelName}".`,
        )
      }
    }
  }
  for (const t of doc.tables) {
    if (t.participantId && !doc.participants.some((p) => p.id === t.participantId)) {
      warn(
        t.sourceLine ?? 0,
        `Table "${t.name}" references unknown participant "@${t.participantId}".`,
      )
    }
  }

  return { doc, errors, warnings }
}

/* ------------------------------------------------------------- model block */

/**
 * Parses everything after a field's `name:` up to end of line — the shape a
 * `model` field and a `table` column share exactly. Kept separate from the
 * two callers' loops because closing-brace/nesting bookkeeping differs
 * enough (a table's reserved key lines) that folding it in would obscure
 * both.
 */
function buildField(
  name: string,
  rawRest: string,
  lineNo: number,
  err: (line: number, m: string) => void,
): DataModelField {
  let rest = rawRest.trim()
  let hasChildren = false
  if (/\{\s*$/.test(rest)) {
    hasChildren = true
    rest = rest.replace(/\{\s*$/, '').trim()
  }

  let example: unknown
  const eq = topLevelEquals(rest)
  if (eq >= 0) {
    example = parseLiteral(rest.slice(eq + 1))
    rest = rest.slice(0, eq).trim()
  }

  const parts = rest.split(/\s+/).filter(Boolean)
  const typeTok = parts.shift() ?? 'string'
  const flags = parts.map((p) => p.toLowerCase())

  let type: FieldType = 'string'
  let enumValues: string[] | undefined
  const enumMatch = /^enum\s*\[(.*)\]$/i.exec(typeTok)
  const vectorMatch = VECTOR_RE.exec(typeTok)
  if (enumMatch) {
    type = 'enum'
    enumValues = enumMatch[1]
      .split(',')
      .map((s) => unquote(s))
      .filter(Boolean)
  } else if (vectorMatch) {
    // The dimension lives in `example` — a vector's authoritative extra data,
    // never in tension with a genuine example value since one wouldn't apply.
    type = 'vector'
    example = Number(vectorMatch[1])
  } else if (FIELD_TYPES.has(typeTok.toLowerCase())) {
    type = typeTok.toLowerCase() as FieldType
  } else {
    err(lineNo, `Unknown field type "${typeTok}" — defaulting to string.`)
  }

  const field: DataModelField = {
    name,
    type: hasChildren && type !== 'array' ? 'object' : type,
    required: flags.includes('required'),
    example,
    enumValues,
  }
  if (hasChildren) field.children = []
  return field
}

function parseModelBlock(
  lines: string[],
  start: number,
  name: string,
  description: string | undefined,
  err: (line: number, m: string) => void,
): { model: DataModel; next: number } {
  const model: DataModel = { name, description: description || undefined, fields: [] }
  // Stack of field lists, innermost last, paired with the indent that opened it.
  const stack: DataModelField[][] = [model.fields]

  let i = start
  for (; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const lineNo = i + 1
    if (!line) continue
    if (line.startsWith('%%') || line.startsWith('//')) continue

    if (line === '}') {
      if (stack.length === 1) {
        i++
        break
      }
      stack.pop()
      continue
    }

    const m = FIELD_LINE_RE.exec(line)
    if (!m) {
      err(lineNo, `Could not parse model field: "${line}"`)
      continue
    }

    const field = buildField(m[1], m[2], lineNo, err)
    stack[stack.length - 1].push(field)
    if (field.children) stack.push(field.children)
  }

  return { model, next: i }
}

/* ------------------------------------------------------------- table block */

function parseTableBlock(
  lines: string[],
  start: number,
  name: string,
  participantId: string | undefined,
  description: string | undefined,
  err: (line: number, m: string) => void,
): { table: DatabaseTable; next: number } {
  const table: DatabaseTable = {
    name,
    participantId,
    description: description || undefined,
    columns: [],
    foreignKeys: [],
    indexes: [],
  }
  // Same field-list stack as a model — columns nest exactly like fields do.
  const stack: DataModelField[][] = [table.columns]

  let i = start
  for (; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const lineNo = i + 1
    if (!line) continue
    if (line.startsWith('%%') || line.startsWith('//')) continue

    if (line === '}') {
      if (stack.length === 1) {
        i++
        break
      }
      stack.pop()
      continue
    }

    const m = FIELD_LINE_RE.exec(line)
    if (!m) {
      err(lineNo, `Could not parse table line: "${line}"`)
      continue
    }

    // Reserved only at the table's own outer scope — a nested column may
    // still be named `primaryKey` inside a `{...}` with no ambiguity.
    if (stack.length === 1 && RESERVED_TABLE_KEYS.has(m[1])) {
      const value = m[2].trim()
      if (m[1] === 'primaryKey') {
        table.primaryKey = splitColumnList(value)
      } else if (m[1] === 'index') {
        table.indexes.push(splitColumnList(value))
      } else {
        const fk = parseForeignKeyLine(value)
        if (fk) table.foreignKeys.push(fk)
        else err(lineNo, `Could not parse foreign key: "${value}"`)
      }
      continue
    }

    const field = buildField(m[1], m[2], lineNo, err)
    stack[stack.length - 1].push(field)
    if (field.children) stack.push(field.children)
  }

  return { table, next: i }
}

function splitColumnList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** `col -> RefTable.RefColumn`, mirroring a response line's `->` split. */
function parseForeignKeyLine(value: string): ForeignKey | undefined {
  const arrow = value.indexOf('->')
  if (arrow < 0) return undefined
  const column = value.slice(0, arrow).trim()
  const rest = value.slice(arrow + 2).trim()
  const dot = rest.lastIndexOf('.')
  if (!column || dot < 0) return undefined
  const refTable = rest.slice(0, dot).trim()
  const refColumn = rest.slice(dot + 1).trim()
  if (!refTable || !refColumn) return undefined
  return { column, refTable, refColumn }
}

/** Index of an `=` that is not inside brackets or quotes. */
function topLevelEquals(s: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
    else if (c === '=' && depth === 0) return i
  }
  return -1
}

/* ---------------------------------------------------------- contract block */

function parseContractBlock(
  lines: string[],
  start: number,
  name: string,
  err: (line: number, m: string) => void,
  warn: (line: number, m: string) => void,
): { contract: Contract; next: number } {
  const contract: Contract = {
    name,
    transport: 'http',
    headers: [],
    responses: [],
  }

  type Mode = 'none' | 'headers' | 'responses'
  let mode: Mode = 'none'
  let sectionIndent = 0

  let i = start
  for (; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const lineNo = i + 1
    if (!line) continue
    if (line.startsWith('%%') || line.startsWith('//')) continue
    if (line === '}') {
      i++
      break
    }

    // A line at or above the section's own indent closes the section.
    if (mode !== 'none' && indentOf(raw) <= sectionIndent) mode = 'none'

    if (/^headers\s*:\s*$/i.test(line)) {
      mode = 'headers'
      sectionIndent = indentOf(raw)
      continue
    }
    if (/^responses\s*:\s*$/i.test(line)) {
      mode = 'responses'
      sectionIndent = indentOf(raw)
      continue
    }

    if (mode === 'headers') {
      const h = parseHeaderLine(line)
      if (h) contract.headers.push(h)
      else err(lineNo, `Could not parse header: "${line}"`)
      continue
    }

    if (mode === 'responses') {
      const r = parseResponseLine(line)
      if (r) contract.responses.push(r)
      else err(lineNo, `Could not parse response: "${line}"`)
      continue
    }

    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) {
      err(lineNo, `Could not parse contract line: "${line}"`)
      continue
    }
    const key = kv[1].toLowerCase()
    const value = unquote(kv[2])

    switch (key) {
      case 'transport':
        if (TRANSPORTS.has(value.toLowerCase())) {
          contract.transport = value.toLowerCase() as Transport
        } else {
          err(lineNo, `Unknown transport "${value}" — defaulting to http.`)
        }
        break
      case 'method':
        if (HTTP_METHODS.has(value.toUpperCase())) {
          contract.method = value.toUpperCase() as HttpMethod
        } else {
          err(lineNo, `Unknown HTTP method "${value}".`)
        }
        break
      case 'path':
        contract.path = value
        break
      case 'model':
        contract.modelName = value
        break
      case 'body':
        if (BODY_KIND_SET.has(value.toLowerCase())) {
          contract.body = value.toLowerCase() as BodyKind
        } else {
          err(
            lineNo,
            `Unknown body kind "${value}" — expected one of ${BODY_KINDS.join(', ')}.`,
          )
        }
        break
      default:
        warn(lineNo, `Ignoring unknown contract key "${kv[1]}".`)
    }
  }

  return { contract, next: i }
}

function parseHeaderLine(line: string): ContractHeader | undefined {
  const idx = line.indexOf(':')
  if (idx < 0) return undefined
  const key = line.slice(0, idx).trim()
  let value = line.slice(idx + 1).trim()
  let required = false
  const req = /\s+(required|optional)$/i.exec(value)
  if (req) {
    required = req[1].toLowerCase() === 'required'
    value = value.slice(0, req.index).trim()
  }
  if (!key) return undefined
  return { key, value, required }
}

function parseResponseLine(line: string): ResponseSpec | undefined {
  let rest = line
  let modelName: string | undefined
  const arrow = rest.lastIndexOf('->')
  if (arrow >= 0) {
    modelName = rest.slice(arrow + 2).trim() || undefined
    rest = rest.slice(0, arrow).trim()
  }

  let marker: boolean | undefined
  const mk = /\((unhappy|happy)\)/i.exec(rest)
  if (mk) {
    marker = mk[1].toLowerCase() === 'unhappy'
    rest = (rest.slice(0, mk.index) + rest.slice(mk.index + mk[0].length)).trim()
  }

  // `as <kind>` only counts when the word really is a body kind, so a label
  // that happens to end in "as something" survives intact.
  let body: BodyKind | undefined
  const asKind = /\s+as\s+([A-Za-z-]+)\s*$/.exec(rest)
  if (asKind && BODY_KIND_SET.has(asKind[1].toLowerCase())) {
    body = asKind[1].toLowerCase() as BodyKind
    rest = rest.slice(0, asKind.index).trim()
  }

  const m = /^(\S+)\s*(.*)$/.exec(rest.trim())
  if (!m) return undefined

  return {
    code: m[1],
    label: m[2].trim(),
    modelName,
    isHappyPath: inferHappyPath(m[1], marker),
    body,
  }
}
