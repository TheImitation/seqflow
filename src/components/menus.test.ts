import { describe, expect, it, vi } from 'vitest'
import { parse } from '../dsl/parser'
import { serialize } from '../dsl/serializer'
import { cloneDoc } from '../dsl/edit'
import { ALL_KINDS, KIND_GROUPS, type SequenceDoc } from '../dsl/ast'
import {
  activeRange,
  archEdgeMenu,
  arrowMenu,
  blockMenu,
  canvasMenu,
  participantMenu,
  type MenuDeps,
} from './menus'
import type { MenuItem, MenuSection } from './useContextMenu'

const SRC = `sequenceDiagram
  participant Client : client
  participant APIGW as API Gateway : aws:apigateway
  participant Queue as PaymentQueue : aws:sqs
  participant Svc as Payment Service

  Client->>APIGW: POST /orders @Charge
  APIGW->>Svc: CreateOrder
  APIGW->>Queue: SendMessage
  alt 200 OK
    Svc-->>APIGW: ok
  else 500 Error (unhappy)
    Svc-->>APIGW: boom
  end
  opt cleanup
    Svc->>Svc: tidy
  end

contract Charge {
  transport: http
  method: POST
  path: /orders
  responses:
    201 Created
}
`

/**
 * Menus are pure builders, so a harness that records what `mutate` produced is
 * enough to assert on both the items and the DSL each one writes.
 */
function harness(src = SRC) {
  const parsed = parse(src)
  expect(parsed.errors).toEqual([])

  let doc = parsed.doc
  const selected: unknown[] = []
  const toasts: string[] = []
  const copied: string[] = []

  const deps: MenuDeps = {
    doc,
    mutate: (fn, after) => {
      const draft = cloneDoc(doc)
      fn(draft)
      const text = serialize(draft)
      const round = parse(text)
      expect(round.errors).toEqual([])
      doc = round.doc
      after?.(doc)
    },
    select: (s) => selected.push(s),
    toast: (m) => toasts.push(m),
    copy: (text) => copied.push(text),
    playFrom: vi.fn(),
    setBranchChoice: vi.fn(),
    suggestFor: vi.fn(),
    range: null,
  }

  return {
    deps,
    get doc() {
      return doc
    },
    get text() {
      return serialize(doc)
    },
    selected,
    toasts,
    copied,
  }
}

function flatten(sections: MenuSection[]): MenuItem[] {
  return sections.flatMap((s) => s.items)
}

function find(sections: MenuSection[], label: string): MenuItem {
  const item = flatten(sections).find((i) => i.label.startsWith(label))
  if (!item) throw new Error(`No menu item starting with "${label}"`)
  return item
}

function sub(sections: MenuSection[], label: string, childLabel: string): MenuItem {
  const child = find(sections, label).items?.find((i) => i.label === childLabel)
  if (!child) throw new Error(`No "${childLabel}" under "${label}"`)
  return child
}

const messageBy = (doc: SequenceDoc, label: string) =>
  doc.messages.find((m) => m.label === label)!

/* ------------------------------------------------------------------ arrow */

describe('arrow menu', () => {
  it('ticks the current style and contract', () => {
    const h = harness()
    const menu = arrowMenu(h.deps, messageBy(h.doc, 'POST /orders'))

    const styles = find(menu, 'Arrow style').items!
    expect(styles.filter((s) => s.checked).map((s) => s.label)).toEqual(['Sync call'])

    const contracts = find(menu, 'Contract').items!
    expect(contracts.filter((c) => c.checked).map((c) => c.label)).toEqual(['Charge'])
    expect(find(menu, 'Contract').hint).toBe('Charge')
  })

  it('disables reply and reverse on a self-message', () => {
    const h = harness()
    const menu = arrowMenu(h.deps, messageBy(h.doc, 'tidy'))
    expect(find(menu, 'Add reply').disabled).toBe(true)
    expect(find(menu, 'Reverse direction').disabled).toBe(true)
  })

  it('reverses, keeping the contract attached', () => {
    const h = harness()
    find(arrowMenu(h.deps, messageBy(h.doc, 'POST /orders')), 'Reverse direction').onSelect!()
    expect(h.text).toContain('APIGW->>Client: POST /orders @Charge')
  })

  it('attaches an existing contract by name', () => {
    const h = harness()
    const menu = arrowMenu(h.deps, messageBy(h.doc, 'CreateOrder'))
    sub(menu, 'Contract', 'Charge').onSelect!()
    expect(h.text).toContain('APIGW->>Svc: CreateOrder @Charge')
  })

  it('drafts a new contract from the interaction', () => {
    const h = harness()
    const menu = arrowMenu(h.deps, messageBy(h.doc, 'SendMessage'))
    sub(menu, 'Contract', 'New contract from this interaction…').onSelect!()
    const created = h.doc.contracts.find((c) => c.name !== 'Charge')!
    // The target is an SQS queue, so the draft should not be an HTTP contract.
    expect(created.transport).toBe('sqs')
    expect(h.text).toContain(`SendMessage @${created.name}`)
  })

  it('copies the message as a DSL line', () => {
    const h = harness()
    find(arrowMenu(h.deps, messageBy(h.doc, 'POST /orders')), 'Copy DSL line').onSelect!()
    expect(h.copied).toEqual(['Client->>APIGW: POST /orders @Charge'])
  })

  it('deletes and clears the selection', () => {
    const h = harness()
    find(arrowMenu(h.deps, messageBy(h.doc, 'CreateOrder')), 'Delete interaction').onSelect!()
    expect(h.text).not.toContain('CreateOrder')
    expect(h.selected).toEqual([null])
    expect(h.toasts[0]).toContain('CreateOrder')
  })
})

/* ------------------------------------------------------------------- wrap */

describe('wrap', () => {
  it('wraps only the clicked step with no range', () => {
    const h = harness()
    const menu = arrowMenu(h.deps, messageBy(h.doc, 'CreateOrder'))
    expect(find(menu, 'Wrap').label).toBe('Wrap in')
    sub(menu, 'Wrap', 'loop').onSelect!()
    expect(h.text).toContain('  loop retry\n    APIGW->>Svc: CreateOrder\n  end')
  })

  it('wraps the whole range and counts it in the label', () => {
    const h = harness()
    const first = messageBy(h.doc, 'CreateOrder')
    const last = messageBy(h.doc, 'SendMessage')
    const range = activeRange(h.doc, first.id, last.id)!
    expect(range.count).toBe(2)

    const menu = arrowMenu({ ...h.deps, range }, last)
    expect(find(menu, 'Wrap').label).toBe('Wrap 2 steps in')
    sub(menu, 'Wrap', 'opt').onSelect!()
    expect(h.text).toContain(
      '  opt optional\n    APIGW->>Svc: CreateOrder\n    APIGW->>Queue: SendMessage\n  end',
    )
  })

  it('selects the block it just created, not a stale id', () => {
    const h = harness()
    const menu = arrowMenu(h.deps, messageBy(h.doc, 'CreateOrder'))
    sub(menu, 'Wrap', 'alt').onSelect!()

    const chosen = h.selected.at(-1) as { type: string; id: string }
    expect(chosen.type).toBe('block')
    const block = h.doc.blocks.find((b) => b.id === chosen.id)!
    expect(block.type).toBe('alt')
    expect(block.label).toBe('success')
  })

  it('never offers a range that straddles an else', () => {
    // `activeRange` is the gate the UI actually goes through: no range, so
    // "Wrap in" falls back to the single clicked step.
    const h = harness()
    const ok = messageBy(h.doc, 'ok')
    const boom = messageBy(h.doc, 'boom')
    expect(activeRange(h.doc, ok.id, boom.id)).toBeNull()
    expect(find(arrowMenu(h.deps, ok), 'Wrap').label).toBe('Wrap in')
  })

  it('surfaces a reason when a range lines up with nothing', () => {
    const h = harness()
    const boom = messageBy(h.doc, 'boom')
    const opt = h.doc.blocks.find((b) => b.type === 'opt')!
    // `boom` is the only step of the sad branch and the `opt` sits outside the
    // alt entirely, so this run belongs to no sibling list.
    const menu = arrowMenu(
      { ...h.deps, range: { lo: boom.order, hi: opt.endOrder, count: 2, anchorId: boom.id } },
      boom,
    )
    sub(menu, 'Wrap', 'loop').onSelect!()
    expect(h.toasts[0]).toMatch(/crosses a block boundary/)
    expect(h.text).not.toContain('loop')
  })
})

/* ------------------------------------------------------------ participant */

describe('participant menu', () => {
  it('offers kinds grouped, and ticks the one in use', () => {
    const h = harness()
    const groups = find(participantMenu(h.deps, 'APIGW'), 'Change kind').items!
    expect(groups.map((g) => g.label)).toEqual(KIND_GROUPS.map((g) => g.label))

    const all = groups.flatMap((g) => g.items ?? [])
    expect(all).toHaveLength(ALL_KINDS.length)
    expect(all.filter((k) => k.checked).map((k) => k.label)).toEqual(['API Gateway'])
    // The group holding the current kind is marked too, so it is findable
    // without opening each one.
    expect(groups.filter((g) => g.hint === '✓').map((g) => g.label)).toEqual(['API & edge'])
  })

  it('changes kind through its group', () => {
    const h = harness()
    const group = find(participantMenu(h.deps, 'Svc'), 'Change kind').items!.find(
      (g) => g.label === 'Compute',
    )!
    group.items!.find((k) => k.label === 'Lambda')!.onSelect!()
    expect(h.text).toContain('participant Svc as Payment Service : aws:lambda')
  })

  it('reaches a newer AI kind the same way', () => {
    const h = harness()
    const group = find(participantMenu(h.deps, 'Svc'), 'Change kind').items!.find(
      (g) => g.label === 'AI & search',
    )!
    expect(group.items!.map((k) => k.label)).toContain('Knowledge Base')
    group.items!.find((k) => k.label === 'Bedrock')!.onSelect!()
    expect(h.text).toContain('participant Svc as Payment Service : aws:bedrock')
  })

  it('disables move-left on the first participant', () => {
    const h = harness()
    expect(find(participantMenu(h.deps, 'Client'), 'Move left').disabled).toBe(true)
    expect(find(participantMenu(h.deps, 'Client'), 'Move right').disabled).toBe(false)
  })

  it('warns how many messages a delete takes with it', () => {
    const h = harness()
    const del = find(participantMenu(h.deps, 'APIGW'), 'Delete participant')
    expect(del.hint).toBe('+5 messages')
    del.onSelect!()
    expect(h.doc.participants.map((p) => p.id)).toEqual(['Client', 'Queue', 'Svc'])
  })

  it('appends a message to another participant and selects it', () => {
    const h = harness()
    sub(participantMenu(h.deps, 'Client'), 'Add message to', 'Payment Service').onSelect!()
    const chosen = h.selected.at(-1) as { type: string; id: string }
    const created = h.doc.messages.find((m) => m.id === chosen.id)!
    expect([created.from, created.to]).toEqual(['Client', 'Svc'])
    // Appended after the last step, but still before the contract declarations.
    expect(h.text).toContain('  end\n  Client->>Svc: call\n')
    expect(created.order).toBe(h.doc.messages.length - 1)
  })

  it('only offers Reveal in sequence when asked for it', () => {
    const h = harness()
    expect(flatten(participantMenu(h.deps, 'APIGW')).map((i) => i.label)).not.toContain(
      'Reveal in sequence',
    )
    const withReveal = participantMenu(h.deps, 'APIGW', { reveal: true })
    expect(find(withReveal, 'Reveal in sequence').hint).toBe('5 interactions')
  })
})

/* ------------------------------------------------------------------ block */

describe('block menu', () => {
  const altOf = (doc: SequenceDoc) => doc.blocks.find((b) => b.type === 'alt')!
  const optOf = (doc: SequenceDoc) => doc.blocks.find((b) => b.type === 'opt')!

  it('offers Add else branch only on an alt', () => {
    const h = harness()
    expect(find(blockMenu(h.deps, altOf(h.doc)), 'Add else branch').disabled).toBe(false)
    const onOpt = find(blockMenu(h.deps, optOf(h.doc)), 'Add else branch')
    expect(onOpt.disabled).toBe(true)
    expect(onOpt.hint).toBe('alt only')
  })

  it('adds an else branch with a placeholder', () => {
    const h = harness()
    find(blockMenu(h.deps, altOf(h.doc)), 'Add else branch').onSelect!()
    expect(h.text).toContain('  else error (unhappy)\n    Svc-->>APIGW: error\n  end')
  })

  it('refuses to retype an alt that would lose branches', () => {
    const h = harness()
    const retype = find(blockMenu(h.deps, altOf(h.doc)), 'Change type')
    expect(retype.disabled).toBe(true)
    expect(retype.hint).toBe('2 branches')

    const onOpt = find(blockMenu(h.deps, optOf(h.doc)), 'Change type')
    expect(onOpt.disabled).toBe(false)
    expect(onOpt.hint).toBe('opt')
  })

  it('lists one playback entry per branch, flagging the unhappy ones', () => {
    const h = harness()
    const walks = flatten(blockMenu(h.deps, altOf(h.doc))).filter((i) =>
      i.label.startsWith('Walk'),
    )
    expect(walks.map((w) => [w.label, w.hint])).toEqual([
      ['Walk "200 OK"', undefined],
      ['Walk "500 Error"', '⚠'],
    ])
    expect(flatten(blockMenu(h.deps, optOf(h.doc))).some((i) => i.label.startsWith('Walk'))).toBe(
      false,
    )
  })

  it('unwraps, keeping the contents', () => {
    const h = harness()
    find(blockMenu(h.deps, optOf(h.doc)), 'Unwrap').onSelect!()
    expect(h.text).not.toContain('opt cleanup')
    expect(h.text).toContain('Svc->>Svc: tidy')
  })

  it('toggles the unhappy marker', () => {
    const h = harness()
    find(blockMenu(h.deps, optOf(h.doc)), 'Mark as (unhappy)').onSelect!()
    expect(h.text).toContain('opt cleanup (unhappy)')
  })
})

/* ------------------------------------------------------------- arch edge */

describe('architecture edge menu', () => {
  it('lists the messages the link stands for', () => {
    const h = harness()
    const menu = archEdgeMenu(h.deps, 'Client', 'APIGW')
    expect(menu[0].label).toBe('Client → API Gateway')
    expect(menu[0].items.map((i) => [i.label, i.hint])).toEqual([
      ['POST /orders', '@Charge'],
    ])
    expect(find(menu, 'Reveal in sequence').hint).toBe('1 interaction')
  })

  it('selects the underlying message', () => {
    const h = harness()
    archEdgeMenu(h.deps, 'APIGW', 'Svc')[0].items[0].onSelect!()
    expect(h.selected.at(-1)).toEqual({
      type: 'message',
      id: messageBy(h.doc, 'CreateOrder').id,
    })
  })

  it('is empty for a link with no messages', () => {
    const h = harness()
    expect(archEdgeMenu(h.deps, 'Client', 'Queue')).toEqual([])
  })
})

/* ---------------------------------------------------------- empty canvas */

describe('canvas menu', () => {
  it('adds a participant of the chosen kind', () => {
    const h = harness()
    const group = find(canvasMenu(h.deps), 'Add participant').items!.find(
      (g) => g.label === 'Storage & data',
    )!
    group.items!.find((k) => k.label === 'DynamoDB')!.onSelect!()
    expect(h.text).toContain('participant DynamoDB : aws:dynamodb')
    expect(h.selected.at(-1)).toEqual({ type: 'participant', id: 'DynamoDB' })
  })

  it('appends whatever extra sections it is handed', () => {
    const h = harness()
    const menu = canvasMenu(h.deps, [{ label: 'View', items: [{ id: 'fit', label: 'Fit' }] }])
    expect(menu.at(-1)!.label).toBe('View')
  })
})

/* ----------------------------------------------------------------- range */

describe('activeRange', () => {
  it('is null without both ends', () => {
    const h = harness()
    const id = messageBy(h.doc, 'CreateOrder').id
    expect(activeRange(h.doc, null, id)).toBeNull()
    expect(activeRange(h.doc, id, null)).toBeNull()
    expect(activeRange(h.doc, id, id)).toBeNull()
  })

  it('spans a message and a block at the same level', () => {
    const h = harness()
    const send = messageBy(h.doc, 'SendMessage')
    const alt = h.doc.blocks.find((b) => b.type === 'alt')!
    expect(activeRange(h.doc, send.id, alt.id)).toMatchObject({
      lo: send.order,
      hi: alt.endOrder,
      count: 2,
    })
  })
})
