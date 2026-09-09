import { describe, expect, it } from 'vitest'
import type { DatabaseTable } from '../dsl/ast'
import type { SchemaGraph } from '../dsl/schema'
import {
  layoutSchema,
  nodeHeight,
  rowCenterY,
  SCHEMA,
  schemaBoxes,
  schemaSeedPositions,
} from './schemaLayout'

function table(name: string, columnNames: string[] = []): DatabaseTable {
  return {
    name,
    columns: columnNames.map((n) => ({ name: n, type: 'string', required: true })),
    foreignKeys: [],
    indexes: [],
  }
}

describe('layoutSchema', () => {
  it('sizes a box by its column count', () => {
    const graph: SchemaGraph = {
      nodes: [table('Small', ['id']), table('Big', ['id', 'a', 'b', 'c', 'd', 'e'])],
      edges: [],
    }
    const layout = layoutSchema(graph)
    const small = layout.nodeById.get('Small')!
    const big = layout.nodeById.get('Big')!
    expect(small.h).toBe(SCHEMA.headerH + SCHEMA.rowH * 1)
    expect(big.h).toBe(SCHEMA.headerH + SCHEMA.rowH * 6)
  })

  it('anchors a row to the right column, and falls back to centre for an unknown one', () => {
    const graph: SchemaGraph = { nodes: [table('T', ['id', 'name', 'campaignId'])], edges: [] }
    const layout = layoutSchema(graph)
    const t = layout.nodeById.get('T')!
    expect(rowCenterY(t, 'id')).toBe(t.y + SCHEMA.headerH + SCHEMA.rowH * 0.5)
    expect(rowCenterY(t, 'campaignId')).toBe(t.y + SCHEMA.headerH + SCHEMA.rowH * 2.5)
    expect(rowCenterY(t, 'nope')).toBeUndefined()
  })

  it('keeps two foreign keys between the same table pair as two distinct edges', () => {
    // The exact multigraph bug: a plain (non-multigraph) dagre graph would
    // hash both edges to (Matches, Teams) and silently drop one.
    const graph: SchemaGraph = {
      nodes: [table('Matches', ['id', 'homeTeamId', 'awayTeamId']), table('Teams', ['id'])],
      edges: [
        { id: 'Matches.homeTeamId->Teams.id', from: 'Matches', to: 'Teams', column: 'homeTeamId', refColumn: 'id' },
        { id: 'Matches.awayTeamId->Teams.id', from: 'Matches', to: 'Teams', column: 'awayTeamId', refColumn: 'id' },
      ],
    }
    const layout = layoutSchema(graph)
    expect(layout.edges).toHaveLength(2)
    const [home, away] = layout.edges
    expect(home.path).not.toBe('')
    expect(away.path).not.toBe('')
    // Both land on the same Teams.id row (same headY) but exit Matches from
    // different rows (homeTeamId vs awayTeamId), so the two paths differ —
    // a plain (non-multigraph) graph would have collapsed them into one.
    expect(home.headY).toBe(away.headY)
    expect(home.path).not.toBe(away.path)
  })

  it('does not crash on a table that references itself', () => {
    const graph: SchemaGraph = {
      nodes: [table('Categories', ['id', 'parentId'])],
      edges: [{ id: 'Categories.parentId->Categories.id', from: 'Categories', to: 'Categories', column: 'parentId', refColumn: 'id' }],
    }
    expect(() => layoutSchema(graph)).not.toThrow()
    const layout = layoutSchema(graph)
    expect(layout.edges).toHaveLength(1)
  })

  it('skips a foreign key whose table is missing from the graph', () => {
    const graph: SchemaGraph = {
      nodes: [table('Only')],
      edges: [{ id: 'x', from: 'Only', to: 'Nowhere', column: 'a', refColumn: 'b' }],
    }
    const layout = layoutSchema(graph)
    expect(layout.edges).toEqual([])
  })
})

describe('schemaBoxes', () => {
  it('reports each table at the height its column count implies', () => {
    const graph: SchemaGraph = {
      nodes: [table('Small', ['id']), table('Big', ['id', 'a', 'b', 'c', 'd'])],
      edges: [],
    }
    const boxes = schemaBoxes(graph)
    expect(boxes.map((b) => b.id)).toEqual(['Small', 'Big'])
    expect(boxes[0].h).toBe(nodeHeight(graph.nodes[0]))
    expect(boxes[1].h).toBeGreaterThan(boxes[0].h)
    expect(boxes.every((b) => b.w === SCHEMA.nodeW)).toBe(true)
  })
})

describe('schemaSeedPositions', () => {
  it('gives a top-left position for every table', () => {
    const graph: SchemaGraph = {
      nodes: [table('users', ['id']), table('orders', ['id', 'user_id'])],
      edges: [
        { id: 'fk1', from: 'orders', to: 'users', column: 'user_id', refColumn: 'id' },
      ],
    }
    const seed = schemaSeedPositions(graph, 'TB')
    expect([...seed.keys()].sort()).toEqual(['orders', 'users'])
  })

  it('agrees with what the full layout places unoverridden tables at', () => {
    const graph: SchemaGraph = {
      nodes: [table('users', ['id']), table('orders', ['id', 'user_id'])],
      edges: [
        { id: 'fk1', from: 'orders', to: 'users', column: 'user_id', refColumn: 'id' },
      ],
    }
    const seed = schemaSeedPositions(graph, 'TB')
    const layout = layoutSchema(graph, 'TB')
    for (const n of layout.nodes) {
      expect(seed.get(n.id)).toEqual({ x: n.x, y: n.y })
    }
  })
})

describe('layoutSchema with position overrides', () => {
  const graph: SchemaGraph = {
    nodes: [
      table('users', ['id', 'email']),
      table('orders', ['id', 'user_id']),
      table('items', ['id', 'order_id']),
    ],
    edges: [
      { id: 'fk1', from: 'orders', to: 'users', column: 'user_id', refColumn: 'id' },
      { id: 'fk2', from: 'items', to: 'orders', column: 'order_id', refColumn: 'id' },
    ],
  }

  it('puts a table exactly where it was told to', () => {
    const layout = layoutSchema(graph, 'TB', {
      positions: new Map([['orders', { x: 700, y: 500 }]]),
    })
    expect(layout.nodeById.get('orders')).toMatchObject({ x: 700, y: 500 })
  })

  it('grows the extent to cover a table moved past the ranked bounds', () => {
    const layout = layoutSchema(graph, 'TB', {
      positions: new Map([['items', { x: 1500, y: 1200 }]]),
    })
    expect(layout.width).toBeGreaterThanOrEqual(1500 + SCHEMA.nodeW)
    expect(layout.height).toBeGreaterThanOrEqual(1200)
  })

  it('marks only the tables it was told are pinned', () => {
    const layout = layoutSchema(graph, 'TB', {
      positions: new Map([['users', { x: 40, y: 40 }]]),
      pinned: new Set(['users']),
    })
    expect(layout.nodeById.get('users')?.pinned).toBe(true)
    expect(layout.nodeById.get('orders')?.pinned).toBe(false)
  })

  it('keeps foreign keys anchored to their own rows after a move', () => {
    const positions = new Map([
      ['users', { x: 40, y: 40 }],
      ['orders', { x: 600, y: 300 }],
      ['items', { x: 40, y: 600 }],
    ])
    const layout = layoutSchema(graph, 'LR', { positions })
    const orders = layout.nodeById.get('orders')!
    const fk = layout.edges.find((e) => e.edge.id === 'fk2')!
    // fk2 lands on orders.id — the first row — not the box centre.
    expect(fk.headY).toBeCloseTo(rowCenterY(orders, 'id')!, 1)
  })

  it('emits usable geometry for every edge under a complete override set', () => {
    const positions = new Map([
      ['users', { x: 40, y: 40 }],
      ['orders', { x: 600, y: 300 }],
      ['items', { x: 40, y: 600 }],
    ])
    const layout = layoutSchema(graph, 'TB', { positions, avoidNodes: true })
    expect(layout.edges).toHaveLength(2)
    for (const e of layout.edges) {
      expect(e.path).not.toContain('NaN')
      expect(Number.isFinite(e.headAngle)).toBe(true)
    }
  })

  it('produces the same output as before when routing is switched off', () => {
    const plain = layoutSchema(graph, 'TB')
    const explicit = layoutSchema(graph, 'TB', { avoidNodes: false })
    expect(explicit.edges.map((e) => e.path)).toEqual(plain.edges.map((e) => e.path))
  })
})
