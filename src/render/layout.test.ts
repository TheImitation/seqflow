import { describe, expect, it } from 'vitest'
import type { ArchGraph } from '../dsl/architecture'
import { edgeId } from '../dsl/architecture'
import type { ArchEdge, ArchNode } from '../dsl/ast'
import { contains, type Rect } from './edgeRouting'
import { ARCH, archSeedPositions, layoutArchitecture } from './layout'

function node(id: string): ArchNode {
  return { participantId: id, kind: 'service' }
}

function edge(from: string, to: string, count = 1, sync = true): ArchEdge {
  return {
    from,
    to,
    interactionCount: count,
    styles: new Set([sync ? 'sync' : 'async'] as const),
    messageLabels: [`${from}->${to}`],
    hasUnhappyPath: false,
    declaredFailures: 0,
  }
}

function graph(nodes: string[], edges: ArchEdge[]): ArchGraph {
  return {
    nodes: nodes.map(node),
    edges,
    edgeMessages: new Map(edges.map((e) => [edgeId(e.from, e.to), ['m0']])),
  }
}

const label = (id: string) => id
const rectOf = (n: { x: number; y: number; w: number; h: number }): Rect => ({
  x: n.x,
  y: n.y,
  w: n.w,
  h: n.h,
})

describe('layoutArchitecture', () => {
  it('places one box per node at the declared size', () => {
    const layout = layoutArchitecture(graph(['A', 'B'], [edge('A', 'B')]), label)
    expect(layout.nodes).toHaveLength(2)
    for (const n of layout.nodes) {
      expect(n.w).toBe(ARCH.nodeW)
      expect(n.h).toBe(ARCH.nodeH)
    }
    expect(layout.nodeById.get('A')?.label).toBe('A')
  })

  it('keeps every box inside the reported extent', () => {
    const layout = layoutArchitecture(
      graph(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C')]),
      label,
    )
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.x + n.w).toBeLessThanOrEqual(layout.width)
      expect(n.y + n.h).toBeLessThanOrEqual(layout.height)
    }
  })

  it('holds a minimum canvas size for a nearly empty graph', () => {
    const layout = layoutArchitecture(graph(['A'], []), label)
    expect(layout.width).toBeGreaterThanOrEqual(360)
    expect(layout.height).toBeGreaterThanOrEqual(240)
  })

  it('returns an empty layout for an empty graph', () => {
    const layout = layoutArchitecture(graph([], []), label)
    expect(layout.nodes).toHaveLength(0)
    expect(layout.edges).toHaveLength(0)
  })

  it('drops an edge whose endpoint is not in the node set', () => {
    const layout = layoutArchitecture(graph(['A'], [edge('A', 'ghost')]), label)
    expect(layout.edges).toHaveLength(0)
    expect(layout.nodes).toHaveLength(1)
  })

  it('dashes an edge that is not a sync call', () => {
    const layout = layoutArchitecture(
      graph(['A', 'B'], [edge('A', 'B', 1, false)]),
      label,
    )
    expect(layout.edges[0].dashed).toBe(true)
  })

  it('anchors the arrowhead on the target box and gives it a finite angle', () => {
    const layout = layoutArchitecture(graph(['A', 'B'], [edge('A', 'B')]), label)
    const e = layout.edges[0]
    const to = layout.nodeById.get('B')!
    expect(Number.isFinite(e.headAngle)).toBe(true)
    // On the border, within the 2px slack `borderPoint` allows.
    expect(contains({ x: to.x - 3, y: to.y - 3, w: to.w + 6, h: to.h + 6 }, {
      x: e.headX,
      y: e.headY,
    })).toBe(true)
  })

  it('separates a reciprocal pair instead of stacking one line on the other', () => {
    const layout = layoutArchitecture(
      graph(['A', 'B'], [edge('A', 'B'), edge('B', 'A')]),
      label,
    )
    const [first, second] = layout.edges
    expect(first.path).not.toBe(second.path)
    // The badges must not land on top of each other either.
    expect(Math.hypot(first.labelX - second.labelX, first.labelY - second.labelY)).toBeGreaterThan(
      10,
    )
  })

  it('puts the badge on the line it labels', () => {
    const layout = layoutArchitecture(graph(['A', 'B'], [edge('A', 'B')]), label)
    const e = layout.edges[0]
    const nearest = Math.min(
      ...drawnPoints(e.path).map((p) => Math.hypot(p.x - e.labelX, p.y - e.labelY)),
    )
    expect(nearest).toBeLessThan(2)
  })

  it('is deterministic for the same graph', () => {
    const g = graph(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C'), edge('A', 'C')])
    const first = layoutArchitecture(g, label)
    const second = layoutArchitecture(g, label)
    expect(first.nodes.map((n) => [n.x, n.y])).toEqual(second.nodes.map((n) => [n.x, n.y]))
    expect(first.edges.map((e) => e.path)).toEqual(second.edges.map((e) => e.path))
  })

  it('gives a reciprocal pair the same lanes however the edges are ordered', () => {
    // Edges arrive in message order, so adding a step above a pair must not
    // make the two halves swap sides.
    const forward = layoutArchitecture(
      graph(['A', 'B'], [edge('A', 'B'), edge('B', 'A')]),
      label,
    )
    const reversed = layoutArchitecture(
      graph(['A', 'B'], [edge('B', 'A'), edge('A', 'B')]),
      label,
    )
    const pathOf = (l: typeof forward, id: string) => l.edgeById.get(id)!.path
    expect(pathOf(reversed, 'A B')).toBe(pathOf(forward, 'A B'))
    expect(pathOf(reversed, 'B A')).toBe(pathOf(forward, 'B A'))
  })
})

describe('layoutArchitecture with position overrides', () => {
  const g = graph(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C')])

  it('puts a node exactly where it was told to', () => {
    const layout = layoutArchitecture(g, label, 'TB', {
      positions: new Map([['B', { x: 500, y: 400 }]]),
    })
    expect(layout.nodeById.get('B')).toMatchObject({ x: 500, y: 400 })
  })

  it('grows the extent to cover a node moved past the ranked bounds', () => {
    // PNG and SVG export crop to this extent, so a dragged node falling
    // outside it would be silently cut off the image.
    const layout = layoutArchitecture(g, label, 'TB', {
      positions: new Map([['C', { x: 1400, y: 1100 }]]),
    })
    expect(layout.width).toBeGreaterThanOrEqual(1400 + ARCH.nodeW)
    expect(layout.height).toBeGreaterThanOrEqual(1100 + ARCH.nodeH)
  })

  it('marks the nodes it was told are pinned, and only those', () => {
    const layout = layoutArchitecture(g, label, 'TB', {
      positions: new Map([['A', { x: 40, y: 40 }]]),
      pinned: new Set(['A']),
    })
    expect(layout.nodeById.get('A')?.pinned).toBe(true)
    expect(layout.nodeById.get('B')?.pinned).toBe(false)
  })

  it('reports no pins when none were given', () => {
    const layout = layoutArchitecture(g, label)
    expect(layout.nodes.every((n) => !n.pinned)).toBe(true)
  })

  it('honours a complete override set without consulting the ranked layout', () => {
    const positions = new Map([
      ['A', { x: 30, y: 30 }],
      ['B', { x: 30, y: 300 }],
      ['C', { x: 30, y: 570 }],
    ])
    const layout = layoutArchitecture(g, label, 'TB', { positions })
    for (const [id, at] of positions) {
      expect(layout.nodeById.get(id)).toMatchObject(at)
    }
    expect(layout.edges).toHaveLength(2)
    for (const e of layout.edges) expect(e.path).not.toContain('NaN')
  })

  it('produces the same output as before when routing is switched off', () => {
    const plain = layoutArchitecture(g, label, 'TB')
    const explicit = layoutArchitecture(g, label, 'TB', { avoidNodes: false })
    expect(explicit.edges.map((e) => e.path)).toEqual(plain.edges.map((e) => e.path))
  })
})

describe('layoutArchitecture edge routing', () => {
  it('steers a link clear of a box parked between its endpoints', () => {
    // A and C are linked; B is dropped right on the straight line between them.
    const g = graph(['A', 'B', 'C'], [edge('A', 'C')])
    const positions = new Map([
      ['A', { x: 40, y: 300 }],
      ['B', { x: 420, y: 300 }],
      ['C', { x: 800, y: 300 }],
    ])

    const straight = layoutArchitecture(g, label, 'LR', { positions, avoidNodes: false })
    const routed = layoutArchitecture(g, label, 'LR', { positions, avoidNodes: true })
    const obstacle = rectOf(routed.nodeById.get('B')!)

    expect(straight.edges[0].path).not.toBe(routed.edges[0].path)
    // The straight line goes through B; the routed one must not.
    expect(crossesBox(straight.edges[0].path, obstacle)).toBe(true)
    expect(crossesBox(routed.edges[0].path, obstacle)).toBe(false)
  })

  it('leaves a link alone when nothing is in its way', () => {
    const g = graph(['A', 'B', 'C'], [edge('A', 'C')])
    const positions = new Map([
      ['A', { x: 40, y: 300 }],
      ['B', { x: 420, y: 900 }],
      ['C', { x: 800, y: 300 }],
    ])
    const straight = layoutArchitecture(g, label, 'LR', { positions, avoidNodes: false })
    const routed = layoutArchitecture(g, label, 'LR', { positions, avoidNodes: true })
    expect(routed.edges[0].path).toBe(straight.edges[0].path)
  })

  it('never emits a path with a negative coordinate', () => {
    // The viewBox starts at 0,0, so anything negative is cropped away.
    const g = graph(['A', 'B', 'C'], [edge('A', 'C')])
    const positions = new Map([
      ['A', { x: 28, y: 28 }],
      ['B', { x: 240, y: 28 }],
      ['C', { x: 460, y: 28 }],
    ])
    const routed = layoutArchitecture(g, label, 'LR', { positions, avoidNodes: true })
    expect(routed.edges[0].path).not.toContain('-')
  })
})

describe('archSeedPositions', () => {
  it('gives a top-left position for every node', () => {
    const seed = archSeedPositions(graph(['A', 'B'], [edge('A', 'B')]), 'TB')
    expect([...seed.keys()].sort()).toEqual(['A', 'B'])
    for (const at of seed.values()) {
      expect(Number.isFinite(at.x)).toBe(true)
      expect(at.x).toBeGreaterThanOrEqual(0)
    }
  })

  it('lays a chain out differently for the two directions', () => {
    const g = graph(['A', 'B'], [edge('A', 'B')])
    const lr = archSeedPositions(g, 'LR')
    const tb = archSeedPositions(g, 'TB')
    // Left-to-right separates on x; top-to-bottom separates on y.
    expect(Math.abs(lr.get('A')!.x - lr.get('B')!.x)).toBeGreaterThan(
      Math.abs(lr.get('A')!.y - lr.get('B')!.y),
    )
    expect(Math.abs(tb.get('A')!.y - tb.get('B')!.y)).toBeGreaterThan(
      Math.abs(tb.get('A')!.x - tb.get('B')!.x),
    )
  })

  it('agrees with what the full layout places unoverridden nodes at', () => {
    const g = graph(['A', 'B', 'C'], [edge('A', 'B'), edge('B', 'C')])
    const seed = archSeedPositions(g, 'TB')
    const layout = layoutArchitecture(g, label, 'TB')
    for (const n of layout.nodes) {
      expect(seed.get(n.id)).toEqual({ x: n.x, y: n.y })
    }
  })
})

/* ----------------------------------------------------------------- helpers */

/**
 * Sample the stroke an `M`/`Q`/`L` path string actually draws.
 *
 * Pulling the numbers out in pairs would *not* do: `toPath` emits control
 * points interleaved with on-curve midpoints, so a flat point list is a
 * different shape from the rendered curve — which is the exact confusion that
 * let a deflected edge pass a polyline test while still cutting the box.
 */
function drawnPoints(d: string, perCurve = 32): { x: number; y: number }[] {
  const tokens = d.match(/[MQL]|-?\d+(?:\.\d+)?/g) ?? []
  const out: { x: number; y: number }[] = []
  let cursor = { x: 0, y: 0 }
  let i = 0

  while (i < tokens.length) {
    const command = tokens[i++]
    const next = () => Number(tokens[i++])
    if (command === 'M') {
      cursor = { x: next(), y: next() }
      out.push(cursor)
    } else if (command === 'L') {
      const to = { x: next(), y: next() }
      // Straight runs need sampling too, not just their endpoints — a chord
      // that passes clean through a box touches neither end of it.
      for (let step = 1; step <= perCurve; step++) {
        const t = step / perCurve
        out.push({
          x: cursor.x + (to.x - cursor.x) * t,
          y: cursor.y + (to.y - cursor.y) * t,
        })
      }
      cursor = to
    } else if (command === 'Q') {
      const control = { x: next(), y: next() }
      const to = { x: next(), y: next() }
      for (let step = 1; step <= perCurve; step++) {
        const t = step / perCurve
        const a = (1 - t) * (1 - t)
        const b = 2 * t * (1 - t)
        const c = t * t
        out.push({
          x: a * cursor.x + b * control.x + c * to.x,
          y: a * cursor.y + b * control.y + c * to.y,
        })
      }
      cursor = to
    }
  }
  return out
}

/** Does the drawn stroke of this path enter the box? */
function crossesBox(d: string, box: Rect): boolean {
  return drawnPoints(d).some((p) => contains(box, p))
}
