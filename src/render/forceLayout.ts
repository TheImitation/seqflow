/**
 * A small force-directed layout, written here rather than pulled in from
 * `d3-force` because the graphs are tens of nodes, not thousands, and the
 * one thing this needs that `d3-force` does not give for free is *rectangle*
 * awareness: these nodes are 184×68 boxes, not points, so both the repulsion
 * and the collision pass measure from box surfaces instead of centres.
 *
 * Everything here is pure and synchronous — one `simulationStep` is one
 * integration step over a mutable array. The `requestAnimationFrame` plumbing
 * lives in `useGraphLayout`, the same split this repo already uses for
 * `minimapGeometry.ts` / `Minimap.tsx`.
 */

export interface Point {
  x: number
  y: number
}

export interface SimNode {
  id: string
  /** Box *centre*, unlike the top-left `x`/`y` the layouts render with. */
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  /**
   * Held where it is. Forces are still read *from* a pinned node — it pushes
   * and pulls its neighbours — they are just never applied *to* it.
   */
  pinned: boolean
}

export interface SimLink {
  source: string
  target: string
  /** Interaction / foreign-key count. A heavier link pulls harder. */
  weight: number
}

export interface SimConfig {
  /** Clear space a spring settles at, between the two boxes' near edges. */
  linkGap: number
  linkStrength: number
  /** Numerator of the inverse-square repulsion term. */
  repulsion: number
  /** Pull toward the centre, so a detached component cannot drift off-canvas. */
  gravity: number
  /** Fraction of velocity carried into the next step. */
  damping: number
  /** Gap the collision pass guarantees between any two boxes. */
  collidePadding: number
  /** Ceiling on per-step travel, so a reheat cannot fling a node into orbit. */
  maxSpeed: number
}

export const SIM: SimConfig = {
  linkGap: 78,
  linkStrength: 0.42,
  repulsion: 11000,
  gravity: 0.028,
  damping: 0.84,
  collidePadding: 16,
  maxSpeed: 34,
}

/** Cooling schedule. `alpha` scales every force, so it doubles as "is it still moving". */
export const ALPHA_START = 0.9
/**
 * Tuned against how long a reheat is *watchable*, not against convergence:
 * every drop reheats, and at 0.026 the graph kept animating for over three
 * seconds afterwards. This settles in around a second and a half.
 */
export const ALPHA_DECAY = 0.055
export const ALPHA_MIN = 0.006
/** Where alpha jumps to when a node is grabbed, or "re-organise" is pressed. */
export const ALPHA_REHEAT = 0.5

export function advanceAlpha(alpha: number, decay = ALPHA_DECAY): number {
  const next = alpha - alpha * decay
  return next < ALPHA_MIN ? 0 : next
}

/**
 * Build simulation nodes from a deterministic layout's top-left positions.
 * Seeding from dagre rather than at random matters: the graph settles in a
 * handful of frames and never shows the user a scrambled intermediate state.
 */
export function seedNodes(
  boxes: { id: string; w: number; h: number }[],
  seed: Map<string, Point>,
  pins?: Map<string, Point>,
): SimNode[] {
  return boxes.map((b, i) => {
    const at = pins?.get(b.id) ?? seed.get(b.id)
    // A node with no seed at all is stacked on a diagonal so coincident nodes
    // still have a direction to repel along.
    const x = at ? at.x + b.w / 2 : 40 + i * 30
    const y = at ? at.y + b.h / 2 : 40 + i * 30
    return { id: b.id, x, y, vx: 0, vy: 0, w: b.w, h: b.h, pinned: !!pins?.has(b.id) }
  })
}

/** One integration step. Mutates `nodes` in place. */
export function simulationStep(
  nodes: SimNode[],
  links: SimLink[],
  alpha: number,
  centre: Point,
  config: SimConfig = SIM,
): void {
  if (alpha <= 0 || !nodes.length) return
  const index = new Map(nodes.map((n) => [n.id, n]))

  applySprings(index, links, alpha, config)
  applyRepulsion(nodes, alpha, config)
  applyGravity(nodes, centre, alpha, config)
  integrate(nodes, config)
  // Two passes per frame, not a full resolution: springs and repulsion get
  // another go next frame, so paying for exact separation 60 times a second
  // buys nothing. One-shot callers pass SETTLE_ITERATIONS instead.
  resolveCollisions(nodes, config.collidePadding, 2)
}

/**
 * Enough relaxation passes to actually clear a pile-up. Pairwise separation
 * converges geometrically, so a cluster of coincident boxes needs far more
 * than the two a single animation frame can justify — this is the count for
 * the one-shot resolution the non-animated modes do after applying overrides.
 */
export const SETTLE_ITERATIONS = 24

/* ------------------------------------------------------------------ forces */

function applySprings(
  index: Map<string, SimNode>,
  links: SimLink[],
  alpha: number,
  config: SimConfig,
): void {
  for (let i = 0; i < links.length; i++) {
    const link = links[i]
    const a = index.get(link.source)
    const b = index.get(link.target)
    if (!a || !b || a === b) continue

    const { ux, uy, d } = unit(a, b, i)
    // The rest length grows with whichever extents face each other, so two
    // wide boxes sit side by side at the same visual gap as two narrow ones.
    const rest =
      config.linkGap +
      ((a.w + b.w) / 2) * Math.abs(ux) +
      ((a.h + b.h) / 2) * Math.abs(uy)

    // log2 rather than linear: a link carrying 40 interactions should read as
    // stronger than one carrying 2, not twenty times stronger.
    const strength = config.linkStrength * (0.6 + 0.4 * Math.log2(1 + Math.max(0, link.weight)))
    const push = (d - rest) * alpha * strength

    a.vx += ux * push
    a.vy += uy * push
    b.vx -= ux * push
    b.vy -= uy * push
  }
}

function applyRepulsion(nodes: SimNode[], alpha: number, config: SimConfig): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const { ux, uy } = unit(a, b, i)

      // Distance between box *surfaces*, not centres: without this a tall
      // schema table repels a neighbour sitting beside it as hard as one
      // sitting a full box-height away.
      const gapX = Math.abs(b.x - a.x) - (a.w + b.w) / 2
      const gapY = Math.abs(b.y - a.y) - (a.h + b.h) / 2
      const gap = Math.max(6, Math.hypot(Math.max(0, gapX), Math.max(0, gapY)))
      const force = (config.repulsion * alpha) / (gap * gap)

      a.vx -= ux * force
      a.vy -= uy * force
      b.vx += ux * force
      b.vy += uy * force
    }
  }
}

function applyGravity(
  nodes: SimNode[],
  centre: Point,
  alpha: number,
  config: SimConfig,
): void {
  for (const n of nodes) {
    n.vx += (centre.x - n.x) * config.gravity * alpha
    n.vy += (centre.y - n.y) * config.gravity * alpha
  }
}

function integrate(nodes: SimNode[], config: SimConfig): void {
  for (const n of nodes) {
    if (n.pinned) {
      n.vx = 0
      n.vy = 0
      continue
    }
    n.vx *= config.damping
    n.vy *= config.damping

    const speed = Math.hypot(n.vx, n.vy)
    if (speed > config.maxSpeed) {
      const k = config.maxSpeed / speed
      n.vx *= k
      n.vy *= k
    }
    n.x += n.vx
    n.y += n.vy
  }
}

/**
 * Positional (not velocity-based) overlap removal, exported separately because
 * it is the one force that must hold exactly rather than on average — a
 * spring can settle with a 2px overlap and look like a bug.
 *
 * Boxes are pushed apart along their axis of *least* overlap, which is what
 * keeps a row of nodes reading as a row instead of exploding diagonally.
 *
 * Returns early once nothing overlaps, so the common case — an already-tidy
 * graph — costs a single pass however high `iterations` is set.
 */
export function resolveCollisions(
  nodes: SimNode[],
  padding: number,
  iterations = 6,
): void {
  for (let pass = 0; pass < iterations; pass++) {
    let settled = true
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        if (a.pinned && b.pinned) continue

        const dx = b.x - a.x
        const dy = b.y - a.y
        const overlapX = (a.w + b.w) / 2 + padding - Math.abs(dx)
        const overlapY = (a.h + b.h) / 2 + padding - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue

        settled = false
        // A pinned partner absorbs none of the correction, so the free node
        // takes all of it and the pin stays exactly where it was dropped.
        const aShare = a.pinned ? 0 : b.pinned ? 1 : 0.5
        const bShare = b.pinned ? 0 : a.pinned ? 1 : 0.5

        if (overlapX < overlapY) {
          const sign = dx === 0 ? tieBreak(i, j) : Math.sign(dx)
          a.x -= sign * overlapX * aShare
          b.x += sign * overlapX * bShare
          // Whatever velocity drove them together is spent; leaving it in
          // place makes a node resting against a pin buzz against it.
          if (aShare) a.vx = 0
          if (bShare) b.vx = 0
        } else {
          const sign = dy === 0 ? tieBreak(i, j) : Math.sign(dy)
          a.y -= sign * overlapY * aShare
          b.y += sign * overlapY * bShare
          if (aShare) a.vy = 0
          if (bShare) b.vy = 0
        }
      }
    }
    if (settled) return
  }
}

/**
 * Which way to shove two exactly-coincident boxes. Derived from both indices
 * rather than one, so a pile of five nodes scatters in several directions on
 * the first pass instead of shuffling along a single axis.
 */
function tieBreak(i: number, j: number): 1 | -1 {
  return (i + j) % 2 === 0 ? 1 : -1
}

/**
 * Unit vector from `a` to `b`. Coincident nodes get a deterministic nudge
 * derived from the index rather than `Math.random()`, so a simulation replays
 * identically — which is what makes it testable at all.
 */
function unit(a: SimNode, b: SimNode, index: number): { ux: number; uy: number; d: number } {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let d = Math.hypot(dx, dy)
  if (d < 1e-6) {
    const angle = (index % 8) * (Math.PI / 4)
    dx = Math.cos(angle)
    dy = Math.sin(angle)
    d = 1
  }
  return { ux: dx / d, uy: dy / d, d }
}

/**
 * Simulation centres back to the top-left positions the layouts render with —
 * the exact inverse of `seedNodes`.
 */
export function readPositions(nodes: SimNode[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  for (const n of nodes) out.set(n.id, { x: n.x - n.w / 2, y: n.y - n.h / 2 })
  return out
}

/** Total kinetic energy — used to decide the graph has stopped moving. */
export function energy(nodes: SimNode[]): number {
  let total = 0
  for (const n of nodes) total += n.vx * n.vx + n.vy * n.vy
  return total
}
