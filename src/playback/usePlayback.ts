import { useEffect, useMemo, useRef, useState } from 'react'
import { buildTree, collectAltBlocks, flattenSteps, type FlatStep } from '../dsl/tree'
import { useStore } from '../state/store'

/**
 * Playback walks one linearized path through the diagram. `alt` blocks default
 * to their first (happy) branch; the branch picker swaps in an unhappy one and
 * the whole animation follows it — both diagrams, same as the happy path.
 */

export function usePlaybackSteps(): FlatStep[] {
  const doc = useStore((s) => s.doc)
  const branchChoice = useStore((s) => s.playback.branchChoice)
  return useMemo(() => flattenSteps(buildTree(doc), branchChoice), [doc, branchChoice])
}

export function useAltBlocks() {
  const doc = useStore((s) => s.doc)
  return useMemo(() => collectAltBlocks(buildTree(doc)), [doc])
}

export interface PlaybackEngine {
  steps: FlatStep[]
  index: number
  current?: FlatStep
  playing: boolean
  /** 0..1 along the current arrow — drives the travelling packet. */
  progress: number
  atEnd: boolean
}

export function usePlaybackEngine(): PlaybackEngine {
  const steps = usePlaybackSteps()
  const { playing, index, speed } = useStore((s) => s.playback)
  const setStep = useStore((s) => s.setStep)
  const pause = useStore((s) => s.pause)

  // While paused the packet sits at the target, so progress is derived rather
  // than written back from the animation loop.
  const [animated, setAnimated] = useState(0)
  const progress = playing ? animated : 1
  const stepStart = useRef(0)

  useEffect(() => {
    if (!playing) return
    if (!steps.length) {
      pause()
      return
    }
    if (index < 0 || index >= steps.length) {
      setStep(0)
      return
    }

    let frame = 0
    stepStart.current = performance.now()
    const durationMs = Math.max(140, 1000 / Math.max(0.15, speed))

    const tick = (now: number) => {
      const p = Math.min(1, (now - stepStart.current) / durationMs)
      setAnimated(p)

      if (p >= 1) {
        if (index + 1 < steps.length) {
          setStep(index + 1)
          return
        }
        pause()
        return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, index, speed, steps.length, setStep, pause])

  return {
    steps,
    index,
    current: index >= 0 ? steps[index] : undefined,
    playing,
    progress,
    atEnd: index >= steps.length - 1,
  }
}

/** Keyboard-driven and button-driven stepping share this. */
export function usePlaybackControls() {
  const steps = usePlaybackSteps()
  const index = useStore((s) => s.playback.index)
  const setStep = useStore((s) => s.setStep)
  const pause = useStore((s) => s.pause)
  const togglePlay = useStore((s) => s.togglePlay)
  const reset = useStore((s) => s.resetPlayback)

  return useMemo(
    () => ({
      total: steps.length,
      forward: () => {
        pause()
        setStep(Math.min(steps.length - 1, index + 1))
      },
      back: () => {
        pause()
        setStep(Math.max(-1, index - 1))
      },
      toggle: () => {
        if (index >= steps.length - 1) setStep(-1)
        togglePlay()
      },
      reset,
      jump: (i: number) => {
        pause()
        setStep(i)
      },
    }),
    [steps.length, index, setStep, pause, togglePlay, reset],
  )
}
