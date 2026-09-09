import {
  contractByName,
  KIND_GROUPS,
  type Block,
  type Message,
  type MessageStyle,
  type ParticipantKind,
  type SequenceDoc,
} from '../dsl/ast'
import {
  addBranch,
  changeBlockType,
  duplicateMessage,
  insertMessage,
  moveParticipant,
  moveStep,
  removeBlock,
  removeMessage,
  removeNote,
  removeParticipant,
  reverseMessage,
  wrapInBlock,
  type WrapResult,
} from '../dsl/edit'
import { messageLine } from '../dsl/serializer'
import { buildTree, siblingRun, type SiblingRun } from '../dsl/tree'
import { draftContract } from '../contracts/contractStore'
import { KIND_LABEL } from '../render/aws-icons/labels'
import type { Selection } from '../state/store'
import type { MenuSection } from './useContextMenu'

/**
 * Everything a menu needs from the app. Menus are pure builders — they read the
 * doc and return the items; only `onSelect` touches state.
 */
export interface MenuDeps {
  doc: SequenceDoc
  mutate: (fn: (draft: SequenceDoc) => void, after?: (doc: SequenceDoc) => void) => void
  select: (selection: Selection | null) => void
  toast: (message: string) => void
  /** Opens the "Suggest unhappy paths" dialog for a message. */
  suggestFor: (messageId: string) => void
  playFrom: (messageId: string) => void
  setBranchChoice: (blockId: string, branchIndex: number) => void
  /** The shift-click range, when one is active and legal. */
  range: (SiblingRun & { anchorId: string }) | null
  copy: (text: string, what: string) => void
}

const STYLES: { value: MessageStyle; label: string; arrow: string }[] = [
  { value: 'sync', label: 'Sync call', arrow: '->>' },
  { value: 'async', label: 'Async / reply', arrow: '-->>' },
  { value: 'fireAndForget', label: 'Fire and forget', arrow: '-x' },
]

const BLOCK_TYPES: { value: Block['type']; label: string }[] = [
  { value: 'loop', label: 'loop' },
  { value: 'alt', label: 'alt' },
  { value: 'opt', label: 'opt' },
]

/* ------------------------------------------------------------------ arrow */

export function arrowMenu(deps: MenuDeps, message: Message): MenuSection[] {
  const { doc, mutate, select, toast } = deps
  const contract = contractByName(doc, message.contractRef)

  return [
    {
      items: [
        {
          id: 'suggest',
          label: 'Suggest unhappy paths…',
          hint: contract ? `@${contract.name}` : undefined,
          onSelect: () => deps.suggestFor(message.id),
        },
      ],
    },
    {
      label: 'Structure',
      items: [
        wrapItem(deps, message),
        {
          id: 'reply',
          label: 'Add reply',
          disabled: message.from === message.to,
          onSelect: () =>
            mutate((d) => {
              insertMessage(d, message.order + 1, {
                from: message.to,
                to: message.from,
                label: 'response',
                style: 'async',
                parentBlock: message.parentBlock,
              })
            }),
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          onSelect: () => mutate((d) => void duplicateMessage(d, message.id)),
        },
        {
          id: 'reverse',
          label: 'Reverse direction',
          hint: `${message.to} → ${message.from}`,
          disabled: message.from === message.to,
          onSelect: () => mutate((d) => void reverseMessage(d, message.id)),
        },
        {
          id: 'move-up',
          label: 'Move earlier',
          onSelect: () => mutate((d) => void moveStep(d, message.id, -1)),
        },
        {
          id: 'move-down',
          label: 'Move later',
          onSelect: () => mutate((d) => void moveStep(d, message.id, 1)),
        },
      ],
    },
    {
      label: 'Style',
      items: [
        {
          id: 'style',
          label: 'Arrow style',
          hint: STYLES.find((s) => s.value === message.style)?.arrow,
          items: STYLES.map((s) => ({
            id: `style-${s.value}`,
            label: s.label,
            hint: s.arrow,
            checked: message.style === s.value,
            onSelect: () =>
              mutate((d) => {
                const m = d.messages.find((x) => x.id === message.id)
                if (m) m.style = s.value
              }),
          })),
        },
        {
          id: 'contract',
          label: 'Contract',
          hint: contract?.name ?? 'none',
          items: [
            {
              id: 'contract-none',
              label: 'Detach',
              checked: !message.contractRef,
              disabled: !message.contractRef,
              onSelect: () =>
                mutate((d) => {
                  const m = d.messages.find((x) => x.id === message.id)
                  if (m) m.contractRef = undefined
                }),
            },
            ...doc.contracts.map((c) => ({
              id: `contract-${c.name}`,
              label: c.name,
              hint: c.transport === 'http' ? (c.method ?? 'HTTP') : c.transport,
              checked: message.contractRef === c.name,
              onSelect: () =>
                mutate((d) => {
                  const m = d.messages.find((x) => x.id === message.id)
                  if (m) m.contractRef = c.name
                }),
            })),
            {
              id: 'contract-new',
              label: 'New contract from this interaction…',
              onSelect: () => {
                mutate((d) => {
                  const created = draftContract(d, message)
                  d.contracts.push(created)
                  const m = d.messages.find((x) => x.id === message.id)
                  if (m) m.contractRef = created.name
                })
                select({ type: 'message', id: message.id })
              },
            },
          ],
        },
      ],
    },
    {
      label: 'Playback',
      items: [
        {
          id: 'play-from',
          label: 'Play from here',
          onSelect: () => deps.playFrom(message.id),
        },
      ],
    },
    {
      items: [
        {
          id: 'copy',
          label: 'Copy DSL line',
          hint: message.sourceLine ? `L${message.sourceLine}` : undefined,
          onSelect: () => deps.copy(messageLine(message), 'DSL line'),
        },
        {
          id: 'delete',
          label: 'Delete interaction',
          danger: true,
          onSelect: () => {
            mutate((d) => removeMessage(d, message.id))
            select(null)
            toast(`Deleted "${message.label}"`)
          },
        },
      ],
    },
  ]
}

/**
 * "Wrap in" applies to the shift-click range when there is one, and to the
 * clicked step otherwise. A range that straddles an `else` never reaches here —
 * `siblingRun` refuses to produce one.
 */
function wrapItem(deps: MenuDeps, message: Message) {
  const { range, mutate, select, toast } = deps
  const covers = range && range.lo <= message.order && message.order < range.hi
  const lo = covers ? range.lo : message.order
  const hi = covers ? range.hi : message.order + 1
  const count = covers ? range.count : 1

  const wrap = (type: Block['type'], label: string) => {
    let wrapped = false
    mutate(
      (d) => {
        const result: WrapResult = wrapInBlock(d, lo, hi, type, label)
        wrapped = result.ok
        if (!result.ok) toast(result.reason ?? 'Could not wrap that selection.')
      },
      // Look the new block up by the range it owns; its id is not the one
      // `wrapInBlock` handed back once the doc has been reparsed.
      (fresh) => {
        if (!wrapped) return
        const created = fresh.blocks.find(
          (b) => b.type === type && b.startOrder === lo && b.endOrder === hi,
        )
        if (created) select({ type: 'block', id: created.id })
      },
    )
  }

  return {
    id: 'wrap',
    label: count > 1 ? `Wrap ${count} steps in` : 'Wrap in',
    items: [
      { id: 'wrap-loop', label: 'loop', onSelect: () => wrap('loop', 'retry') },
      { id: 'wrap-alt', label: 'alt', onSelect: () => wrap('alt', 'success') },
      { id: 'wrap-opt', label: 'opt', onSelect: () => wrap('opt', 'optional') },
    ],
  }
}

/* ------------------------------------------------------------ participant */

export function participantMenu(
  deps: MenuDeps,
  id: string,
  options: { reveal?: boolean } = {},
): MenuSection[] {
  const { doc, mutate, select, toast } = deps
  const participant = doc.participants.find((p) => p.id === id)
  if (!participant) return []

  const index = doc.participants.findIndex((p) => p.id === id)
  const touching = doc.messages.filter((m) => m.from === id || m.to === id)
  const others = doc.participants.filter((p) => p.id !== id)
  const lastOrder = doc.messages.reduce((n, m) => Math.max(n, m.order + 1), 0)

  const kindItem = (kind: ParticipantKind) => ({
    id: `kind-${kind}`,
    label: KIND_LABEL[kind],
    checked: participant.kind === kind,
    onSelect: () =>
      mutate((d) => {
        const p = d.participants.find((x) => x.id === id)
        if (p) p.kind = kind
      }),
  })

  // Two levels: group, then kind. A flat list of every kind is unusable.
  const kindGroups = KIND_GROUPS.map((group) => ({
    id: `kind-group-${group.label}`,
    label: group.label,
    hint: group.kinds.includes(participant.kind) ? '✓' : undefined,
    items: group.kinds.map(kindItem),
  }))

  return [
    {
      items: [
        {
          id: 'kind',
          label: 'Change kind',
          hint: KIND_LABEL[participant.kind],
          items: kindGroups,
        },
        {
          id: 'send',
          label: 'Add message to',
          disabled: !others.length,
          items: others.map((p) => ({
            id: `send-${p.id}`,
            label: p.label,
            onSelect: () =>
              mutate(
                (d) => {
                  insertMessage(d, lastOrder, {
                    from: id,
                    to: p.id,
                    label: 'call',
                    style: 'sync',
                  })
                },
                (fresh) => {
                  const created = fresh.messages.find((m) => m.order === lastOrder)
                  if (created) select({ type: 'message', id: created.id })
                },
              ),
          })),
        },
      ],
    },
    {
      label: 'Order',
      items: [
        {
          id: 'left',
          label: 'Move left',
          disabled: index <= 0,
          onSelect: () => mutate((d) => moveParticipant(d, id, -1)),
        },
        {
          id: 'right',
          label: 'Move right',
          disabled: index >= doc.participants.length - 1,
          onSelect: () => mutate((d) => moveParticipant(d, id, 1)),
        },
      ],
    },
    {
      items: [
        ...(options.reveal && touching.length
          ? [
              {
                id: 'reveal',
                label: 'Reveal in sequence',
                hint: `${touching.length} interaction${touching.length === 1 ? '' : 's'}`,
                onSelect: () => select({ type: 'message', id: touching[0].id }),
              },
            ]
          : []),
        {
          id: 'delete',
          label: 'Delete participant',
          hint: touching.length ? `+${touching.length} messages` : undefined,
          danger: true,
          onSelect: () => {
            mutate((d) => removeParticipant(d, id))
            select(null)
            toast(
              touching.length
                ? `Deleted ${participant.label} and ${touching.length} interaction${touching.length === 1 ? '' : 's'}`
                : `Deleted ${participant.label}`,
            )
          },
        },
      ],
    },
  ]
}

/* ------------------------------------------------------------------ block */

export function blockMenu(deps: MenuDeps, block: Block): MenuSection[] {
  const { mutate, select, toast, setBranchChoice } = deps
  const branches = block.branches ?? []
  const canRetype = branches.length <= 1

  return [
    {
      items: [
        {
          id: 'add-branch',
          label: 'Add else branch',
          disabled: block.type !== 'alt',
          hint: block.type !== 'alt' ? 'alt only' : undefined,
          onSelect: () =>
            mutate((d) => {
              addBranch(d, block.id, 'error', true)
            }),
        },
        {
          id: 'type',
          label: 'Change type',
          hint: canRetype ? block.type : `${branches.length} branches`,
          disabled: !canRetype,
          items: BLOCK_TYPES.map((t) => ({
            id: `type-${t.value}`,
            label: t.label,
            checked: block.type === t.value,
            onSelect: () => mutate((d) => void changeBlockType(d, block.id, t.value)),
          })),
        },
        {
          id: 'unhappy',
          label: 'Mark as (unhappy)',
          checked: !!block.isUnhappy,
          onSelect: () =>
            mutate((d) => {
              const b = d.blocks.find((x) => x.id === block.id)
              if (b) b.isUnhappy = b.isUnhappy ? undefined : true
            }),
        },
      ],
    },
    ...(branches.length > 1
      ? [
          {
            label: 'Playback',
            items: branches.map((b, i) => ({
              id: `branch-${i}`,
              label: `Walk "${b.label || `branch ${i + 1}`}"`,
              hint: b.isUnhappy ? '⚠' : undefined,
              onSelect: () => {
                setBranchChoice(block.id, i)
                toast(`Playback now walks "${b.label}"`)
              },
            })),
          },
        ]
      : []),
    {
      label: 'Order',
      items: [
        {
          id: 'up',
          label: 'Move earlier',
          onSelect: () => mutate((d) => void moveStep(d, block.id, -1)),
        },
        {
          id: 'down',
          label: 'Move later',
          onSelect: () => mutate((d) => void moveStep(d, block.id, 1)),
        },
      ],
    },
    {
      items: [
        {
          id: 'unwrap',
          label: 'Unwrap',
          hint: 'keep contents',
          onSelect: () => {
            mutate((d) => removeBlock(d, block.id, true))
            select(null)
          },
        },
        {
          id: 'delete',
          label: 'Delete with contents',
          danger: true,
          onSelect: () => {
            mutate((d) => removeBlock(d, block.id, false))
            select(null)
            toast(`Deleted ${block.type} "${block.label}"`)
          },
        },
      ],
    },
  ]
}

/* ------------------------------------------------------------------- note */

export function noteMenu(deps: MenuDeps, noteId: string): MenuSection[] {
  const { mutate, select } = deps
  return [
    {
      items: [
        {
          id: 'up',
          label: 'Move earlier',
          onSelect: () => mutate((d) => void moveStep(d, noteId, -1)),
        },
        {
          id: 'down',
          label: 'Move later',
          onSelect: () => mutate((d) => void moveStep(d, noteId, 1)),
        },
        {
          id: 'delete',
          label: 'Delete note',
          danger: true,
          onSelect: () => {
            mutate((d) => removeNote(d, noteId))
            select(null)
          },
        },
      ],
    },
  ]
}

/* -------------------------------------------------------- architecture edge */

export function archEdgeMenu(deps: MenuDeps, from: string, to: string): MenuSection[] {
  const { doc, select } = deps
  const messages = doc.messages.filter((m) => m.from === from && m.to === to)
  if (!messages.length) return []

  const label = (id: string) => doc.participants.find((p) => p.id === id)?.label ?? id
  const short = (m: Message) => m.label || '(no label)'

  return [
    {
      label: `${label(from)} → ${label(to)}`,
      items: messages.slice(0, 10).map((m) => ({
        id: `sel-${m.id}`,
        label: short(m),
        hint: m.contractRef ? `@${m.contractRef}` : undefined,
        onSelect: () => select({ type: 'message', id: m.id }),
      })),
    },
    {
      items: [
        {
          id: 'suggest',
          label: 'Suggest unhappy paths on',
          items: messages.slice(0, 10).map((m) => ({
            id: `sug-${m.id}`,
            label: short(m),
            onSelect: () => deps.suggestFor(m.id),
          })),
        },
        {
          id: 'reveal',
          label: 'Reveal in sequence',
          hint: `${messages.length} interaction${messages.length === 1 ? '' : 's'}`,
          onSelect: () => select({ type: 'message', id: messages[0].id }),
        },
      ],
    },
  ]
}

/* ---------------------------------------------------------- empty canvas */

export function canvasMenu(
  deps: MenuDeps,
  extras: MenuSection[] = [],
): MenuSection[] {
  const { doc, mutate, select } = deps
  const stepCount = doc.messages.length

  return [
    {
      items: [
        {
          id: 'add-participant',
          label: 'Add participant',
          items: KIND_GROUPS.map((group) => ({
            id: `add-group-${group.label}`,
            label: group.label,
            items: group.kinds.map((kind) => ({
              id: `add-${kind}`,
              label: KIND_LABEL[kind],
              onSelect: () =>
                mutate((d) => {
                  const created = addParticipantOfKind(d, kind)
                  select({ type: 'participant', id: created })
                }),
            })),
          })),
        },
        {
          id: 'select-all-hint',
          label: 'Shift-click two arrows to wrap a run',
          disabled: true,
          hint: stepCount ? `${stepCount} steps` : undefined,
        },
      ],
    },
    ...extras,
  ]
}

function addParticipantOfKind(doc: SequenceDoc, kind: ParticipantKind): string {
  const base = KIND_LABEL[kind].replace(/[^A-Za-z0-9]/g, '') || 'Service'
  let id = base
  let n = 2
  while (doc.participants.some((p) => p.id === id)) id = `${base}${n++}`
  doc.participants.push({ id, label: id, kind })
  return id
}

/** Shared by both canvases: the zoom items on an empty-space right-click. */
export function viewSection(zoom: {
  isFit: boolean
  setFit: () => void
  reset: () => void
  zoomIn: () => void
  zoomOut: () => void
}): MenuSection {
  return {
    label: 'View',
    items: [
      { id: 'fit', label: 'Fit to pane', checked: zoom.isFit, onSelect: zoom.setFit },
      { id: 'actual', label: 'Actual size', onSelect: zoom.reset },
      { id: 'in', label: 'Zoom in', onSelect: zoom.zoomIn },
      { id: 'out', label: 'Zoom out', onSelect: zoom.zoomOut },
    ],
  }
}

/** The run the shift-click selection currently covers, if it is a legal one. */
export function activeRange(
  doc: SequenceDoc,
  anchorId: string | null,
  focusId: string | null,
): (SiblingRun & { anchorId: string }) | null {
  if (!anchorId || !focusId || anchorId === focusId) return null
  const run = siblingRun(buildTree(doc), anchorId, focusId)
  return run ? { ...run, anchorId } : null
}
