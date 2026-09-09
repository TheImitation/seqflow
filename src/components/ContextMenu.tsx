import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MenuItem, MenuState } from './useContextMenu'

const MARGIN = 6

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const host = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  const [openSub, setOpenSub] = useState<string | null>(null)

  const flat = menu.sections.flatMap((s) => s.items)
  const [active, setActive] = useState<string | null>(null)

  // Keep the menu on screen; flip it back from the right and bottom edges.
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(MARGIN, Math.min(menu.x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(menu.y, window.innerHeight - height - MARGIN)),
    })
  }, [menu])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as globalThis.Node)) onClose()
    }
    const onScroll = () => onClose()
    // `capture` so the app-level Escape (clear selection) does not also fire.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const usable = flat.filter((i) => !i.disabled)
        if (!usable.length) return
        const at = usable.findIndex((i) => i.id === active)
        const next =
          e.key === 'ArrowDown'
            ? usable[(at + 1) % usable.length]
            : usable[(at - 1 + usable.length) % usable.length]
        setActive(next.id)
        setOpenSub(next.items?.length ? next.id : null)
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const item = flat.find((i) => i.id === active)
        if (!item || item.disabled) return
        e.preventDefault()
        if (item.items?.length) {
          setOpenSub(item.id)
          return
        }
        item.onSelect?.()
        onClose()
      }
    }

    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('resize', onScroll)
    window.addEventListener('blur', onScroll)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('blur', onScroll)
    }
  }, [flat, active, onClose])

  return createPortal(
    <div
      className="ctx-menu"
      ref={host}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.sections.map((section, i) => (
        <div key={section.label ?? i} className="ctx-section">
          {i > 0 && <div className="ctx-divider" />}
          {section.label && <div className="ctx-label">{section.label}</div>}
          {section.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              active={active === item.id}
              subOpen={openSub === item.id}
              onHover={() => {
                setActive(item.id)
                setOpenSub(item.items?.length ? item.id : null)
              }}
              onClose={onClose}
            />
          ))}
        </div>
      ))}
    </div>,
    document.body,
  )
}

function Row({
  item,
  active,
  subOpen,
  onHover,
  onClose,
}: {
  item: MenuItem
  active: boolean
  subOpen: boolean
  onHover: () => void
  onClose: () => void
}) {
  const row = useRef<HTMLButtonElement | null>(null)
  const [flip, setFlip] = useState(false)
  const [activeSub, setActiveSub] = useState<string | null>(null)
  const [openGrandchild, setOpenGrandchild] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!subOpen || !row.current) return
    const r = row.current.getBoundingClientRect()
    setFlip(r.right + 230 > window.innerWidth)
  }, [subOpen])

  const hasSub = !!item.items?.length

  return (
    <div className="ctx-row-wrap">
      <button
        ref={row}
        className={[
          'ctx-row',
          active ? 'active' : '',
          item.danger ? 'danger' : '',
          item.checked ? 'checked' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="menuitem"
        disabled={item.disabled}
        onMouseEnter={onHover}
        onClick={() => {
          if (item.disabled || hasSub) return
          item.onSelect?.()
          onClose()
        }}
      >
        <span className="ctx-tick">{item.checked ? '✓' : ''}</span>
        <span className="ctx-text">{item.label}</span>
        {item.hint && <span className="ctx-hint">{item.hint}</span>}
        {hasSub && <span className="ctx-caret">›</span>}
      </button>

      {hasSub && subOpen && (
        <div className={`ctx-menu ctx-sub${flip ? ' flip' : ''}`} role="menu">
          {/* Recursive, so a group can open a group — 40-odd participant kinds
              are only navigable two levels deep. */}
          {item.items!.map((sub) => (
            <Row
              key={sub.id}
              item={sub}
              active={activeSub === sub.id}
              subOpen={openGrandchild === sub.id}
              onHover={() => {
                setActiveSub(sub.id)
                setOpenGrandchild(sub.items?.length ? sub.id : null)
              }}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  )
}
