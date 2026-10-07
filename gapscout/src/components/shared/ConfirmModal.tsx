import type { ReactNode } from 'react'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { Modal } from './Modal'

/**
 * ConfirmModal - a confirmation built on the one shell (#204).
 *
 * The file was called DeleteConfirmModal.tsx while the export was already
 * ConfirmModal; the name is now the export's. Destructive actions render as
 * outlined-accent text rather than a solid red button, because the accent has
 * three jobs and "a button that deletes something" is not a fourth.
 */

type ButtonStyle = 'primary' | 'secondary' | 'danger'

interface ModalAction {
  label: string
  onClick: () => void | Promise<void>
  style?: ButtonStyle
  /** Sub-label shown below the action label. Only rendered in the stacked-options variant. */
  description?: string
}

export interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  /**
   * When provided, action buttons render as a stacked list (each full-width with optional
   * sub-description). Used by the step-deletion-options modal where a user picks between
   * two strategies. Cancel renders separately below the stack.
   */
  options?: ModalAction[]
  /**
   * When provided (and `options` is not): a single inline action button paired with Cancel.
   * Used by the four simple-confirmation modals (delete steps, delete gap, cancel row, autofill).
   */
  confirmAction?: ModalAction
  /** Defaults to "Cancel". Set explicitly when the cancel verb should differ ("Keep Editing"). */
  cancelLabel?: string
  /** The warning icon next to the copy. `null` hides it. */
  icon?: 'danger' | 'warning' | null
  /** Set when this confirmation opens from inside another dialog. */
  above?: boolean
  /**
   * Locks dismiss and action buttons (download/install in progress). Escape, backdrop,
   * header close, Cancel, and Confirm all no-op or stay disabled until cleared.
   */
  busy?: boolean
}

const buttonClass: Record<ButtonStyle, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
}

export function ConfirmModal({
  isOpen,
  onClose,
  title,
  description,
  options,
  confirmAction,
  cancelLabel = 'Cancel',
  icon = 'danger',
  above = false,
  busy = false,
}: ConfirmModalProps) {
  const hasOptions = options && options.length > 0

  const handleClose = () => {
    if (busy) return
    onClose()
  }

  const footer = hasOptions ? (
    <button type="button" className="btn-secondary" onClick={handleClose} disabled={busy}>
      {cancelLabel}
    </button>
  ) : (
    <>
      <button type="button" className="btn-secondary" onClick={handleClose} disabled={busy}>
        {cancelLabel}
      </button>
      {confirmAction && (
        <button
          type="button"
          className={buttonClass[confirmAction.style ?? 'danger']}
          onClick={confirmAction.onClick}
          disabled={busy}
        >
          {confirmAction.label}
        </button>
      )}
    </>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="md"
      above={above}
      footer={footer}
      dismissOnBackdrop={!busy}
      hideClose={busy}
    >
      {(icon || description) && (
        <div className="flex items-start gap-gs-3">
          {icon && (
            <TriangleAlert
              size={16}
              strokeWidth={2}
              className="text-gs-accent flex-shrink-0 mt-gs-1"
              aria-hidden="true"
            />
          )}
          {description && <div className="flex-1 text-[13px] text-gs-ink-muted">{description}</div>}
        </div>
      )}

      {hasOptions && (
        <div className="mt-gs-4 flex flex-col gap-gs-2">
          {options!.map((opt, i) => {
            const isPrimary = (opt.style ?? 'primary') === 'primary'
            return (
              <button
                key={i}
                type="button"
                onClick={opt.onClick}
                disabled={busy}
                className={`flex w-full items-center justify-between gap-gs-4 px-gs-4 py-gs-3 text-left border-2 transition-colors hover:bg-gs-sunken ${
                  isPrimary ? 'border-gs-accent' : 'border-gs-rule'
                }`}
              >
                <span className="flex-1">
                  <span className="block text-[13px] font-semibold text-gs-ink">{opt.label}</span>
                  {opt.description && (
                    <span className="mt-gs-1 block text-xs text-gs-ink-muted">
                      {opt.description}
                    </span>
                  )}
                </span>
                <ChevronRight size={16} strokeWidth={2} className="text-gs-ink-muted" />
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

export default ConfirmModal
