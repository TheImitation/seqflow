import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { inferSchemaGraph } from '../dsl/schema'
import { ContextMenu } from '../components/ContextMenu'
import { useContextMenu } from '../components/useContextMenu'
import { viewSection } from '../components/menus'
import { ZoomControl } from '../components/ZoomControl'
import { LayoutControl } from '../components/LayoutControl'
import { useZoom } from '../components/useZoom'
import { PaneHideButton } from '../components/PaneRail'
import { usePanels } from '../state/panels'
import { MODE_LABEL } from '../state/viewLayout'
import { Minimap } from './Minimap'
import { useStore } from '../state/store'
import {
  layoutSchema,
  SCHEMA,
  schemaBoxes,
  schemaSeedPositions,
  type SchemaEdgeLayout,
  type SchemaNodeLayout,
} from './schemaLayout'
import { useGraphLayout } from './useGraphLayout'

/**
 * Derived from `doc.tables`, never independently edited — same rule as
 * `ArchitectureCanvas`, just over foreign keys instead of messages. Tables
 * are hand-authored `table` blocks, though, not inferred from the sequence,
 * so unlike the architecture pane this one carries no "inferred" tag.
 */
export function SchemaCanvas({ style }: { style?: React.CSSProperties }) {
  const doc = useStore((s) => s.doc)
  const direction = useStore((s) => s.schemaDirection)
  const setDirection = useStore((s) => s.setSchemaDirection)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const showMinimap = usePanels((s) => s.minimap)
  const ctx = useContextMenu()

  const svgRef = useRef<SVGSVGElement | null>(null)
  const schema = useMemo(() => inferSchemaGraph(doc), [doc])

  const boxes = useMemo(() => schemaBoxes(schema), [schema])
  // A table's height is its column count, so unlike the architecture view the
  // links carry no weight — every foreign key pulls the same.
  const links = useMemo(
    () => schema.edges.map((e) => ({ source: e.from, target: e.to, weight: 1 })),
    [schema.edges],
  )
  const seed = useMemo(() => schemaSeedPositions(schema, direction), [schema, direction])

  const graph = useGraphLayout({ pane: 'schema', boxes, links, seed, margin: SCHEMA.margin })

  const layout = useMemo(
    () =>
      layoutSchema(schema, direction, {
        positions: graph.positions,
        pinned: graph.pinned,
        avoidNodes: true,
      }),
    [schema, direction, graph.positions, graph.pinned],
  )

  // Held still while nodes move — see the same guard in `ArchitectureCanvas`.
  const [zoomWidth, setZoomWidth] = useState(layout.width)
  useEffect(() => {
    if (graph.draggingId || graph.settling) return
    setZoomWidth(layout.width)
  }, [layout.width, graph.draggingId, graph.settling])

  const zoom = useZoom(zoomWidth)
  const { scale, hostRef } = zoom
  // Only ever read from a pointer handler, so an effect is soon enough.
  const scaleRef = useRef(scale)
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: (clientX - rect.left) / scaleRef.current,
      y: (clientY - rect.top) / scaleRef.current,
    }
  }, [])

  /** No `MenuDeps` needed: nothing here edits the document. */
  const layoutSection = () => ({
    label: 'Layout',
    items: [
      ...(['rigid', 'fluid', 'manual'] as const).map((m) => ({
        id: `mode-${m}`,
        label: MODE_LABEL[m],
        checked: graph.mode === m,
        onSelect: () => graph.setMode(m),
      })),
      {
        id: 'sticky',
        label: 'Sticky drops',
        checked: graph.sticky || !graph.stickyApplies,
        disabled: !graph.stickyApplies,
        onSelect: graph.toggleSticky,
      },
      {
        id: 'reorganise',
        label: 'Re-organise',
        hint: graph.pinned.size ? `unpins ${graph.pinned.size}` : undefined,
        onSelect: graph.reorganise,
      },
      ...(['LR', 'TB'] as const).map((d) => ({
        id: `dir-${d}`,
        label: d === 'LR' ? 'Rank left to right' : 'Rank top to bottom',
        checked: direction === d,
        onSelect: () => setDirection(d),
      })),
    ],
  })

  const head = (
    <div className="pane-head">
      Schema
      <span className="spacer" />
      <LayoutControl
        mode={graph.mode}
        setMode={graph.setMode}
        sticky={graph.sticky}
        stickyApplies={graph.stickyApplies}
        toggleSticky={graph.toggleSticky}
        reorganise={graph.reorganise}
        direction={direction}
        setDirection={setDirection}
        hasPins={graph.pinned.size > 0}
        settling={graph.settling}
      />
      <ZoomControl zoom={zoom} />
      <PaneHideButton id="schema" />
    </div>
  )

  if (!layout.nodes.length) {
    return (
      <section className="pane" style={style}>
        {head}
        <div className="pane-body">
          <div className="empty-state">
            <strong>No table blocks yet</strong>
            Add <code>table Name @Participant {'{'} ... {'}'}</code> and its
            relationships appear here.
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="pane" style={style}>
      {head}
      <div className="pane-body">
        <div className="canvas-scroll" ref={hostRef}>
          <svg
            ref={svgRef}
            className={`schema-svg${graph.draggingId ? ' dragging' : ''}`}
            width={layout.width * scale}
            height={layout.height * scale}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) select(null)
            }}
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return
              select(null)
              ctx.open(e, [layoutSection(), viewSection(zoom)])
            }}
          >
            {layout.edges.map((e) => (
              <SchemaEdgeView key={e.id} edge={e} />
            ))}

            {layout.nodes.map((n) => (
              <TableNode
                key={n.id}
                node={n}
                selected={selection?.type === 'table' && selection.name === n.id}
                dragging={graph.draggingId === n.id}
                onSelect={() => select({ type: 'table', name: n.id })}
                onGrab={(event) => graph.beginNodeDrag(n.id, event, toLocal)}
                onMenu={(event) => {
                  select({ type: 'table', name: n.id })
                  ctx.open(event, [
                    {
                      label: 'Position',
                      items: [
                        {
                          id: 'unpin',
                          label: n.pinned ? 'Release this table' : 'Not parked',
                          disabled: !n.pinned,
                          onSelect: () => graph.unpin(n.id),
                        },
                      ],
                    },
                    layoutSection(),
                  ])
                }}
              />
            ))}
          </svg>
        </div>

        {showMinimap && !graph.settling && !graph.draggingId && (
          <Minimap
            hostRef={hostRef}
            width={layout.width}
            height={layout.height}
            scale={scale}
            label="Schema"
          >
            {layout.edges.map((e) => (
              <path key={e.id} className="mini-edge" d={e.path} />
            ))}
            {layout.nodes.map((n) => (
              <rect
                key={n.id}
                className={`mini-node${
                  selection?.type === 'table' && selection.name === n.id ? ' sel' : ''
                }`}
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={3}
              />
            ))}
          </Minimap>
        )}
      </div>
      {ctx.menu && <ContextMenu menu={ctx.menu} onClose={ctx.close} />}
    </section>
  )
}

/* ------------------------------------------------------------------- node */

function TableNode({
  node,
  selected,
  dragging,
  onSelect,
  onGrab,
  onMenu,
}: {
  node: SchemaNodeLayout
  selected: boolean
  dragging: boolean
  onSelect: () => void
  onGrab: (e: React.PointerEvent) => void
  onMenu: (e: React.MouseEvent) => void
}) {
  const { table } = node
  const cls = [
    'schema-node',
    selected ? 'selected' : '',
    node.pinned ? 'pinned' : '',
    dragging ? 'grabbed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <g
      className={cls}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onSelect()
        // Without this, dragging across the column names selects text.
        e.preventDefault()
        onGrab(e)
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        onMenu(e)
      }}
      tabIndex={0}
      role="button"
      aria-label={table.name}
    >
      <title>
        {`${table.description ?? table.name}${node.pinned ? ' · parked here' : ''}`}
      </title>
      <rect className="body" x={node.x} y={node.y} width={node.w} height={node.h} />
      <rect className="header" x={node.x} y={node.y} width={node.w} height={SCHEMA.headerH} />
      <text className="title" x={node.x + 10} y={node.y + SCHEMA.headerH / 2 + 4}>
        {truncate(table.name, 24)}
      </text>
      {node.pinned && (
        <text className="pin-mark" x={node.x + node.w - 7} y={node.y + SCHEMA.headerH / 2 + 5}>
          📌
        </text>
      )}
      {table.columns.map((col, i) => {
        const y = node.y + SCHEMA.headerH + SCHEMA.rowH * i
        const isPk = table.primaryKey?.includes(col.name)
        const isFk = table.foreignKeys.some((fk) => fk.column === col.name)
        return (
          <g key={`${col.name}-${i}`} className="row">
            <text className="col-name" x={node.x + 10} y={y + SCHEMA.rowH / 2 + 4}>
              {truncate(col.name, 20)}
            </text>
            {(isPk || isFk) && (
              <text className="col-key" x={node.x + node.w - 10} y={y + SCHEMA.rowH / 2 + 4}>
                {isPk ? 'PK' : 'FK'}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/* ------------------------------------------------------------------- edge */

function SchemaEdgeView({ edge }: { edge: SchemaEdgeLayout }) {
  const tooltip = `${edge.edge.from}.${edge.edge.column} → ${edge.edge.to}.${edge.edge.refColumn}`

  return (
    <g className="schema-edge">
      <path className="line" d={edge.path} />
      <polygon
        className="line"
        points="0,0 -8,-4 -8,4"
        transform={`translate(${edge.headX} ${edge.headY}) rotate(${edge.headAngle})`}
        pointerEvents="none"
      />
      <path className="hit" d={edge.path}>
        <title>{tooltip}</title>
      </path>
    </g>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}
