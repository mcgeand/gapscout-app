/**
 * Close a menu on an outside click or Escape.
 *
 * A `fixed inset-0` click-away layer cannot do this job on the board header.
 * `.board-chrome` declares `container-type: inline-size` for 12b's collapse, and
 * that applies layout containment — which makes the element a containing block for
 * its `position: fixed` descendants. `inset: 0` inside it resolves against the
 * header strip, not the viewport, so clicking down in the table would not dismiss
 * anything. Listening on the document is what `SearchBar` already does, and it gets
 * Escape for free.
 *
 * The diagram's own menu has the same shape, which is why this lives here rather
 * than beside one of its two callers.
 */

import { useEffect } from 'react'

export function useDismissOnOutside(
  isOpen: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, ref, onDismiss])
}
