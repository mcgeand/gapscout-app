import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Milestone, System, Team } from '../data/types'

const {
  mockCreateMilestone,
  mockGetMilestone,
  mockListSteps,
  mockListGaps,
  mockListMilestones,
  mockToast,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => {
  const mockToastError = vi.fn()
  const mockToastSuccess = vi.fn()
  return {
    mockCreateMilestone: vi.fn(),
    mockGetMilestone: vi.fn(),
    mockListSteps: vi.fn(),
    mockListGaps: vi.fn(),
    mockListMilestones: vi.fn(),
    mockToast: Object.assign(vi.fn(), {
      error: mockToastError,
      success: mockToastSuccess,
    }),
    mockToastError,
    mockToastSuccess,
  }
})

vi.mock('../services/db', () => ({
  createStep: vi.fn(),
  listSteps: mockListSteps,
  getStep: vi.fn(),
  updateStep: vi.fn(),
  setStepOrders: vi.fn(),
  setGapOrders: vi.fn(),
  deleteStep: vi.fn(),
  listMilestones: mockListMilestones,
  getMilestone: mockGetMilestone,
  createMilestone: mockCreateMilestone,
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  createTeam: vi.fn(),
  listTeams: vi.fn(),
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  getTeamUsageCount: vi.fn(),
  createSystem: vi.fn(),
  listSystems: vi.fn(),
  getSystem: vi.fn(),
  updateSystem: vi.fn(),
  deleteSystem: vi.fn(),
  getSystemUsageCount: vi.fn(),
  createGap: vi.fn(),
  listGaps: mockListGaps,
  listGapsByStep: vi.fn(),
  getGap: vi.fn(),
  updateGap: vi.fn(),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))
vi.mock('../components/Discovery/MilestoneManager', () => ({ MilestoneManager: () => null }))
vi.mock('../components/Discovery/ProcessGapManager', () => ({ ProcessGapManager: () => null }))
vi.mock('../components/Discovery/ValidationWarningModal', () => ({ ValidationWarningModal: () => null }))
vi.mock('../components/shared/ConfirmModal', () => ({ ConfirmModal: () => null }))

import DiscoveryGrid from '../components/Discovery/DiscoveryGrid'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useTeamsStore } from '../state/teamsStore'

const mainFlow: Milestone = {
  id: 'milestone-new',
  projectId: 'project-1',
  name: 'Main Flow',
  order: 0,
  description: 'Primary process flow',
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

const existingMilestone: Milestone = {
  id: 'milestone-1',
  projectId: 'project-1',
  name: 'Requisition',
  order: 0,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

const team: Team = {
  id: 'team-1',
  projectId: 'project-1',
  name: 'Operations',
  color: '#000000',
  order: 0,
  tags: [],
  createdAt: 0,
}

const system: System = {
  id: 'system-1',
  projectId: 'project-1',
  name: 'ERP',
  tags: [],
  createdAt: 0,
}

const seedStores = (milestones: Milestone[]) => {
  useStepsStore.setState({
    steps: [],
    milestones,
    currentProjectId: 'project-1',
    currentStep: null,
    isLoading: false,
    loadSteps: vi.fn().mockResolvedValue(undefined),
  })
  useTeamsStore.setState({
    teams: [team],
    currentProjectId: 'project-1',
    isLoading: false,
    loadTeams: vi.fn().mockResolvedValue(undefined),
  })
  useSystemsStore.setState({
    systems: [system],
    currentProjectId: 'project-1',
    isLoading: false,
    loadSystems: vi.fn().mockResolvedValue(undefined),
  })
  useGapsStore.setState({
    gaps: [],
    currentProjectId: 'project-1',
    currentGap: null,
    isLoading: false,
    loadGaps: vi.fn().mockResolvedValue(undefined),
  })
}

const clickAddFirstStep = async () => {
  const button = await screen.findByRole('button', { name: /Add First Step/ })
  // The handler awaits the milestone create before it touches state, so the
  // click has to be flushed as an async act or React warns about the update.
  await act(async () => {
    fireEvent.click(button)
  })
}

describe('DiscoveryGrid on a project with no milestone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListSteps.mockResolvedValue([])
    mockListGaps.mockResolvedValue([])
  })

  it('creates the first milestone and adds the step instead of refusing', async () => {
    // The bug this replaces: the grid answered "+ Add First Step" with
    // "No milestone found. Please create a project first." — the project exists,
    // and creating another one is not the fix (#168).
    seedStores([])
    mockListMilestones.mockResolvedValue([mainFlow])
    mockCreateMilestone.mockResolvedValue(mainFlow.id)
    mockGetMilestone.mockResolvedValue(mainFlow)

    render(<DiscoveryGrid projectId="project-1" />)
    await clickAddFirstStep()

    await waitFor(() =>
      expect(mockCreateMilestone).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          name: 'Main Flow',
          order: 0,
        })
      )
    )

    // Pending rows toast on save, not when the empty row appears (#282).
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports a failed milestone create once and adds no step', async () => {
    seedStores([])
    mockListMilestones.mockResolvedValue([])
    mockCreateMilestone.mockRejectedValue(new Error('disk full'))

    render(<DiscoveryGrid projectId="project-1" />)
    await clickAddFirstStep()

    // The store owns that report; the grid must not stack a second toast on it.
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Failed to create milestone')
    )
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(screen.getByText('No steps yet')).toBeInTheDocument()
  })

  it('creates one milestone when the button is clicked twice in a row', async () => {
    // `milestones` is the handler's closure copy and stays empty for the whole
    // await, so both clicks pass the "no milestones at all" guard. Nothing in
    // the schema stops the second write — the project would just end up with
    // two "Main Flow" milestones at order 0.
    seedStores([])
    mockListMilestones.mockResolvedValue([mainFlow])
    mockCreateMilestone.mockResolvedValue(mainFlow.id)
    mockGetMilestone.mockResolvedValue(mainFlow)

    render(<DiscoveryGrid projectId="project-1" />)
    const button = await screen.findByRole('button', { name: /Add First Step/ })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })

    await waitFor(() => expect(mockCreateMilestone).toHaveBeenCalledTimes(1))
    // And one row, not one row plus a second toast for a row that was dropped:
    // both clicks resume in the same microtask drain, so the second would
    // append from the same stale `steps`.
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(screen.getAllByPlaceholderText('Enter process step...')).toHaveLength(1)
  })

  it('asks for a team before it writes a milestone', async () => {
    // A project with neither should not end up with a milestone persisted for a
    // step it was then refused.
    seedStores([])
    useTeamsStore.setState({ teams: [] })
    mockListMilestones.mockResolvedValue([])

    render(<DiscoveryGrid projectId="project-1" />)
    await clickAddFirstStep()

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('No teams found. Please set up teams first.')
    )
    expect(mockCreateMilestone).not.toHaveBeenCalled()
  })

  it('leaves a project that already has milestones alone', async () => {
    // A template seeds its own phases and none of them is called "Main Flow"
    // (#146). The guard is "no milestones at all", so this project must not gain
    // a second one.
    seedStores([existingMilestone])
    mockListMilestones.mockResolvedValue([existingMilestone])

    render(<DiscoveryGrid projectId="project-1" />)
    await clickAddFirstStep()

    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockCreateMilestone).not.toHaveBeenCalled()
  })
})
