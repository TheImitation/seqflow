export interface Pattern {
  id: string
  name: string
  blurb: string
  /** What syntax this snippet is meant to teach. */
  teaches: string
  dsl: string
}

const syncRest = `sequenceDiagram
  participant Client : client
  participant APIGW as API Gateway : aws:apigateway
  participant Fn as GetOrderFn : aws:lambda
  participant DB as OrdersTable : aws:dynamodb

  Client->>APIGW: GET /orders/{id} @GetOrder
  APIGW->>Fn: Invoke(event)
  Fn->>DB: GetItem(orderId)
  alt 200 OK
    DB-->>Fn: Item
    Fn-->>APIGW: 200 order
    APIGW-->>Client: 200 order
  else 404 NotFound (unhappy)
    DB-->>Fn: null
    Fn-->>APIGW: 404
    APIGW-->>Client: 404 Not Found
  else 429 TooManyRequests (unhappy)
    DB-->>Fn: ProvisionedThroughputExceededException
    Fn-->>APIGW: 429
    APIGW-->>Client: 429 Too Many Requests
  end

model Order {
  orderId: string required
  status: enum[pending,paid,shipped] required
  total: number required = 42.5
}

model ApiError {
  code: string required
  message: string required
}

contract GetOrder {
  transport: http
  method: GET
  path: /orders/{id}
  headers:
    Accept: application/json required
    X-Correlation-Id: string required
  responses:
    200 OK -> Order
    404 NotFound (unhappy) -> ApiError
    429 TooManyRequests (unhappy) -> ApiError
    503 ServiceUnavailable (unhappy) -> ApiError
}
`

const fanOut = `sequenceDiagram
  participant Client : client
  participant APIGW as API Gateway : aws:apigateway
  participant OrderSvc as Order Service
  participant Topic as OrderEvents : aws:sns
  participant Queue as PaymentQueue : aws:sqs
  participant PaymentSvc as Payment Service
  participant Gateway as Card Gateway : external
  participant DB as OrdersTable : aws:dynamodb
  participant DLQ as PaymentDLQ : aws:sqs

  Client->>APIGW: POST /orders
  APIGW->>OrderSvc: CreateOrder(payload)
  OrderSvc->>DB: PutItem(order)
  OrderSvc->>Topic: Publish(OrderCreated) @PublishOrderCreated
  Topic-->>Queue: Fan-out
  Queue-->>PaymentSvc: OrderCreated
  PaymentSvc->>Gateway: ChargeCard @ChargeCardRequest
  alt 200 OK
    Gateway-->>PaymentSvc: PaymentConfirmed
    PaymentSvc-->>OrderSvc: PaymentConfirmed
  else 402 PaymentRequired (unhappy)
    Gateway-->>PaymentSvc: PaymentDeclined
    PaymentSvc-->>OrderSvc: PaymentDeclined
  else 503 ServiceUnavailable (unhappy)
    Gateway-->>PaymentSvc: ServiceError
  end
  opt processing failure (unhappy)
    Queue->>PaymentSvc: Deliver (attempt 1..N)
    Note over Queue,PaymentSvc: after maxReceiveCount exceeded
    Queue->>DLQ: Move to dead-letter queue
  end

model PaymentRequest "The charge request body" {
  cardToken: string required
  amount: number required = 42.5
  currency: enum[GBP,USD,EUR] required
  orderId: string required
}

model PaymentConfirmation {
  paymentId: string required
  status: enum[settled,pending] required
}

model PaymentError {
  code: string required
  message: string required
  retryable: boolean required = false
}

model OrderCreated {
  orderId: string required
  customerId: string required
  total: number required
  items: array required {
    sku: string required
    qty: number required = 1
  }
}

contract ChargeCardRequest {
  transport: http
  method: POST
  path: /payments
  model: PaymentRequest
  headers:
    Content-Type: application/json required
    Idempotency-Key: string required
    X-Correlation-Id: string required
  responses:
    200 OK -> PaymentConfirmation
    402 PaymentRequired (unhappy) -> PaymentError
    409 Conflict (unhappy) -> PaymentError
    503 ServiceUnavailable (unhappy)
}

contract PublishOrderCreated {
  transport: sns
  model: OrderCreated
  headers:
    x-correlation-id: string required
  responses:
    delivered Subscriber acknowledged
    retry Delivery retried per policy (unhappy)
    DLQ Moved to dead-letter queue (unhappy)
}
`

const eventDriven = `sequenceDiagram
  participant OrderSvc as Order Service
  participant Bus as DomainEventBus : aws:eventbridge
  participant Ship as ShippingFn : aws:lambda
  participant Analytics as AnalyticsFn : aws:lambda
  participant Archive as EventArchive : aws:s3
  participant DLQ as BusDLQ : aws:sqs

  OrderSvc->>Bus: PutEvents(OrderPlaced) @OrderPlacedEvent
  Bus-->>Ship: rule ShipOnOrderPlaced
  Bus-->>Analytics: rule TrackOnOrderPlaced
  Ship->>Archive: PutObject(shipment-label)
  opt target invocation failure (unhappy)
    Bus->>Ship: Retry with exponential backoff
    Note over Bus,Ship: 185 attempts / 24h max, then give up
    Bus->>DLQ: Send failed invocation
  end

model OrderPlaced {
  orderId: string required
  placedAt: date required
  channel: enum[web,mobile,partner] required
}

contract OrderPlacedEvent {
  transport: eventbridge
  model: OrderPlaced
  headers:
    detail-type: OrderPlaced required
    source: com.acme.orders required
  responses:
    delivered Rule matched and target invoked
    retry Target invocation retried (unhappy)
    DLQ Sent to the rule dead-letter queue (unhappy)
}
`

const saga = `sequenceDiagram
  participant API as API Gateway : aws:apigateway
  participant SM as CheckoutSaga : aws:stepfunctions
  participant Reserve as ReserveStockFn : aws:lambda
  participant Charge as ChargeCardFn : aws:lambda
  participant Ship as CreateShipmentFn : aws:lambda
  participant Release as ReleaseStockFn : aws:lambda
  participant DB as SagaState : aws:dynamodb

  API->>SM: StartExecution(checkout)
  SM->>Reserve: Task ReserveStock
  Reserve-->>SM: reserved
  SM->>DB: PutItem(saga step)
  SM->>Charge: Task ChargeCard
  alt States.Succeeded
    Charge-->>SM: charged
    SM->>Ship: Task CreateShipment
    Ship-->>SM: shipmentId
    SM-->>API: execution Succeeded
  else States.TaskFailed (unhappy)
    Charge-->>SM: PaymentDeclined
    SM->>SM: Retry 3x with backoff
    SM->>Release: Compensate ReleaseStock
    Release-->>SM: released
    SM-->>API: execution Failed
  end
`

const streaming = `sequenceDiagram
  participant Producer as Clickstream App
  participant Stream as EventStream : aws:kinesis
  participant Consumer as AggregatorFn : aws:lambda
  participant Table as MetricsTable : aws:dynamodb
  participant DLQ as StreamDLQ : aws:sqs

  Producer->>Stream: PutRecords(batch) @PutClickBatch
  Stream-->>Consumer: Shard iterator batch
  loop per record
    Consumer->>Table: UpdateItem(counter)
  end
  opt batch processing failure (unhappy)
    Stream->>Consumer: Re-deliver batch (bisect on error)
    Note over Stream,Consumer: after maximumRetryAttempts
    Consumer->>DLQ: Report failed batch
  end

model ClickEvent {
  sessionId: string required
  url: string required
  ts: date required
}

contract PutClickBatch {
  transport: kinesis
  model: ClickEvent
  headers:
    partition-key: sessionId required
  responses:
    delivered Records accepted
    throttle ProvisionedThroughputExceededException (unhappy)
    DLQ Failed batch reported (unhappy)
}
`

const dataLake = `sequenceDiagram
  participant Uploader as Partner Feed : external
  participant Bucket as RawLanding : aws:s3
  participant Fn as IngestFn : aws:lambda
  participant Curated as CuratedBucket : aws:s3
  participant Table as CatalogTable : aws:dynamodb
  participant DLQ as IngestDLQ : aws:sqs

  Uploader->>Bucket: PutObject(feed.csv)
  Bucket-->>Fn: s3:ObjectCreated:Put
  Fn->>Bucket: GetObject(feed.csv)
  Fn->>Curated: PutObject(parquet partition)
  Fn->>Table: PutItem(catalog entry)
  opt invocation failure (unhappy)
    Note over Bucket,Fn: async invoke retries twice
    Fn->>DLQ: Send failed event
  end
`

const auth = `sequenceDiagram
  participant User : client
  participant Pool as UserPool : aws:cognito
  participant APIGW as API Gateway : aws:apigateway
  participant Fn as ProtectedFn : aws:lambda
  participant DB as ProfileTable : aws:dynamodb

  User->>Pool: InitiateAuth(username, password)
  alt 200 OK
    Pool-->>User: id_token + access_token
    User->>APIGW: GET /me @GetMe
    APIGW->>Pool: Validate JWT (authorizer)
    Pool-->>APIGW: claims
    APIGW->>Fn: Invoke(event with claims)
    Fn->>DB: GetItem(sub)
    DB-->>Fn: profile
    Fn-->>User: 200 profile
  else 401 Unauthorized (unhappy)
    Pool-->>User: NotAuthorizedException
  else 403 Forbidden (unhappy)
    APIGW-->>User: 403 token expired or scope missing
  end

model Profile {
  sub: string required
  email: string required
  roles: array required {
    name: string required
  }
}

contract GetMe {
  transport: http
  method: GET
  path: /me
  headers:
    Authorization: Bearer <id_token> required
    traceparent: string required
  responses:
    200 OK -> Profile
    401 Unauthorized (unhappy)
    403 Forbidden (unhappy)
    429 TooManyRequests (unhappy)
}
`

const graphql = `sequenceDiagram
  participant App as Mobile App : client
  participant Api as OrdersGraphApi : aws:appsync
  participant Table as OrdersTable : aws:dynamodb
  participant Fn as SearchResolverFn : aws:lambda

  App->>Api: query getOrder(id) @GetOrderQuery
  Api->>Table: DynamoDB resolver GetItem
  alt 200 OK
    Table-->>Api: item
    Api-->>App: data.getOrder
  else 404 NotFound (unhappy)
    Table-->>Api: null
    Api-->>App: errors[NOT_FOUND]
  end
  App->>Api: query searchOrders(filter)
  Api->>Fn: Lambda resolver
  Fn->>Table: Query(index byCustomer)
  Fn-->>Api: page
  Api-->>App: data.searchOrders

model OrderNode {
  orderId: string required
  status: enum[pending,paid,shipped] required
}

contract GetOrderQuery {
  transport: http
  method: POST
  path: /graphql
  headers:
    Content-Type: application/json required
    x-api-key: string required
  responses:
    200 OK -> OrderNode
    401 Unauthorized (unhappy)
    404 NotFound (unhappy)
}
`

const rag = `sequenceDiagram
  participant App as Chat UI : client
  participant APIGW as API Gateway : aws:apigateway
  participant Orchestrator as AnswerFn : aws:lambda
  participant KB as ProductKnowledgeBase : aws:knowledgebase
  participant Vectors as DocVectorIndex : aws:opensearch
  participant Model as Claude on Bedrock : aws:bedrock
  participant Traces as AnswerTraces : aws:cloudwatch

  App->>APIGW: POST /answer @AskQuestion
  APIGW->>Orchestrator: Invoke(question)
  Orchestrator->>KB: Retrieve(question, topK=8)
  KB->>Vectors: kNN search over embeddings
  alt passages found
    Vectors-->>KB: 8 passages
    KB-->>Orchestrator: retrievalResults
    Orchestrator->>Model: InvokeModel(question + passages) @Generate
    Model-->>Orchestrator: grounded answer
    Orchestrator->>Traces: PutLogEvents(citations)
    Orchestrator-->>App: 200 answer with citations
  else no relevant passages (unhappy)
    Vectors-->>KB: retrievalResults: []
    KB-->>Orchestrator: nothing above threshold
    Orchestrator-->>App: 200 I do not know
  else 429 ThrottlingException (unhappy)
    Model-->>Orchestrator: ThrottlingException
    Orchestrator->>Orchestrator: Retry with exponential backoff
    Orchestrator-->>App: 503 try again shortly
  end

model Question {
  question: string required
  sessionId: string required
  topK: number = 8
}

model GroundedAnswer {
  answer: string required
  citations: array required {
    documentId: string required
    excerpt: string required
    score: number required
  }
}

model ApiError {
  code: string required
  message: string required
}

contract AskQuestion {
  transport: http
  method: POST
  path: /answer
  model: Question
  headers:
    Content-Type: application/json required
    Authorization: Bearer <id_token> required
    X-Correlation-Id: string required
  responses:
    200 OK -> GroundedAnswer
    400 ValidationException (unhappy) -> ApiError
    429 TooManyRequests (unhappy) -> ApiError
    503 ServiceUnavailable (unhappy) -> ApiError
}

contract Generate {
  transport: http
  method: POST
  path: /model/invoke
  headers:
    Content-Type: application/json required
  responses:
    200 OK
    400 ValidationException (unhappy) -> ApiError
    429 ThrottlingException (unhappy) -> ApiError
    timeout ModelTimeoutException (unhappy)
}
`

const documentPipeline = `sequenceDiagram
  participant Uploader as Partner Portal : client
  participant Bucket as RawDocuments : aws:s3
  participant Extract as Textract : aws:textract
  participant Enrich as EnrichFn : aws:lambda
  participant Classify as Comprehend : aws:comprehend
  participant Vectors as DocVectorIndex : aws:opensearch
  participant Catalog as DocumentCatalog : aws:dynamodb
  participant DLQ as IngestDLQ : aws:sqs

  Uploader->>Bucket: PutObject(contract.pdf) @UploadDocument
  Bucket-->>Enrich: s3:ObjectCreated:Put
  Enrich->>Extract: StartDocumentAnalysis(contract.pdf)
  Extract-->>Enrich: blocks + tables
  Enrich->>Classify: DetectEntities(text)
  Classify-->>Enrich: entities
  loop per chunk
    Enrich->>Vectors: IndexDocument(chunk + embedding)
  end
  Enrich->>Catalog: PutItem(document summary)
  opt extraction failure (unhappy)
    Extract-->>Enrich: InvalidS3ObjectException
    Note over Enrich,DLQ: after 2 async invoke retries
    Enrich->>DLQ: Send failed document
  end

model DocumentUpload "The uploaded file and where it came from" {
  file: file required
  filename: string required
  contentType: string required = "application/pdf"
  partnerId: string required
}

contract UploadDocument {
  transport: http
  method: PUT
  path: /documents/{id}
  model: DocumentUpload
  body: multipart
  headers:
    Content-Type: multipart/form-data required
    X-Correlation-Id: string required
  responses:
    201 Created
    413 PayloadTooLarge (unhappy)
    415 UnsupportedMediaType (unhappy)
    503 SlowDown (unhappy)
}
`

export const PATTERNS: Pattern[] = [
  {
    id: 'sync-rest',
    name: 'Sync REST',
    blurb: 'API Gateway to Lambda to DynamoDB, with the 404 and throttle paths modelled.',
    teaches: 'participant kinds, alt branches, an HTTP contract',
    dsl: syncRest,
  },
  {
    id: 'async-fan-out',
    name: 'Async fan-out',
    blurb: 'SNS topic fanning out to an SQS subscriber, with a dead-letter path.',
    teaches: 'async arrows, opt blocks, DLQ routing, two transports',
    dsl: fanOut,
  },
  {
    id: 'event-driven',
    name: 'Event-driven',
    blurb: 'One EventBridge rule routing a domain event to two decoupled consumers.',
    teaches: 'fan-out without coupling, retry and archive behaviour',
    dsl: eventDriven,
  },
  {
    id: 'saga',
    name: 'Orchestration / saga',
    blurb: 'Step Functions coordinating three Lambdas with a compensating step.',
    teaches: 'self-messages, catch and retry, compensation',
    dsl: saga,
  },
  {
    id: 'streaming',
    name: 'Streaming ingestion',
    blurb: 'Kinesis stream feeding a Lambda consumer that aggregates into DynamoDB.',
    teaches: 'loop blocks, batch retry semantics',
    dsl: streaming,
  },
  {
    id: 'data-lake',
    name: 'Data lake ingestion',
    blurb: 'An S3 event notification triggering a Lambda that writes a curated partition.',
    teaches: 'event notifications, async invoke retries',
    dsl: dataLake,
  },
  {
    id: 'auth',
    name: 'Auth flow',
    blurb: 'Cognito issuing tokens, an API Gateway authorizer, then a protected Lambda.',
    teaches: 'Authorization headers, 401 vs 403',
    dsl: auth,
  },
  {
    id: 'rag',
    name: 'RAG / knowledge retrieval',
    blurb:
      'A question routed through a Bedrock Knowledge Base and its vector index, then answered by a model.',
    teaches: 'AI participants, retrieval-miss and throttling branches',
    dsl: rag,
  },
  {
    id: 'document-pipeline',
    name: 'Document understanding',
    blurb:
      'An uploaded PDF through Textract and Comprehend, chunked into a vector index.',
    teaches: 'a multipart file-upload contract, loop blocks, DLQ on failure',
    dsl: documentPipeline,
  },
  {
    id: 'graphql',
    name: 'GraphQL',
    blurb: 'AppSync resolving one query straight from DynamoDB and one via Lambda.',
    teaches: 'two resolver styles on one API',
    dsl: graphql,
  },
]

export const DEFAULT_PATTERN_ID = 'async-fan-out'

export function defaultDsl(): string {
  return (
    PATTERNS.find((p) => p.id === DEFAULT_PATTERN_ID) ?? PATTERNS[0]
  ).dsl
}
