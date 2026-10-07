import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ error: undefined as unknown, revalidate: vi.fn() }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useRouteError: () => state.error,
    useRevalidator: () => ({ revalidate: state.revalidate }),
  }
})

import ProjectRouteError from '../app/ProjectRouteError'

beforeEach(() => {
  state.error = undefined
  state.revalidate.mockReset()
})

describe('project route error rendering', () => {
  it('renders the not-found state only for a 404 response', () => {
    state.error = { status: 404, statusText: 'Not Found', data: 'missing', internal: false }
    render(<ProjectRouteError />)
    expect(screen.getByText('Project Not Found')).toBeInTheDocument()
    expect(screen.queryByText('Project unavailable')).not.toBeInTheDocument()
  })

  it('renders an actionable database error for initialization failures', () => {
    state.error = new Error('database unavailable')
    render(<ProjectRouteError />)
    expect(screen.getByText('Project unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(state.revalidate).toHaveBeenCalledOnce()
    expect(screen.queryByText('Project Not Found')).not.toBeInTheDocument()
  })
})
