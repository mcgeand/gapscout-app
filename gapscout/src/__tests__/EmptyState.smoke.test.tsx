/**
 * #205: one grammar for empty, loading and error. The regression these guard
 * against is the poster coming back — a `text-6xl` emoji above centred prose —
 * and an error state that does not announce itself.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EmptyState } from '../components/shared/EmptyState'

afterEach(cleanup)

describe('EmptyState — smoke', () => {
  it('renders a heading, one sentence and one action', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No teams yet"
        message="Teams say who owns which process step."
        action={<button onClick={onClick}>Add Your First Team</button>}
      />
    )
    expect(screen.getByRole('heading', { name: 'No teams yet' })).toBeInTheDocument()
    expect(screen.getByText('Teams say who owns which process step.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add Your First Team' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('omits the action block when no action is offered', () => {
    const { container } = render(<EmptyState title="No matching gaps" message="Nothing matches." />)
    expect(container.querySelector('.state-action')).toBeNull()
  })

  it('says what is loading and marks the panel busy', () => {
    const { container } = render(
      <EmptyState
        kind="loading"
        title="Opening the team registry"
        message="Reading teams from the local database."
      />
    )
    expect(screen.getByText('Opening the team registry')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('announces an error and takes the accent edge', () => {
    const { container } = render(
      <EmptyState kind="error" title="Could not read gaps" message="The database is locked." />
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(container.querySelector('.state-error')).not.toBeNull()
  })

  it('is a panel, not a poster', () => {
    const { container } = render(<EmptyState title="No steps yet" message="Add one." />)
    const panel = container.querySelector('.state')!
    expect(panel.className).not.toMatch(/py-16|text-6xl|text-center/)
    // No decorative glyph: an empty state carries a heading, not a picture.
    expect(panel.querySelector('svg')).toBeNull()
  })
})
