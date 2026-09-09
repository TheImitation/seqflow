import { describe, expect, it } from 'vitest'
import {
  cleanClassList,
  INTERACTION_ONLY,
  isStyledClass,
  MAX_CANVAS_PIXELS,
  naturalSize,
  pngScaleFor,
} from './snapshotGeometry'

const fallback = { width: 10, height: 10 }

describe('naturalSize', () => {
  it('prefers the viewBox over the rendered width', () => {
    // The bug this exists for: the arch canvas at 96% zoom reported
    // width="904.84" against viewBox 944, so the background rect fell short
    // and left an unpainted band down two edges.
    expect(naturalSize('0 0 944 812', '904.84375', '778.318', fallback)).toEqual({
      width: 944,
      height: 812,
    })
  })

  it('handles a comma-separated viewBox', () => {
    expect(naturalSize('0,0,300,200', null, null, fallback)).toEqual({ width: 300, height: 200 })
  })

  it('ignores a viewBox with a zero dimension', () => {
    expect(naturalSize('0 0 0 200', '640', '480', fallback)).toEqual({ width: 640, height: 480 })
  })

  it('falls back to the width and height attributes', () => {
    expect(naturalSize(null, '640', '480', fallback)).toEqual({ width: 640, height: 480 })
  })

  it('falls back to the measured size when nothing parses', () => {
    expect(naturalSize('nonsense', 'auto', '100%', fallback)).toEqual(fallback)
  })
})

describe('pngScaleFor', () => {
  it('leaves a small diagram at the requested scale', () => {
    expect(pngScaleFor({ width: 900, height: 800 }, 2)).toBe(2)
  })

  it('reduces the scale rather than exceeding the canvas budget', () => {
    // The Phase 1 sequence diagram: 2180 x 4972 is 10.8M pixels, so 2x would
    // ask for 43M and some browsers return a blank canvas.
    const scale = pngScaleFor({ width: 2180, height: 4972 }, 2)
    expect(scale).toBeLessThan(2)
    expect(2180 * scale * 4972 * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1)
  })

  it('never drops below 1, because a shrunken diagram is unreadable', () => {
    expect(pngScaleFor({ width: 20000, height: 20000 }, 2)).toBe(1)
  })

  it('tolerates a degenerate size', () => {
    expect(pngScaleFor({ width: 0, height: 0 }, 2)).toBe(2)
  })
})

describe('cleanClassList', () => {
  it('strips playback dimming and keeps the rest', () => {
    expect(cleanClassList('arrow-line head async unhappy dim')).toBe(
      'arrow-line head async unhappy',
    )
  })

  it('strips selection and the active highlight', () => {
    expect(cleanClassList('arch-edge dashed unhappy active')).toBe('arch-edge dashed unhappy')
    expect(cleanClassList('lane-box aws selected')).toBe('lane-box aws')
  })

  it('leaves a class list with no live state untouched', () => {
    expect(cleanClassList('arch-node aws')).toBe('arch-node aws')
  })

  it('does not strip a name that merely contains a state word', () => {
    expect(cleanClassList('arch-edge-badge declared')).toBe('arch-edge-badge declared')
  })

  it('collapses stray whitespace', () => {
    expect(cleanClassList('  block-rect   unhappy  selected ')).toBe('block-rect unhappy')
  })
})

describe('what an export drops', () => {
  it('drops the insert gutter, whose plus and pen are hover-only', () => {
    expect(INTERACTION_ONLY).toContain('.slot')
  })

  it('drops every pointer target and drag preview', () => {
    for (const selector of ['.arrow-hit', '.arch-edge-hit', '.lifeline-grip', '.packet']) {
      expect(INTERACTION_ONLY).toContain(selector)
    }
  })
})

describe('isStyledClass', () => {
  it('accepts the classes the inlined stylesheet covers', () => {
    for (const value of [
      'arrow-line head async unhappy',
      'lane-box aws',
      'arch-node aws',
      'arch-edge-badge declared',
      'block-rect unhappy',
      'note-box',
      'contract-badge unhappy',
      // Descendant-styled: `.arch-node rect.body`, `.arch-node text.title`.
      'body',
      'accent-bar plain',
      'title',
      'kind',
      // The schema pane: absent from both lists until the report export
      // needed it, so its diagram exported as unstyled shapes.
      'schema-node selected pinned',
      'schema-edge',
      'line',
      'col-name',
      'col-key',
      'header',
      'row',
      'pin-mark',
    ]) {
      expect(isStyledClass(value), value).toBe(true)
    }
  })

  it('rejects the gutter, which is why it exported unstyled', () => {
    // Each of these must therefore appear in INTERACTION_ONLY, or it renders
    // with no CSS at all in the exported file.
    for (const value of ['slot', 'slot-line', 'slot-add note', 'slot-hit']) {
      expect(isStyledClass(value), value).toBe(false)
    }
  })
})
