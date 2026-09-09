import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const STRUCTURE = /^(sequenceDiagram|participant|actor|loop|alt|else|opt|end|par|and|rect|critical|break|autonumber|activate|deactivate)\b/
const DECL = /^(model|contract|table)\b/
const CONTRACT_KEY =
  /^(transport|method|path|model|body|headers|responses|primaryKey|foreignKey|index)\s*:/
const MODIFIER = /^(required|optional|as|over|of|left|right)\b/
const TYPE = /^(string|number|boolean|object|array|date|enum|vector)\b/
const KIND = /^aws:[a-z]+\b/
const ARROW = /^(-->>|--x|--\)|-->|->>|-x|-\)|->)/
const STATUS = /^[1-5]\d{2}\b/

/** Minimal stream tokenizer — the grammar is small enough not to need a parser. */
export const dslLanguage = StreamLanguage.define<{ afterColon: boolean }>({
  name: 'seqflow',
  startState: () => ({ afterColon: false }),

  token(stream, state) {
    if (stream.sol()) {
      state.afterColon = false
      stream.eatSpace()
      if (stream.eol()) return null
    }

    if (stream.match(/^(%%|\/\/|#).*$/)) return 'comment'

    // Everything after the `:` of a message is free-text label.
    if (state.afterColon) {
      if (stream.match(/^\s*@[A-Za-z_][\w-]*/)) return 'meta'
      if (stream.match(/^\([Uu]nhappy\)/)) return 'invalid'
      stream.skipToEnd()
      return 'string'
    }

    if (stream.match(/^Note\b/i)) return 'keyword'
    if (stream.match(DECL)) return 'definitionKeyword'
    if (stream.match(CONTRACT_KEY, false)) {
      stream.match(/^\w+/)
      return 'propertyName'
    }
    if (stream.match(STRUCTURE)) return 'keyword'
    if (stream.match(MODIFIER)) return 'modifier'
    if (stream.match(KIND)) return 'className'
    if (stream.match(TYPE)) return 'typeName'
    if (stream.match(/^\([Uu]nhappy\)/)) return 'invalid'
    if (stream.match(ARROW)) return 'operator'
    if (stream.match(STATUS)) return 'number'
    if (stream.match(/^@[A-Za-z_][\w-]*/)) return 'meta'
    if (stream.match(/^"[^"]*"/)) return 'string'
    if (stream.match(/^[{}[\]]/)) return 'bracket'
    if (stream.match(/^->/)) return 'operator'

    if (stream.eat(':')) {
      state.afterColon = true
      return 'punctuation'
    }

    if (stream.match(/^[A-Za-z_][\w-]*/)) return 'variableName'
    stream.next()
    return null
  },
})

const highlight = HighlightStyle.define([
  { tag: t.comment, color: '#5c6b82', fontStyle: 'italic' },
  { tag: t.keyword, color: '#ff9d2e' },
  { tag: t.definitionKeyword, color: '#ff9d2e', fontWeight: '600' },
  { tag: t.propertyName, color: '#7ee0c0' },
  { tag: t.modifier, color: '#a78bfa' },
  { tag: t.className, color: '#ffc46b' },
  { tag: t.typeName, color: '#a78bfa' },
  { tag: t.operator, color: '#f2685c' },
  { tag: t.meta, color: '#e3a44a', fontWeight: '600' },
  { tag: t.invalid, color: '#e3a44a', fontStyle: 'italic' },
  { tag: t.number, color: '#79c0ff' },
  { tag: t.string, color: '#c9d5e6' },
  { tag: t.variableName, color: '#58a6ff' },
  { tag: t.bracket, color: '#7d8da5' },
  { tag: t.punctuation, color: '#7d8da5' },
])

export const dslHighlighting = [dslLanguage, syntaxHighlighting(highlight)]
