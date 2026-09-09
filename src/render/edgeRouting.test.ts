import { describe, expect, it } from 'vitest'
import {
  avoidObstacles,
  bowPolyline,
  contains,
  fanOffset,
  inflate,
  samplePath,
  segmentIntersectsRect,
  toPath,
  type Point,
  type Rect,
} from './edgeRouting'

const box = (x: number, y: number, w = 100, h = 60): Rect => ({ x, y, w, h })

/** Does any segment of the polyline still cut this rect? */
function pathHits(points: Point[], r: Rect): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsRect(points[i], points[i + 1], r)) return true
  }
  return false
}

/**
 * Does the curve `toPath` actually draws enter this rect? The polyline and the
 * drawn stroke are different shapes — interior points are quadratic control
 * points — so this is the assertion that matters for what the user sees.
 */
function drawnHits(points: Point[], r: Rect): boolean {
  return samplePath(points, 48).some((p) => contains(r, p))
}

describe('segmentIntersectsRect', () => {
  it('finds a segment driven straight through the middle', () => {
    expect(segmentIntersectsRect({ x: -50, y: 30 }, { x: 150, y: 30 }, box(0, 0))).toBe(true)
  })

  it('rejects a segment that passes clear above', () => {
    expect(segmentIntersectsRect({ x: -50, y: -40 }, { x: 150, y: -40 }, box(0, 0))).toBe(false)
  })

  it('rejects a segment aimed at the rect but stopping short', () => {
    expect(segmentIntersectsRect({ x: -50, y: 30 }, { x: -10, y: 30 }, box(0, 0))).toBe(false)
  })

  it('counts a segment that merely clips a corner', () => {
    expect(segmentIntersectsRect({ x: -10, y: 10 }, { x: 10, y: -10 }, box(0, 0))).toBe(true)
  })

  it('counts a segment that starts inside', () => {
    expect(segmentIntersectsRect({ x: 50, y: 30 }, { x: 500, y: 300 }, box(0, 0))).toBe(true)
  })

  it('counts a segment lying entirely inside', () => {
    expect(segmentIntersectsRect({ x: 20, y: 20 }, { x: 40, y: 40 }, box(0, 0))).toBe(true)
  })

  it('treats a degenerate segment as a point test', () => {
    expect(segmentIntersectsRect({ x: 50, y: 30 }, { x: 50, y: 30 }, box(0, 0))).toBe(true)
    expect(segmentIntersectsRect({ x: 500, y: 30 }, { x: 500, y: 30 }, box(0, 0))).toBe(false)
  })

  it('handles a vertical segment, where the x slab is parallel', () => {
    expect(segmentIntersectsRect({ x: 50, y: -100 }, { x: 50, y: 100 }, box(0, 0))).toBe(true)
    expect(segmentIntersectsRect({ x: 500, y: -100 }, { x: 500, y: 100 }, box(0, 0))).toBe(false)
  })
})

describe('inflate', () => {
  it('grows a rect on every side', () => {
    expect(inflate(box(10, 10, 100, 60), 5)).toEqual({ x: 5, y: 5, w: 110, h: 70 })
  })
})

describe('fanOffset', () => {
  it('leaves a lone line on the straight path', () => {
    expect(fanOffset(0, 1, 22)).toBe(0)
  })

  it('splits a reciprocal pair symmetrically about zero', () => {
    expect(fanOffset(0, 2, 22)).toBe(-11)
    expect(fanOffset(1, 2, 22)).toBe(11)
  })

  it('keeps the middle line of an odd fan straight', () => {
    expect(fanOffset(1, 3, 22)).toBe(0)
    expect(fanOffset(0, 3, 22)).toBe(-22)
    expect(fanOffset(2, 3, 22)).toBe(22)
  })

  it('sums to zero across a fan, so the bundle stays centred', () => {
    const total = [0, 1, 2, 3].reduce((sum, i) => sum + fanOffset(i, 4, 18), 0)
    expect(total).toBeCloseTo(0)
  })
})

describe('avoidObstacles', () => {
  it('bends a line around a box sitting in its way', () => {
    const obstacle = box(200, 170, 100, 60)
    const straight = [
      { x: 0, y: 200 },
      { x: 500, y: 200 },
    ]
    expect(pathHits(straight, obstacle)).toBe(true)

    const routed = avoidObstacles(straight, [obstacle])
    expect(routed.length).toBeGreaterThan(2)
    expect(pathHits(routed, obstacle)).toBe(false)
  })

  it('leaves the endpoints exactly where they were, so arrowheads stay attached', () => {
    const straight = [
      { x: 0, y: 200 },
      { x: 500, y: 200 },
    ]
    const routed = avoidObstacles(straight, [box(200, 170)])
    expect(routed[0]).toEqual(straight[0])
    expect(routed.at(-1)).toEqual(straight[1])
  })

  it('leaves a path with nothing in its way untouched', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
    ]
    expect(avoidObstacles(straight, [box(200, 400)])).toBe(straight)
  })

  it('returns the input unchanged when there are no obstacles at all', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]
    expect(avoidObstacles(straight, [])).toBe(straight)
  })

  it('clears a corridor of several boxes', () => {
    const obstacles = [box(150, 170), box(300, 170), box(450, 170)]
    const routed = avoidObstacles(
      [
        { x: 0, y: 200 },
        { x: 700, y: 200 },
      ],
      obstacles,
    )
    // Not every arrangement is fully solvable inside the pass cap, but the
    // routed path must be a strict improvement on the straight one.
    const before = obstacles.filter((o) =>
      pathHits(
        [
          { x: 0, y: 200 },
          { x: 700, y: 200 },
        ],
        o,
      ),
    ).length
    const after = obstacles.filter((o) => pathHits(routed, o)).length
    expect(after).toBeLessThan(before)
  })

  it('keeps the *drawn* curve out of the box, not just the polyline', () => {
    // The regression this guards: a single waypoint at offset d renders as a
    // curve deviating only ~0.6 d, so the polyline cleared the box while the
    // stroke still cut its corner.
    const obstacle = box(200, 170, 100, 60)
    const routed = avoidObstacles(
      [
        { x: 0, y: 200 },
        { x: 500, y: 200 },
      ],
      [obstacle],
    )
    expect(drawnHits(routed, obstacle)).toBe(false)
  })

  it('emits a path string a renderer can consume', () => {
    const routed = avoidObstacles(
      [
        { x: 0, y: 200 },
        { x: 500, y: 200 },
      ],
      [box(200, 170)],
    )
    const d = toPath(routed)
    expect(d.startsWith('M ')).toBe(true)
    expect(d).toContain('Q')
    expect(d).not.toContain('NaN')
  })

  it('gives up rather than spraying waypoints when a box swallows an endpoint', () => {
    // A line's own anchors sit just outside their box, and the schema view
    // pushes them further out with a stub — so an obstacle containing an
    // endpoint is routine, and inescapable. It must be ignored, not fought.
    const swallowing = box(-20, 180, 100, 60)
    const straight = [
      { x: 0, y: 200 },
      { x: 500, y: 200 },
    ]
    expect(contains(inflate(swallowing, 9), straight[0])).toBe(true)
    expect(avoidObstacles(straight, [swallowing])).toBe(straight)
  })

  it('still routes around other boxes when one of them holds an endpoint', () => {
    const swallowing = box(-20, 180, 100, 60)
    const inTheWay = box(250, 170, 100, 60)
    const routed = avoidObstacles(
      [
        { x: 0, y: 200 },
        { x: 600, y: 200 },
      ],
      [swallowing, inTheWay],
    )
    expect(drawnHits(routed, inTheWay)).toBe(false)
  })

  it('does not kink at the arrowhead when a blocker sits off the end of the span', () => {
    // The blocker's centre projects outside the segment, which an unclamped
    // projection would collapse onto the anchor itself.
    const obstacle = box(460, 170, 100, 60)
    const routed = avoidObstacles(
      [
        { x: 0, y: 200 },
        { x: 500, y: 200 },
      ],
      [obstacle],
    )
    for (const p of routed) expect(Number.isFinite(p.x)).toBe(true)
    // No waypoint may land on top of an anchor.
    for (const p of routed.slice(1, -1)) {
      expect(Math.hypot(p.x - 500, p.y - 200)).toBeGreaterThan(1)
    }
  })

  it('keeps its clearance, not just its non-intersection', () => {
    const obstacle = box(200, 170, 100, 60)
    const routed = avoidObstacles(
      [
        { x: 0, y: 200 },
        { x: 500, y: 200 },
      ],
      [obstacle],
      14,
    )
    // The padded obstacle is what the router promised to stay outside of.
    expect(pathHits(routed, inflate(obstacle, 8))).toBe(false)
  })

  it('terminates on a pathological cluster instead of inserting points forever', () => {
    const obstacles = Array.from({ length: 12 }, (_, i) => box(50 + i * 30, 180, 40, 40))
    const routed = avoidObstacles(
      [
        { x: 0, y: 200 },
        { x: 600, y: 200 },
      ],
      obstacles,
    )
    expect(routed.length).toBeLessThanOrEqual(14)
    for (const p of routed) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const run = () =>
      avoidObstacles(
        [
          { x: 0, y: 200 },
          { x: 500, y: 200 },
        ],
        [box(200, 170), box(350, 150)],
      )
    expect(run()).toEqual(run())
  })

  it('routes a diagonal line, not just axis-aligned ones', () => {
    const obstacle = box(200, 200, 100, 100)
    const diagonal = [
      { x: 0, y: 0 },
      { x: 500, y: 500 },
    ]
    expect(pathHits(diagonal, obstacle)).toBe(true)
    expect(pathHits(avoidObstacles(diagonal, [obstacle]), obstacle)).toBe(false)
  })
})

describe('bowPolyline', () => {
  it('creates a midpoint to bow through when the line is straight', () => {
    const bowed = bowPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
    )
    expect(bowed).toHaveLength(3)
    expect(bowed[1].x).toBe(50)
    expect(Math.abs(bowed[1].y)).toBe(10)
  })

  it('bows an existing pair of lines to opposite sides', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const up = bowPolyline(straight, 10)
    const down = bowPolyline(straight, -10)
    expect(up[1].y).toBe(-down[1].y)
  })

  it('shifts interior points but never the endpoints', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]
    const bowed = bowPolyline(points, 10)
    expect(bowed[0]).toEqual(points[0])
    expect(bowed[2]).toEqual(points[2])
    expect(bowed[1].y).not.toBe(0)
  })

  it('is a no-op at zero amount', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    expect(bowPolyline(points, 0)).toBe(points)
  })
})
