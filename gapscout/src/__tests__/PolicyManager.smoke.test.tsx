import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../services/db', () => ({
  createPolicy: vi.fn().mockResolvedValue('p-1'),
  getPolicy: vi.fn(),
  listPolicies: vi.fn().mockResolvedValue([]),
  updatePolicy: vi.fn(),
  deletePolicy: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
}))

import PolicyManager from '../components/Policies/PolicyManager'

describe('PolicyManager — smoke', () => {
  // #207 made the registry a destination rather than a dialog, so there is no
  // closed state to assert any more. What replaces it is that the panel names
  // itself in the page — the heading the tab bar navigates to.
  it('renders as a named panel in the page', () => {
    render(<PolicyManager projectId="project-1" />)
    expect(screen.getByRole('heading', { name: 'Policies' })).toBeInTheDocument()
  })

  it('renders the empty state with no policies', async () => {
    render(<PolicyManager projectId="project-1" />)
    expect(await screen.findByText('No policies yet')).toBeInTheDocument()
  })
})
