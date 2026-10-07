import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ConfirmModal } from '../components/shared/ConfirmModal'

describe('ConfirmModal — smoke', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmModal
        isOpen={false}
        onClose={vi.fn()}
        title="Closed Modal"
        confirmAction={{ label: 'OK', onClick: vi.fn() }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders simple confirmation variant when open', () => {
    cleanup()
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        title="Delete It?"
        description="This cannot be undone."
        confirmAction={{ label: 'Delete', onClick: vi.fn(), style: 'danger' }}
      />
    )
    expect(screen.getByText('Delete It?')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('renders options variant with stacked action buttons', () => {
    cleanup()
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        title="Pick a Strategy"
        icon="warning"
        options={[
          { label: 'Strategy A', description: 'desc A', onClick: vi.fn(), style: 'primary' },
          { label: 'Strategy B', description: 'desc B', onClick: vi.fn(), style: 'secondary' },
        ]}
      />
    )
    expect(screen.getByText('Pick a Strategy')).toBeInTheDocument()
    expect(screen.getByText('Strategy A')).toBeInTheDocument()
    expect(screen.getByText('Strategy B')).toBeInTheDocument()
  })
})
