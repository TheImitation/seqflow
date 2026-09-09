import { describe, expect, it } from 'vitest'
import {
  advanceAlpha,
  ALPHA_MIN,
  energy,
  SETTLE_ITERATIONS,
  readPositions,
  resolveCollisions,
  seedNodes,
  SIM,
  simulationStep,
  type SimLink,
  type SimNode,
} from './forceLayout'

function node(id: string, x: number, y: number, pinned = false): SimNode {
  return { id, x, y, vx: 0, vy: 0, w: 184, h: 68, pinned }
}

const centre = { x: 400, y: 300 }

/** Run the cooling schedule to a standstill, or give up after `cap` steps. */
function settle(nodes: SimNode[], links: SimLink[], cap = 600): number {
  let alpha = 0.9
  let steps = 0
  while (alpha > 0 && steps < cap) {
    simulationStep(nodes, links, alpha, centre)
    alpha = advanceAlpha(alpha)
    steps++
  }
  return steps
}

describe('seedNodes', () => {
  it('converts top-left layout positions into box centres', () => {
    const nodes = seedNodes([{ id: 'a', w: 184, h: 68 }], new Map([['a', { x: 10, y: 20 }]]))
    expect(nodes[0].x).toBe(10 + 92)
    expect(nodes[0].y).toBe(20 + 34)
  })

  it('marks a node pinned when a pin overrides its seed', () => {
    const nodes = seedNodes(
      [
        { id: 'a', w: 184, h: 68 },
        { id: 'b', w: 184, h: 68 },
      ],
      new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 0, y: 0 }],
      ]),
      new Map([['b', { x: 500, y: 500 }]]),
    )
    expect(nodes[0].pinned).toBe(false)
    expect(nodes[1].pinned).toBe(true)
    expect(nodes[1].x).toBe(500 + 92)
  })

  it('spreads nodes it has no position for, so they have a direction to repel along', () => {
    const nodes = seedNodes(
      [
        { id: 'a', w: 10, h: 10 },
        { id: 'b', w: 10, h: 10 },
      ],
      new Map(),
    )
    expect(nodes[0].x).not.toBe(nodes[1].x)
  })
})

describe('readPositions', () => {
  it('round-trips seedNodes, including boxes of differing height', () => {
    const boxes = [
      { id: 'a', w: 220, h: 90 },
      { id: 'b', w: 220, h: 250 },
      { id: 'c', w: 184, h: 68 },
    ]
    const seed = new Map([
      ['a', { x: 10, y: 20 }],
      ['b', { x: 300, y: 400 }],
      ['c', { x: 55, y: 5 }],
    ])
    expect(readPositions(seedNodes(boxes, seed))).toEqual(seed)
  })
})

describe('advanceAlpha', () => {
  it('decays toward zero and snaps shut below the minimum', () => {
    expect(advanceAlpha(0.9)).toBeLessThan(0.9)
    expect(advanceAlpha(ALPHA_MIN)).toBe(0)
  })

  it('reaches zero from a hot start in a bounded number of steps', () => {
    let alpha = 0.9
    let steps = 0
    while (alpha > 0 && steps < 10000) {
      alpha = advanceAlpha(alpha)
      steps++
    }
    expect(alpha).toBe(0)
    expect(steps).toBeLessThan(400)
  })
})

describe('simulationStep', () => {
  it('never moves a pinned node, however hard its neighbours pull', () => {
    const pinned = node('a', 100, 100, true)
    const free = node('b', 900, 700)
    settle([pinned, free], [{ source: 'a', target: 'b', weight: 20 }])
    expect(pinned.x).toBe(100)
    expect(pinned.y).toBe(100)
    expect(pinned.vx).toBe(0)
  })

  it('pulls a linked pair together until their boxes are about one gap apart', () => {
    const a = node('a', 100, 300)
    const b = node('b', 1400, 300)
    settle([a, b], [{ source: 'a', target: 'b', weight: 1 }])
    const gap = Math.abs(b.x - a.x) - 184
    // Springs settle against repulsion and collision, so this is a band, not
    // an equality — but it must be in the same postcode as linkGap.
    expect(gap).toBeGreaterThan(SIM.collidePadding)
    expect(gap).toBeLessThan(SIM.linkGap * 3)
  })

  it('pushes unlinked nodes apart instead of leaving them stacked', () => {
    const a = node('a', 400, 300)
    const b = node('b', 404, 302)
    settle([a, b], [])
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(184)
  })

  it('comes to rest — the graph stops moving once alpha runs out', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id, i) => node(id, 200 + i * 40, 250 + i * 15))
    const links: SimLink[] = [
      { source: 'a', target: 'b', weight: 1 },
      { source: 'b', target: 'c', weight: 1 },
      { source: 'c', target: 'd', weight: 1 },
      { source: 'd', target: 'e', weight: 1 },
    ]
    settle(nodes, links)
    expect(energy(nodes)).toBeLessThan(1)
  })

  it('keeps every coordinate finite, even from a fully coincident start', () => {
    const nodes = ['a', 'b', 'c'].map((id) => node(id, 300, 300))
    settle(nodes, [
      { source: 'a', target: 'b', weight: 1 },
      { source: 'b', target: 'c', weight: 1 },
      { source: 'c', target: 'a', weight: 1 },
    ])
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })

  it('replays identically from identical input', () => {
    const build = () => ['a', 'b', 'c'].map((id) => node(id, 300, 300))
    const links: SimLink[] = [{ source: 'a', target: 'b', weight: 3 }]
    const first = build()
    const second = build()
    settle(first, links)
    settle(second, links)
    expect(first.map((n) => [n.x, n.y])).toEqual(second.map((n) => [n.x, n.y]))
  })

  it('drags a detached node back toward the centre rather than letting it drift', () => {
    const stray = node('a', 5000, 4000)
    settle([stray], [])
    expect(Math.hypot(stray.x - centre.x, stray.y - centre.y)).toBeLessThan(
      Math.hypot(5000 - centre.x, 4000 - centre.y),
    )
  })

  it('ignores a link whose endpoints are not in the node set', () => {
    const a = node('a', 100, 100)
    expect(() => settle([a], [{ source: 'a', target: 'ghost', weight: 1 }])).not.toThrow()
  })

  it('does nothing once alpha has reached zero', () => {
    const a = node('a', 100, 100)
    const b = node('b', 120, 100)
    simulationStep([a, b], [], 0, centre)
    expect(a.x).toBe(100)
    expect(b.x).toBe(120)
  })
})

describe('resolveCollisions', () => {
  it('separates two overlapping boxes by at least the padding', () => {
    const a = node('a', 300, 300)
    const b = node('b', 340, 305)
    resolveCollisions([a, b], 16, 8)
    const clearX = Math.abs(b.x - a.x) - 184
    const clearY = Math.abs(b.y - a.y) - 68
    expect(Math.max(clearX, clearY)).toBeGreaterThanOrEqual(15.9)
  })

  it('moves only the free node when its partner is pinned', () => {
    const pinned = node('a', 300, 300, true)
    const free = node('b', 320, 300)
    resolveCollisions([pinned, free], 16, 4)
    expect([pinned.x, pinned.y]).toEqual([300, 300])
    expect([free.x, free.y]).not.toEqual([320, 300])
  })

  it('leaves two pinned boxes overlapping rather than fighting the user', () => {
    const one = node('a', 300, 300, true)
    const two = node('b', 320, 300, true)
    resolveCollisions([one, two], 16, 4)
    expect(one.x).toBe(300)
    expect(two.x).toBe(320)
  })

  it('separates along the axis of least overlap, keeping a row a row', () => {
    // Deeply overlapped vertically, barely overlapped horizontally.
    const a = node('a', 300, 300)
    const b = node('b', 470, 302)
    resolveCollisions([a, b], 16, 4)
    expect(Math.abs(b.y - a.y)).toBeLessThan(20)
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(170)
  })

  it('clears a whole cluster, not just a pair', () => {
    // Every other test here uses exactly two boxes, which is what made an
    // iteration count of 2 look sufficient.
    const cluster = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, 400, 300))
    resolveCollisions(cluster, 16, SETTLE_ITERATIONS)
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        const overlapX = 184 + 16 - Math.abs(cluster[j].x - cluster[i].x)
        const overlapY = 68 + 16 - Math.abs(cluster[j].y - cluster[i].y)
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('leaves already-clear boxes untouched', () => {
    const a = node('a', 0, 0)
    const b = node('b', 900, 900)
    resolveCollisions([a, b], 16, 4)
    expect([a.x, a.y, b.x, b.y]).toEqual([0, 0, 900, 900])
  })
})
