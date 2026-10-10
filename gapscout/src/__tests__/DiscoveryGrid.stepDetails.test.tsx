/**
 * #209: Trigger/Notes left the Discovery grid. The Process cell's SquarePen
 * opens StepEditModal — the only path back into those fields from Discovery.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Milestone, Step, Team } from '../data/types'

const { mockDbUpdateStep, mockListSteps, mockListGaps, mockListMilestones } = vi.hoisted(() => ({
  mockDbUpdateStep: vi.fn(),
  mockListSteps: vi.fn(),
  mockListGaps: vi.fn(),
  mockListMilestones: vi.fn(),
}))

vi.mock('../services/db', () => ({
  createStep: vi.fn(),
  listSteps: mockListSteps,
  getStep: vi.fn(),
  updateStep: mockDbUpdateStep,
  setStepOrders: vi.fn(),
  setGapOrders: vi.fn(),
  deleteStep: vi.fn(),
  listMilestones: mockListMilestones,
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  createTeam: vi.fn(),
  listTeams: vi.fn().mockResolvedValue([]),
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  getTeamUsageCount: vi.fn(),
  createSystem: vi.fn(),
  listSystems: vi.fn().mockResolvedValue([]),
  getSystem: vi.fn(),
  updateSystem: vi.fn(),
  deleteSystem: vi.fn(),
  getSystemUsageCount: vi.fn(),
  createGap: vi.fn(),
  listGaps: mockListGaps,
  listGapsByStep: vi.fn().mockResolvedValue([]),
  getGap: vi.fn(),
  updateGap: vi.fn(),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock('../components/Discovery/MilestoneManager', () => ({ MilestoneManager: () => null }))
vi.mock('../components/Discovery/ProcessGapManager', () => ({ ProcessGapManager: () => null }))
vi.mock('../components/Discovery/ValidationWarningModal', () => ({ ValidationWarningModal: () => null }))
vi.mock('../components/shared/ConfirmModal', () => ({ ConfirmModal: () => null }))

import DiscoveryGrid from '../components/Discovery/DiscoveryGrid'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useTeamsStore } from '../state/teamsStore'
import { beginProjectScope } from '../state/workspaceScope'

const milestone: Milestone = {
  id: 'milestone-1',
  projectId: 'project-1',
  name: 'Main Flow',
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

const savedStep: Step = {
  id: 'step-1',
  projectId: 'project-1',
  label: 'Review request',
  teamId: team.id,
  milestoneId: milestone.id,
  order: 1,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
}

describe('DiscoveryGrid — Edit step details opens Trigger/Notes (#209)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    beginProjectScope('project-1')
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockListSteps.mockResolvedValue([savedStep])
    mockListGaps.mockResolvedValue([])
    mockListMilestones.mockResolvedValue([milestone])

    useStepsStore.setState({
      steps: [savedStep],
      milestones: [milestone],
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: [savedStep] })
      }),
      updateStep: useStepsStore.getState().updateStep,
    })
    useTeamsStore.setState({
      teams: [team],
      currentProjectId: 'project-1',
      isLoading: false,
      loadTeams: vi.fn().mockResolvedValue(undefined),
    })
    useSystemsStore.setState({
      systems: [],
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
  })

  it('opens StepEditModal from a saved row, saves a Trigger edit, and hides the control on a new row', async () => {
    render(<DiscoveryGrid projectId="project-1" />)

    await waitFor(() => expect(screen.getByText('Review request')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit step details' }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByLabelText('Trigger')).toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Trigger'), {
      target: { value: 'PO arrives' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save step' }))

    await waitFor(() =>
      expect(mockDbUpdateStep).toHaveBeenCalledWith(
        'step-1',
        expect.objectContaining({ trigger: 'PO arrives' }),
        'project-1'
      )
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Pending insert tray: SquarePen must stay off the unsaved row.
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }))
    await waitFor(() => expect(screen.getByText('Save Step')).toBeInTheDocument())

    expect(screen.getAllByRole('button', { name: 'Edit step details' })).toHaveLength(1)
  })
})
