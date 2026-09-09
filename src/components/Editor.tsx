import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, indentUnit } from '@codemirror/language'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view'
import { useEffect, useMemo, useRef } from 'react'
import { usePlaybackSteps } from '../playback/usePlayback'
import { useStore } from '../state/store'
import { dslHighlighting } from './dslLanguage'

/* ------------------------------------------------------- line decorations */

interface LineMarks {
  errors: number[]
  playing?: number
}

const setMarks = StateEffect.define<LineMarks>()

const errorLine = Decoration.line({ class: 'cm-error-line' })
const playingLine = Decoration.line({ class: 'cm-playing-line' })

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setMarks)) continue
      const { errors, playing } = effect.value
      const ranges = []
      for (const line of new Set(errors)) {
        if (line >= 1 && line <= tr.state.doc.lines) {
          ranges.push(errorLine.range(tr.state.doc.line(line).from))
        }
      }
      if (playing && playing >= 1 && playing <= tr.state.doc.lines) {
        ranges.push(playingLine.range(tr.state.doc.line(playing).from))
      }
      ranges.sort((a, b) => a.from - b.from)
      return Decoration.set(ranges)
    }
    return tr.docChanged ? value.map(tr.changes) : value
  },
  provide: (f) => EditorView.decorations.from(f),
})

/* -------------------------------------------------------------- component */

export function Editor({ revealLine }: { revealLine?: number }) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const applying = useRef(false)

  const text = useStore((s) => s.text)
  const errors = useStore((s) => s.errors)
  const setText = useStore((s) => s.setText)
  const playingLineNo = usePlayingLine()

  const extensions: Extension[] = useMemo(
    () => [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      history(),
      indentUnit.of('  '),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      dslHighlighting,
      marksField,
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { backgroundColor: 'var(--surface-0)', color: 'var(--text)' },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applying.current) return
        setText(update.state.doc.toString(), 'editor')
      }),
    ],
    [setText],
  )

  useEffect(() => {
    if (!host.current) return
    const instance = new EditorView({
      state: EditorState.create({ doc: text, extensions }),
      parent: host.current,
    })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
    // Mount once; `text` is pushed in by the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions])

  // Push store -> editor, but only when they have actually diverged (an undo,
  // a canvas edit, a template load) so typing is never interrupted.
  useEffect(() => {
    const instance = view.current
    if (!instance) return
    const current = instance.state.doc.toString()
    if (current === text) return

    applying.current = true
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      selection: { anchor: Math.min(instance.state.selection.main.anchor, text.length) },
    })
    applying.current = false
  }, [text])

  useEffect(() => {
    const instance = view.current
    if (!instance) return
    instance.dispatch({
      effects: setMarks.of({
        errors: errors.map((e) => e.line).filter((l) => l > 0),
        playing: playingLineNo,
      }),
    })
  }, [errors, playingLineNo, text])

  useEffect(() => {
    const instance = view.current
    if (!instance || !revealLine) return
    if (revealLine < 1 || revealLine > instance.state.doc.lines) return
    const line = instance.state.doc.line(revealLine)
    instance.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
  }, [revealLine])

  return <div className="editor-host" ref={host} />
}

function usePlayingLine(): number | undefined {
  const index = useStore((s) => s.playback.index)
  const steps = usePlaybackSteps()
  return index < 0 ? undefined : steps[index]?.message.sourceLine
}
