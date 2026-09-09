import { beforeEach, describe, expect, it } from 'vitest'
import { pinsFor, projectKey, UNSAVED_KEY, useViewLayout } from './viewLayout'

/**
 * Node ships a method-less `localStorage` stub, which the store's try/catch
 * swallows — fine for every other assertion here, but it would make the
 * "survives a reload" test vacuous. This is the smallest shim that lets the
 * persist path actually be observed, without pulling in jsdom.
 */
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
})

const reset = () => {
  localStorage.clear()
  useViewLayout.setState({
    mode: { arch: 'rigid', schema: 'rigid' },
    sticky: { arch: true, schema: true },
    pins: {},
    recent: [],
  })
}

beforeEach(reset)

describe('mode and sticky', () => {
  it('switches one pane without disturbing the other', () => {
    useViewLayout.getState().setMode('arch', 'fluid')
    expect(useViewLayout.getState().mode.arch).toBe('fluid')
    expect(useViewLayout.getState().mode.schema).toBe('rigid')
  })

  it('writes the choice to localStorage so a reload keeps it', () => {
    useViewLayout.getState().setMode('schema', 'manual')
    const raw = localStorage.getItem('seqflow.viewLayout.v1')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).mode.schema).toBe('manual')
  })

  it('toggles sticky per pane', () => {
    useViewLayout.getState().toggleSticky('arch')
    expect(useViewLayout.getState().sticky.arch).toBe(false)
    expect(useViewLayout.getState().sticky.schema).toBe(true)
  })
})

describe('pins', () => {
  it('records a dropped node against its project and pane', () => {
    useViewLayout.getState().pinNode('proj-1', 'arch', 'Api', { x: 40, y: 90 })
    const map = pinsFor(useViewLayout.getState().pins, 'proj-1', 'arch')
    expect(map.get('Api')).toEqual({ x: 40, y: 90 })
  })

  it('keeps one project’s pins out of another’s', () => {
    useViewLayout.getState().pinNode('proj-1', 'arch', 'Api', { x: 40, y: 90 })
    expect(pinsFor(useViewLayout.getState().pins, 'proj-2', 'arch').size).toBe(0)
  })

  it('keeps the two panes’ pins separate', () => {
    useViewLayout.getState().pinNode('proj-1', 'arch', 'Api', { x: 1, y: 2 })
    useViewLayout.getState().pinNode('proj-1', 'schema', 'users', { x: 3, y: 4 })
    expect(pinsFor(useViewLayout.getState().pins, 'proj-1', 'arch').size).toBe(1)
    expect(pinsFor(useViewLayout.getState().pins, 'proj-1', 'schema').get('users')).toEqual({
      x: 3,
      y: 4,
    })
  })

  it('overwrites a pin when the node is dragged again', () => {
    useViewLayout.getState().pinNode('p', 'arch', 'Api', { x: 1, y: 1 })
    useViewLayout.getState().pinNode('p', 'arch', 'Api', { x: 9, y: 9 })
    expect(pinsFor(useViewLayout.getState().pins, 'p', 'arch').get('Api')).toEqual({ x: 9, y: 9 })
  })

  it('releases a single node', () => {
    useViewLayout.getState().pinNode('p', 'arch', 'Api', { x: 1, y: 1 })
    useViewLayout.getState().pinNode('p', 'arch', 'Db', { x: 2, y: 2 })
    useViewLayout.getState().unpinNode('p', 'arch', 'Api')
    const map = pinsFor(useViewLayout.getState().pins, 'p', 'arch')
    expect(map.has('Api')).toBe(false)
    expect(map.has('Db')).toBe(true)
  })

  it('ignores unpinning something that was never pinned', () => {
    expect(() => useViewLayout.getState().unpinNode('p', 'arch', 'ghost')).not.toThrow()
  })

  it('clears a whole pane but leaves the other pane alone', () => {
    useViewLayout.getState().pinNode('p', 'arch', 'Api', { x: 1, y: 1 })
    useViewLayout.getState().pinNode('p', 'schema', 'users', { x: 2, y: 2 })
    useViewLayout.getState().clearPins('p', 'arch')
    expect(pinsFor(useViewLayout.getState().pins, 'p', 'arch').size).toBe(0)
    expect(pinsFor(useViewLayout.getState().pins, 'p', 'schema').size).toBe(1)
  })

  it('trims the least recently pinned project once past the cap', () => {
    for (let i = 0; i < 25; i++) {
      useViewLayout.getState().pinNode(`proj-${i}`, 'arch', 'Api', { x: i, y: i })
    }
    const { pins } = useViewLayout.getState()
    expect(Object.keys(pins).length).toBeLessThanOrEqual(20)
    expect(pins['proj-24']).toBeTruthy()
    expect(pins['proj-0']).toBeUndefined()
  })
})

describe('adoptPins', () => {
  it('carries pre-hydration pins over to the project that loaded', () => {
    useViewLayout.getState().pinNode(UNSAVED_KEY, 'arch', 'Api', { x: 7, y: 7 })
    useViewLayout.getState().adoptPins(UNSAVED_KEY, 'proj-1')
    expect(pinsFor(useViewLayout.getState().pins, 'proj-1', 'arch').get('Api')).toEqual({
      x: 7,
      y: 7,
    })
    expect(useViewLayout.getState().pins[UNSAVED_KEY]).toBeUndefined()
  })

  it('lets a pin already placed against the real project win', () => {
    useViewLayout.getState().pinNode('proj-1', 'arch', 'Api', { x: 100, y: 100 })
    useViewLayout.getState().pinNode(UNSAVED_KEY, 'arch', 'Api', { x: 1, y: 1 })
    useViewLayout.getState().adoptPins(UNSAVED_KEY, 'proj-1')
    expect(pinsFor(useViewLayout.getState().pins, 'proj-1', 'arch').get('Api')).toEqual({
      x: 100,
      y: 100,
    })
  })

  it('does nothing when there is nothing to carry over', () => {
    useViewLayout.getState().pinNode('proj-1', 'arch', 'Api', { x: 5, y: 5 })
    const before = useViewLayout.getState().pins
    useViewLayout.getState().adoptPins(UNSAVED_KEY, 'proj-1')
    expect(useViewLayout.getState().pins).toBe(before)
  })

  it('does nothing when asked to adopt onto itself', () => {
    useViewLayout.getState().pinNode(UNSAVED_KEY, 'arch', 'Api', { x: 5, y: 5 })
    const before = useViewLayout.getState().pins
    useViewLayout.getState().adoptPins(UNSAVED_KEY, UNSAVED_KEY)
    expect(useViewLayout.getState().pins).toBe(before)
  })
})

describe('projectKey', () => {
  it('files pins under a placeholder until hydration supplies an id', () => {
    expect(projectKey(null)).toBe(UNSAVED_KEY)
    expect(projectKey('proj-1')).toBe('proj-1')
  })
})

describe('pinsFor', () => {
  it('returns an empty map for a project or pane with no pins', () => {
    expect(pinsFor({}, 'nope', 'arch').size).toBe(0)
  })
})
