import dagre from '@dagrejs/dagre'
import type { DatabaseTable } from '../dsl/ast'
import type { SchemaEdge, SchemaGraph } from '../dsl/schema'
import { avoidObstacles, bowPolyline, fanOffset, type Point } from './edgeRouting'
import { boundsOf, obstaclesExcept, round, toPath } from './layout'

export const SCHEMA = {
  nodeW: 220,
  headerH: 30,
  rowH: 20,
  nodeSep: 60,
  rankSep: 140,
  margin: 28,
  /** How far a row's exit point pokes out past the box before bending. */
  stub: 24,
  /** Sideways separation between two foreign keys that would otherwise overlap. */
  fanSpread: 26,
} as const

export interface SchemaNodeLayout {
  id: string
  table: DatabaseTable
  x: number
  y: number
  w: number
  h: number
  /** Parked by the user, rather than placed by the algorithm. */
  pinned: boolean
}

export interface SchemaEdgeLayout {
  id: string
  edge: SchemaEdge
  path: string
  headX: number
  headY: number
  headAngle: number
}

export interface SchemaLayout {
  width: number
  height: number
  nodes: SchemaNodeLayout[]
  edges: SchemaEdgeLayout[]
  nodeById: Map<string, SchemaNodeLayout>
}

export interface SchemaLayoutOptions {
  /** Top-left overrides; see `ArchLayoutOptions.positions` for the reasoning. */
  positions?: Map<string, Point> | null
  pinned?: Set<string> | null
  avoidNodes?: boolean
}

export function nodeHeight(table: DatabaseTable): number {
  return SCHEMA.headerH + SCHEMA.rowH * Math.max(1, table.columns.length)
}

/**
 * The box sizes the simulation needs. Unlike architecture nodes these are not
 * uniform — a table's height is its column count — and the physics has to know
 * that or a 20-column table will sit on top of its neighbours.
 */
export function schemaBoxes(graph: SchemaGraph): { id: string; w: number; h: number }[] {
  return graph.nodes.map((t) => ({ id: t.name, w: SCHEMA.nodeW, h: nodeHeight(t) }))
}

/** Ranked positions only — the seed for the force simulation. */
export function schemaSeedPositions(
  graph: SchemaGraph,
  direction: 'LR' | 'TB' = 'TB',
): Map<string, Point> {
  return runDagre(graph, direction).positions
}

/**
 * The y of a top-level column's row centre, in document coordinates —
 * `undefined` for a column that isn't one of the table's own top-level
 * columns (nested fields have no row of their own in this flat ER view).
 */
export function rowCenterY(node: SchemaNodeLayout, columnName: string): number | undefined {
  const index = node.table.columns.findIndex((c) => c.name === columnName)
  if (index < 0) return undefined
  return node.y + SCHEMA.headerH + SCHEMA.rowH * (index + 0.5)
}

/**
 * A row-anchored ER diagram: every table is a box sized to its own column
 * count, and every foreign key is a line from its column's row to the
 * referenced column's row — not box-centre to box-centre, which is what
 * `layoutArchitecture` draws and what would make an ERD unreadable the
 * moment a table has more than a couple of relationships.
 *
 * `multigraph: true` is deliberate, not copied from `layoutArchitecture`:
 * two foreign keys between the same pair of tables (different columns) are
 * two distinct edges, and a plain graph would hash both to the same
 * (from, to) slot and silently drop the second one.
 */
export function layoutSchema(
  graph: SchemaGraph,
  direction: 'LR' | 'TB' = 'TB',
  options: SchemaLayoutOptions = {},
): SchemaLayout {
  const overrides = options.positions
  const covered =
    !!overrides && graph.nodes.length > 0 && graph.nodes.every((t) => overrides.has(t.name))

  const ranked = covered
    ? { positions: new Map<string, Point>(), edgePoints: new Map<string, Point[]>(), width: 0, height: 0 }
    : runDagre(graph, direction)

  const pinnedIds = options.pinned ?? new Set<string>()

  const nodes: SchemaNodeLayout[] = graph.nodes.map((t) => {
    const h = nodeHeight(t)
    const at = overrides?.get(t.name) ??
      ranked.positions.get(t.name) ?? { x: SCHEMA.margin, y: SCHEMA.margin }
    return {
      id: t.name,
      table: t,
      x: at.x,
      y: at.y,
      w: SCHEMA.nodeW,
      h,
      pinned: pinnedIds.has(t.name),
    }
  })
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const edges = buildSchemaEdges(graph, nodeById, ranked.edgePoints, overrides, options.avoidNodes)
  const bounds = boundsOf(nodes, edges, ranked, SCHEMA.margin)

  return { ...bounds, nodes, edges, nodeById }
}

/* ------------------------------------------------------------------ dagre */

function runDagre(
  graph: SchemaGraph,
  direction: 'LR' | 'TB',
): {
  positions: Map<string, Point>
  edgePoints: Map<string, Point[]>
  width: number
  height: number
} {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: false })
  g.setGraph({
    rankdir: direction,
    nodesep: SCHEMA.nodeSep,
    ranksep: SCHEMA.rankSep,
    marginx: SCHEMA.margin,
    marginy: SCHEMA.margin,
    ranker: 'tight-tree',
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const t of graph.nodes) {
    g.setNode(t.name, { width: SCHEMA.nodeW, height: nodeHeight(t) })
  }
  for (const e of graph.edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue
    g.setEdge(e.from, e.to, { weight: 1 }, e.id)
  }

  dagre.layout(g)

  const positions = new Map<string, Point>()
  for (const t of graph.nodes) {
    const laid = g.node(t.name) as { x: number; y: number } | undefined
    const h = nodeHeight(t)
    positions.set(t.name, {
      x: (laid?.x ?? SCHEMA.margin + SCHEMA.nodeW / 2) - SCHEMA.nodeW / 2,
      y: (laid?.y ?? SCHEMA.margin + h / 2) - h / 2,
    })
  }

  const edgePoints = new Map<string, Point[]>()
  for (const e of graph.edges) {
    const laid = g.edge(e.from, e.to, e.id) as { points?: Point[] } | undefined
    if (laid?.points?.length) edgePoints.set(e.id, laid.points.slice())
  }

  const info = g.graph() as { width?: number; height?: number }
  return { positions, edgePoints, width: info.width ?? 0, height: info.height ?? 0 }
}

/* ------------------------------------------------------------------ edges */

function buildSchemaEdges(
  graph: SchemaGraph,
  nodeById: Map<string, SchemaNodeLayout>,
  rankedPoints: Map<string, Point[]>,
  overrides: Map<string, Point> | null | undefined,
  avoidNodes: boolean | undefined,
): SchemaEdgeLayout[] {
  // Anchors are resolved first, because in an ERD it is the *row* pair that
  // decides whether two lines overlap — two foreign keys between the same
  // tables usually leave from different rows and need no fanning at all.
  const anchored = graph.edges.flatMap((e) => {
    const from = nodeById.get(e.from)
    const to = nodeById.get(e.to)
    if (!from || !to) return []

    const fromPoint = rowBorder(from, rowCenterY(from, e.column), to.x + to.w / 2)
    const toPoint = rowBorder(to, rowCenterY(to, e.refColumn), from.x + from.w / 2)
    return [{ edge: e, from, to, fromPoint, toPoint }]
  })

  // Lanes by sorted foreign-key id rather than iteration order, so a line does
  // not hop to the other side of its partner when a table gains a column above.
  const members = new Map<string, string[]>()
  for (const a of anchored) {
    const key = anchorKey(a.fromPoint, a.toPoint)
    const list = members.get(key)
    if (list) list.push(a.edge.id)
    else members.set(key, [a.edge.id])
  }
  const bundles = new Map<string, number>()
  const laneOf = new Map<string, number>()
  for (const [key, list] of members) {
    list.sort()
    bundles.set(key, list.length)
    list.forEach((id, i) => laneOf.set(id, i))
  }

  const edges: SchemaEdgeLayout[] = []
  for (const a of anchored) {
    const { edge: e, from, to, fromPoint, toPoint } = a
    const displaced = !!overrides && (overrides.has(e.from) || overrides.has(e.to))
    const interior = displaced ? [] : (rankedPoints.get(e.id) ?? []).slice(1, -1)

    const fromStub = pushOut(from, fromPoint, SCHEMA.stub)
    const toStub = pushOut(to, toPoint, SCHEMA.stub)
    let points: Point[] = [fromPoint, fromStub, ...interior, toStub, toPoint]

    const key = anchorKey(fromPoint, toPoint)
    const lane = fanOffset(laneOf.get(e.id) ?? 0, bundles.get(key) ?? 1, SCHEMA.fanSpread)
    if (lane) points = bowPolyline(points, lane)

    if (avoidNodes) {
      // The stubs and anchors are load-bearing — a line must leave its own row
      // horizontally — so only the span between them is offered for rerouting.
      const obstacles = obstaclesExcept(nodeById, e.from, e.to)
      const middle = avoidObstacles(points.slice(1, -1), obstacles)
      points = [points[0], ...middle, points[points.length - 1]]
    }

    const head = toPoint
    const prev = points[points.length - 2] ?? fromPoint

    edges.push({
      id: e.id,
      edge: e,
      path: toPath(points),
      headX: round(head.x),
      headY: round(head.y),
      headAngle: (Math.atan2(head.y - prev.y, head.x - prev.x) * 180) / Math.PI,
    })
  }
  return edges
}

/** Two lines only need separating if they start and end in the same places. */
function anchorKey(a: Point, b: Point): string {
  return `${Math.round(a.x)},${Math.round(a.y)}|${Math.round(b.x)},${Math.round(b.y)}`
}

/**
 * The point on a box's left or right edge, at the given row's height,
 * choosing whichever side faces `towardX`. Falls back to the vertical
 * centre when the row can't be found (a column outside this flat view).
 */
function rowBorder(
  n: SchemaNodeLayout,
  rowY: number | undefined,
  towardX: number,
): Point {
  const y = rowY ?? n.y + n.h / 2
  const x = towardX >= n.x + n.w / 2 ? n.x + n.w : n.x
  return { x, y: Math.min(Math.max(y, n.y + 2), n.y + n.h - 2) }
}

/** Push a border point further outward, away from the box it sits on. */
function pushOut(n: SchemaNodeLayout, p: Point, amount: number): Point {
  const outward = p.x >= n.x + n.w / 2 ? 1 : -1
  return { x: p.x + outward * amount, y: p.y }
}
