/**
 * Keeping lines off boxes.
 *
 * Neither dagre's polylines nor a force layout's straight chords know anything
 * about the boxes they pass *over* — dagre reserves space only for the ranks it
 * created, and a dragged or simulated node can land anywhere. This module is
 * the shared fix-up pass both canvases run after positions are final: find the
 * segments that cut through a node they do not terminate at, and bend them
 * around it.
 *
 * Pure geometry, no layout types — so `layoutArchitecture` (centre-anchored
 * links) and `layoutSchema` (row-anchored foreign keys) can both use it.
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * How much daylight a deflected line keeps between itself and the box. Kept
 * comfortably under `SIM.collidePadding` so that a line leaving its own box
 * toward a settled neighbour does not start out already inside that
 * neighbour's padded bounds — which would make every detour candidate look
 * equally blocked and burn the whole pass budget achieving nothing.
 */
export const CLEARANCE = 9
/** Bounds the fix-up: a path already this bent is not improved by more bending. */
const MAX_WAYPOINTS = 6
const MAX_PASSES = 3

/**
 * Signed sideways offset for one line among `count` running between the same
 * pair of boxes, spread symmetrically about zero. Generalises the two-line
 * "bow the reciprocal pair apart" case to any number of parallel links.
 */
export function fanOffset(index: number, count: number, spread: number): number {
  if (count <= 1) return 0
  return (index - (count - 1) / 2) * spread
}

/** Does the closed segment `a`→`b` touch the rectangle? Liang–Barsky slabs. */
export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const minX = r.x
  const maxX = r.x + r.w
  const minY = r.y
  const maxY = r.y + r.h

  // A degenerate segment is just a point-in-rect test.
  if (dx === 0 && dy === 0) {
    return a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY
  }

  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0 // parallel to this slab: inside or fully outside
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }

  return (
    clip(-dx, a.x - minX) &&
    clip(dx, maxX - a.x) &&
    clip(-dy, a.y - minY) &&
    clip(dy, maxY - a.y)
  )
}

/** Grow a rect on all sides — the padded obstacle a line should stay outside of. */
export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 }
}

/**
 * Bend `points` around any obstacle it passes through, leaving the first and
 * last point exactly where they were — those are the anchors on the boxes the
 * line actually connects, and moving them would detach the arrowhead.
 *
 * The obstacles a line legitimately touches (its own endpoints' boxes) must be
 * excluded by the caller; everything passed in is treated as something to
 * avoid.
 */
export function avoidObstacles(
  points: Point[],
  obstacles: Rect[],
  clearance = CLEARANCE,
): Point[] {
  if (points.length < 2 || !obstacles.length) return points

  const start = points[0]
  const end = points[points.length - 1]
  // An obstacle that swallows one of the anchors can never be escaped: every
  // candidate detour still starts (or ends) inside it, so the router would
  // spend its whole budget spraying waypoints. Anchors legitimately sit just
  // outside their own box, and `SCHEMA.stub` pushes them further, so this is
  // the routine case rather than a pathological one.
  const padded = obstacles
    .map((o) => inflate(o, clearance))
    .filter((r) => !contains(r, start) && !contains(r, end))
  if (!padded.length) return points

  let current = points

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (current.length - 2 >= MAX_WAYPOINTS) break

    const next: Point[] = [current[0]]
    let bent = false

    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i]
      const b = current[i + 1]
      const blocker = worstBlocker(a, b, padded)

      if (blocker && next.length - 1 < MAX_WAYPOINTS - 1) {
        const detour = detourPair(a, b, blocker, padded)
        if (detour) {
          next.push(detour[0], detour[1])
          bent = true
        }
      }
      next.push(b)
    }

    // Bail before swapping, so an unbent pass hands back the caller's own
    // array rather than a fresh copy — this runs per edge per frame.
    if (!bent) break
    current = next
  }

  return current
}

/**
 * The obstacle to route around first: of everything this segment cuts, the one
 * whose centre sits nearest the segment. Dealing with the most central blocker
 * first tends to clear the incidental ones as a side effect.
 */
function worstBlocker(a: Point, b: Point, padded: Rect[]): Rect | null {
  let best: Rect | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const r of padded) {
    if (!segmentIntersectsRect(a, b, r)) continue
    const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    const foot = projectOnto(a, b, centre)
    const d = Math.hypot(centre.x - foot.x, centre.y - foot.y)
    if (d < bestDistance) {
      bestDistance = d
      best = r
    }
  }
  return best
}

/**
 * *Two* waypoints that steer the segment clear of `blocker`, both at the same
 * sideways offset and straddling the point of closest approach.
 *
 * A pair rather than a single point, because of how `toPath` renders these:
 * interior points become quadratic *control* points, and a lone control point
 * at offset `d` draws a curve that only deviates by about `0.6 d` — enough to
 * satisfy a polyline test while the drawn stroke still cuts the corner of the
 * box. With two points at the same offset, `toPath` emits a curve that passes
 * exactly through their midpoint, so the clearance that was computed is the
 * clearance that gets drawn.
 *
 * Both sides are tried and scored: when a line runs through a box's middle the
 * two detours are geometrically equivalent, and only their knock-on effects —
 * does this side hit something else, and how far out of the way is it —
 * separate them.
 */
function detourPair(
  a: Point,
  b: Point,
  blocker: Rect,
  padded: Rect[],
): [Point, Point] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return null

  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  const centre = { x: blocker.x + blocker.w / 2, y: blocker.y + blocker.h / 2 }
  // Held off the very ends of the segment: when a blocker's centre projects
  // outside the span, an unclamped foot collapses onto an anchor and the pair
  // degenerates into a kink at the arrowhead.
  const foot = projectOnto(a, b, centre, 0.15, 0.85)

  // Reach along the normal clears the box's corner; reach along the segment is
  // how far apart the pair must sit to bracket it.
  const acrossReach = Math.abs(nx) * (blocker.w / 2) + Math.abs(ny) * (blocker.h / 2)
  const alongReach = Math.abs(ux) * (blocker.w / 2) + Math.abs(uy) * (blocker.h / 2)
  const offset = acrossReach + 2
  const span = Math.min(alongReach * 0.6, length * 0.3)

  let best: [Point, Point] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const side of [1, -1]) {
    const first = {
      x: foot.x - ux * span + nx * offset * side,
      y: foot.y - uy * span + ny * offset * side,
    }
    const second = {
      x: foot.x + ux * span + nx * offset * side,
      y: foot.y + uy * span + ny * offset * side,
    }
    const hits =
      countBlocked(a, first, padded) +
      countBlocked(first, second, padded) +
      countBlocked(second, b, padded)
    const detourLength =
      Math.hypot(first.x - a.x, first.y - a.y) +
      Math.hypot(second.x - first.x, second.y - first.y) +
      Math.hypot(b.x - second.x, b.y - second.y)
    // Clearing obstacles dominates; path length only breaks ties.
    const score = hits * 10000 + detourLength
    if (score < bestScore) {
      bestScore = score
      best = [first, second]
    }
  }
  return best
}

function countBlocked(a: Point, b: Point, padded: Rect[]): number {
  let n = 0
  for (const r of padded) if (segmentIntersectsRect(a, b, r)) n++
  return n
}

/** Closest point to `p` on the segment `a`→`b`, optionally held off the ends. */
function projectOnto(a: Point, b: Point, p: Point, low = 0, high = 1): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-9) return a
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared
  const clamped = Math.min(high, Math.max(low, t))
  return { x: a.x + dx * clamped, y: a.y + dy * clamped }
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/**
 * Push the interior points of a polyline sideways, so two lines between the
 * same pair of boxes separate instead of overlapping. Endpoints are fixed.
 * When there are no interior points, a midpoint is created to bow through.
 */
export function bowPolyline(points: Point[], amount: number): Point[] {
  if (!amount || points.length < 2) return points
  const a = points[0]
  const b = points[points.length - 1]
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const nx = -(b.y - a.y) / length
  const ny = (b.x - a.x) / length

  if (points.length === 2) {
    return [a, { x: (a.x + b.x) / 2 + nx * amount, y: (a.y + b.y) / 2 + ny * amount }, b]
  }
  return points.map((p, i) =>
    i === 0 || i === points.length - 1 ? p : { x: p.x + nx * amount, y: p.y + ny * amount },
  )
}

/* ------------------------------------------------------------------- paths */

/**
 * Quadratic smoothing through midpoints, so a polyline reads as a curve.
 *
 * Interior points act as *control* points, not points on the curve — the
 * stroke passes exactly through the midpoint between each consecutive pair.
 * `detourPair` exists because of this: it is what makes a computed clearance
 * and a drawn clearance the same number.
 */
export function toPath(points: Point[]): string {
  if (points.length < 2) return ''
  const p = (q: Point) => `${round(q.x)} ${round(q.y)}`

  let d = `M ${p(points[0])}`
  for (let i = 1; i < points.length - 1; i++) {
    const mid = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    }
    d += ` Q ${p(points[i])} ${p(mid)}`
  }
  d += ` L ${p(points[points.length - 1])}`
  return d
}

/**
 * The curve `toPath` actually draws, as points — the oracle the routing tests
 * check against. Sampling the rendered stroke rather than the input polyline
 * is the difference between "the waypoints avoid the box" and "the line the
 * user sees avoids the box", which are not the same claim.
 */
export function samplePath(points: Point[], perSegment = 24): Point[] {
  if (points.length < 2) return points.slice()
  const out: Point[] = [points[0]]
  let from = points[0]

  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i]
    const to = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    }
    for (let step = 1; step <= perSegment; step++) {
      const t = step / perSegment
      const m = (1 - t) * (1 - t)
      const n = 2 * t * (1 - t)
      const o = t * t
      out.push({
        x: m * from.x + n * control.x + o * to.x,
        y: m * from.y + n * control.y + o * to.y,
      })
    }
    from = to
  }
  out.push(points[points.length - 1])
  return out
}

export function round(n: number): number {
  return Math.round(n * 10) / 10
}
