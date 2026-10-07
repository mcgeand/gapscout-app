/**
 * #204: the one dialog shell. These pin the three things every call site now
 * inherits instead of hand-rolling — the dialog role, Escape, and the backdrop
 * — plus the nested step, because a dialog opened from inside a dialog is the
 * only stacking the app has.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Modal } from '../components/shared/Modal'

afterEach(cleanup)

describe('Modal — smoke', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal isOpen={false} onClose={vi.fn()} title="Closed">
        body
      </Modal>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('exposes the title as the dialog’s accessible name', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Manage Teams" description="Who owns what">
        body
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Manage Teams')
    expect(screen.getByText('Who owns what')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen onClose={onClose} title="Edit Step">
        body
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not listen for Escape while closed', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen={false} onClose={onClose} title="Edit Step">
        body
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a backdrop click, and not when the dialog declines it', () => {
    const onClose = vi.fn()
    const { rerender, container } = render(
      <Modal isOpen onClose={onClose} title="Edit Step">
        body
      </Modal>
    )
    fireEvent.click(container.querySelector('.modal-backdrop')!)
    expect(onClose).toHaveBeenCalledOnce()

    onClose.mockClear()
    rerender(
      <Modal isOpen onClose={onClose} title="Edit Step" dismissOnBackdrop={false}>
        body
      </Modal>
    )
    fireEvent.click(container.querySelector('.modal-backdrop')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sends Escape to the topmost dialog only', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    const { rerender } = render(
      <>
        <Modal isOpen onClose={closeOuter} title="Manage Teams">
          registry
        </Modal>
        <Modal isOpen onClose={closeInner} title="Delete Team?" above>
          confirm
        </Modal>
      </>
    )

    // One Escape must not take the registry down with the confirmation.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeInner).toHaveBeenCalledOnce()
    expect(closeOuter).not.toHaveBeenCalled()

    // With the confirmation gone, Escape reaches the registry.
    rerender(
      <>
        <Modal isOpen onClose={closeOuter} title="Manage Teams">
          registry
        </Modal>
      </>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeOuter).toHaveBeenCalledOnce()
  })

  it('raises a nested dialog above the popover level', () => {
    const { container } = render(
      <Modal isOpen onClose={vi.fn()} title="Delete Team?" above>
        body
      </Modal>
    )
    // The class is what carries the z step; the value lives in the token sheet
    // so no component picks a number.
    expect(container.querySelector('.modal-above')).not.toBeNull()
  })

  it('hides the close button on request but keeps the header actions', () => {
    render(
      <Modal
        isOpen
        onClose={vi.fn()}
        title="Manage Teams"
        hideClose
        headerActions={<button>Add Team</button>}
      >
        body
      </Modal>
    )
    expect(screen.queryByRole('button', { name: 'Close Manage Teams' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add Team' })).toBeInTheDocument()
  })

  it('renders footer actions only when given', () => {
    const { container, rerender } = render(
      <Modal isOpen onClose={vi.fn()} title="Edit Step">
        body
      </Modal>
    )
    expect(container.querySelector('.modal-foot')).toBeNull()

    rerender(
      <Modal isOpen onClose={vi.fn()} title="Edit Step" footer={<button>Save</button>}>
        body
      </Modal>
    )
    expect(container.querySelector('.modal-foot')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})
