import { describe, expect, it } from 'vitest'
import { mergeRenderOrder } from './renderOrder'

describe('mergeRenderOrder', () => {
  it('renders a fresh mount in the order it was given', () => {
    expect(mergeRenderOrder([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('appends what opened, rather than inserting it', () => {
    expect(mergeRenderOrder(['a', 'b'], ['b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('drops what closed and moves no survivor', () => {
    expect(mergeRenderOrder(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'c'])
  })

  it('holds a slot however the tree is rearranged', () => {
    // The open set is identical, only its arrangement changed. Nothing in the
    // DOM should move — that is the whole point of the module.
    const previous = ['a', 'b', 'c']
    expect(mergeRenderOrder(previous, ['c', 'b', 'a'])).toBe(previous)
  })

  it('returns the same array when nothing changed, so a ref compares by identity', () => {
    const previous = ['a', 'b']
    expect(mergeRenderOrder(previous, ['a', 'b'])).toBe(previous)
  })

  it('returns exactly the open set, never a stale id', () => {
    const merged = mergeRenderOrder(['a', 'b', 'c'], ['c', 'd'])
    expect([...merged].sort()).toEqual(['c', 'd'])
  })

  it('is idempotent, because StrictMode invokes it twice per render', () => {
    const once = mergeRenderOrder(['a', 'b'], ['b', 'c'])
    const twice = mergeRenderOrder(once, ['b', 'c'])
    expect(twice).toEqual(once)
    expect(twice).toBe(once)
  })

  it('empties when the last tab closes', () => {
    expect(mergeRenderOrder(['a'], [])).toEqual([])
  })

  it('keeps relative order stable across a long open/close sequence', () => {
    // A pane that stays open must never overtake one that opened before it.
    let order: string[] = []
    let open: string[] = []
    const opened: string[] = []

    for (const step of ['+a', '+b', '+c', '-b', '+d', '-a', '+b', '+e', '-d']) {
      const id = step.slice(1)
      if (step[0] === '+') {
        open = [...open, id]
        if (!opened.includes(id)) opened.push(id)
      } else {
        open = open.filter((o) => o !== id)
      }
      order = mergeRenderOrder(order, open)
      expect([...order].sort(), step).toEqual([...open].sort())
    }

    // `b` closed and reopened, so it goes to the back; `c` and `e` never moved.
    expect(order).toEqual(['c', 'b', 'e'])
  })
})
