import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Milestone, Step, System, Team } from '../data/types'

const {
  mockSetStepOrders,
  mockSetGapOrders,
  mockListSteps,
  mockListGaps,
  mockListMilestones,
  mockDbUpdateStep,
  mockToast,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => {
  const mockToastError = vi.fn()
  const mockToastSuccess = vi.fn()
  return {
    mockSetStepOrders: vi.fn(),
    mockSetGapOrders: vi.fn(),
    mockListSteps: vi.fn(),
    mockListGaps: vi.fn(),
    mockListMilestones: vi.fn(),
    mockDbUpdateStep: vi.fn(),
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
  updateStep: mockDbUpdateStep,
  setStepOrders: mockSetStepOrders,
  setGapOrders: mockSetGapOrders,
  deleteStep: vi.fn(),
  listMilestones: mockListMilestones,
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
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

const system: System = {
  id: 'system-1',
  projectId: 'project-1',
  name: 'ERP',
  tags: [],
  createdAt: 0,
}

const steps: Step[] = [
  {
    id: 'step-1',
    projectId: 'project-1',
    label: 'First step',
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
  },
  {
    id: 'step-2',
    projectId: 'project-1',
    label: 'Second step',
    teamId: team.id,
    milestoneId: milestone.id,
    order: 2,
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
  },
  {
    id: 'step-3',
    projectId: 'project-1',
    label: 'Third step',
    teamId: team.id,
    milestoneId: milestone.id,
    order: 3,
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
  },
]

const renderGrid = () => render(<DiscoveryGrid projectId="project-1" />)

const clickInsertBeforeSecondStep = async (container: HTMLElement) => {
  await waitFor(() => expect(screen.getByText('Second step')).toBeInTheDocument())
  const insertZones = container.querySelectorAll('tbody tr.group')
  fireEvent.mouseEnter(insertZones[1])
  fireEvent.click(screen.getByRole('button', { name: 'Insert Step' }))
}

const seedStores = () => {
  useStepsStore.setState({
    steps: [],
    milestones: [milestone],
    currentProjectId: 'project-1',
    currentStep: null,
    isLoading: false,
    loadSteps: vi.fn().mockImplementation(async () => {
      useStepsStore.setState({ steps })
    }),
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

describe('DiscoveryGrid insertion order persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetStepOrders.mockResolvedValue(undefined)
    mockSetGapOrders.mockResolvedValue(undefined)
    // The sequence module reads the milestone's live rows from the database
    // rather than from the store (#353), so the fixture has to be seeded on
    // both sides — this is what the plan is measured against.
    mockListSteps.mockResolvedValue(steps)
    mockListGaps.mockResolvedValue([])
    mockListMilestones.mockResolvedValue([milestone])
    seedStores()
  })

  it('waits for the shifted step write before showing the pending row', async () => {
    let resolveWrite!: () => void
    const writeFinished = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    mockSetStepOrders.mockReturnValueOnce(writeFinished)

    const { container } = renderGrid()
    await clickInsertBeforeSecondStep(container)

    // Steps 2 and 3 move up by one to leave position 2 empty. One statement
    // naming both, rather than a shift with a threshold.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [
        { id: 'step-2', order: 3 },
        { id: 'step-3', order: 4 },
      ])
    )
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Step inserted at position 2')

    await act(async () => {
      resolveWrite()
      await writeFinished
    })

    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('consumes shifted step write failures without duplicate error or success feedback', async () => {
    mockSetStepOrders.mockRejectedValueOnce(new Error('database write failed'))

    const { container } = renderGrid()
    await clickInsertBeforeSecondStep(container)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to insert step')
    })
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Step inserted at position 2')
    expect(screen.queryByRole('button', { name: 'Save Step' })).not.toBeInTheDocument()
    expect(screen.getByText('First step')).toBeInTheDocument()
    expect(screen.getByText('Second step')).toBeInTheDocument()
  })
})

/**
 * #302: the insert tray sits above a row, and in the All Steps view that row can
 * belong to any milestone. The handler took the order from the clicked row but
 * always shifted and inserted into the default milestone, so the new step landed
 * on a position belonging to a sequence it was not part of — `order` is scoped
 * to its milestone (#299).
 */
describe('DiscoveryGrid insertion targets the clicked row’s milestone (#302)', () => {
  const secondMilestone: Milestone = {
    id: 'milestone-2',
    projectId: 'project-1',
    name: 'Fulfilment',
    order: 1,
    relatedPolicies: [],
    createdAt: 0,
    updatedAt: 0,
  }

  // Orders restart at 1 in the second milestone, which is the whole point: a
  // handler reading `order` alone cannot tell "Pack order" from "First step".
  const crossMilestoneSteps: Step[] = [
    ...steps,
    {
      ...steps[0],
      id: 'step-4',
      label: 'Pack order',
      milestoneId: secondMilestone.id,
      order: 1,
    },
    {
      ...steps[0],
      id: 'step-5',
      label: 'Ship order',
      milestoneId: secondMilestone.id,
      order: 2,
    },
  ]

  const seedTwoMilestones = () => {
    seedStores()
    useStepsStore.setState({
      milestones: [milestone, secondMilestone],
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: crossMilestoneSteps })
      }),
    })
  }

  const clickInsertBefore = async (container: HTMLElement, label: string) => {
    await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument())
    const rowIndex = crossMilestoneSteps.findIndex((step) => step.label === label)
    const insertZones = container.querySelectorAll('tbody tr.group')
    fireEvent.mouseEnter(insertZones[rowIndex])
    fireEvent.click(screen.getByRole('button', { name: 'Insert Step' }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSetStepOrders.mockResolvedValue(undefined)
    mockSetGapOrders.mockResolvedValue(undefined)
    mockListSteps.mockResolvedValue(crossMilestoneSteps)
    mockListGaps.mockResolvedValue([])
    mockListMilestones.mockResolvedValue([milestone, secondMilestone])
    seedTwoMilestones()
  })

  it('shifts the clicked row’s milestone, not the default one', async () => {
    const { container } = renderGrid()
    await clickInsertBefore(container, 'Pack order')

    // Both of Fulfilment's steps move up; nothing in Main Flow is named at all,
    // which is what "shift the clicked row's milestone" means once the write
    // lists rows instead of carrying a milestone argument.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [
        { id: 'step-4', order: 2 },
        { id: 'step-5', order: 3 },
      ])
    )
    const movedIds = mockSetStepOrders.mock.calls.flatMap(
      (call) => (call[1] as Array<{ id: string }>).map((assignment) => assignment.id)
    )
    expect(movedIds).not.toContain('step-1')
    expect(movedIds).not.toContain('step-2')
    expect(movedIds).not.toContain('step-3')
  })

  it('gives the new row the clicked row’s milestone', async () => {
    const { container } = renderGrid()
    await clickInsertBefore(container, 'Ship order')

    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [{ id: 'step-5', order: 3 }])
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Step' })).toBeInTheDocument()
    })

    // The Milestone cell renders the milestone's name as text. Two rows carried
    // "Fulfilment" before the insert; the new row makes three. Inserting into
    // the default milestone would have left it at two.
    const milestoneCells = Array.from(
      container.querySelectorAll('tbody tr td:nth-child(4)')
    ).map((cell) => cell.textContent?.trim())
    expect(milestoneCells.filter((name) => name === 'Fulfilment')).toHaveLength(3)
    expect(milestoneCells.filter((name) => name === 'Main Flow')).toHaveLength(3)
  })

  it('does not toast on insert; the save tray reports success (#282)', async () => {
    const { container } = renderGrid()
    await clickInsertBefore(container, 'Pack order')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Step' })).toBeInTheDocument()
    })
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})

/**
 * Cancelling an inserted row has to undo exactly the shift the insert made.
 * `shiftStepsForInsertion` only ever moves the target milestone's steps, so a
 * project-wide decrement pulled milestones that were never shifted down by one
 * and left two of their steps sharing an order — which the grid and the diagram
 * both read as a deliberate parallel branch (#299), and which nothing repairs.
 */
describe('DiscoveryGrid cancelling an insert un-shifts only that milestone', () => {
  const secondMilestone: Milestone = {
    id: 'milestone-2',
    projectId: 'project-1',
    name: 'Fulfilment',
    order: 1,
    relatedPolicies: [],
    createdAt: 0,
    updatedAt: 0,
  }

  const crossMilestoneSteps: Step[] = [
    ...steps,
    { ...steps[0], id: 'step-4', label: 'Pack order', milestoneId: secondMilestone.id, order: 1 },
    { ...steps[0], id: 'step-5', label: 'Ship order', milestoneId: secondMilestone.id, order: 2 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockListMilestones.mockResolvedValue([milestone, secondMilestone])
    mockDbUpdateStep.mockResolvedValue(undefined)
    // A one-table stand-in for SQLite, because this case is about what the
    // CANCEL reads: the reseal measures against the rows the insert actually
    // wrote, so a `listSteps` frozen at the pre-insert layout would give it no
    // hole to close and the assertion would pass vacuously.
    let rows: Step[] = crossMilestoneSteps.map((step) => ({ ...step }))
    mockListSteps.mockImplementation(async () => rows.map((step) => ({ ...step })))
    mockListGaps.mockResolvedValue([])
    mockSetStepOrders.mockImplementation(
      async (_projectId: string, assignments: Array<{ id: string; order: number }>) => {
        const byId = new Map(assignments.map((a) => [a.id, a.order]))
        rows = rows.map((step) =>
          byId.has(step.id) ? { ...step, order: byId.get(step.id)! } : step
        )
      }
    )
    mockSetGapOrders.mockResolvedValue(undefined)
    seedStores()
    useStepsStore.setState({
      milestones: [milestone, secondMilestone],
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: crossMilestoneSteps })
      }),
    })
  })

  it('leaves the other milestone’s orders alone, so no two steps collide', async () => {
    const { container } = renderGrid()
    await waitFor(() => expect(screen.getByText('Pack order')).toBeInTheDocument())

    const insertZones = container.querySelectorAll('tbody tr.group')
    fireEvent.mouseEnter(insertZones[3]) // above "Pack order"
    fireEvent.click(screen.getByRole('button', { name: 'Insert Step' }))

    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [
        { id: 'step-4', order: 2 },
        { id: 'step-5', order: 3 },
      ])
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })
    mockSetStepOrders.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // The cancel closes the slot the insert opened: Pack and Ship come back
    // down. Main Flow was never shifted, so nothing in it may be decremented —
    // doing so would put "Second step" on order 1 beside "First step". And no
    // per-row `updateStep` loop, which is what tore the sequence on a partial
    // failure (#350).
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [
        { id: 'step-4', order: 1 },
        { id: 'step-5', order: 2 },
      ])
    )
    const touched = mockSetStepOrders.mock.calls.flatMap(
      (call) => (call[1] as Array<{ id: string }>).map((assignment) => assignment.id)
    )
    expect(touched).not.toContain('step-1')
    expect(touched).not.toContain('step-2')
    expect(touched).not.toContain('step-3')
    expect(mockDbUpdateStep).not.toHaveBeenCalled()
  })
})
