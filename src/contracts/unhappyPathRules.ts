import {
  contractByName,
  participantById,
  type Contract,
  type HttpMethod,
  type Message,
  type MessageStyle,
  type ParticipantKind,
  type SequenceDoc,
  type Transport,
} from '../dsl/ast'

/**
 * The rule table behind "Suggest unhappy paths". Keyed on
 * (transport, method, target kind); returns candidate failure branches that the
 * person ticks. Nothing here mutates the doc — see `applyUnhappyPaths`.
 */

/**
 * Placeholder participants a generated step can refer to. `broker` is whichever
 * side of the message is the queue/topic/bus/stream; `consumer` is who it
 * delivers to. Those two matter because a producer-side message
 * (`OrderSvc->>Queue`) and a consumer-side one (`Queue-->>PaymentSvc`) should
 * both generate the same redelivery story.
 */
export type Ref = 'source' | 'target' | 'dlq' | 'broker' | 'consumer'

export type GeneratedStep =
  | { kind: 'message'; from: Ref; to: Ref; label: string; style: MessageStyle }
  | { kind: 'note'; over: Ref[]; text: string }

export interface UnhappySuggestion {
  id: string
  /** `alt` becomes an else-branch on the reply; `opt` becomes a trailing block. */
  shape: 'alt' | 'opt'
  /** Branch or block label, e.g. `503 ServiceUnavailable`. */
  label: string
  description: string
  group: string
  steps: GeneratedStep[]
  /** Response added to the message's contract, when it has one. */
  response?: { code: string; label: string }
  /** A DLQ-style participant the branch needs. */
  needsParticipant?: { idHint: string; labelHint: string; kind: ParticipantKind }
  defaultChecked: boolean
}

/* ------------------------------------------------------------------ status */

export interface StatusInfo {
  code: string
  meaning: string
  happy: boolean
}

/** The status codes the generator and the inspector both know about. */
export const STATUS_CODES: StatusInfo[] = [
  { code: '200', meaning: 'OK', happy: true },
  { code: '201', meaning: 'Created', happy: true },
  { code: '202', meaning: 'Accepted', happy: true },
  { code: '204', meaning: 'No Content', happy: true },
  { code: '400', meaning: 'Bad Request', happy: false },
  { code: '401', meaning: 'Unauthorized', happy: false },
  { code: '403', meaning: 'Forbidden', happy: false },
  { code: '404', meaning: 'Not Found', happy: false },
  { code: '409', meaning: 'Conflict', happy: false },
  { code: '422', meaning: 'Unprocessable Entity', happy: false },
  { code: '429', meaning: 'Too Many Requests', happy: false },
  { code: '500', meaning: 'Internal Server Error', happy: false },
  { code: '502', meaning: 'Bad Gateway', happy: false },
  { code: '503', meaning: 'Service Unavailable', happy: false },
  { code: '504', meaning: 'Gateway Timeout', happy: false },
]

export const STATUS_BY_CODE = new Map(STATUS_CODES.map((s) => [s.code, s]))

export interface MethodInfo {
  method: HttpMethod
  use: string
  happy: string
  unhappy: string[]
}

export const HTTP_METHODS: MethodInfo[] = [
  {
    method: 'GET',
    use: 'Fetch a resource',
    happy: '200',
    unhappy: ['404', '401', '403', '429'],
  },
  {
    method: 'POST',
    use: 'Create or trigger an action',
    happy: '201',
    unhappy: ['400', '409', '422', '429'],
  },
  { method: 'PUT', use: 'Full replace', happy: '200', unhappy: ['400', '404', '409', '429'] },
  {
    method: 'PATCH',
    use: 'Partial update',
    happy: '200',
    unhappy: ['400', '404', '409', '422', '429'],
  },
  { method: 'DELETE', use: 'Remove', happy: '204', unhappy: ['404', '409', '429'] },
]

export const HEADER_PRESETS: { key: string; value: string; note: string }[] = [
  { key: 'Content-Type', value: 'application/json', note: 'Body media type' },
  { key: 'Accept', value: 'application/json', note: 'Response media type' },
  { key: 'Authorization', value: 'Bearer <token>', note: 'Caller credentials' },
  {
    key: 'Idempotency-Key',
    value: 'string',
    note: 'Makes a retried POST safe to repeat',
  },
  { key: 'X-Correlation-Id', value: 'string', note: 'Ties one request across services' },
  { key: 'traceparent', value: 'string', note: 'W3C trace-context' },
]

/* -------------------------------------------------------------- inference */

const KIND_TRANSPORT: Partial<Record<ParticipantKind, Transport>> = {
  'aws:sqs': 'sqs',
  'aws:sns': 'sns',
  'aws:eventbridge': 'eventbridge',
  'aws:kinesis': 'kinesis',
  'aws:msk': 'generic-async',
  'aws:mq': 'generic-async',
}

export function inferTransport(doc: SequenceDoc, m: Message): Transport {
  const explicit = contractByName(doc, m.contractRef)?.transport
  if (explicit) return explicit

  const toKind = participantById(doc, m.to)?.kind
  const fromKind = participantById(doc, m.from)?.kind
  const byKind = (toKind && KIND_TRANSPORT[toKind]) ?? (fromKind && KIND_TRANSPORT[fromKind])
  if (byKind) return byKind

  if (m.style === 'fireAndForget') return 'generic-async'
  return 'http'
}

const METHOD_IN_LABEL = /\b(GET|POST|PUT|PATCH|DELETE)\b/i

export function inferMethod(doc: SequenceDoc, m: Message): HttpMethod {
  const explicit = contractByName(doc, m.contractRef)?.method
  if (explicit) return explicit
  const found = METHOD_IN_LABEL.exec(m.label)
  if (found) return found[1].toUpperCase() as HttpMethod
  if (/\b(get|fetch|read|list|query|lookup)\b/i.test(m.label)) return 'GET'
  if (/\b(delete|remove|revoke)\b/i.test(m.label)) return 'DELETE'
  if (/\b(update|patch)\b/i.test(m.label)) return 'PATCH'
  return 'POST'
}

export function inferPath(m: Message): string {
  const found = /(\/[\w{}\-/.:]*)/.exec(m.label)
  if (found) return found[1]
  const slug = m.label
    .replace(/\(.*\)/g, '')
    .trim()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return '/' + (slug || 'resource')
}

/* ------------------------------------------------------------- suggestions */

function httpBranch(
  code: string,
  meaning: string,
  description: string,
  reply: string,
  defaultChecked = true,
): UnhappySuggestion {
  return {
    id: `http-${code}`,
    shape: 'alt',
    label: `${code} ${meaning.replace(/\s+/g, '')}`,
    description,
    group: 'HTTP status',
    steps: [{ kind: 'message', from: 'target', to: 'source', label: reply, style: 'async' }],
    response: { code, label: meaning.replace(/\s+/g, '') },
    defaultChecked,
  }
}

const CROSS_CUTTING: UnhappySuggestion[] = [
  {
    id: 'x-timeout',
    shape: 'alt',
    label: 'timeout',
    description: 'The call exceeded its deadline and no response ever arrived.',
    group: 'Cross-cutting',
    steps: [
      { kind: 'note', over: ['source', 'target'], text: 'no response within the deadline' },
      {
        kind: 'message',
        from: 'source',
        to: 'source',
        label: 'Abort and surface a timeout',
        style: 'sync',
      },
    ],
    response: { code: 'timeout', label: 'Network timeout' },
    defaultChecked: false,
  },
  {
    id: 'x-refused',
    shape: 'alt',
    label: 'connection refused',
    description: 'The downstream was not reachable at all.',
    group: 'Cross-cutting',
    steps: [
      {
        kind: 'message',
        from: 'target',
        to: 'source',
        label: 'ECONNREFUSED',
        style: 'async',
      },
    ],
    response: { code: 'refused', label: 'Connection refused' },
    defaultChecked: false,
  },
  {
    id: 'x-breaker',
    shape: 'opt',
    label: 'circuit breaker open (unhappy)',
    description: 'Repeated failures trip the breaker and the call short-circuits.',
    group: 'Cross-cutting',
    steps: [
      {
        kind: 'note',
        over: ['source', 'target'],
        text: 'failure threshold reached, breaker opens',
      },
      {
        kind: 'message',
        from: 'source',
        to: 'source',
        label: 'Serve fallback without calling downstream',
        style: 'sync',
      },
    ],
    response: { code: 'breaker', label: 'Circuit breaker open' },
    defaultChecked: false,
  },
]

const DLQ_PARTICIPANT = {
  idHint: 'DLQ',
  labelHint: 'DeadLetterQueue',
  kind: 'aws:sqs' as ParticipantKind,
}

function targetKindSuggestions(kind: ParticipantKind | undefined): UnhappySuggestion[] {
  switch (kind) {
    case 'aws:sqs':
      return [
        {
          id: 'sqs-dlq',
          shape: 'opt',
          label: 'processing failure (unhappy)',
          description:
            'The consumer fails, the message becomes visible again, and after maxReceiveCount it moves to the DLQ.',
          group: 'SQS',
          steps: [
            {
              kind: 'message',
              from: 'broker',
              to: 'consumer',
              label: 'Deliver (attempt 1..N)',
              style: 'sync',
            },
            {
              kind: 'note',
              over: ['broker', 'consumer'],
              text: 'after maxReceiveCount exceeded',
            },
            {
              kind: 'message',
              from: 'broker',
              to: 'dlq',
              label: 'Move to dead-letter queue',
              style: 'sync',
            },
          ],
          response: { code: 'DLQ', label: 'Moved to dead-letter queue' },
          needsParticipant: DLQ_PARTICIPANT,
          defaultChecked: true,
        },
      ]
    case 'aws:sns':
      return [
        {
          id: 'sns-dlq',
          shape: 'opt',
          label: 'subscriber delivery failure (unhappy)',
          description:
            'Delivery to a subscriber fails, SNS retries per the delivery policy, then dead-letters or drops.',
          group: 'SNS',
          steps: [
            {
              kind: 'message',
              from: 'broker',
              to: 'consumer',
              label: 'Deliver to subscriber (retry per policy)',
              style: 'sync',
            },
            {
              kind: 'note',
              over: ['broker', 'consumer'],
              text: 'retries exhausted: DLQ if configured, otherwise dropped',
            },
            {
              kind: 'message',
              from: 'broker',
              to: 'dlq',
              label: 'Send undeliverable notification',
              style: 'sync',
            },
          ],
          response: { code: 'DLQ', label: 'Undeliverable after retries' },
          needsParticipant: DLQ_PARTICIPANT,
          defaultChecked: true,
        },
      ]
    case 'aws:eventbridge':
      return [
        {
          id: 'eb-dlq',
          shape: 'opt',
          label: 'target invocation failure (unhappy)',
          description:
            'The rule target fails, EventBridge retries with exponential backoff, then dead-letters.',
          group: 'EventBridge',
          steps: [
            {
              kind: 'message',
              from: 'broker',
              to: 'consumer',
              label: 'Retry target with exponential backoff',
              style: 'sync',
            },
            {
              kind: 'note',
              over: ['broker', 'consumer'],
              text: '185 attempts / 24h maximum event age',
            },
            {
              kind: 'message',
              from: 'broker',
              to: 'dlq',
              label: 'Send failed invocation',
              style: 'sync',
            },
          ],
          response: { code: 'DLQ', label: 'Sent to the rule dead-letter queue' },
          needsParticipant: DLQ_PARTICIPANT,
          defaultChecked: true,
        },
      ]
    case 'aws:kinesis':
      return [
        {
          id: 'kinesis-retry',
          shape: 'opt',
          label: 'batch processing failure (unhappy)',
          description:
            'The batch fails, the shard iterator re-delivers (bisecting on error), then reports the failed batch.',
          group: 'Kinesis',
          steps: [
            {
              kind: 'message',
              from: 'broker',
              to: 'consumer',
              label: 'Re-deliver batch (bisect on error)',
              style: 'sync',
            },
            {
              kind: 'note',
              over: ['broker', 'consumer'],
              text: 'after maximumRetryAttempts',
            },
            {
              kind: 'message',
              from: 'consumer',
              to: 'dlq',
              label: 'Report failed batch',
              style: 'sync',
            },
          ],
          response: { code: 'DLQ', label: 'Failed batch reported' },
          needsParticipant: DLQ_PARTICIPANT,
          defaultChecked: true,
        },
        {
          id: 'kinesis-throttle',
          shape: 'alt',
          label: 'ProvisionedThroughputExceeded (unhappy)',
          description: 'The shard write limit was exceeded.',
          group: 'Kinesis',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ProvisionedThroughputExceededException',
              style: 'async',
            },
          ],
          response: { code: 'throttle', label: 'ProvisionedThroughputExceededException' },
          defaultChecked: false,
        },
      ]
    case 'aws:lambda':
      return [
        {
          id: 'lambda-429',
          shape: 'alt',
          label: '429 Throttled',
          description: 'The reserved or account concurrency limit was hit.',
          group: 'Lambda',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'TooManyRequestsException',
              style: 'async',
            },
          ],
          response: { code: '429', label: 'Throttled (concurrency limit)' },
          defaultChecked: true,
        },
        {
          id: 'lambda-timeout',
          shape: 'alt',
          label: 'Task timed out',
          description: 'The invocation ran past the configured timeout.',
          group: 'Lambda',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'Task timed out after N seconds',
              style: 'async',
            },
          ],
          response: { code: 'timeout', label: 'Task timed out' },
          defaultChecked: true,
        },
        {
          id: 'lambda-unhandled',
          shape: 'alt',
          label: '500 UnhandledException',
          description: 'The handler threw and the error surfaced to the caller.',
          group: 'Lambda',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'Unhandled exception',
              style: 'async',
            },
          ],
          response: { code: '500', label: 'Unhandled exception' },
          defaultChecked: true,
        },
      ]
    case 'aws:dynamodb':
      return [
        {
          id: 'ddb-conditional',
          shape: 'alt',
          label: 'ConditionalCheckFailed (unhappy)',
          description: 'A condition expression did not hold — usually a concurrent write.',
          group: 'DynamoDB',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ConditionalCheckFailedException',
              style: 'async',
            },
          ],
          response: { code: '409', label: 'ConditionalCheckFailedException' },
          defaultChecked: true,
        },
        {
          id: 'ddb-throughput',
          shape: 'alt',
          label: 'ProvisionedThroughputExceeded (unhappy)',
          description: 'The table or index ran out of provisioned capacity.',
          group: 'DynamoDB',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ProvisionedThroughputExceededException',
              style: 'async',
            },
          ],
          response: { code: '429', label: 'ProvisionedThroughputExceededException' },
          defaultChecked: true,
        },
        {
          id: 'ddb-notfound',
          shape: 'alt',
          label: 'ResourceNotFound (unhappy)',
          description: 'The table or index does not exist.',
          group: 'DynamoDB',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ResourceNotFoundException',
              style: 'async',
            },
          ],
          response: { code: '404', label: 'ResourceNotFoundException' },
          defaultChecked: false,
        },
      ]
    case 'aws:stepfunctions':
      return [
        {
          id: 'sfn-taskfailed',
          shape: 'alt',
          label: 'States.TaskFailed (unhappy)',
          description:
            'The task failed, a Retry policy backs off, a Catch routes to a fallback state, and the execution ends Failed.',
          group: 'Step Functions',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'States.TaskFailed',
              style: 'async',
            },
            {
              kind: 'message',
              from: 'source',
              to: 'source',
              label: 'Retry 3x with exponential backoff',
              style: 'sync',
            },
            {
              kind: 'note',
              over: ['source'],
              text: 'Catch routes to the fallback state',
            },
            {
              kind: 'message',
              from: 'source',
              to: 'source',
              label: 'execution Failed',
              style: 'sync',
            },
          ],
          response: { code: 'States.TaskFailed', label: 'Task failed after retries' },
          defaultChecked: true,
        },
      ]
    case 'aws:bedrock':
    case 'aws:bedrockagent':
      return [
        {
          id: 'bedrock-throttle',
          shape: 'alt',
          label: 'ThrottlingException (unhappy)',
          description:
            'Account or model throughput exceeded. Retry with backoff, or fall back to a smaller model.',
          group: 'Bedrock',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ThrottlingException',
              style: 'async',
            },
            {
              kind: 'message',
              from: 'source',
              to: 'source',
              label: 'Retry with exponential backoff',
              style: 'sync',
            },
          ],
          response: { code: '429', label: 'ThrottlingException' },
          defaultChecked: true,
        },
        {
          id: 'bedrock-context',
          shape: 'alt',
          label: 'ValidationException (unhappy)',
          description:
            'The prompt exceeded the context window, or the request was malformed.',
          group: 'Bedrock',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ValidationException: input too long',
              style: 'async',
            },
          ],
          response: { code: '400', label: 'ValidationException' },
          defaultChecked: true,
        },
        {
          id: 'bedrock-timeout',
          shape: 'alt',
          label: 'Model timeout (unhappy)',
          description: 'Generation ran past the read timeout — common on long completions.',
          group: 'Bedrock',
          steps: [
            {
              kind: 'note',
              over: ['source', 'target'],
              text: 'streaming avoids most read timeouts',
            },
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ModelTimeoutException',
              style: 'async',
            },
          ],
          response: { code: 'timeout', label: 'ModelTimeoutException' },
          defaultChecked: true,
        },
        {
          id: 'bedrock-guardrail',
          shape: 'alt',
          label: 'Blocked by guardrail (unhappy)',
          description: 'A guardrail intervened on the prompt or the completion.',
          group: 'Bedrock',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'GUARDRAIL_INTERVENED',
              style: 'async',
            },
          ],
          response: { code: 'guardrail', label: 'Blocked by guardrail' },
          defaultChecked: false,
        },
      ]
    case 'aws:knowledgebase':
      return [
        {
          id: 'kb-empty',
          shape: 'alt',
          label: 'No relevant passages (unhappy)',
          description:
            'Retrieval returned nothing above the score threshold — answer from the model alone, or say so.',
          group: 'Knowledge Base',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'retrievalResults: []',
              style: 'async',
            },
            {
              kind: 'message',
              from: 'source',
              to: 'source',
              label: 'Answer without context, or decline',
              style: 'sync',
            },
          ],
          response: { code: 'empty', label: 'No passages above threshold' },
          defaultChecked: true,
        },
        {
          id: 'kb-stale',
          shape: 'opt',
          label: 'ingestion lagging (unhappy)',
          description:
            'The source changed but the index has not caught up, so retrieval returns stale passages.',
          group: 'Knowledge Base',
          steps: [
            {
              kind: 'note',
              over: ['source', 'target'],
              text: 'last ingestion job still running',
            },
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'Stale passages returned',
              style: 'async',
            },
          ],
          response: { code: 'stale', label: 'Index behind the source' },
          defaultChecked: false,
        },
        {
          id: 'kb-throttle',
          shape: 'alt',
          label: 'ThrottlingException (unhappy)',
          description: 'Retrieve calls exceeded the account limit.',
          group: 'Knowledge Base',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ThrottlingException',
              style: 'async',
            },
          ],
          response: { code: '429', label: 'ThrottlingException' },
          defaultChecked: false,
        },
      ]
    case 'aws:opensearch':
      return [
        {
          id: 'aoss-429',
          shape: 'alt',
          label: '429 TooManyRequests (unhappy)',
          description: 'Search or indexing rejected — the queue for that shard is full.',
          group: 'OpenSearch',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'es_rejected_execution_exception',
              style: 'async',
            },
          ],
          response: { code: '429', label: 'Rejected execution' },
          defaultChecked: true,
        },
        {
          id: 'aoss-index-missing',
          shape: 'alt',
          label: '404 IndexNotFound (unhappy)',
          description: 'The index or vector collection does not exist yet.',
          group: 'OpenSearch',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'index_not_found_exception',
              style: 'async',
            },
          ],
          response: { code: '404', label: 'IndexNotFound' },
          defaultChecked: true,
        },
        {
          id: 'aoss-dimension',
          shape: 'alt',
          label: 'Vector dimension mismatch (unhappy)',
          description:
            'The embedding length does not match the index mapping — usually a changed embedding model.',
          group: 'OpenSearch',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'mapper_parsing_exception: wrong dimension',
              style: 'async',
            },
          ],
          response: { code: '400', label: 'Vector dimension mismatch' },
          defaultChecked: true,
        },
      ]
    case 'aws:sagemaker':
      return [
        {
          id: 'sm-throttle',
          shape: 'alt',
          label: '429 ThrottlingException (unhappy)',
          description: 'The endpoint is at capacity.',
          group: 'SageMaker',
          steps: [
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ThrottlingException',
              style: 'async',
            },
          ],
          response: { code: '429', label: 'ThrottlingException' },
          defaultChecked: true,
        },
        {
          id: 'sm-cold',
          shape: 'opt',
          label: 'cold start (unhappy)',
          description: 'A serverless endpoint had scaled to zero and must warm up first.',
          group: 'SageMaker',
          steps: [
            {
              kind: 'note',
              over: ['source', 'target'],
              text: 'first request after scale-to-zero',
            },
            {
              kind: 'message',
              from: 'target',
              to: 'source',
              label: 'ModelNotReadyException',
              style: 'async',
            },
          ],
          response: { code: 'cold-start', label: 'ModelNotReadyException' },
          defaultChecked: false,
        },
      ]
    case 'aws:s3':
      return [
        {
          id: 's3-403',
          shape: 'alt',
          label: '403 AccessDenied',
          description: 'The caller lacks permission on the bucket or key.',
          group: 'S3',
          steps: [
            { kind: 'message', from: 'target', to: 'source', label: 'AccessDenied', style: 'async' },
          ],
          response: { code: '403', label: 'AccessDenied' },
          defaultChecked: true,
        },
        {
          id: 's3-404',
          shape: 'alt',
          label: '404 NoSuchKey',
          description: 'The object does not exist.',
          group: 'S3',
          steps: [
            { kind: 'message', from: 'target', to: 'source', label: 'NoSuchKey', style: 'async' },
          ],
          response: { code: '404', label: 'NoSuchKey' },
          defaultChecked: true,
        },
        {
          id: 's3-503',
          shape: 'alt',
          label: '503 SlowDown',
          description: 'Request rate exceeded what the prefix can absorb.',
          group: 'S3',
          steps: [
            { kind: 'message', from: 'target', to: 'source', label: 'SlowDown', style: 'async' },
          ],
          response: { code: '503', label: 'SlowDown' },
          defaultChecked: false,
        },
      ]
    default:
      return []
  }
}

const HTTP_RULES: Record<HttpMethod, UnhappySuggestion[]> = {
  GET: [
    httpBranch('404', 'Not Found', 'The resource does not exist.', '404 Not Found'),
    httpBranch('401', 'Unauthorized', 'Missing or invalid credentials.', '401 Unauthorized'),
    httpBranch('403', 'Forbidden', 'Authenticated but not permitted.', '403 Forbidden', false),
    httpBranch('429', 'Too Many Requests', 'Rate limited.', '429 Too Many Requests'),
    httpBranch('503', 'Service Unavailable', 'Downstream overloaded.', '503 Service Unavailable'),
  ],
  POST: [
    httpBranch('400', 'Bad Request', 'Malformed or invalid input.', '400 Bad Request'),
    httpBranch('401', 'Unauthorized', 'Missing or invalid credentials.', '401 Unauthorized', false),
    httpBranch('403', 'Forbidden', 'Authenticated but not permitted.', '403 Forbidden', false),
    httpBranch(
      '409',
      'Conflict',
      'Uniqueness violation, or a retry without an idempotency key.',
      '409 Conflict',
    ),
    httpBranch('422', 'Unprocessable Entity', 'Semantically invalid payload.', '422 Unprocessable Entity', false),
    httpBranch('429', 'Too Many Requests', 'Rate limited.', '429 Too Many Requests'),
    httpBranch('502', 'Bad Gateway', 'Upstream returned an invalid response.', '502 Bad Gateway', false),
    httpBranch('503', 'Service Unavailable', 'Downstream overloaded.', '503 Service Unavailable'),
    httpBranch('504', 'Gateway Timeout', 'Downstream took too long.', '504 Gateway Timeout', false),
  ],
  PUT: [
    httpBranch('400', 'Bad Request', 'Malformed or invalid input.', '400 Bad Request'),
    httpBranch('404', 'Not Found', 'The resource does not exist.', '404 Not Found'),
    httpBranch('409', 'Conflict', 'Stale update — the resource changed underneath.', '409 Conflict'),
    httpBranch('422', 'Unprocessable Entity', 'Semantically invalid payload.', '422 Unprocessable Entity', false),
    httpBranch('429', 'Too Many Requests', 'Rate limited.', '429 Too Many Requests', false),
    httpBranch('500', 'Internal Server Error', 'Unhandled failure.', '500 Internal Server Error'),
  ],
  PATCH: [
    httpBranch('400', 'Bad Request', 'Malformed or invalid input.', '400 Bad Request'),
    httpBranch('404', 'Not Found', 'The resource does not exist.', '404 Not Found'),
    httpBranch('409', 'Conflict', 'Stale update — the resource changed underneath.', '409 Conflict'),
    httpBranch('422', 'Unprocessable Entity', 'Semantically invalid payload.', '422 Unprocessable Entity'),
    httpBranch('429', 'Too Many Requests', 'Rate limited.', '429 Too Many Requests', false),
    httpBranch('500', 'Internal Server Error', 'Unhandled failure.', '500 Internal Server Error', false),
  ],
  DELETE: [
    httpBranch('404', 'Not Found', 'Already gone, or never existed.', '404 Not Found'),
    httpBranch('409', 'Conflict', 'A dependent resource still references this one.', '409 Conflict'),
    httpBranch('429', 'Too Many Requests', 'Rate limited.', '429 Too Many Requests', false),
    httpBranch('500', 'Internal Server Error', 'Unhandled failure.', '500 Internal Server Error', false),
  ],
}

/** Kinds that sit between a producer and a consumer rather than terminating a call. */
const BROKER_KINDS = new Set<ParticipantKind>([
  'aws:sqs',
  'aws:sns',
  'aws:eventbridge',
  'aws:kinesis',
  'aws:msk',
  'aws:mq',
])

export interface SuggestionContext {
  transport: Transport
  method: HttpMethod
  targetKind?: ParticipantKind
  /** The queue/topic/bus/stream on either end of the message, if there is one. */
  brokerId?: string
  brokerKind?: ParticipantKind
  /** Who the broker delivers to. */
  consumerId?: string
  contract?: Contract
}

export function suggestionContext(doc: SequenceDoc, m: Message): SuggestionContext {
  const toKind = participantById(doc, m.to)?.kind
  const fromKind = participantById(doc, m.from)?.kind

  let brokerId: string | undefined
  let brokerKind: ParticipantKind | undefined
  if (toKind && BROKER_KINDS.has(toKind)) {
    brokerId = m.to
    brokerKind = toKind
  } else if (fromKind && BROKER_KINDS.has(fromKind)) {
    brokerId = m.from
    brokerKind = fromKind
  }

  let consumerId: string | undefined
  if (brokerId) {
    consumerId =
      brokerId === m.from
        ? m.to
        : doc.messages.find((x) => x.from === brokerId && x.to !== brokerId)?.to
    consumerId ??= brokerId === m.to ? m.from : m.to
  }

  return {
    transport: inferTransport(doc, m),
    method: inferMethod(doc, m),
    targetKind: toKind,
    brokerId,
    brokerKind,
    consumerId,
    contract: contractByName(doc, m.contractRef),
  }
}

/** Candidate failure branches for one message, most relevant first. */
export function suggestUnhappyPaths(
  doc: SequenceDoc,
  m: Message,
): { context: SuggestionContext; suggestions: UnhappySuggestion[] } {
  const context = suggestionContext(doc, m)
  const out: UnhappySuggestion[] = []

  // Broker rules fire from either side of the queue; everything else keys on
  // the call's target.
  out.push(...targetKindSuggestions(context.brokerKind))
  if (context.targetKind !== context.brokerKind) {
    out.push(...targetKindSuggestions(context.targetKind))
  }
  if (context.transport === 'http') out.push(...HTTP_RULES[context.method])
  out.push(...CROSS_CUTTING)

  // Drop what is already modelled — but judge the two shapes differently.
  // An `alt` branch is redundant once the contract declares that response code;
  // an `opt` block is structural, so it is only redundant once the block itself
  // exists in the diagram.
  const declared = new Set(context.contract?.responses.map((r) => r.code) ?? [])
  const existingBlocks = new Set(
    doc.blocks
      .filter((b) => b.type === 'opt')
      .map((b) => b.label.trim().toLowerCase()),
  )

  const seen = new Set<string>()
  const suggestions = out.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    if (s.shape === 'opt') return !existingBlocks.has(bareLabel(s.label))
    return !(s.response && declared.has(s.response.code))
  })

  return { context, suggestions }
}

/** A suggestion label without its `(unhappy)` marker, for comparison. */
function bareLabel(label: string): string {
  return label.replace(/\s*\((?:un)?happy\)\s*$/i, '').trim().toLowerCase()
}
