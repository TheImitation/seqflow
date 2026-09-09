import { useEffect } from 'react'

/**
 * Escape closes the topmost overlay. Capture phase and `stopPropagation` keep
 * the app-level Escape (clear selection) from also firing, and keep nested
 * overlays from all closing at once.
 */
export function useDismiss(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose, enabled])
}
