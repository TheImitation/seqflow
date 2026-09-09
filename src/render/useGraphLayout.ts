import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  pinsFor,
  projectKey,
  UNSAVED_KEY,
  useViewLayout,
  type GraphPaneId,
  type LayoutMode,
  type Point,
} from '../state/viewLayout'
import { useStore } from '../state/store'
import {
  advanceAlpha,
  ALPHA_REHEAT,
  ALPHA_START,
  energy,
  readPositions,
  resolveCollisions,
  seedNodes,
  SETTLE_ITERATIONS,
  SIM,
  simulationStep,
  type SimLink,
  type SimNode,
} from './forceLayout'

/**
 * The interactive half of the two graph panes: which arrangement is in force,
 * where the user has parked things, and the animation loop that makes the
 * fluid view follow a dragged node.
 *
 * The physics is in `forceLayout.ts` and the geometry in `edgeRouting.ts`, both
 * pure and unit-tested. What lives here is only the React plumbing those two
 * cannot be tested with: refs, a `requestAnimationFrame` loop, and pointer
 * listeners.
 *
 * Per-frame positions are deliberately kept in a ref and surfaced with a render
 * counter, never written into the document store. `usePlayback.ts` makes the
 * same call for its animation progress, and for the same reason: pushing sixty
 * updates a second through the doc store would drag undo, autosave and every
 * parser-derived selector along with it.
 */

export interface GraphBox {
  id: string
  w: number
  h: number
}

export interface GraphLayoutController {
  /**
   * Top-left positions to hand the layout function, or null for "nothing to
   * override — use the ranked layout as-is".
   */
  positions: Map<string, Point> | null
  /** Nodes the user has parked, for the pin marker. */
  pinned: Set<string>
  mode: LayoutMode
  sticky: boolean
  /** Sticky has nothing to decide in manual mode, where every drop is kept. */
  stickyApplies: boolean
  setMode: (mode: LayoutMode) => void
  toggleSticky: () => void
  /** Drop every pin and let the algorithm arrange the graph from scratch. */
  reorganise: () => void
  /** Node currently held, for the grabbed cursor and drag styling. */
  draggingId: string | null
  /** True while the simulation is still moving. */
  settling: boolean
  beginNodeDrag: (
    id: string,
    event: React.PointerEvent,
    toLocal: (clientX: number, clientY: number) => Point,
  ) => void
  unpin: (id: string) => void
}

/** How far a pointer must travel before a press on a node becomes a drag. */
const DRAG_THRESHOLD = 4
/**
 * Kinetic energy below which the graph is called still. Checked only once the
 * graph has cooled, because at seed time every velocity is zero and an
 * unguarded energy test would stop the loop before it started.
 */
const STILL_ENERGY = 0.35
const STILL_ALPHA = 0.25

export function useGraphLayout({
  pane,
  boxes,
  links,
  seed,
  margin,
}: {
  pane: GraphPaneId
  boxes: GraphBox[]
  links: SimLink[]
  /** Ranked positions, memoised by the caller on `(graph, direction)`. */
  seed: Map<string, Point>
  margin: number
}): GraphLayoutController {
  const projectId = useStore((s) => s.projectId)
  const hydrated = useStore((s) => s.hydrated)
  const project = projectKey(projectId)

  const mode = useViewLayout((s) => s.mode[pane])
  const sticky = useViewLayout((s) => s.sticky[pane])
  const allPins = useViewLayout((s) => s.pins)
  const setModeRaw = useViewLayout((s) => s.setMode)
  const toggleStickyRaw = useViewLayout((s) => s.toggleSticky)
  const pinNode = useViewLayout((s) => s.pinNode)
  const unpinNode = useViewLayout((s) => s.unpinNode)
  const clearPins = useViewLayout((s) => s.clearPins)
  const adoptPins = useViewLayout((s) => s.adoptPins)

  const pinMap = useMemo(() => pinsFor(allPins, project, pane), [allPins, project, pane])
  /**
   * A stable dependency. `allPins` changes identity whenever any project is
   * touched and `pinMap` is rebuilt every render, so neither can gate an
   * effect; the rounded digest can.
   */
  const pinKey = useMemo(
    () =>
      [...pinMap.entries()]
        .map(([id, p]) => `${id}:${Math.round(p.x)},${Math.round(p.y)}`)
        .sort()
        .join('|'),
    [pinMap],
  )

  // Pins placed before IndexedDB hydration finished were filed under a
  // placeholder; move them onto the real project now that it has an id.
  useEffect(() => {
    if (hydrated && projectId) adoptPins(UNSAVED_KEY, projectId)
  }, [hydrated, projectId, adoptPins])

  /* --------------------------------------------------------- live geometry */

  const simRef = useRef<SimNode[]>([])
  const alphaRef = useRef(0)
  const frameRef = useRef(0)
  const loopingRef = useRef(false)
  const draggingRef = useRef<string | null>(null)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  /** Where the grabbed node is right now, before the drop is committed. */
  const [dragAt, setDragAt] = useState<{ id: string; at: Point } | null>(null)
  /** Bumped once per simulated frame; the only reason this hook re-renders. */
  const [frame, setFrame] = useState(0)

  /**
   * Latest values, for the rAF loop and the pointer listeners — both of which
   * outlive the render that created them and would otherwise close over stale
   * props. Synced in one effect that is declared *before* the seeding effects,
   * so those see current values on the same commit.
   */
  const linksRef = useRef(links)
  const boxesRef = useRef(boxes)
  const seedRef = useRef(seed)
  const pinMapRef = useRef(pinMap)
  const marginRef = useRef(margin)
  const modeRef = useRef(mode)
  const stickyRef = useRef(sticky)

  /**
   * The centre gravity pulls toward, taken from the *ranked* layout rather than
   * from live positions. Deriving it from where the nodes currently are would
   * close a second feedback loop: nodes drift, the centre follows, the nodes
   * drift further.
   */
  const centre = useMemo(() => {
    let sumX = 0
    let sumY = 0
    let count = 0
    for (const b of boxes) {
      const at = seed.get(b.id)
      if (!at) continue
      sumX += at.x + b.w / 2
      sumY += at.y + b.h / 2
      count++
    }
    return count ? { x: sumX / count, y: sumY / count } : { x: 400, y: 300 }
  }, [boxes, seed])
  const centreRef = useRef(centre)

  useEffect(() => {
    linksRef.current = links
    boxesRef.current = boxes
    seedRef.current = seed
    pinMapRef.current = pinMap
    marginRef.current = margin
    modeRef.current = mode
    stickyRef.current = sticky
    centreRef.current = centre
  }, [links, boxes, seed, pinMap, margin, mode, sticky, centre])

  /* ------------------------------------------------------ animation loop */

  const step = useCallback(function step() {
    const nodes = simRef.current
    const dragging = draggingRef.current
    const cooled = alphaRef.current < STILL_ALPHA && energy(nodes) < STILL_ENERGY
    const done = alphaRef.current <= 0 || cooled

    if (modeRef.current !== 'fluid' || !nodes.length || (done && !dragging)) {
      loopingRef.current = false
      frameRef.current = 0
      alphaRef.current = 0
      setSettling(false)
      // A final render, so the graph is drawn at its settled positions with
      // edge routing applied to where things actually came to rest.
      setFrame((f) => f + 1)
      return
    }

    // A held node keeps the graph warm. That is what makes the rest of the
    // nodes trail after it, instead of snapping into place on release.
    const alpha = dragging ? Math.max(alphaRef.current, ALPHA_REHEAT) : alphaRef.current
    simulationStep(nodes, linksRef.current, alpha, centreRef.current)
    clampIntoCanvas(nodes, marginRef.current)
    if (!dragging) alphaRef.current = advanceAlpha(alphaRef.current)

    setFrame((f) => f + 1)
    frameRef.current = requestAnimationFrame(step)
  }, [])

  /**
   * Armed here rather than from an effect: a press needs the loop running on
   * the same tick, and an effect would not run until after React commits — the
   * same reasoning as the listener attachment in `SequenceCanvas.beginDrag`.
   *
   * The `frameRef` guard matters under StrictMode, where effects mount twice:
   * two live rAF loops over one shared array would double every force.
   */
  const reheat = useCallback(
    (alpha: number) => {
      alphaRef.current = Math.max(alphaRef.current, alpha)
      if (loopingRef.current || frameRef.current || modeRef.current !== 'fluid') return
      loopingRef.current = true
      setSettling(true)
      frameRef.current = requestAnimationFrame(step)
    },
    [step],
  )

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      loopingRef.current = false
    },
    [],
  )

  /* ------------------------------------------------------------- seeding */

  /** Structural identity: reseeding is only warranted when this changes. */
  const topology = useMemo(() => boxes.map((b) => `${b.id}:${b.w}x${b.h}`).join('|'), [boxes])

  useEffect(() => {
    if (mode !== 'fluid') {
      simRef.current = []
      alphaRef.current = 0
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      loopingRef.current = false
      setSettling(false)
      return
    }

    // Nodes that survive the edit keep their positions: without this, adding a
    // single participant would reshuffle every box on the canvas. Sizes are
    // refreshed even on the preserving path, because a schema table's height is
    // its column count and the collision pass depends on it.
    const previous = new Map(simRef.current.map((n) => [n.id, n]))
    simRef.current = boxesRef.current.map((b, i) => {
      const pin = pinMapRef.current.get(b.id)
      if (pin) {
        return {
          id: b.id,
          x: pin.x + b.w / 2,
          y: pin.y + b.h / 2,
          vx: 0,
          vy: 0,
          w: b.w,
          h: b.h,
          pinned: true,
        }
      }
      const prior = previous.get(b.id)
      if (prior) return { ...prior, w: b.w, h: b.h, pinned: false }
      const at = seedRef.current.get(b.id)
      return {
        id: b.id,
        x: (at?.x ?? margin + i * 24) + b.w / 2,
        y: (at?.y ?? margin + i * 24) + b.h / 2,
        vx: 0,
        vy: 0,
        w: b.w,
        h: b.h,
        pinned: false,
      }
    })
    reheat(ALPHA_START)
    // `project` is a dependency because two projects can share node ids
    // (`Client`, `API`), and without it a project switch would carry the old
    // project's live positions across while its pins were swapped out.
  }, [mode, topology, project, margin, reheat])

  // A pin appearing or moving retargets an anchor; it does not invalidate the
  // arrangement, so the graph is nudged rather than reseeded. Kept separate
  // from the seed effect so a pin arriving after the boot race still lands.
  useEffect(() => {
    if (mode !== 'fluid' || !simRef.current.length) return
    for (const n of simRef.current) {
      const pin = pinMapRef.current.get(n.id)
      n.pinned = !!pin
      if (pin) {
        n.x = pin.x + n.w / 2
        n.y = pin.y + n.h / 2
        n.vx = 0
        n.vy = 0
      }
    }
    reheat(ALPHA_REHEAT)
  }, [pinKey, mode, reheat])

  /* -------------------------------------------------------------- dragging */

  /** The node's current on-screen top-left, whichever mode placed it there. */
  const positionOf = useCallback((id: string): Point => {
    const live = simRef.current.find((n) => n.id === id)
    if (live) return { x: live.x - live.w / 2, y: live.y - live.h / 2 }
    return pinMapRef.current.get(id) ?? seedRef.current.get(id) ?? { x: 0, y: 0 }
  }, [])

  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  const beginNodeDrag = useCallback(
    (id: string, event: React.PointerEvent, toLocal: (cx: number, cy: number) => Point) => {
      if (event.button !== 0) return
      endDrag.current?.()

      const start = toLocal(event.clientX, event.clientY)
      const origin = positionOf(id)
      // Grab the box where it was clicked, so it does not jump to centre itself
      // under the pointer.
      const grabX = start.x - origin.x
      const grabY = start.y - origin.y
      let moved = false
      /**
       * The committed position is tracked here rather than read back out of
       * React state: `pointerup` can land in the same frame as the last
       * `pointermove`, and would otherwise commit a stale value — the
       * staleness trap `SequenceCanvas` documents on its own drag.
       */
      let at: Point | null = null

      draggingRef.current = id
      setDraggingId(id)
      if (modeRef.current === 'fluid') reheat(ALPHA_REHEAT)

      const move = (e: PointerEvent) => {
        const p = toLocal(e.clientX, e.clientY)
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) <= DRAG_THRESHOLD) return
        moved = true

        at = {
          x: Math.max(marginRef.current, p.x - grabX),
          y: Math.max(marginRef.current, p.y - grabY),
        }
        setDragAt({ id, at })

        // Held rigidly for the duration. The springs read this position and
        // haul the neighbours toward it, which is the whole effect.
        const node = simRef.current.find((n) => n.id === id)
        if (node) {
          node.pinned = true
          node.x = at.x + node.w / 2
          node.y = at.y + node.h / 2
          node.vx = 0
          node.vy = 0
        }
      }

      const finish = () => {
        const dropped = at
        const wasMoved = moved
        cleanup()
        if (!wasMoved || !dropped) return

        if (stickyRef.current || modeRef.current === 'manual') {
          pinNode(project, pane, id, dropped)
        } else {
          // Not sticky: hand the node back to the algorithm from where it was
          // let go, with no inherited velocity — throwing nodes is entertaining
          // for about four seconds — so it visibly settles rather than snapping.
          const node = simRef.current.find((n) => n.id === id)
          if (node) {
            node.pinned = false
            node.vx = 0
            node.vy = 0
          }
          reheat(ALPHA_REHEAT)
        }
      }

      function cleanup() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', cleanup)
        endDrag.current = null
        draggingRef.current = null
        setDraggingId(null)
        setDragAt(null)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', cleanup)
      endDrag.current = cleanup
    },
    [pane, pinNode, positionOf, project, reheat],
  )

  /* ------------------------------------------------------------- positions */

  /**
   * Reading `simRef.current` during render is deliberate, and is why `frame`
   * is a dependency: the simulation array is an imperative buffer the rAF loop
   * writes to in place, and the render counter is what publishes it. Copying
   * it into state each frame would allocate a fresh array of twenty objects
   * sixty times a second to describe something React never diffs.
   */
  const positions = useMemo(() => {
    void frame // recomputed every simulated frame

    if (mode === 'fluid') {
      const live = readPositions(simRef.current)
      if (dragAt) live.set(dragAt.id, dragAt.at)
      return live.size ? live : null
    }

    // Rigid and manual place boxes with no physics running, so a pin dropped on
    // top of a ranked node has nothing to push either of them apart again. One
    // resolution pass, with the placed nodes immovable, is that missing force.
    const placed = new Map(pinMap)
    if (dragAt) placed.set(dragAt.id, dragAt.at)
    if (!placed.size) return null

    const nodes = seedNodes(boxes, seed, placed)
    resolveCollisions(nodes, SIM.collidePadding, SETTLE_ITERATIONS)
    const resolved = readPositions(nodes)

    if (mode === 'manual') return resolved

    // Rigid keeps dagre's own edge routing for everything the pins did not
    // disturb, so only genuinely-displaced nodes are reported as overrides.
    const moved = new Map<string, Point>()
    for (const [id, to] of resolved) {
      const from = seed.get(id)
      if (!from || Math.hypot(to.x - from.x, to.y - from.y) > 0.5) moved.set(id, to)
    }
    return moved.size ? moved : null
  }, [mode, pinMap, seed, boxes, dragAt, frame])

  const pinned = useMemo(() => new Set(pinMap.keys()), [pinMap])

  const setMode = useCallback((next: LayoutMode) => setModeRaw(pane, next), [pane, setModeRaw])
  const toggleSticky = useCallback(() => toggleStickyRaw(pane), [pane, toggleStickyRaw])
  const unpin = useCallback((id: string) => unpinNode(project, pane, id), [project, pane, unpinNode])

  const reorganise = useCallback(() => {
    clearPins(project, pane)
    if (modeRef.current !== 'fluid') return
    // Reseed from the ranked layout, so this is a genuine restart rather than a
    // nudge out of the arrangement the graph is already in.
    for (const n of simRef.current) {
      const at = seedRef.current.get(n.id)
      if (!at) continue
      n.x = at.x + n.w / 2
      n.y = at.y + n.h / 2
      n.vx = 0
      n.vy = 0
      n.pinned = false
    }
    reheat(ALPHA_START)
  }, [clearPins, pane, project, reheat])

  return {
    positions,
    pinned,
    mode,
    sticky,
    stickyApplies: mode !== 'manual',
    setMode,
    toggleSticky,
    reorganise,
    draggingId,
    settling,
    beginNodeDrag,
    unpin,
  }
}

/* ----------------------------------------------------------------- helpers */

/** Keep boxes inside the positive quadrant — the SVG viewBox starts at 0,0. */
function clampIntoCanvas(nodes: SimNode[], margin: number): void {
  for (const n of nodes) {
    if (n.pinned) continue
    n.x = Math.max(margin + n.w / 2, n.x)
    n.y = Math.max(margin + n.h / 2, n.y)
  }
}
