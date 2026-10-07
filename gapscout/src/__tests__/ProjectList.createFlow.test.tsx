/**
 * What the manual create path leaves behind (#395).
 *
 * The wizard seeds: teams, systems, and the "Main Flow" milestone, each written
 * through a path that moves the project's `updated_at`. So a project reaches
 * the grid with `updated_at` already ahead of `created_at`, and the card — which
 * reads exactly that comparison to choose between "Created" and "Edited" —
 * would call every project ever made here "Edited" before anyone had opened it.
 * `resetProjectUpdatedAt` is what keeps the "Created" branch reachable, and it
 * has to run after the last seed write or a touch still to come undoes it.
 *
 * The wizard itself is stubbed to a button: its own steps are
 * `ProjectSetupWizard.template.test.tsx`'s subject, and driving them here would
 * test that file's code to reach one call in this one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProjectSetupData } from '../components/Setup/ProjectSetupWizard'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

// `vi.hoisted`, because every factory below is lifted above these declarations.
const SETUP: ProjectSetupData = vi.hoisted(() => ({
  projectName: 'Order to Cash',
  projectDescription: 'How an order becomes money',
  projectState: 'current',
  template: null,
  teams: [{ name: 'Operations', color: '#201e1d', description: 'Fulfilment' }],
  systems: [{ name: 'ERP', description: 'Ledger of record' }],
})) as ProjectSetupData

vi.mock('../components/Setup/ProjectSetupWizard', () => ({
  default: ({ isOpen, onComplete }: { isOpen: boolean; onComplete: (data: ProjectSetupData) => void }) =>
    isOpen ? <button onClick={() => onComplete(SETUP)}>Finish setup</button> : null,
}))

const createProject = vi.hoisted(() => vi.fn(async () => ({ id: 'proj-new', name: 'Order to Cash' })))
vi.mock('../state/projectStore', () => ({
  useProjectStore: () => ({
    projects: [],
    isLoading: false,
    isInitialized: true,
    createProject,
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    loadProjects: vi.fn(async () => {}),
  }),
}))

const addTeam = vi.hoisted(() => vi.fn(async () => {}))
const addSystem = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../state/teamsStore', () => ({ useTeamsStore: () => ({ addTeam }) }))
vi.mock('../state/systemsStore', () => ({ useSystemsStore: () => ({ addSystem }) }))

const createMilestone = vi.hoisted(() => vi.fn(async () => 'ms-1'))
const resetProjectUpdatedAt = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../services/db', () => ({ createMilestone, resetProjectUpdatedAt }))
vi.mock('../services/templateService', () => ({ applyTemplate: vi.fn() }))
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: vi.fn() } }))

import ProjectList from '../pages/ProjectList'

async function runTheWizard(): Promise<void> {
  render(<ProjectList />)
  fireEvent.click(screen.getByRole('button', { name: /New Project/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
  await waitFor(() => expect(resetProjectUpdatedAt).toHaveBeenCalled())
}

describe('the manual create path (#395)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('puts the new project’s updated_at back before leaving the page', async () => {
    await runTheWizard()

    expect(resetProjectUpdatedAt).toHaveBeenCalledWith('proj-new')
  })

  it('does it after the last seed write, so nothing touches the project again', async () => {
    // Order matters rather than presence: the milestone create moves
    // `updated_at` too, so a reset run before it would be overwritten by the
    // very write it is meant to cover.
    await runTheWizard()

    const lastSeed = Math.max(
      addTeam.mock.invocationCallOrder[0],
      addSystem.mock.invocationCallOrder[0],
      createMilestone.mock.invocationCallOrder[0]
    )
    expect(resetProjectUpdatedAt.mock.invocationCallOrder[0]).toBeGreaterThan(lastSeed)
  })

  it('still opens the project it created', async () => {
    await runTheWizard()

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects/proj-new'))
  })

  it('reports one aggregate toast after seeding teams and systems (#177)', async () => {
    await runTheWizard()

    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Order to Cash' }),
      { silent: true }
    )
    expect(addTeam).toHaveBeenCalledWith(expect.any(Object), { silent: true })
    expect(addSystem).toHaveBeenCalledWith(expect.any(Object), { silent: true })
    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith(
      'Project "Order to Cash" created — 1 team, 1 system'
    )
  })
})
