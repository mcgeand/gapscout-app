/**
 * #208 / section 12d — the sidebar project row.
 *
 * The row has no horizontal room to give, so a project's state (#263) renders
 * as a one-letter mark in a fixed-width column rather than a word. The third
 * case is the one that matters: `state` is nullable on purpose, and a project
 * nobody has classified must draw nothing at all — a mark that guessed would be
 * the same defect as the hardcoded `Ready` this replaces.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const PROJECTS = [
  { id: 'p-current', name: 'As It Runs', state: 'current' as const },
  { id: 'p-future', name: 'As It Should Run', state: 'future' as const },
  { id: 'p-unset', name: 'Nobody Has Said' },
].map((p) => ({ ...p, description: '', createdAt: 1, updatedAt: 1 }))

const projectState = { projects: PROJECTS, isLoading: false }

vi.mock('../state/projectStore', () => ({
  useProjectStore: (selector?: (state: typeof projectState) => unknown) =>
    selector ? selector(projectState) : projectState,
}))

import Sidebar from '../app/layout/Sidebar'

function renderSidebar() {
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <Sidebar isCollapsed={false} onToggle={vi.fn()} />
    </MemoryRouter>
  )
}

/** The row is the button; the mark is its first cell. */
function markFor(name: string): HTMLElement | null {
  const row = screen.getByText(name).closest('button') as HTMLElement
  return row.querySelector('.side-state')
}

describe('Sidebar project state mark (#208, 12d)', () => {
  it('marks a current-state project with C in the accent', () => {
    renderSidebar()
    const mark = markFor('As It Runs')
    expect(mark).toHaveTextContent('C')
    expect(mark?.className).toContain('side-state-current')
  })

  it('marks a future-state project with F, quietly', () => {
    renderSidebar()
    const mark = markFor('As It Should Run')
    expect(mark).toHaveTextContent('F')
    expect(mark?.className).toContain('side-state-future')
  })

  it('draws no letter for a project whose state nobody has set', () => {
    renderSidebar()
    const mark = markFor('Nobody Has Said')
    // The column still reserves its width, so the three names stay aligned.
    expect(mark).toBeInTheDocument()
    expect(mark).toHaveTextContent('')
    expect(mark?.className).not.toContain('side-state-current')
    expect(mark?.className).not.toContain('side-state-future')
  })

  it('no longer prints the hardcoded Ready line under every name', () => {
    renderSidebar()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
  })
})
