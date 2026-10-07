import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../services/db', () => ({
  createGlossaryEntry: vi.fn().mockResolvedValue('g-1'),
  getGlossaryEntry: vi.fn(),
  listGlossaryEntries: vi.fn().mockResolvedValue([]),
  updateGlossaryEntry: vi.fn(),
  deleteGlossaryEntry: vi.fn(),
  listSteps: vi.fn().mockResolvedValue([]),
}))

import GlossaryManager from '../components/Glossary/GlossaryManager'

describe('GlossaryManager — smoke', () => {
  // #207 made the registry a destination rather than a dialog, so there is no
  // closed state to assert any more. What replaces it is that the panel names
  // itself in the page — the heading the tab bar navigates to.
  it('renders as a named panel in the page', () => {
    render(<GlossaryManager projectId="project-1" />)
    expect(screen.getByRole('heading', { name: 'Glossary' })).toBeInTheDocument()
  })

  it('renders the empty state with no entries', async () => {
    render(<GlossaryManager projectId="project-1" />)
    expect(await screen.findByText('No terms yet')).toBeInTheDocument()
  })
})
