import { inferArchitecture } from '../dsl/architecture'
import { isAwsKind, type SequenceDoc } from '../dsl/ast'
import { layoutArchitecture, type ArchLayout } from '../render/layout'

const AWS_FILL = '#2b1d10'
const AWS_STROKE = '#ff9d2e'
const PLAIN_FILL = '#1b2230'
const PLAIN_STROKE = '#4d7ea8'

/**
 * mxGraph XML for the architecture diagram, positioned with the same dagre
 * layout the canvas uses so the import matches what you were looking at.
 */
export function toDrawio(doc: SequenceDoc, layout?: ArchLayout): string {
  const graph = inferArchitecture(doc)
  const laid =
    layout ??
    layoutArchitecture(graph, (id) => doc.participants.find((p) => p.id === id)?.label ?? id)

  const cells: string[] = [
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
  ]

  const cellId = new Map<string, string>()
  laid.nodes.forEach((n, i) => {
    const id = `node${i + 1}`
    cellId.set(n.id, id)
    const kind = doc.participants.find((p) => p.id === n.id)?.kind ?? 'service'
    const aws = isAwsKind(kind)
    const style = [
      'rounded=1',
      'arcSize=12',
      'whiteSpace=wrap',
      'html=1',
      `fillColor=${aws ? AWS_FILL : PLAIN_FILL}`,
      `strokeColor=${aws ? AWS_STROKE : PLAIN_STROKE}`,
      'fontColor=#e6edf6',
      'fontSize=13',
      'strokeWidth=1.5',
      'verticalAlign=middle',
    ].join(';')

    cells.push(
      `        <mxCell id="${id}" value="${esc(`${n.label}\n${kind}`)}" style="${style}" vertex="1" parent="1">`,
      `          <mxGeometry x="${r(n.x)}" y="${r(n.y)}" width="${r(n.w)}" height="${r(n.h)}" as="geometry" />`,
      '        </mxCell>',
    )
  })

  laid.edges.forEach((e, i) => {
    const source = cellId.get(e.edge.from)
    const target = cellId.get(e.edge.to)
    if (!source || !target) return

    const unhappy = e.edge.hasUnhappyPath
    const style = [
      'edgeStyle=orthogonalEdgeStyle',
      'rounded=1',
      'html=1',
      'jettySize=auto',
      'orthogonalLoop=1',
      `strokeColor=${unhappy ? '#e8a33d' : '#7d8da5'}`,
      'fontColor=#a8b6cc',
      'fontSize=11',
      e.dashed ? 'dashed=1' : 'dashed=0',
      'endArrow=block',
      'endFill=1',
    ].join(';')

    const count = e.edge.interactionCount
    const label = `${count} ${count === 1 ? 'call' : 'calls'}${unhappy ? ' ⚠' : ''}`

    cells.push(
      `        <mxCell id="edge${i + 1}" value="${esc(label)}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">`,
      '          <mxGeometry relative="1" as="geometry" />',
      '        </mxCell>',
    )
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="seqflow" type="device">',
    '  <diagram name="Architecture" id="seqflow-architecture">',
    `    <mxGraphModel dx="${r(laid.width)}" dy="${r(laid.height)}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" background="#0d1117" math="0" shadow="0">`,
    '      <root>',
    ...cells,
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
    '',
  ].join('\n')
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
}

function r(n: number): number {
  return Math.round(n)
}
