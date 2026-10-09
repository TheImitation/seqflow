/**
 * The single source of truth for a SeqFlow project.
 *
 * Both the text editor and the visual canvases are views over `SequenceDoc`.
 * Text edits parse into it; canvas edits mutate it and re-serialize. Nothing
 * lives in only one of the two views.
 */

export const AWS_KINDS = [
  // Compute
  'aws:lambda',
  'aws:ecs',
  'aws:eks',
  'aws:batch',
  'aws:apprunner',
  'aws:stepfunctions',
  // API & edge
  'aws:apigateway',
  'aws:appsync',
  'aws:cloudfront',
  'aws:waf',
  'aws:alb',
  // Messaging
  'aws:sqs',
  'aws:sns',
  'aws:eventbridge',
  'aws:kinesis',
  'aws:firehose',
  'aws:msk',
  'aws:mq',
  // Storage & data
  'aws:s3',
  'aws:dynamodb',
  'aws:rds',
  'aws:aurora',
  'aws:elasticache',
  'aws:neptune',
  'aws:redshift',
  'aws:athena',
  'aws:glue',
  // AI & search
  'aws:bedrock',
  'aws:bedrockagent',
  'aws:knowledgebase',
  'aws:opensearch',
  'aws:kendra',
  'aws:sagemaker',
  'aws:textract',
  'aws:comprehend',
  'aws:rekognition',
  // Security & ops
  'aws:cognito',
  'aws:verifiedpermissions',
  'aws:iam',
  'aws:secretsmanager',
  'aws:kms',
  'aws:cloudwatch',
  'aws:xray',
  // Delivery
  'aws:ecr',
  'aws:codedeploy',
] as const

export const PLAIN_KINDS = ['service', 'client', 'database', 'external'] as const

export const ALL_KINDS = [...PLAIN_KINDS, ...AWS_KINDS] as const

export type AwsKind = (typeof AWS_KINDS)[number]
export type PlainKind = (typeof PLAIN_KINDS)[number]
export type ParticipantKind = PlainKind | AwsKind

/**
 * The vocabulary is large enough that a flat picker is unusable, so every
 * surface that offers kinds reads these groups instead. A test asserts the
 * grouping covers `ALL_KINDS` exactly once, so a new kind cannot go missing
 * from the UI.
 */
export const KIND_GROUPS: { label: string; kinds: readonly ParticipantKind[] }[] = [
  {
    label: 'General',
    kinds: ['service', 'client', 'database', 'external'],
  },
  {
    label: 'Compute',
    kinds: [
      'aws:lambda',
      'aws:ecs',
      'aws:eks',
      'aws:batch',
      'aws:apprunner',
      'aws:stepfunctions',
    ],
  },
  {
    label: 'API & edge',
    kinds: ['aws:apigateway', 'aws:appsync', 'aws:cloudfront', 'aws:waf', 'aws:alb'],
  },
  {
    label: 'Messaging',
    kinds: [
      'aws:sqs',
      'aws:sns',
      'aws:eventbridge',
      'aws:kinesis',
      'aws:firehose',
      'aws:msk',
      'aws:mq',
    ],
  },
  {
    label: 'Storage & data',
    kinds: [
      'aws:s3',
      'aws:dynamodb',
      'aws:rds',
      'aws:aurora',
      'aws:elasticache',
      'aws:neptune',
      'aws:redshift',
      'aws:athena',
      'aws:glue',
    ],
  },
  {
    label: 'AI & search',
    kinds: [
      'aws:bedrock',
      'aws:bedrockagent',
      'aws:knowledgebase',
      'aws:opensearch',
      'aws:kendra',
      'aws:sagemaker',
      'aws:textract',
      'aws:comprehend',
      'aws:rekognition',
    ],
  },
  {
    label: 'Security & ops',
    kinds: [
      'aws:cognito',
      'aws:verifiedpermissions',
      'aws:iam',
      'aws:secretsmanager',
      'aws:kms',
      'aws:cloudwatch',
      'aws:xray',
    ],
  },
  {
    // Build and release participants. They only appear in pipeline diagrams,
    // but a pipeline is a sequence like any other and deserves real lifelines
    // rather than a note saying "and then CI deploys it".
    label: 'Delivery',
    kinds: ['aws:ecr', 'aws:codedeploy'],
  },
]

export function isAwsKind(kind: ParticipantKind): kind is AwsKind {
  return kind.startsWith('aws:')
}

/**
 * Kinds that hold a row-and-column schema a `table` block can describe.
 * Deliberately narrower than the "Storage & data" `KIND_GROUPS` entry: S3 is
 * blobs, ElastiCache is an ephemeral cache, Athena/Glue are query/ETL engines
 * — none of them own a schema in the sense this feature means.
 */
export const DATABASE_KINDS: ParticipantKind[] = [
  'database',
  'aws:dynamodb',
  'aws:rds',
  'aws:aurora',
  'aws:redshift',
  'aws:neptune',
]

export function isDatabaseKind(kind: ParticipantKind): boolean {
  return DATABASE_KINDS.includes(kind)
}

/**
 * 1-based line in the DSL text this element was parsed from. Parse metadata,
 * not content: the serializer ignores it and a reparse recomputes it. It is
 * what lets a click on the canvas move the editor cursor.
 */
export type SourceLine = number | undefined

export interface Participant {
  id: string
  label: string
  kind: ParticipantKind
  sourceLine?: SourceLine
}

export type MessageStyle = 'sync' | 'async' | 'fireAndForget'

export interface Message {
  id: string
  from: string
  to: string
  label: string
  style: MessageStyle
  /** Linear step index. Unique across messages and notes; drives playback. */
  order: number
  /** Enclosing loop/alt/opt, if any. */
  parentBlock?: string
  /** Name of a `Contract` in `SequenceDoc.contracts`. */
  contractRef?: string
  sourceLine?: SourceLine
}

export type BlockType = 'loop' | 'alt' | 'opt'

export interface Branch {
  label: string
  /** Inclusive index of the first step in the branch. */
  startOrder: number
  /** Exclusive. */
  endOrder: number
  /** Set from a trailing `(unhappy)` marker in the DSL. */
  isUnhappy?: boolean
}

export interface Block {
  id: string
  type: BlockType
  label: string
  startOrder: number
  endOrder: number
  parentBlock?: string
  /** Always present for `alt` (>= 1 entry). Absent for loop/opt. */
  branches?: Branch[]
  isUnhappy?: boolean
  sourceLine?: SourceLine
}

export interface Note {
  id: string
  over: string[]
  text: string
  order: number
  placement: 'over' | 'left' | 'right'
  parentBlock?: string
  sourceLine?: SourceLine
}

/* ---------------------------------------------------------------- contracts */

export type FieldType =
  | 'string'
  /**
   * A number of unstated precision. Right for a JSON payload, where there is
   * one number type and nothing to choose between — but in a `table` block
   * prefer `int` or `float`, because a column has to pick one and a score
   * stored as a whole number is silently destroyed.
   */
  | 'number'
  /** A whole number: keys, counts, ordinals, offsets. */
  | 'int'
  /** A real number: similarity scores and anything else a model emits. */
  | 'float'
  | 'boolean'
  | 'object'
  | 'array'
  | 'date'
  | 'enum'
  /** A binary part — only meaningful inside a `multipart` body. */
  | 'file'
  /**
   * A fixed-dimension embedding column (`vector(1024)`). Meaningful only in a
   * `table` block's columns — a wire payload has no reason to declare one,
   * since `EmbeddingResponse`-shaped models already describe the array shape
   * a vector travels as over JSON. The dimension is carried in `example`
   * (never read by the JSON-schema exporter, which only walks `dataModels`).
   */
  | 'vector'

/**
 * How a body is encoded on the wire. Separate from the model, which describes
 * the *shape*: the same `AvatarUpload` fields mean something different sent as
 * `multipart` than as `json`.
 */
export type BodyKind =
  | 'json'
  | 'form'
  | 'multipart'
  | 'text'
  | 'xml'
  | 'csv'
  | 'binary'
  | 'none'

export const BODY_KINDS: BodyKind[] = [
  'json',
  'form',
  'multipart',
  'text',
  'xml',
  'csv',
  'binary',
  'none',
]

/** Media type each kind travels as, for headers and for export. */
export const BODY_MEDIA_TYPE: Record<Exclude<BodyKind, 'none'>, string> = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
  text: 'text/plain',
  xml: 'application/xml',
  csv: 'text/csv',
  binary: 'application/octet-stream',
}

/** Kinds whose shape a `model` can describe. The rest are opaque payloads. */
export const STRUCTURED_BODY_KINDS: BodyKind[] = ['json', 'form', 'multipart']

export function isStructuredBody(kind: BodyKind): boolean {
  return STRUCTURED_BODY_KINDS.includes(kind)
}

export interface DataModelField {
  name: string
  type: FieldType
  required: boolean
  example?: unknown
  /** type === 'enum' */
  enumValues?: string[]
  /** type === 'object' | 'array' */
  children?: DataModelField[]
}

export interface DataModel {
  name: string
  description?: string
  fields: DataModelField[]
  sourceLine?: SourceLine
}

export interface ResponseSpec {
  /** '200', '402', or async equivalents like 'DLQ' / 'retry'. */
  code: string
  label: string
  modelName?: string
  isHappyPath: boolean
  /** Omitted means the default: `json` with a model, `none` without one. */
  body?: BodyKind
}

export type Transport =
  | 'http'
  | 'sqs'
  | 'sns'
  | 'eventbridge'
  | 'kinesis'
  | 'generic-async'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ContractHeader {
  key: string
  value: string
  required: boolean
}

export interface Contract {
  name: string
  transport: Transport
  /** http only */
  method?: HttpMethod
  path?: string
  /** request / message body */
  modelName?: string
  /** Omitted means the default: `json` with a model, `none` without one. */
  body?: BodyKind
  headers: ContractHeader[]
  responses: ResponseSpec[]
  sourceLine?: SourceLine
}

/* ------------------------------------------------------------- database schema */

export interface ForeignKey {
  column: string
  refTable: string
  refColumn: string
}

/**
 * A hand-authored table, deliberately separate from `model`/`contract`: a wire
 * payload and a normalized relational schema are different shapes, and
 * inferring one from the other silently forces them to agree when they
 * shouldn't have to.
 */
export interface DatabaseTable {
  name: string
  /** Which database participant owns this table. Unset means "not shown yet". */
  participantId?: string
  description?: string
  /** Reuses the model field shape — same nesting support, same type vocabulary. */
  columns: DataModelField[]
  primaryKey?: string[]
  foreignKeys: ForeignKey[]
  indexes: string[][]
  sourceLine?: SourceLine
}

/* -------------------------------------------------------------------- doc */

export interface SequenceDoc {
  participants: Participant[]
  messages: Message[]
  blocks: Block[]
  notes: Note[]
  dataModels: DataModel[]
  contracts: Contract[]
  tables: DatabaseTable[]
}

export function emptyDoc(): SequenceDoc {
  return {
    participants: [],
    messages: [],
    blocks: [],
    notes: [],
    dataModels: [],
    contracts: [],
    tables: [],
  }
}

/* ------------------------------------------------- derived architecture view */

export interface ArchNode {
  participantId: string
  kind: ParticipantKind
}

export interface ArchEdge {
  from: string
  to: string
  interactionCount: number
  styles: Set<MessageStyle>
  /** for hover tooltip */
  messageLabels: string[]
  /**
   * At least one underlying message sits on a failure branch that is actually
   * drawn — a path playback can walk. A contract that merely lists a 429 does
   * NOT set this; see `declaredFailures`.
   */
  hasUnhappyPath: boolean
  /**
   * Failure responses declared on the contracts behind this link. These are
   * facts about one call, not paths: nothing animates them and nothing on the
   * canvas shows their consequence.
   */
  declaredFailures: number
}

/* ------------------------------------------------------------------ helpers */

/**
 * A body kind is only ever stored when it differs from what the presence of a
 * model already implies, so an untagged contract keeps serializing unchanged.
 */
export function effectiveBody(carrier: { body?: BodyKind; modelName?: string }): BodyKind {
  return carrier.body ?? (carrier.modelName ? 'json' : 'none')
}

export function isDefaultBody(carrier: { body?: BodyKind; modelName?: string }): boolean {
  return carrier.body === undefined || carrier.body === (carrier.modelName ? 'json' : 'none')
}

export function participantById(
  doc: SequenceDoc,
  id: string,
): Participant | undefined {
  return doc.participants.find((p) => p.id === id)
}

export function contractByName(
  doc: SequenceDoc,
  name: string | undefined,
): Contract | undefined {
  if (!name) return undefined
  return doc.contracts.find((c) => c.name === name)
}

export function modelByName(
  doc: SequenceDoc,
  name: string | undefined,
): DataModel | undefined {
  if (!name) return undefined
  return doc.dataModels.find((m) => m.name === name)
}

