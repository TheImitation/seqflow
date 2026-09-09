import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { edgeId } from '../dsl/architecture'
import { isAwsKind } from '../dsl/ast'
import { ContextMenu } from '../components/ContextMenu'
import { useContextMenu } from '../components/useContextMenu'
import {
  archEdgeMenu,
  canvasMenu,
  participantMenu,
  viewSection,
  type MenuDeps,
} from '../components/menus'
import { ZoomControl } from '../components/ZoomControl'
import { LayoutControl } from '../components/LayoutControl'
import { useZoom } from '../components/useZoom'
import { usePlaybackEngine } from '../playback/usePlayback'
import { PaneHideButton } from '../components/PaneRail'
import { usePanels } from '../state/panels'
import { Minimap } from './Minimap'
import { useStore } from '../state/store'
import { KindGlyph } from './aws-icons'
import { KIND_LABEL } from './aws-icons/labels'
import {
  ARCH,
  archSeedPositions,
  layoutArchitecture,
  type ArchEdgeLayout,
  type ArchNodeLayout,
} from './layout'
import { useGraphLayout } from './useGraphLayout'
import { MODE_LABEL } from '../state/viewLayout'

/**
 * Derived, never independently edited: the node and edge set come straight out
 * of `inferArchitecture`, and only the dagre positions live here.
 */
export function ArchitectureCanvas({
  style,
  menuDeps,
}: {
  style?: React.CSSProperties
  menuDeps: MenuDeps
}) {
  const doc = useStore((s) => s.doc)
  const arch = useStore((s) => s.arch)
  const direction = useStore((s) => s.archDirection)
  const setDirection = useStore((s) => s.setArchDirection)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const showMinimap = usePanels((s) => s.minimap)
  const focusPath = useStore((s) => s.focusPath)

  const { current, index } = usePlaybackEngine()
  const ctx = useContextMenu()

  const svgRef = useRef<SVGSVGElement | null>(null)

  const boxes = useMemo(
    () => arch.nodes.map((n) => ({ id: n.participantId, w: ARCH.nodeW, h: ARCH.nodeH })),
    [arch.nodes],
  )
  const links = useMemo(
    () => arch.edges.map((e) => ({ source: e.from, target: e.to, weight: e.interactionCount })),
    [arch.edges],
  )
  // Memoised on the graph and direction alone, so the ranked layout is computed
  // once per edit rather than once per animation frame.
  const seed = useMemo(() => archSeedPositions(arch, direction), [arch, direction])

  const graph = useGraphLayout({ pane: 'arch', boxes, links, seed, margin: ARCH.margin })

  const layout = useMemo(
    () =>
      layoutArchitecture(
        arch,
        (id) => doc.participants.find((p) => p.id === id)?.label ?? id,
        direction,
        { positions: graph.positions, pinned: graph.pinned, avoidNodes: true },
      ),
    [arch, doc.participants, direction, graph.positions, graph.pinned],
  )

  /**
   * The extent the zoom fits to is held still while nodes are moving.
   * `useZoom` derives `scale` from the content width, and `layout.width` grows
   * with a node dragged rightward — so feeding it live would shrink `scale`
   * mid-drag, which in turn stretches the coordinate the pointer maps to and
   * accelerates the node away from the cursor.
   */
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
    // Divided by `scale` rather than by `rect.width` over `layout.width`: the
    // two are algebraically identical, but only this form keeps the layout
    // extent out of the pointer mapping.
    return {
      x: (clientX - rect.left) / scaleRef.current,
      y: (clientY - rect.top) / scaleRef.current,
    }
  }, [])

  const playing = index >= 0
  const activeEdgeId = current ? edgeId(current.message.from, current.message.to) : undefined
  const activeNodes = new Set(
    current ? [current.message.from, current.message.to] : [],
  )

  // Which links and nodes the traced outcome actually touches. This is the
  // payoff of tracing on this pane: "the infected document never reaches S3"
  // stops being a Note and becomes a visible property of the graph.
  const onPath = useMemo(() => {
    if (!focusPath) return null
    const edges = new Set<string>()
    const nodes = new Set<string>()
    for (const [id, messageIds] of arch.edgeMessages) {
      if (messageIds.some((m) => focusPath.messageIds.has(m))) edges.add(id)
    }
    for (const m of doc.messages) {
      if (!focusPath.messageIds.has(m.id)) continue
      nodes.add(m.from)
      nodes.add(m.to)
    }
    return { edges, nodes }
  }, [focusPath, arch.edgeMessages, doc.messages])

  // Follow the active link so playback stays visible in a large graph.
  const activeEdge = activeEdgeId ? layout.edgeById.get(activeEdgeId) : undefined
  useEffect(() => {
    const host = hostRef.current
    if (!host || !activeEdge) return
    // Assigned rather than animated: at a few steps per second a smooth scroll
    // would still be catching up when the next step lands.
    host.scrollTop = Math.max(0, activeEdge.labelY * scale - host.clientHeight / 2)
    host.scrollLeft = Math.max(0, activeEdge.labelX * scale - host.clientWidth / 2)
  }, [activeEdge, hostRef, scale])

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
      Architecture
      <span
        style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}
        title="Nodes and links are derived from the sequence on every change"
      >
        inferred
      </span>
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
      <PaneHideButton id="arch" />
    </div>
  )

  if (!layout.nodes.length) {
    return (
      <section className="pane" style={style}>
        {head}
        <div
          className="pane-body"
          onContextMenu={(e) => ctx.open(e, canvasMenu(menuDeps))}
        >
          <div className="empty-state">
            <strong>Nothing to infer yet</strong>
            Add a participant or a message and the architecture appears here.
          </div>
        </div>
        {ctx.menu && <ContextMenu menu={ctx.menu} onClose={ctx.close} />}
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
            className={`arch-svg${graph.draggingId ? ' dragging' : ''}`}
            width={layout.width * scale}
            height={layout.height * scale}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) select(null)
            }}
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return
              select(null)
              ctx.open(e, canvasMenu(menuDeps, [layoutSection(), viewSection(zoom)]))
            }}
          >
            {layout.edges.map((e) => (
          <Edge
            key={e.id}
            edge={e}
            selected={selection?.type === 'edge' && selection.id === e.id}
            active={e.id === activeEdgeId}
            dim={
              (playing && e.id !== activeEdgeId) || (!!onPath && !onPath.edges.has(e.id))
            }
            onSelect={() => select({ type: 'edge', id: e.id })}
            onMenu={(event) => {
              select({ type: 'edge', id: e.id })
              ctx.open(event, archEdgeMenu(menuDeps, e.edge.from, e.edge.to))
            }}
          />
        ))}

        {layout.nodes.map((n) => (
          <Node
            key={n.id}
            node={n}
            selected={selection?.type === 'participant' && selection.id === n.id}
            active={activeNodes.has(n.id)}
            dragging={graph.draggingId === n.id}
            dim={
              (playing && !activeNodes.has(n.id)) || (!!onPath && !onPath.nodes.has(n.id))
            }
            onSelect={() => select({ type: 'participant', id: n.id })}
            onGrab={(event) => graph.beginNodeDrag(n.id, event, toLocal)}
            onMenu={(event) => {
              select({ type: 'participant', id: n.id })
              ctx.open(event, [
                ...participantMenu(menuDeps, n.id, { reveal: true }),
                {
                  label: 'Position',
                  items: [
                    {
                      id: 'unpin',
                      label: n.pinned ? 'Release this node' : 'Not parked',
                      disabled: !n.pinned,
                      onSelect: () => graph.unpin(n.id),
                    },
                  ],
                },
              ])
            }}
          />
          ))}
          </svg>
        </div>

        {/* A plan of the whole diagram is not worth redrawing sixty times a
            second while that diagram is still moving. */}
        {showMinimap && !graph.settling && !graph.draggingId && (
          <Minimap
            hostRef={hostRef}
            width={layout.width}
            height={layout.height}
            scale={scale}
            label="Architecture"
          >
            {layout.edges.map((e) => (
              <path key={e.id} className="mini-edge" d={e.path} />
            ))}
            {layout.nodes.map((n) => (
              <rect
                key={n.id}
                className={`mini-node${
                  selection?.type === 'participant' && selection.id === n.id
                    ? ' sel'
                    : ''
                }${isAwsKind(n.kind) ? ' aws' : ''}`}
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

function Node({
  node,
  selected,
  active,
  dragging,
  dim,
  onSelect,
  onGrab,
  onMenu,
}: {
  node: ArchNodeLayout
  selected: boolean
  active: boolean
  dragging: boolean
  dim: boolean
  onSelect: () => void
  onGrab: (e: React.PointerEvent) => void
  onMenu: (e: React.MouseEvent) => void
}) {
  const aws = isAwsKind(node.kind)
  const cls = [
    'arch-node',
    aws ? 'aws' : '',
    selected ? 'selected' : '',
    active ? 'active' : '',
    node.pinned ? 'pinned' : '',
    dragging ? 'grabbed' : '',
    dim ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <g
      className={cls}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        // Selecting on press feels immediate; the placement is only committed
        // if the pointer then travels past the drag threshold.
        onSelect()
        // Without this, dragging across the labels starts a text selection.
        e.preventDefault()
        onGrab(e)
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        onMenu(e)
      }}
      tabIndex={0}
      role="button"
      aria-label={`${node.label}, ${KIND_LABEL[node.kind]}`}
    >
      <title>
        {`${node.label} · ${KIND_LABEL[node.kind]}${node.pinned ? ' · parked here' : ''}`}
      </title>
      <rect className="body" x={node.x} y={node.y} width={node.w} height={node.h} />
      <rect
        className={aws ? 'accent-bar' : 'accent-bar plain'}
        x={node.x}
        y={node.y + 8}
        width={3}
        height={node.h - 16}
        rx={1.5}
      />
      <g style={{ color: aws ? 'var(--accent)' : 'var(--text-dim)' }}>
        <KindGlyph kind={node.kind} x={node.x + 15} y={node.y + node.h / 2 - 11} size={22} />
      </g>
      <text className="title" x={node.x + 48} y={node.y + node.h / 2 - 2}>
        {truncate(node.label, 17)}
      </text>
      <text className="kind" x={node.x + 48} y={node.y + node.h / 2 + 14}>
        {KIND_LABEL[node.kind].toUpperCase()}
      </text>
      {node.pinned && (
        <text className="pin-mark" x={node.x + node.w - 8} y={node.y + 15}>
          📌
        </text>
      )}
    </g>
  )
}

/* ------------------------------------------------------------------- edge */

function Edge({
  edge,
  selected,
  active,
  dim,
  onSelect,
  onMenu,
}: {
  edge: ArchEdgeLayout
  selected: boolean
  active: boolean
  dim: boolean
  onSelect: () => void
  onMenu: (e: React.MouseEvent) => void
}) {
  const unhappy = edge.edge.hasUnhappyPath
  const cls = [
    'arch-edge',
    edge.dashed ? 'dashed' : '',
    unhappy ? 'unhappy' : '',
    selected || active ? 'active' : '',
    dim ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const count = edge.edge.interactionCount
  const declared = edge.edge.declaredFailures
  // ⚠ means a failure branch is drawn; ○ means the contract only lists error
  // codes. Conflating the two made coverage read far higher than it was.
  const badge = `${count}${unhappy ? ' ⚠' : declared > 0 ? ' ○' : ''}`
  const badgeW = badge.length * 6.6 + 12
  const tooltip = [
    `${edge.edge.from} → ${edge.edge.to}`,
    `${count} interaction${count === 1 ? '' : 's'}: ${[...edge.edge.styles].join(', ')}`,
    ...edge.edge.messageLabels.slice(0, 6).map((l) => `  • ${l}`),
    edge.edge.messageLabels.length > 6 ? `  …${edge.edge.messageLabels.length - 6} more` : '',
    unhappy
      ? '⚠ a failure branch is drawn for this link'
      : declared > 0
        ? `○ ${declared} failure response${declared === 1 ? '' : 's'} declared, none drawn as a path`
        : 'happy path only',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <g>
      <path className={cls} d={edge.path} />
      <polygon
        className={cls}
        points="0,0 -9,-4.6 -9,4.6"
        transform={`translate(${edge.headX} ${edge.headY}) rotate(${edge.headAngle})`}
        pointerEvents="none"
      />
      <path
        className="arch-edge-hit"
        d={edge.path}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          onSelect()
        }}
        onContextMenu={(e) => {
          e.stopPropagation()
          onMenu(e)
        }}
      >
        <title>{tooltip}</title>
      </path>
      <g
        className={`arch-edge-badge${unhappy ? ' unhappy' : declared > 0 ? ' declared' : ''}`}
        opacity={dim ? 0.25 : 1}
        pointerEvents="none"
      >
        <rect x={edge.labelX - badgeW / 2} y={edge.labelY - 8} width={badgeW} height={16} />
        <text x={edge.labelX} y={edge.labelY + 3.5} textAnchor="middle">
          {badge}
        </text>
      </g>
    </g>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}
