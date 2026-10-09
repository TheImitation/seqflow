import type { JSX } from 'react'
import type { ParticipantKind } from '../../dsl/ast'

/**
 * Simplified glyphs drawn for this app — deliberately not the official AWS
 * Architecture Icons, so the project carries no third-party asset licence.
 * All are 24x24, stroke-based, and inherit `currentColor`.
 */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const ICONS: Record<ParticipantKind, JSX.Element> = {
  /* ------------------------------------------------------------ plain kinds */
  service: (
    <g {...S}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <circle cx="6.6" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
      <path d="M8 13h5M8 16h8" />
    </g>
  ),
  client: (
    <g {...S}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
      <path d="M7.5 8.5l-2 2 2 2M16.5 8.5l2 2-2 2" />
    </g>
  ),
  database: (
    <g {...S}>
      <ellipse cx="12" cy="6.4" rx="7.5" ry="2.9" />
      <path d="M4.5 6.4v11.2c0 1.6 3.36 2.9 7.5 2.9s7.5-1.3 7.5-2.9V6.4" />
      <path d="M4.5 12c0 1.6 3.36 2.9 7.5 2.9s7.5-1.3 7.5-2.9" />
    </g>
  ),
  external: (
    <g {...S}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4" />
      <path d="M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5.1-3.3-8.2S9.8 6.1 12 3.8z" />
    </g>
  ),

  /* -------------------------------------------------------------- aws kinds */
  'aws:apigateway': (
    <g {...S}>
      <path d="M6 4.2v15.6M18 4.2v15.6" />
      <path d="M9.4 12h5.2" />
      <path d="M12.6 9.8l2.2 2.2-2.2 2.2" />
      <path d="M3.4 8.4L6 12l-2.6 3.6M20.6 8.4L18 12l2.6 3.6" />
    </g>
  ),
  'aws:lambda': (
    <g {...S}>
      <rect x="3.2" y="3.6" width="17.6" height="16.8" rx="3" />
      <path d="M8 17.4l3.5-9.2h1.6l3.4 9.2" />
      <path d="M8 8.2h2.1" />
    </g>
  ),
  'aws:sqs': (
    <g {...S}>
      <rect x="2.6" y="7.4" width="7" height="9.2" rx="1.4" />
      <rect x="11" y="7.4" width="7" height="9.2" rx="1.4" />
      <path d="M20 8.6v6.8" />
      <path d="M6.1 10.6h.01M14.5 10.6h.01" />
      <path d="M4.6 13.4h3M13 13.4h3" />
    </g>
  ),
  'aws:sns': (
    <g {...S}>
      <circle cx="5.6" cy="12" r="2.6" />
      <circle cx="18.4" cy="6.4" r="2.2" />
      <circle cx="18.4" cy="12" r="2.2" />
      <circle cx="18.4" cy="17.6" r="2.2" />
      <path d="M8 11.1l8.3-3.7M8.2 12h8M8 12.9l8.3 3.7" />
    </g>
  ),
  'aws:eventbridge': (
    <g {...S}>
      <path d="M3 7.2h18M3 12h18M3 16.8h18" />
      <circle cx="8" cy="7.2" r="1.9" fill="var(--surface-1)" />
      <circle cx="15" cy="12" r="1.9" fill="var(--surface-1)" />
      <circle cx="9.5" cy="16.8" r="1.9" fill="var(--surface-1)" />
    </g>
  ),
  'aws:stepfunctions': (
    <g {...S}>
      <rect x="8.4" y="2.8" width="7.2" height="4.6" rx="1.2" />
      <rect x="2.6" y="16.6" width="7.2" height="4.6" rx="1.2" />
      <rect x="14.2" y="16.6" width="7.2" height="4.6" rx="1.2" />
      <path d="M12 7.4v3.4M12 10.8H6.2v5.8M12 10.8h5.8v5.8" />
    </g>
  ),
  'aws:dynamodb': (
    <g {...S}>
      <ellipse cx="12" cy="5.8" rx="7.4" ry="2.7" />
      <path d="M4.6 5.8v12.4c0 1.5 3.31 2.7 7.4 2.7s7.4-1.2 7.4-2.7V5.8" />
      <path d="M4.6 11.6c0 1.5 3.31 2.7 7.4 2.7s7.4-1.2 7.4-2.7" />
      <path d="M12.8 15.6l-2.2 3.1h2.4l-1.6 2.6" />
    </g>
  ),
  'aws:s3': (
    <g {...S}>
      <path d="M4.4 6.2h15.2l-1.5 13a1.6 1.6 0 0 1-1.6 1.4H7.5a1.6 1.6 0 0 1-1.6-1.4z" />
      <path d="M2.8 6.2h18.4" />
      <path d="M9.4 6.2V4.6a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.6" />
    </g>
  ),
  'aws:kinesis': (
    <g {...S}>
      <path d="M2.6 8.2c2.4-2 4.7-2 7.1 0s4.7 2 7.1 0 4.7-2 4.6 0" />
      <path d="M2.6 12.6c2.4-2 4.7-2 7.1 0s4.7 2 7.1 0 4.7-2 4.6 0" />
      <path d="M2.6 17c2.4-2 4.7-2 7.1 0s4.7 2 7.1 0 4.7-2 4.6 0" />
    </g>
  ),
  'aws:cognito': (
    <g {...S}>
      <path d="M12 2.9l7 2.8v5.5c0 4.3-2.9 8.1-7 9.9-4.1-1.8-7-5.6-7-9.9V5.7z" />
      <circle cx="12" cy="10.2" r="2.3" />
      <path d="M8.3 16.4a4.2 4.2 0 0 1 7.4 0" />
    </g>
  ),
  'aws:appsync': (
    <g {...S}>
      <circle cx="12" cy="4.8" r="2" />
      <circle cx="4.8" cy="16.4" r="2" />
      <circle cx="19.2" cy="16.4" r="2" />
      <circle cx="12" cy="12.4" r="2" />
      <path d="M12 6.8v3.6M10.4 13.7l-3.9 1.9M13.6 13.7l3.9 1.9M6.8 16.4h10.4" />
    </g>
  ),
  'aws:ecs': (
    <g {...S}>
      <rect x="2.8" y="9.6" width="6" height="5.4" rx="1" />
      <rect x="9.9" y="9.6" width="6" height="5.4" rx="1" />
      <rect x="6.4" y="3.6" width="6" height="5.4" rx="1" />
      <path d="M17.6 6.8h3.6M17.6 12.3h3.6M17.6 17.8h3.6" />
      <path d="M14.6 17.8h1.6" />
    </g>
  ),

  /* ------------------------------------------------------------- compute */
  'aws:eks': (
    <g {...S}>
      <path d="M12 2.6l7.6 4.4v8.8L12 20.2 4.4 15.8V7z" />
      <path d="M12 8.2l3.6 2.1v4.2L12 16.6l-3.6-2.1v-4.2z" />
      <path d="M12 2.6v5.6M19.6 7l-4 3.3M4.4 15.8l4-1.3" />
    </g>
  ),
  'aws:batch': (
    <g {...S}>
      <rect x="2.8" y="4" width="7" height="5.4" rx="1" />
      <rect x="2.8" y="12.6" width="7" height="5.4" rx="1" />
      <rect x="14.2" y="8.3" width="7" height="5.4" rx="1" />
      <path d="M9.8 6.7h2.2v4.3h2.2M9.8 15.3h2.2V11" />
    </g>
  ),
  'aws:apprunner': (
    <g {...S}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10 7.9l6.2 4.1-6.2 4.1z" />
    </g>
  ),

  /* -------------------------------------------------------- api and edge */
  'aws:cloudfront': (
    <g {...S}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4" />
      <path d="M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5.1-3.3-8.2S9.8 6.1 12 3.8z" />
      <circle cx="18.6" cy="6.2" r="2.4" fill="var(--surface-1)" />
      <circle cx="5.4" cy="17.8" r="2.4" fill="var(--surface-1)" />
    </g>
  ),
  'aws:waf': (
    <g {...S}>
      <path d="M12 2.9l7 2.8v5.5c0 4.3-2.9 8.1-7 9.9-4.1-1.8-7-5.6-7-9.9V5.7z" />
      <path d="M8.6 11.2h6.8M12 7.8v6.8" />
      <path d="M8.6 15.6h6.8" />
    </g>
  ),

  /* ------------------------------------------------------------ messaging */
  'aws:msk': (
    <g {...S}>
      <circle cx="6" cy="6.4" r="2.1" />
      <circle cx="6" cy="17.6" r="2.1" />
      <circle cx="17.4" cy="12" r="2.1" />
      <path d="M7.9 7.4l7.7 3.6M7.9 16.6l7.7-3.6" />
      <path d="M6 8.5v7" />
    </g>
  ),
  'aws:mq': (
    <g {...S}>
      <rect x="3" y="6.6" width="18" height="10.8" rx="2" />
      <path d="M3 9.6h18" />
      <path d="M7 13h3M13 13h4" />
      <circle cx="5.6" cy="8.1" r="0.6" fill="currentColor" stroke="none" />
    </g>
  ),

  /* ------------------------------------------------------- storage & data */
  'aws:aurora': (
    <g {...S}>
      <ellipse cx="12" cy="6" rx="7.4" ry="2.7" />
      <path d="M4.6 6v12c0 1.5 3.31 2.7 7.4 2.7s7.4-1.2 7.4-2.7V6" />
      <path d="M4.6 12c0 1.5 3.31 2.7 7.4 2.7s7.4-1.2 7.4-2.7" />
      <path d="M8.6 17.2c1.6-1.8 3.4-1.8 4.9 0s3 1.6 2.9 0" />
    </g>
  ),
  'aws:elasticache': (
    <g {...S}>
      <path d="M6.5 3.4l5.5 3.2 5.5-3.2" />
      <rect x="3.2" y="6.6" width="17.6" height="11" rx="2.4" />
      <path d="M7.4 11h3.2M13.4 11h3.2M7.4 14.2h9.2" />
      <path d="M12 17.6v3" />
    </g>
  ),
  'aws:neptune': (
    <g {...S}>
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="13" r="2.2" />
      <circle cx="7.6" cy="19" r="2" />
      <circle cx="17" cy="18.4" r="2" />
      <path d="M7.6 8.4l3 3.2M16.5 8.4l-3 3.2M11 14.7l-2 2.6M13.4 14.6l2.4 2.3" />
    </g>
  ),
  'aws:redshift': (
    <g {...S}>
      <path d="M3.4 5.4h17.2v9.2H3.4z" />
      <path d="M3.4 14.6l4.4 4h8.4l4.4-4" />
      <path d="M8.2 11.6V8M12 11.6V6.8M15.8 11.6v-2.4" />
    </g>
  ),
  'aws:athena': (
    <g {...S}>
      <circle cx="10.6" cy="10.6" r="6.2" />
      <path d="M15.2 15.2l5 5" />
      <path d="M7.8 10.6h5.6M10.6 7.8v5.6" />
    </g>
  ),
  'aws:glue': (
    <g {...S}>
      <rect x="2.8" y="9.2" width="6.4" height="5.6" rx="1.2" />
      <rect x="14.8" y="9.2" width="6.4" height="5.6" rx="1.2" />
      <path d="M9.2 12h5.6" />
      <path d="M12 4.6v4.6M12 14.8v4.6" />
      <circle cx="12" cy="12" r="1.5" />
    </g>
  ),

  /* ----------------------------------------------------------- ai & search */
  'aws:bedrock': (
    <g {...S}>
      <path d="M12 2.7l8 4.6v9.4l-8 4.6-8-4.6V7.3z" />
      <path d="M12 7.4l4 2.3v4.6l-4 2.3-4-2.3V9.7z" />
      <path d="M4 7.3l8 4.6 8-4.6M12 11.9v8.4" />
    </g>
  ),
  'aws:bedrockagent': (
    <g {...S}>
      <rect x="4.6" y="7.4" width="14.8" height="11" rx="3" />
      <circle cx="9.4" cy="12.4" r="1.3" />
      <circle cx="14.6" cy="12.4" r="1.3" />
      <path d="M9.6 15.6h4.8" />
      <path d="M12 3.4v4M9.4 3.4h5.2" />
      <path d="M2.6 11.4v3.2M21.4 11.4v3.2" />
    </g>
  ),
  'aws:knowledgebase': (
    <g {...S}>
      <path d="M4 5.2a2 2 0 0 1 2-2h4.4a1.6 1.6 0 0 1 1.6 1.6v14.4a1.4 1.4 0 0 0-1.4-1.4H4z" />
      <path d="M20 5.2a2 2 0 0 0-2-2h-4.4A1.6 1.6 0 0 0 12 4.8v14.4a1.4 1.4 0 0 1 1.4-1.4H20z" />
      <path d="M6.6 8.4h3M6.6 11.6h3M14.4 8.4h3M14.4 11.6h3" />
    </g>
  ),
  'aws:opensearch': (
    <g {...S}>
      <circle cx="10.4" cy="10.4" r="6" />
      <path d="M14.9 14.9l5 5" />
      <path d="M10.4 7.2v6.4M7.4 9.2l3 1.6 3-1.6M7.4 12l3 1.6 3-1.6" />
    </g>
  ),
  'aws:kendra': (
    <g {...S}>
      <circle cx="10.6" cy="10.6" r="6.2" />
      <path d="M15.2 15.2l5 5" />
      <path d="M7.6 12.4c1-1.4 2-2.1 3-2.1s2 .7 3 2.1" />
      <circle cx="10.6" cy="8" r="1.1" />
    </g>
  ),
  'aws:sagemaker': (
    <g {...S}>
      <path d="M3.4 18.6l4.4-5.2 3.4 2.6 4-5.4 5.4 3.6" />
      <path d="M3.4 3.8v16.4h16.8" />
      <circle cx="7.8" cy="13.4" r="1.2" />
      <circle cx="15.2" cy="10.6" r="1.2" />
    </g>
  ),
  'aws:textract': (
    <g {...S}>
      <path d="M5.6 3.4h8L18.8 8v12.6H5.6z" />
      <path d="M13.4 3.4V8h5.4" />
      <path d="M8.4 12h7.4M8.4 15h7.4M8.4 18h4.4" />
    </g>
  ),
  'aws:comprehend': (
    <g {...S}>
      <path d="M12 3.6c3.6 0 6.4 2.5 6.4 5.8 0 1.6-.7 3-1.8 4.1v3.2a1.6 1.6 0 0 1-1.6 1.6h-1.4v2.1H9.6v-3.4H8.2a1.6 1.6 0 0 1-1.6-1.6v-1.9H5.4a.9.9 0 0 1-.75-1.4l1.5-2.3C6.5 6.4 8.9 3.6 12 3.6z" />
      <path d="M10.2 9.6h4M10.2 12.4h2.6" />
    </g>
  ),
  'aws:rekognition': (
    <g {...S}>
      <path d="M2.6 12s3.6-6 9.4-6 9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6z" />
      <circle cx="12" cy="12" r="2.8" />
    </g>
  ),

  /* -------------------------------------------------------- security & ops */
  'aws:secretsmanager': (
    <g {...S}>
      <rect x="4.2" y="10" width="15.6" height="10.2" rx="2.2" />
      <path d="M7.8 10V7.4a4.2 4.2 0 0 1 8.4 0V10" />
      <circle cx="12" cy="14.6" r="1.4" />
      <path d="M12 16v2" />
    </g>
  ),
  'aws:kms': (
    <g {...S}>
      <circle cx="8.2" cy="8.2" r="4.2" />
      <path d="M11.2 11.2l8.6 8.6" />
      <path d="M16.6 16.6l2-2M14.2 14.2l2-2" />
    </g>
  ),
  'aws:cloudwatch': (
    <g {...S}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M6.6 12.6h3l1.8-3.4 2 6 1.6-2.6h2.4" />
    </g>
  ),
  /* ---------------------------------------------------------------- added */
  // One entry point fanning out to a target group. Deliberately not a shield
  // or a gateway: a balancer does not inspect or transform, it only chooses.
  'aws:alb': (
    <g {...S}>
      <path d="M2.8 12h2.6" />
      <rect x="5.4" y="8.8" width="4.8" height="6.4" rx="1.4" />
      <path d="M10.2 12h2.4" />
      <path d="M12.6 12c2 0 1.6-6 3.6-6" />
      <path d="M12.6 12h3.6" />
      <path d="M12.6 12c2 0 1.6 6 3.6 6" />
      <rect x="16.2" y="4" width="4.8" height="4" rx="1.2" />
      <rect x="16.2" y="10" width="4.8" height="4" rx="1.2" />
      <rect x="16.2" y="16" width="4.8" height="4" rx="1.2" />
    </g>
  ),
  // Many producers converging into one nozzle that drips into a destination.
  // Kinesis is three free-running waves; a delivery stream buffers and lands.
  'aws:firehose': (
    <g {...S}>
      <path d="M2.6 6.6l4.6 3.4M2.6 17.4l4.6-3.4M2.6 12h4.6" />
      <path d="M7.2 9.4h5.4l3 2.6-3 2.6H7.2z" />
      <path d="M18.4 8.8c1.6 1.9 2.4 3.1 2.4 4.1a2.4 2.4 0 0 1-4.8 0c0-1 .8-2.2 2.4-4.1z" />
    </g>
  ),
  // A policy document with a decision on it. Not a shield — WAF and Cognito
  // already own that silhouette, and a policy store decides rather than blocks.
  'aws:verifiedpermissions': (
    <g {...S}>
      <path d="M5.4 3.4h9l4.2 4.2v13H5.4z" />
      <path d="M14.4 3.4v4.2h4.2" />
      <path d="M8.4 13.2l2.4 2.4 4.6-5" />
    </g>
  ),
  // An identity badge. KMS is the key in this set, so IAM is who you are
  // rather than what you can unlock.
  'aws:iam': (
    <g {...S}>
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4" />
      <circle cx="8.8" cy="10.2" r="2.2" />
      <path d="M5.4 16.2a3.6 3.6 0 0 1 6.8 0" />
      <path d="M14.8 9.4h4.2M14.8 12.4h4.2M14.8 15.4h2.6" />
    </g>
  ),
  // A sealed package. ECS is flat boxes on a host; a registry holds one
  // immutable artefact, so this is a single closed volume.
  'aws:ecr': (
    <g {...S}>
      <path d="M12 3.2l7.6 4.2v9.2L12 20.8 4.4 16.6V7.4z" />
      <path d="M4.4 7.4L12 11.6l7.6-4.2" />
      <path d="M12 11.6v9.2" />
    </g>
  ),
  // Traffic splitting between two task sets, shifting toward the new one.
  'aws:codedeploy': (
    <g {...S}>
      <path d="M2.8 12h3.2" />
      <path d="M6 12c1.8 0 1.4-5.2 3.2-5.2M6 12c1.8 0 1.4 5.2 3.2 5.2" />
      <rect x="9.2" y="3.4" width="11.4" height="6.6" rx="1.6" />
      <rect x="9.2" y="14" width="11.4" height="6.6" rx="1.6" />
      <path d="M12 6.7h4.4" />
      <path d="M16.4 5.5l1.4 1.2-1.4 1.2" />
      <path d="M12 17.3h5.8" />
    </g>
  ),

  'aws:xray': (
    <g {...S}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 3.2v6.6M12 14.2v6.6M3.2 12h6.6M14.2 12h6.6" />
      <path d="M5.8 5.8l3.2 3.2M15 15l3.2 3.2M18.2 5.8L15 9M9 15l-3.2 3.2" />
    </g>
  ),
  'aws:rds': (
    <g {...S}>
      <ellipse cx="10.4" cy="5.8" rx="6.6" ry="2.6" />
      <path d="M3.8 5.8v11.6c0 1.4 2.95 2.6 6.6 2.6 1 0 1.96-.09 2.8-.25" />
      <path d="M3.8 11.6c0 1.44 2.95 2.6 6.6 2.6.62 0 1.22-.03 1.8-.1" />
      <circle cx="17.4" cy="16.6" r="2.5" />
      <path d="M17.4 12.9v1.2M17.4 19.1v1.2M13.7 16.6h1.2M19.9 16.6h1.2" />
    </g>
  ),
}

export function KindIcon({
  kind,
  size = 18,
  className,
}: {
  kind: ParticipantKind
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[kind] ?? ICONS.service}
    </svg>
  )
}

/** For use inside an existing SVG, positioned by the caller. */
export function KindGlyph({
  kind,
  x,
  y,
  size = 18,
}: {
  kind: ParticipantKind
  x: number
  y: number
  size?: number
}) {
  const scale = size / 24
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} pointerEvents="none">
      {ICONS[kind] ?? ICONS.service}
    </g>
  )
}
