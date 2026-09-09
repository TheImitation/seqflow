import { describe, expect, it } from 'vitest'
import {
  MAX_H,
  MAX_W,
  MIN_SIDE,
  minimapSize,
  overflows,
  scrollTargetFor,
  viewportRect,
} from './minimapGeometry'

describe('viewportRect', () => {
  it('converts device pixels to content coordinates', () => {
    const v = viewportRect({ left: 200, top: 100, w: 600, h: 400 }, 0.5)
    expect(v).toEqual({ x: 400, y: 200, w: 1200, h: 800 })
  })

  it('is the identity at 1:1', () => {
    const v = viewportRect({ left: 12, top: 34, w: 500, h: 300 }, 1)
    expect(v).toEqual({ x: 12, y: 34, w: 500, h: 300 })
  })
})

describe('overflows', () => {
  it('is false when the diagram already fits', () => {
    expect(overflows(800, 600, { w: 900, h: 700 })).toBe(false)
  })

  it('ignores a few pixels of rounding slack', () => {
    expect(overflows(800, 600, { w: 795, h: 597 })).toBe(false)
  })

  it('is true when either axis runs off the pane', () => {
    expect(overflows(2000, 600, { w: 800, h: 700 })).toBe(true)
    expect(overflows(800, 4000, { w: 900, h: 700 })).toBe(true)
  })
})

describe('minimapSize', () => {
  it('stays inside the maximum box', () => {
    const box = minimapSize(3000, 500)
    expect(box.w).toBeLessThanOrEqual(MAX_W)
    expect(box.h).toBeLessThanOrEqual(MAX_H)
  })

  it('preserves aspect ratio for ordinary diagrams', () => {
    const box = minimapSize(1600, 800)
    expect(box.w / box.h).toBeCloseTo(2, 1)
  })

  it('floors a lopsided diagram at a usable width', () => {
    // A tall sequence diagram: 400 wide by 6000 tall.
    const box = minimapSize(400, 6000)
    expect(box.h).toBe(MAX_H)
    expect(box.w).toBe(MIN_SIDE)
  })
})

describe('scrollTargetFor', () => {
  const base = { width: 2000, height: 1500, visible: { w: 500, h: 400 }, scale: 1 }

  it('centres the viewport on the clicked point', () => {
    const at = scrollTargetFor({ ...base, fx: 0.5, fy: 0.5 })
    expect(at.left).toBe(1000 - 250)
    expect(at.top).toBe(750 - 200)
  })

  it('parks against the near edge instead of going negative', () => {
    expect(scrollTargetFor({ ...base, fx: 0, fy: 0 })).toEqual({ left: 0, top: 0 })
  })

  it('parks against the far edge instead of overscrolling', () => {
    const at = scrollTargetFor({ ...base, fx: 1, fy: 1 })
    expect(at.left).toBe(2000 - 500)
    expect(at.top).toBe(1500 - 400)
  })

  it('reports device pixels, so zoom multiplies the offsets', () => {
    const at = scrollTargetFor({ ...base, fx: 0.5, fy: 0.5, scale: 2 })
    // The visible width is already in content coordinates, so only the final
    // offset is scaled.
    expect(at.left).toBe((1000 - 250) * 2)
  })

  it('clamps to zero on an axis that does not overflow', () => {
    const at = scrollTargetFor({
      ...base,
      visible: { w: 3000, h: 400 },
      fx: 1,
      fy: 0.5,
    })
    expect(at.left).toBe(0)
  })
})

describe('the map matches the window it draws', () => {
  it('round-trips a click back to the same viewport centre', () => {
    const width = 2400
    const height = 1800
    const visible = { w: 600, h: 450 }
    const scale = 0.8

    const target = scrollTargetFor({ fx: 0.4, fy: 0.7, width, height, visible, scale })
    const v = viewportRect(
      { left: target.left, top: target.top, w: visible.w * scale, h: visible.h * scale },
      scale,
    )
    expect(v.x + v.w / 2).toBeCloseTo(0.4 * width)
    expect(v.y + v.h / 2).toBeCloseTo(0.7 * height)
  })
})
