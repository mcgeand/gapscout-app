/**
 * #264 — a project name truncates in four places with no way to read it.
 *
 * The two sites covered here render a project name from a store. jsdom does not
 * lay out text, so the clamp itself cannot be measured; what is asserted is the
 * part that is actually observable — the `title` attribute that makes a clipped
 * name recoverable — plus the clamp utility the acceptance criteria name.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// 60 characters, the length the issue's acceptance criterion names.
const LONG_NAME = 'Procure to Pay End to End Current State Process Map v3 Draft'

const PROJECT = {
  id: 'proj-1',
  name: LONG_NAME,
  description: '',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  stepCount: 0,
  openGapCount: 0,
}

const projectState = {
  projects: [PROJECT],
  isLoading: false,
  isInitialized: true,
  createProject: vi.fn(),
  updateProject: vi.fn(),
  loadProjects: vi.fn(),
}

vi.mock('../state/projectStore', () => ({
  useProjectStore: (selector?: (state: typeof projectState) => unknown) =>
    selector ? selector(projectState) : projectState,
}))

vi.mock('../state/teamsStore', () => ({
  useTeamsStore: () => ({ addTeam: vi.fn() }),
}))

vi.mock('../state/systemsStore', () => ({
  useSystemsStore: () => ({ addSystem: vi.fn() }),
}))

vi.mock('../services/db', () => ({
  createMilestone: vi.fn(),
}))

import Sidebar from '../app/layout/Sidebar'
import ProjectList from '../pages/ProjectList'

describe('Sidebar project row (#264)', () => {
  it('carries the full name in a title attribute', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Sidebar isCollapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>
    )
    expect(screen.getByText(LONG_NAME)).toHaveAttribute('title', LONG_NAME)
  })

  it('clamps the name at two lines instead of one', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Sidebar isCollapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>
    )
    const name = screen.getByText(LONG_NAME)
    expect(name.className).toContain('line-clamp-2')
    expect(name.className).not.toContain('truncate')
  })
})

describe('ProjectList card (#264)', () => {
  it('carries the full name in a title attribute', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <ProjectList />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('heading', { level: 3, name: LONG_NAME })
    ).toHaveAttribute('title', LONG_NAME)
  })

  it('clamps the name at two lines instead of one', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <ProjectList />
      </MemoryRouter>
    )
    const name = screen.getByRole('heading', { level: 3, name: LONG_NAME })
    expect(name.className).toContain('line-clamp-2')
    expect(name.className).not.toContain('truncate')
  })
})
