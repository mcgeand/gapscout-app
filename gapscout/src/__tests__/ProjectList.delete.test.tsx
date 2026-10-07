/**
 * The project delete control on the project list (#314).
 *
 * `db.deleteProject` and `projectStore.deleteProject` both existed already; the
 * only thing missing was a way to reach them, so every project ever created was
 * permanent. These tests cover the reaching: the control is on the card, it
 * does not open the project it sits on, it confirms before deleting, and
 * cancelling deletes nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react'
import type { ProjectSummary } from '../data/types'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}))

const deleteProject = vi.fn(async () => {})
const loadProjects = vi.fn(async () => {})
/** Mutable so a test can render the list as the last delete leaves it. */
let projects: ProjectSummary[] = [
  {
    id: 'proj-keep',
    name: 'Order to Cash',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    stepCount: 4,
    openGapCount: 1,
  },
  {
    id: 'proj-doomed',
    name: 'Scratch Project',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    stepCount: 0,
    openGapCount: 0,
  },
]

vi.mock('../state/projectStore', () => ({
  useProjectStore: () => ({
    projects,
    isLoading: false,
    isInitialized: true,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject,
    loadProjects,
  }),
}))

vi.mock('../state/teamsStore', () => ({ useTeamsStore: () => ({ addTeam: vi.fn() }) }))
vi.mock('../state/systemsStore', () => ({ useSystemsStore: () => ({ addSystem: vi.fn() }) }))
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

import ProjectList from '../pages/ProjectList'

/** The card for a named project — the delete control is scoped to its own card. */
function cardFor(name: string): HTMLElement {
  return screen.getByRole('article', { name })
}

const twoProjects = () => [...projects]

describe('ProjectList — deleting a project (#314)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    projects = twoProjects()
    render(<ProjectList />)
  })

  it('puts a delete control on every project card', () => {
    expect(within(cardFor('Order to Cash')).getByLabelText('Delete Order to Cash')).toBeInTheDocument()
    expect(within(cardFor('Scratch Project')).getByLabelText('Delete Scratch Project')).toBeInTheDocument()
  })

  it('confirms before deleting, naming the project and saying it is permanent', async () => {
    fireEvent.click(within(cardFor('Scratch Project')).getByLabelText('Delete Scratch Project'))

    expect(screen.getByText('Delete Project?')).toBeInTheDocument()
    expect(screen.getByText('"Scratch Project"')).toBeInTheDocument()
    expect(screen.getByText(/permanent and cannot be undone/i)).toBeInTheDocument()
    // Nothing is deleted by opening the confirm.
    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('does not open the project the delete control sits on', async () => {
    fireEvent.click(within(cardFor('Scratch Project')).getByLabelText('Delete Scratch Project'))

    expect(navigate).not.toHaveBeenCalled()
  })

  it('deletes the confirmed project, and only that one', async () => {
    fireEvent.click(within(cardFor('Scratch Project')).getByLabelText('Delete Scratch Project'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Project' }))

    await waitFor(() => expect(deleteProject).toHaveBeenCalledTimes(1))
    expect(deleteProject).toHaveBeenCalledWith('proj-doomed')
  })

  it('deletes nothing when the confirm is cancelled', async () => {
    fireEvent.click(within(cardFor('Scratch Project')).getByLabelText('Delete Scratch Project'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteProject).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete Project?')).not.toBeInTheDocument()
  })

  it('lands on the empty state when the last project is deleted', () => {
    // The store reloads the list after a delete, so an emptied list is exactly
    // what this page is handed — not a blank screen.
    cleanup()
    projects = []
    render(<ProjectList />)

    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Your First Project/ })).toBeInTheDocument()
  })
})
