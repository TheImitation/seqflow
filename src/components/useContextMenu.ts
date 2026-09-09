import { useCallback, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  /** Right-aligned secondary text: a shortcut, a count, a reason. */
  hint?: string
  disabled?: boolean
  danger?: boolean
  /** Renders a leading tick — for the currently-applied option in a group. */
  checked?: boolean
  onSelect?: () => void
  items?: MenuItem[]
}

export interface MenuSection {
  label?: string
  items: MenuItem[]
}

export interface MenuState {
  x: number
  y: number
  sections: MenuSection[]
}

/**
 * Right-click plumbing. The menu renders through a portal because both canvases
 * are `overflow: auto`, which would otherwise clip it at the pane edge.
 */
export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const open = useCallback(
    (event: { clientX: number; clientY: number; preventDefault: () => void }, sections: MenuSection[]) => {
      event.preventDefault()
      const usable = sections.filter((s) => s.items.length)
      if (!usable.length) return
      setMenu({ x: event.clientX, y: event.clientY, sections: usable })
    },
    [],
  )

  const close = useCallback(() => setMenu(null), [])
  return { menu, open, close }
}

