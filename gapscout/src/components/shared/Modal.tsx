import { useEffect, useId, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Modal - the one dialog shell (#204).
 *
 * Before this, ~24 dialogs hand-rolled the same backdrop/centring/panel triple
 * and disagreed on all three. Every one of them now renders here, so the frame,
 * the z-index step, the Escape key and the backdrop opacity are decided once.
 *
 * The backdrop is the reason this could not wait: `bg-black bg-opacity-50` was
 * removed in Tailwind v4 and painted fully opaque at every call site (#178).
 */

/**
 * Mount order of the open dialogs, so Escape reaches only the top one. Module
 * scope is deliberate: it is one stack for the whole app, which is exactly the
 * scope the keydown listener has.
 */
const openModals: object[] = []

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'wide'

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  wide: 'max-w-6xl',
}

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  /** Rendered in the header and used as the dialog's accessible name. */
  title: string
  /** One sentence under the title. */
  description?: ReactNode
  children: ReactNode
  /** Action buttons. Rendered bottom-right above a 2px rule. */
  footer?: ReactNode
  size?: ModalSize
  /**
   * Renders above an already-open dialog, clearing the popover level so a
   * dropdown left open behind it cannot paint over it.
   */
  above?: boolean
  /** Set false for a dialog that must be dismissed through its own buttons. */
  dismissOnBackdrop?: boolean
  /** Hides the header's close button; Escape still works. */
  hideClose?: boolean
  /** Buttons that belong beside the close button — a registry's "Add" action. */
  headerActions?: ReactNode
  /**
   * Drops the body's own padding, for a dialog that lays out its own scroll
   * regions (the wizards, the step editor).
   */
  bare?: boolean
  /** Extra classes on the panel. */
  className?: string
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  above = false,
  dismissOnBackdrop = true,
  hideClose = false,
  headerActions,
  bare = false,
  className = '',
}: ModalProps) {
  const titleId = useId()

  // Escape closes the topmost dialog only. Every open Modal listens on
  // `document`, so without the stack one Escape inside a registry's delete
  // confirmation would close the confirmation *and* the registry behind it.
  useEffect(() => {
    if (!isOpen) return
    const token = {}
    openModals.push(token)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (openModals[openModals.length - 1] !== token) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const i = openModals.indexOf(token)
      if (i !== -1) openModals.splice(i, 1)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const layer = above ? 'modal-above' : ''

  return (
    <div className={layer}>
      <div
        className="modal-backdrop"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="modal-layer">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`modal-panel ${sizeClass[size]} ${className}`}
        >
          <div className="modal-head">
            <div>
              <h2 id={titleId} className="modal-title">
                {title}
              </h2>
              {description && <div className="modal-description">{description}</div>}
            </div>
            <div className="flex flex-shrink-0 items-center gap-gs-2">
              {headerActions}
              {!hideClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-ghost p-gs-1"
                  aria-label={`Close ${title}`}
                >
                  <X size={16} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          <div className={bare ? 'flex-1 min-h-0 overflow-y-auto' : 'modal-body'}>{children}</div>

          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

export default Modal
