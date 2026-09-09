import { inferArchitecture } from '../dsl/architecture'
import { isAwsKind, type ParticipantKind, type SequenceDoc } from '../dsl/ast'

/**
 * A starter scaffold, not production IaC. Props are placeholders and the
 * wiring is a best-effort read of the inferred edges — expect to edit it.
 */

interface ConstructSpec {
  module: string
  namespace: string
  ctor: string
  /** Placeholder props, one per line. */
  props: string[]
}

const CONSTRUCTS: Partial<Record<ParticipantKind, ConstructSpec>> = {
  'aws:apigateway': {
    module: 'aws-cdk-lib/aws-apigateway',
    namespace: 'apigateway',
    ctor: 'RestApi',
    props: ["restApiName: '%LABEL%'", "deployOptions: { stageName: 'dev' }"],
  },
  'aws:lambda': {
    module: 'aws-cdk-lib/aws-lambda',
    namespace: 'lambda',
    ctor: 'Function',
    props: [
      'runtime: lambda.Runtime.NODEJS_22_X',
      "handler: 'index.handler'",
      "code: lambda.Code.fromAsset('src/%VAR%')",
      'timeout: cdk.Duration.seconds(30)',
    ],
  },
  'aws:sqs': {
    module: 'aws-cdk-lib/aws-sqs',
    namespace: 'sqs',
    ctor: 'Queue',
    props: ["queueName: '%LABEL%'", 'visibilityTimeout: cdk.Duration.seconds(60)'],
  },
  'aws:sns': {
    module: 'aws-cdk-lib/aws-sns',
    namespace: 'sns',
    ctor: 'Topic',
    props: ["topicName: '%LABEL%'", "displayName: '%LABEL%'"],
  },
  'aws:eventbridge': {
    module: 'aws-cdk-lib/aws-events',
    namespace: 'events',
    ctor: 'EventBus',
    props: ["eventBusName: '%LABEL%'"],
  },
  'aws:stepfunctions': {
    module: 'aws-cdk-lib/aws-stepfunctions',
    namespace: 'stepfunctions',
    ctor: 'StateMachine',
    props: [
      "stateMachineName: '%LABEL%'",
      "definitionBody: stepfunctions.DefinitionBody.fromChainable(new stepfunctions.Pass(this, '%PASCAL%Start'))",
    ],
  },
  'aws:dynamodb': {
    module: 'aws-cdk-lib/aws-dynamodb',
    namespace: 'dynamodb',
    ctor: 'Table',
    props: [
      "tableName: '%LABEL%'",
      "partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }",
      'billingMode: dynamodb.BillingMode.PAY_PER_REQUEST',
    ],
  },
  'aws:s3': {
    module: 'aws-cdk-lib/aws-s3',
    namespace: 's3',
    ctor: 'Bucket',
    props: ['encryption: s3.BucketEncryption.S3_MANAGED', 'enforceSSL: true'],
  },
  'aws:kinesis': {
    module: 'aws-cdk-lib/aws-kinesis',
    namespace: 'kinesis',
    ctor: 'Stream',
    props: ["streamName: '%LABEL%'", 'shardCount: 1'],
  },
  'aws:cognito': {
    module: 'aws-cdk-lib/aws-cognito',
    namespace: 'cognito',
    ctor: 'UserPool',
    props: ["userPoolName: '%LABEL%'", 'selfSignUpEnabled: false'],
  },
  'aws:appsync': {
    module: 'aws-cdk-lib/aws-appsync',
    namespace: 'appsync',
    ctor: 'GraphqlApi',
    props: [
      "name: '%LABEL%'",
      "definition: appsync.Definition.fromFile('schema.graphql')",
    ],
  },
  'aws:ecs': {
    module: 'aws-cdk-lib/aws-ecs',
    namespace: 'ecs',
    ctor: 'FargateService',
    props: ['cluster', 'taskDefinition', 'desiredCount: 1'],
  },
  'aws:eks': {
    module: 'aws-cdk-lib/aws-eks',
    namespace: 'eks',
    ctor: 'Cluster',
    props: ["clusterName: '%LABEL%'", 'version: eks.KubernetesVersion.V1_31'],
  },
  'aws:batch': {
    module: 'aws-cdk-lib/aws-batch',
    namespace: 'batch',
    ctor: 'JobQueue',
    props: ["jobQueueName: '%LABEL%'", 'priority: 1'],
  },
  'aws:apprunner': {
    module: 'aws-cdk-lib/aws-apprunner',
    namespace: 'apprunner',
    ctor: 'CfnService',
    props: ["serviceName: '%LABEL%'", 'sourceConfiguration: { /* image or repo */ }'],
  },
  'aws:cloudfront': {
    module: 'aws-cdk-lib/aws-cloudfront',
    namespace: 'cloudfront',
    ctor: 'Distribution',
    props: ["comment: '%LABEL%'", 'defaultBehavior: { origin: /* set an origin */ }'],
  },
  'aws:waf': {
    module: 'aws-cdk-lib/aws-wafv2',
    namespace: 'wafv2',
    ctor: 'CfnWebACL',
    props: [
      "name: '%LABEL%'",
      "scope: 'REGIONAL'",
      'defaultAction: { allow: {} }',
      "visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: '%PASCAL%', sampledRequestsEnabled: true }",
    ],
  },
  'aws:msk': {
    module: 'aws-cdk-lib/aws-msk',
    namespace: 'msk',
    ctor: 'CfnCluster',
    props: [
      "clusterName: '%LABEL%'",
      "kafkaVersion: '3.6.0'",
      'numberOfBrokerNodes: 2',
      'brokerNodeGroupInfo: { instanceType: \'kafka.m5.large\', clientSubnets: [] }',
    ],
  },
  'aws:mq': {
    module: 'aws-cdk-lib/aws-amazonmq',
    namespace: 'amazonmq',
    ctor: 'CfnBroker',
    props: [
      "brokerName: '%LABEL%'",
      "engineType: 'RABBITMQ'",
      "hostInstanceType: 'mq.t3.micro'",
      "deploymentMode: 'SINGLE_INSTANCE'",
      'autoMinorVersionUpgrade: true',
      "publiclyAccessible: false",
    ],
  },
  'aws:aurora': {
    module: 'aws-cdk-lib/aws-rds',
    namespace: 'rds',
    ctor: 'DatabaseCluster',
    props: [
      'engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_4 })',
      'vpc',
      'writer: rds.ClusterInstance.serverlessV2(\'writer\')',
    ],
  },
  'aws:elasticache': {
    module: 'aws-cdk-lib/aws-elasticache',
    namespace: 'elasticache',
    ctor: 'CfnServerlessCache',
    props: ["serverlessCacheName: '%LABEL%'", "engine: 'redis'"],
  },
  'aws:neptune': {
    module: 'aws-cdk-lib/aws-neptune',
    namespace: 'neptune',
    ctor: 'CfnDBCluster',
    props: ["dbClusterIdentifier: '%LABEL%'"],
  },
  'aws:redshift': {
    module: 'aws-cdk-lib/aws-redshiftserverless',
    namespace: 'redshiftserverless',
    ctor: 'CfnWorkgroup',
    props: ["workgroupName: '%LABEL%'", "namespaceName: '%LABEL%'"],
  },
  'aws:athena': {
    module: 'aws-cdk-lib/aws-athena',
    namespace: 'athena',
    ctor: 'CfnWorkGroup',
    props: ["name: '%LABEL%'"],
  },
  'aws:glue': {
    module: 'aws-cdk-lib/aws-glue',
    namespace: 'glue',
    ctor: 'CfnDatabase',
    props: ['catalogId: this.account', "databaseInput: { name: '%VAR%' }"],
  },
  'aws:bedrock': {
    module: 'aws-cdk-lib/aws-bedrock',
    namespace: 'bedrock',
    ctor: 'CfnGuardrail',
    props: [
      "name: '%LABEL%'",
      "blockedInputMessaging: 'Blocked.'",
      "blockedOutputsMessaging: 'Blocked.'",
      '// Model invocation itself is runtime, not infrastructure — grant',
      '// bedrock:InvokeModel to whatever calls it.',
    ],
  },
  'aws:bedrockagent': {
    module: 'aws-cdk-lib/aws-bedrock',
    namespace: 'bedrock',
    ctor: 'CfnAgent',
    props: [
      "agentName: '%LABEL%'",
      "foundationModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0'",
      "instruction: 'Describe what this agent is for.'",
    ],
  },
  'aws:knowledgebase': {
    module: 'aws-cdk-lib/aws-bedrock',
    namespace: 'bedrock',
    ctor: 'CfnKnowledgeBase',
    props: [
      "name: '%LABEL%'",
      'roleArn: /* a role that can read the data source and the vector store */',
      "knowledgeBaseConfiguration: { type: 'VECTOR', vectorKnowledgeBaseConfiguration: { embeddingModelArn: '' } }",
      'storageConfiguration: { type: \'OPENSEARCH_SERVERLESS\' }',
    ],
  },
  'aws:opensearch': {
    module: 'aws-cdk-lib/aws-opensearchserverless',
    namespace: 'opensearchserverless',
    ctor: 'CfnCollection',
    props: ["name: '%VAR%'", "type: 'VECTORSEARCH'"],
  },
  'aws:kendra': {
    module: 'aws-cdk-lib/aws-kendra',
    namespace: 'kendra',
    ctor: 'CfnIndex',
    props: ["name: '%LABEL%'", "edition: 'DEVELOPER_EDITION'", 'roleArn: /* index role */'],
  },
  'aws:sagemaker': {
    module: 'aws-cdk-lib/aws-sagemaker',
    namespace: 'sagemaker',
    ctor: 'CfnEndpoint',
    props: ["endpointName: '%LABEL%'", 'endpointConfigName: /* an endpoint config */'],
  },
  'aws:secretsmanager': {
    module: 'aws-cdk-lib/aws-secretsmanager',
    namespace: 'secretsmanager',
    ctor: 'Secret',
    props: ["secretName: '%LABEL%'"],
  },
  'aws:kms': {
    module: 'aws-cdk-lib/aws-kms',
    namespace: 'kms',
    ctor: 'Key',
    props: ["alias: '%VAR%'", 'enableKeyRotation: true'],
  },
  'aws:cloudwatch': {
    module: 'aws-cdk-lib/aws-logs',
    namespace: 'logs',
    ctor: 'LogGroup',
    props: ["logGroupName: '/seqflow/%VAR%'", 'retention: logs.RetentionDays.ONE_MONTH'],
  },
  'aws:rds': {
    module: 'aws-cdk-lib/aws-rds',
    namespace: 'rds',
    ctor: 'DatabaseInstance',
    props: [
      'engine: rds.DatabaseInstanceEngine.POSTGRES',
      'vpc',
      'instanceType: cdk.aws_ec2.InstanceType.of(cdk.aws_ec2.InstanceClass.T4G, cdk.aws_ec2.InstanceSize.MICRO)',
    ],
  },
}

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'props', 'scope', 'stack',
])

export function toCdk(doc: SequenceDoc, stackName = 'SeqFlowStack'): string {
  const graph = inferArchitecture(doc)
  const managed = doc.participants.filter((p) => isAwsKind(p.kind) && CONSTRUCTS[p.kind])
  const unmanaged = doc.participants.filter((p) => !managed.includes(p))

  const varNames = new Map<string, string>()
  const used = new Set<string>()
  for (const p of doc.participants) {
    let name = camel(p.id)
    if (RESERVED.has(name)) name = `${name}Resource`
    let candidate = name
    let n = 2
    while (used.has(candidate)) candidate = `${name}${n++}`
    used.add(candidate)
    varNames.set(p.id, candidate)
  }

  const namespaces = new Map<string, string>()
  for (const p of managed) {
    const spec = CONSTRUCTS[p.kind]!
    namespaces.set(spec.namespace, spec.module)
  }

  const wiring: string[] = []
  const extraImports = new Map<string, string>()
  const kindOf = (id: string) => doc.participants.find((p) => p.id === id)?.kind

  for (const e of graph.edges) {
    const from = kindOf(e.from)
    const to = kindOf(e.to)
    if (!from || !to) continue
    const a = varNames.get(e.from)!
    const b = varNames.get(e.to)!
    const line = wireEdge(from, to, a, b, extraImports)
    if (line) wiring.push(...line)
  }

  /* ------------------------------------------------------------------ emit */
  const out: string[] = []
  out.push('// Generated by SeqFlow from the inferred architecture.')
  out.push('//')
  out.push('// STARTER SCAFFOLD — not production-ready IaC. Props are placeholders,')
  out.push('// and the grant/event-source wiring below is inferred from the direction')
  out.push('// of each interaction. Review every line before deploying.')
  out.push('')
  out.push("import * as cdk from 'aws-cdk-lib'")
  out.push("import { Construct } from 'constructs'")
  for (const [ns, mod] of [...namespaces].sort()) {
    out.push(`import * as ${ns} from '${mod}'`)
  }
  for (const [ns, mod] of [...extraImports].sort()) {
    out.push(`import * as ${ns} from '${mod}'`)
  }
  out.push('')
  out.push(`export class ${pascal(stackName)} extends cdk.Stack {`)
  out.push('  constructor(scope: Construct, id: string, props?: cdk.StackProps) {')
  out.push('    super(scope, id, props)')
  out.push('')

  if (!managed.length) {
    out.push('    // No aws:* participants in this diagram yet — tag participants with')
    out.push('    // a kind such as `: aws:lambda` to generate constructs here.')
  }

  for (const p of managed) {
    const spec = CONSTRUCTS[p.kind]!
    const v = varNames.get(p.id)!
    const fill = (s: string) =>
      s
        .replace(/%LABEL%/g, p.label.replace(/'/g, "\\'"))
        .replace(/%VAR%/g, v)
        .replace(/%PASCAL%/g, constructId(p.id))

    out.push(`    // ${p.label} (${p.kind})`)
    out.push(
      `    const ${v} = new ${spec.namespace}.${spec.ctor}(this, '${constructId(p.id)}', {`,
    )
    for (const prop of spec.props) out.push(`      ${fill(prop)},`)
    out.push('    })')
    out.push('')
  }

  if (unmanaged.length) {
    out.push('    // Not managed by this stack:')
    for (const p of unmanaged) out.push(`    //   ${p.label} (${p.kind})`)
    out.push('')
  }

  if (wiring.length) {
    out.push('    /* ---------------------------------------------- inferred wiring */')
    out.push(...wiring.map((l) => `    ${l}`))
    out.push('')
  }

  out.push('  }')
  out.push('}')
  return out.join('\n') + '\n'
}

function wireEdge(
  from: ParticipantKind,
  to: ParticipantKind,
  a: string,
  b: string,
  imports: Map<string, string>,
): string[] | undefined {
  const eventSources = () => imports.set('eventsources', 'aws-cdk-lib/aws-lambda-event-sources')
  const subscriptions = () => imports.set('subscriptions', 'aws-cdk-lib/aws-sns-subscriptions')
  const targets = () => imports.set('targets', 'aws-cdk-lib/aws-events-targets')
  const s3n = () => imports.set('s3n', 'aws-cdk-lib/aws-s3-notifications')

  // Something invoking a Lambda.
  if (to === 'aws:lambda') {
    switch (from) {
      case 'aws:apigateway':
        return [
          `${a}.root.addResource('${b}').addMethod('ANY', new apigateway.LambdaIntegration(${b}))`,
        ]
      case 'aws:sqs':
        eventSources()
        return [`${b}.addEventSource(new eventsources.SqsEventSource(${a}))`]
      case 'aws:kinesis':
        eventSources()
        return [
          `${b}.addEventSource(new eventsources.KinesisEventSource(${a}, {`,
          `  startingPosition: lambda.StartingPosition.LATEST,`,
          `}))`,
        ]
      case 'aws:sns':
        subscriptions()
        return [`${a}.addSubscription(new subscriptions.LambdaSubscription(${b}))`]
      case 'aws:s3':
        s3n()
        return [
          `${a}.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(${b}))`,
        ]
      case 'aws:eventbridge':
        targets()
        return [
          `new events.Rule(this, '${pascal(a)}To${pascal(b)}', {`,
          `  eventBus: ${a},`,
          `  eventPattern: { source: ['seqflow'] },`,
          `  targets: [new targets.LambdaFunction(${b})],`,
          `})`,
        ]
      case 'aws:stepfunctions':
        return [`// ${a} invokes ${b} — add a tasks.LambdaInvoke step to the state machine`]
    }
  }

  // A compute participant reaching a data or messaging service.
  const caller = from === 'aws:lambda' || from === 'aws:ecs' || from === 'aws:stepfunctions'
  if (caller) {
    switch (to) {
      case 'aws:dynamodb':
        return [`${b}.grantReadWriteData(${a})`]
      case 'aws:s3':
        return [`${b}.grantReadWrite(${a})`]
      case 'aws:sqs':
        return [`${b}.grantSendMessages(${a})`]
      case 'aws:sns':
        return [`${b}.grantPublish(${a})`]
      case 'aws:kinesis':
        return [`${b}.grantWrite(${a})`]
      case 'aws:eventbridge':
        return [`${b}.grantPutEventsTo(${a})`]
      case 'aws:rds':
        return [`${b}.grantConnect(${a})`]
    }
  }

  // Anything invoking a model, a search index or a secret is a grant, not a
  // construct relationship.
  if (caller) {
    switch (to) {
      case 'aws:bedrock':
      case 'aws:bedrockagent':
        return [
          `${a}.addToRolePolicy(new cdk.aws_iam.PolicyStatement({`,
          `  actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],`,
          `  resources: ['*'],`,
          `}))`,
        ]
      case 'aws:knowledgebase':
        return [
          `${a}.addToRolePolicy(new cdk.aws_iam.PolicyStatement({`,
          `  actions: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],`,
          `  resources: [${b}.attrKnowledgeBaseArn],`,
          `}))`,
        ]
      case 'aws:opensearch':
        return [
          `${a}.addToRolePolicy(new cdk.aws_iam.PolicyStatement({`,
          `  actions: ['aoss:APIAccessAll'],`,
          `  resources: [${b}.attrArn],`,
          `}))`,
        ]
      case 'aws:secretsmanager':
        return [`${b}.grantRead(${a})`]
      case 'aws:kms':
        return [`${b}.grantEncryptDecrypt(${a})`]
      case 'aws:sagemaker':
        return [`// ${a} invokes the ${b} endpoint — grant sagemaker:InvokeEndpoint`]
      case 'aws:athena':
      case 'aws:redshift':
      case 'aws:glue':
      case 'aws:kendra':
      case 'aws:textract':
      case 'aws:comprehend':
      case 'aws:rekognition':
        return [`// ${a} calls ${b} — add the matching IAM grant`]
    }
  }

  if (from === 'aws:knowledgebase' && to === 'aws:opensearch') {
    return [`// ${a} stores its vectors in ${b}`]
  }
  if (from === 'aws:cloudfront' || to === 'aws:cloudfront') {
    return [`// ${a} → ${b}: set as a CloudFront origin or behaviour`]
  }

  if (from === 'aws:sns' && to === 'aws:sqs') {
    subscriptions()
    return [`${a}.addSubscription(new subscriptions.SqsSubscription(${b}))`]
  }
  if (from === 'aws:eventbridge' && to === 'aws:sqs') {
    targets()
    return [
      `new events.Rule(this, '${pascal(a)}To${pascal(b)}', {`,
      `  eventBus: ${a},`,
      `  targets: [new targets.SqsQueue(${b})],`,
      `})`,
    ]
  }
  if (from === 'aws:cognito' && to === 'aws:apigateway') {
    return [
      `const ${a}Authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, '${pascal(a)}Authorizer', {`,
      `  cognitoUserPools: [${a}],`,
      `})`,
      `// attach with { authorizer: ${a}Authorizer } on the protected methods of ${b}`,
    ]
  }
  if (to === 'aws:apigateway' || from === 'aws:apigateway') return undefined

  return undefined
}

/** `DB` -> `db`, `OrderSvc` -> `orderSvc`, `payment-queue` -> `paymentQueue`. */
function camel(s: string): string {
  const parts = s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'resource'

  const head = /^[A-Z0-9]+$/.test(parts[0])
    ? parts[0].toLowerCase()
    : parts[0].charAt(0).toLowerCase() + parts[0].slice(1)

  const name =
    head +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  return /^[0-9]/.test(name) ? `r${name}` : name
}

function pascal(s: string): string {
  const c = camel(s)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

/**
 * CDK logical ids are stable identity, so keep the participant's own id where
 * it is already a legal one rather than re-casing it.
 */
function constructId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9]/g, '')
  if (!cleaned || /^[0-9]/.test(cleaned)) return pascal(id)
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}
