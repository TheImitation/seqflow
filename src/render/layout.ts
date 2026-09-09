import dagre from '@dagrejs/dagre'
import { edgeId, type ArchGraph } from '../dsl/architecture'
import type { ArchEdge, ParticipantKind } from '../dsl/ast'
import {
  avoidObstacles,
  bowPolyline,
  fanOffset,
  toPath,
  type Point,
  type Rect,
} from './edgeRouting'

export { round, toPath } from './edgeRouting'

export const ARCH = {
  nodeW: 184,
  nodeH: 68,
  nodeSep: 44,
  rankSep: 104,
  margin: 28,
  /** Sideways separation between the lines of a parallel bundle. */
  fanSpread: 40,
} as const

export interface ArchNodeLayout {
  id: string
  label: string
  kind: ParticipantKind
  x: number
  y: number
  w: number
  h: number
  /** Parked by the user, rather than placed by the algorithm. */
  pinned: boolean
}

export interface ArchEdgeLayout {
  id: string
  edge: ArchEdge
  path: string
  /** Point for the count badge / warning marker. */
  labelX: number
  labelY: number
  /** Angle at the arrowhead, in degrees. */
  headAngle: number
  headX: number
  headY: number
  dashed: boolean
}

export interface ArchLayout {
  width: number
  height: number
  nodes: ArchNodeLayout[]
  edges: ArchEdgeLayout[]
  nodeById: Map<string, ArchNodeLayout>
  edgeById: Map<string, ArchEdgeLayout>
}

export interface ArchLayoutOptions {
  /**
   * Top-left positions that override the ranked layout — a dragged node, a
   * pinned one, or a whole graph coming out of the force simulation. When this
   * covers every node, dagre is skipped entirely: at 60fps in fluid mode,
   * re-ranking a graph nobody is going to look at is the single most expensive
   * thing this function could do.
   */
  positions?: Map<string, Point> | null
  /** Which nodes to draw a pin marker on. */
  pinned?: Set<string> | null
  /**
   * Bend links around boxes they cross. Skipped mid-drag, where the geometry
   * is about to change anyway and the cost is per-frame.
   */
  avoidNodes?: boolean
}

/**
 * The ranked positions on their own, without any edge work. The canvases
 * memoise this on `(graph, direction)` and feed it to the simulation as a
 * starting arrangement — seeding physics from dagre rather than at random is
 * why the fluid view settles in a few frames instead of visibly scrambling.
 */
export function archSeedPositions(
  graph: ArchGraph,
  direction: 'LR' | 'TB' = 'LR',
): Map<string, Point> {
  return runDagre(graph, direction).positions
}

export function layoutArchitecture(
  graph: ArchGraph,
  labelOf: (id: string) => string,
  direction: 'LR' | 'TB' = 'LR',
  options: ArchLayoutOptions = {},
): ArchLayout {
  const overrides = options.positions
  const covered =
    !!overrides && graph.nodes.length > 0 && graph.nodes.every((n) => overrides.has(n.participantId))

  const ranked = covered
    ? { positions: new Map<string, Point>(), edgePoints: new Map<string, Point[]>(), width: 0, height: 0 }
    : runDagre(graph, direction)

  const pinnedIds = options.pinned ?? new Set<string>()

  const nodes: ArchNodeLayout[] = graph.nodes.map((n) => {
    const at =
      overrides?.get(n.participantId) ??
      ranked.positions.get(n.participantId) ?? {
        x: ARCH.margin,
        y: ARCH.margin,
      }
    return {
      id: n.participantId,
      label: labelOf(n.participantId),
      kind: n.kind,
      x: at.x,
      y: at.y,
      w: ARCH.nodeW,
      h: ARCH.nodeH,
      pinned: pinnedIds.has(n.participantId),
    }
  })
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const edges = buildArchEdges(graph, nodeById, ranked.edgePoints, overrides, options.avoidNodes)
  const bounds = boundsOf(nodes, edges, ranked, ARCH.margin)

  return {
    ...bounds,
    nodes,
    edges,
    nodeById,
    edgeById: new Map(edges.map((e) => [e.id, e])),
  }
}

/* ------------------------------------------------------------------ dagre */

function runDagre(
  graph: ArchGraph,
  direction: 'LR' | 'TB',
): {
  positions: Map<string, Point>
  edgePoints: Map<string, Point[]>
  width: number
  height: number
} {
  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false })
  g.setGraph({
    rankdir: direction,
    nodesep: ARCH.nodeSep,
    ranksep: ARCH.rankSep,
    marginx: ARCH.margin,
    marginy: ARCH.margin,
    ranker: 'tight-tree',
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of graph.nodes) {
    g.setNode(n.participantId, { width: ARCH.nodeW, height: ARCH.nodeH })
  }
  for (const e of graph.edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue
    g.setEdge(e.from, e.to, { weight: e.interactionCount })
  }

  dagre.layout(g)

  const positions = new Map<string, Point>()
  for (const n of graph.nodes) {
    const laid = g.node(n.participantId) as { x: number; y: number } | undefined
    positions.set(n.participantId, {
      // dagre reports centres; everything downstream renders from top-left.
      x: (laid?.x ?? ARCH.margin + ARCH.nodeW / 2) - ARCH.nodeW / 2,
      y: (laid?.y ?? ARCH.margin + ARCH.nodeH / 2) - ARCH.nodeH / 2,
    })
  }

  const edgePoints = new Map<string, Point[]>()
  for (const e of graph.edges) {
    const laid = g.edge(e.from, e.to) as { points?: Point[] } | undefined
    if (laid?.points?.length) edgePoints.set(edgeId(e.from, e.to), laid.points.slice())
  }

  const info = g.graph() as { width?: number; height?: number }
  return { positions, edgePoints, width: info.width ?? 0, height: info.height ?? 0 }
}

/* ------------------------------------------------------------------ edges */

function buildArchEdges(
  graph: ArchGraph,
  nodeById: Map<string, ArchNodeLayout>,
  rankedPoints: Map<string, Point[]>,
  overrides: Map<string, Point> | null | undefined,
  avoidNodes: boolean | undefined,
): ArchEdgeLayout[] {
  // Every line between the same two boxes gets its own lane, so a reciprocal
  // pair — or three links to the same database — never stack into one stroke.
  //
  // Lanes are assigned by sorted edge id, not by iteration order: `graph.edges`
  // comes out in message order, so keying off it would make the two halves of a
  // reciprocal pair swap sides whenever a message was added above them.
  const bundleMembers = new Map<string, string[]>()
  for (const e of graph.edges) {
    const key = pairKey(e.from, e.to)
    const members = bundleMembers.get(key)
    if (members) members.push(edgeId(e.from, e.to))
    else bundleMembers.set(key, [edgeId(e.from, e.to)])
  }
  const bundles = new Map<string, number>()
  const bundleIndex = new Map<string, number>()
  for (const [key, members] of bundleMembers) {
    members.sort()
    bundles.set(key, members.length)
    members.forEach((id, i) => bundleIndex.set(id, i))
  }

  const edges: ArchEdgeLayout[] = []
  for (const e of graph.edges) {
    const from = nodeById.get(e.from)
    const to = nodeById.get(e.to)
    if (!from || !to) continue

    const id = edgeId(e.from, e.to)
    // dagre's polyline is only meaningful while both ends are where dagre put
    // them; once either has been dragged or simulated it is describing a route
    // between two places the boxes no longer are.
    const displaced =
      !!overrides && (overrides.has(e.from) || overrides.has(e.to))
    const ranked = displaced ? undefined : rankedPoints.get(id)

    let points: Point[] =
      ranked && ranked.length >= 2 ? ranked.slice() : [centre(from), centre(to)]

    const lane = fanOffset(
      bundleIndex.get(id) ?? 0,
      bundles.get(pairKey(e.from, e.to)) ?? 1,
      ARCH.fanSpread,
    )
    if (lane) points = bowPolyline(points, lane)

    // Re-anchor onto the box edges last, so the arrowhead lands on the border
    // whatever the interior route ended up being.
    points[0] = borderPoint(from, points[1] ?? centre(to))
    points[points.length - 1] = borderPoint(to, points[points.length - 2] ?? centre(from))

    if (avoidNodes) {
      const obstacles = obstaclesExcept(nodeById, e.from, e.to)
      points = avoidObstacles(points, obstacles).map(nonNegative)
    }

    const head = points[points.length - 1]
    const prev = points[points.length - 2] ?? centre(from)
    const mid = midpointOf(points)

    edges.push({
      id,
      edge: e,
      path: toPath(points),
      labelX: mid.x,
      labelY: mid.y,
      headX: head.x,
      headY: head.y,
      headAngle: (Math.atan2(head.y - prev.y, head.x - prev.x) * 180) / Math.PI,
      dashed: !e.styles.has('sync'),
    })
  }
  return edges
}

/* ---------------------------------------------------------------- helpers */

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function centre(n: { x: number; y: number; w: number; h: number }): Point {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 }
}

/** Every box a line must dodge — all of them except the two it connects. */
export function obstaclesExcept(
  nodeById: Map<string, { x: number; y: number; w: number; h: number }>,
  from: string,
  to: string,
): Rect[] {
  const out: Rect[] = []
  for (const [id, n] of nodeById) {
    if (id === from || id === to) continue
    out.push({ x: n.x, y: n.y, w: n.w, h: n.h })
  }
  return out
}

/** A deflection can push a waypoint off the top or left; the viewBox starts at 0. */
function nonNegative(p: Point): Point {
  return p.x >= 4 && p.y >= 4 ? p : { x: Math.max(4, p.x), y: Math.max(4, p.y) }
}

/**
 * The point half way *along* the polyline, rather than the middle array entry
 * — once a line has been deflected the two are no longer the same, and a badge
 * pinned to the array midpoint drifts off the stroke.
 */
function midpointOf(points: Point[]): Point {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  }
  let walked = 0
  for (let i = 0; i < points.length - 1; i++) {
    const seg = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      }
    }
    walked += seg
  }
  return points[Math.floor(points.length / 2)]
}

/**
 * The canvas size. Node positions can now come from a drag, so this cannot
 * trust dagre's reported size — and it has to cover deflected edge waypoints
 * too, because `snapshot.ts` crops PNG and SVG exports to this viewBox.
 */
export function boundsOf(
  nodes: { x: number; y: number; w: number; h: number }[],
  edges: { path: string }[],
  ranked: { width: number; height: number },
  margin: number,
  minWidth = 360,
  minHeight = 240,
): { width: number; height: number } {
  let right = minWidth
  let bottom = minHeight
  for (const n of nodes) {
    right = Math.max(right, n.x + n.w + margin)
    bottom = Math.max(bottom, n.y + n.h + margin)
  }
  for (const e of edges) {
    for (const [x, y] of pathExtents(e.path)) {
      right = Math.max(right, x + margin)
      bottom = Math.max(bottom, y + margin)
    }
  }
  return {
    width: Math.max(right, ranked.width),
    height: Math.max(bottom, ranked.height),
  }
}

/** Coordinate pairs out of an `M/Q/L` path — cheaper than re-plumbing points. */
function pathExtents(d: string): [number, number][] {
  const out: [number, number][] = []
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)
  if (!numbers) return out
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    out.push([Number(numbers[i]), Number(numbers[i + 1])])
  }
  return out
}

/** Where a line into `n` should stop so the arrowhead sits on the box edge. */
export function borderPoint(
  n: { x: number; y: number; w: number; h: number },
  towards: Point,
): Point {
  const c = centre(n)
  const dx = towards.x - c.x
  const dy = towards.y - c.y
  if (dx === 0 && dy === 0) return c

  const hw = n.w / 2 + 2
  const hh = n.h / 2 + 2
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy),
  )
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}
