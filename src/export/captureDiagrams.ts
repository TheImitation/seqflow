import { makeDocId, viewOf, type ViewKind } from '../state/docId'
import { findPane, isBackgroundTab, paneIds, usePanels, type SlotId } from '../state/panels'
import { useStore } from '../state/store'
import { useViewLayout, type GraphPaneId } from '../state/viewLayout'
import { MAX_CANVAS_PIXELS } from './snapshotGeometry'
import { sizeOf, svgToPngBlob } from './snapshot'
import type { DiagramId } from './reportContent'

/**
 * Rasterise the diagrams for a report, revealing whatever is hidden and
 * putting the layout back afterwards.
 *
 * The report wants three figures; the user may have any of those panes closed,
 * and a closed pane is unmounted (`App.tsx` renders a rail instead), so there
 * is no SVG to capture. So: record the layout, reveal what is missing, capture,
 * and restore in a `finally` — a rasterisation failure must never leave the
 * workspace rearranged.
 *
 * Two decisions worth knowing about:
 *
 * A pane that was **already on screen is captured exactly as the user has it**,
 * including a parked node or a mid-air fluid arrangement — and that now covers a
 * pane sitting behind another tab, which is mounted and settled and needs only
 * to be brought to the front. A pane this function had to **open from closed is
 * captured in `rigid`**: it was unmounted, so there is no arrangement to
 * preserve — the simulation would simply re-derive one from dagre over about a
 * second, and a design document whose figures come out differently on every
 * regeneration is a bad artefact to circulate.
 *
 * Waiting is gated on the rendered geometry going still, not on a timer and not
 * on the layout hook's `settling` flag — that flag is component-local React
 * state with no store behind it, and a fixed delay is simultaneously too long
 * for the common case and too short for a pathological graph.
 */

export type CaptureSkip = 'pane-empty' | 'too-large' | 'failed'

export interface CapturedDiagram {
  id: DiagramId
  png: ArrayBuffer
  /** viewBox units, for the aspect fit in `toDocx`. */
  width: number
  height: number
}

export interface CaptureResult {
  captured: CapturedDiagram[]
  skipped: { id: DiagramId; reason: CaptureSkip; detail?: string }[]
}

const VIEW_OF: Record<DiagramId, ViewKind> = {
  sequence: 'sequence',
  architecture: 'arch',
  schema: 'schema',
}

/**
 * The slot a figure is drawn in, which is a document of whichever project is
 * open — so it is resolved when the capture runs rather than named in a table.
 */
function paneOf(id: DiagramId): SlotId {
  return makeDocId(usePanels.getState().projectId, VIEW_OF[id])
}

const SELECTOR_OF: Record<DiagramId, string> = {
  sequence: '.seq-svg',
  architecture: '.arch-svg',
  schema: '.schema-svg',
}

/** Frames of identical geometry before a diagram is called still. */
const STILL_FRAMES = 3
/**
 * Hard ceiling on waiting. `requestAnimationFrame` does not fire in a hidden
 * tab, so a poll with no deadline would hang forever if the user switched away
 * mid-export.
 */
const STILL_DEADLINE_MS = 2500

export async function captureDiagrams(want: DiagramId[]): Promise<CaptureResult> {
  const captured: CapturedDiagram[] = []
  const skipped: CaptureResult['skipped'] = []

  // The whole arrangement is one immutable value, so a snapshot is a reference
  // and restoring it is a single write — no need to replay the individual shows
  // and hides the flat layout used to require.
  const before = usePanels.getState().root
  const onScreen = new Set(paneIds(before))
  const opened = want.map(paneOf).filter((pane) => !onScreen.has(pane))

  // Playback moves the diagram under us: `usePlayback` fires a step on a timer
  // and the architecture canvas scrolls to follow the active link, which would
  // never let the stability poll converge.
  const savedPlayback = { ...useStore.getState().playback }
  useStore.getState().resetPlayback()

  // A `focusPath` trace is deliberately left alone — it dims parts of the
  // diagram but moves nothing, and `svgToString` strips the dimming anyway.

  const restoreModes: [GraphPaneId, 'rigid' | 'fluid' | 'manual'][] = []
  for (const pane of opened) {
    const view = viewOf(pane)
    if (view !== 'arch' && view !== 'schema') continue
    const mode = useViewLayout.getState().mode[view]
    if (mode === 'fluid') {
      restoreModes.push([view, mode])
      useViewLayout.getState().setMode(view, 'rigid')
    }
  }
  for (const pane of opened) usePanels.getState().show(pane)

  // A pane already on screen may be behind another tab in its slot. Bringing it
  // to the front costs nothing and is restored wholesale with the tree below.
  for (const id of want) {
    const pane = paneOf(id)
    const current = usePanels.getState().root
    if (isBackgroundTab(current, pane)) {
      const home = findPane(current, pane)
      if (home) usePanels.getState().setActive(home.path, pane)
    }
  }

  try {
    for (const id of want) {
      try {
        const svg = await waitForDiagram(SELECTOR_OF[id])
        if (!svg) {
          // Both graph panes early-return an empty state with no `<svg>` at
          // all, so "absent" usually means "nothing to draw", not "too soon".
          skipped.push({ id, reason: 'pane-empty' })
          continue
        }

        // The same viewBox-derived size the exporter itself will draw at.
        const size = sizeOf(svg)
        // `pngScaleFor` floors at 1, so a diagram whose natural area already
        // exceeds the canvas budget is not scaled down — it rasterises to a
        // blank bitmap, which in a Word document is a blank page.
        if (size.width * size.height > MAX_CANVAS_PIXELS) {
          skipped.push({
            id,
            reason: 'too-large',
            detail: `${Math.round(size.width)}×${Math.round(size.height)}`,
          })
          continue
        }

        const blob = await svgToPngBlob(svg, 2)
        captured.push({ id, png: await blob.arrayBuffer(), width: size.width, height: size.height })
      } catch (error) {
        // One failed figure must not cost the whole report.
        skipped.push({
          id,
          reason: 'failed',
          detail: error instanceof Error ? error.message : undefined,
        })
      }
    }
  } finally {
    // One write puts the arrangement back exactly — the panes that were opened,
    // and any tab that was brought to the front. Because the panes never move in
    // the React tree, this is a style recalculation rather than a remount.
    usePanels.getState().setRoot(before)
    for (const [pane, mode] of restoreModes) useViewLayout.getState().setMode(pane, mode)
    useStore.setState({ playback: savedPlayback })
  }

  return { captured, skipped }
}

/* ----------------------------------------------------------------- waiting */

/**
 * Resolve once the diagram's geometry has stopped changing, or null if it never
 * appears. In `rigid` this returns after the first few frames; in `fluid` it
 * waits out the simulation.
 */
async function waitForDiagram(selector: string): Promise<SVGSVGElement | null> {
  const deadline = Date.now() + STILL_DEADLINE_MS
  let previous = ''
  let still = 0
  // Two commits' grace before concluding a pane is genuinely empty, so a
  // freshly revealed pane is not written off before React has rendered it.
  let missingFrames = 0

  for (;;) {
    await nextFrame()

    const svg = document.querySelector<SVGSVGElement>(selector)
    if (!svg) {
      if (++missingFrames > 3) return null
      continue
    }
    missingFrames = 0

    const digest = geometryDigest(svg)
    if (digest === previous) {
      if (++still >= STILL_FRAMES) return svg
    } else {
      still = 0
      previous = digest
    }

    if (Date.now() > deadline) return svg
  }
}

/**
 * A cheap fingerprint of everything that moves: the canvas extent plus each
 * box's position. Node positions are what the force simulation animates, and
 * the extent is what it grows as boxes spread out.
 */
function geometryDigest(svg: SVGSVGElement): string {
  const parts = [svg.getAttribute('viewBox') ?? '']
  for (const rect of svg.querySelectorAll('rect.body')) {
    parts.push(`${rect.getAttribute('x')},${rect.getAttribute('y')}`)
  }
  return parts.join('|')
}

/**
 * One animation frame, or a timer if frames are not being served — a hidden
 * tab stops `requestAnimationFrame` entirely, and the caller's deadline can
 * only fire if something keeps resolving.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(finish)
    setTimeout(finish, 120)
  })
}
