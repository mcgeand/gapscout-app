/**
 * Step deletion decides what to raise against the store, not the render-time
 * `gaps` prop (#261).
 *
 * `executeStepDeletion` is a loop of writes followed by a chain-validation
 * pass, and between the two it reloads the gaps store on purpose — the pass has
 * to read what the deletion left behind. Both halves then used to ask `gaps`, a
 * closure captured when the row was rendered, which holds neither the loop's
 * own writes nor anything the reload brought in. The pass therefore answered
 * "no chain gap here" for a step that already had one, and raised a duplicate.
 *
 * Mocks the db module at its boundary so the real Zustand stores still run, and
 * `wireSequenceDb` gives the reseal live rows to read.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap, Milestone, Step, System, Team } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'
import { wireSequenceDb, type SequenceDb } from './helpers/sequenceDb'

const {
  mockDbUpdateStep,
  mockDbDeleteStep,
  mockSetStepOrders,
  mockSetGapOrders,
  mockListGaps,
  mockDbCreateGap,
  mockDbDeleteGap,
  mockListSteps,
  mockListMilestones,
  mockToast,
} = vi.hoisted(() => ({
  mockDbUpdateStep: vi.fn(),
  mockDbDeleteStep: vi.fn(),
  mockSetStepOrders: vi.fn(),
  mockSetGapOrders: vi.fn(),
  mockListGaps: vi.fn(),
  mockDbCreateGap: vi.fn(),
  mockDbDeleteGap: vi.fn(),
  mockListSteps: vi.fn(),
  mockListMilestones: vi.fn(),
  mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../services/db', () => ({
  createStep: vi.fn(),
  createGap: mockDbCreateGap,
  updateStep: mockDbUpdateStep,
  updateGap: vi.fn(),
  getGap: vi.fn(),
  listMilestones: mockListMilestones,
  listSteps: mockListSteps,
  getStep: vi.fn(),
  deleteStep: mockDbDeleteStep,
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  listGaps: mockListGaps,
  listGapsByStep: vi.fn(),
  deleteGap: mockDbDeleteGap,
  closeGap: vi.fn(),
  setStepOrders: mockSetStepOrders,
  setGapOrders: mockSetGapOrders,
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))
vi.mock('../components/Discovery/MilestoneManager', () => ({ MilestoneManager: () => null }))
vi.mock('../components/Discovery/ProcessGapManager', () => ({ ProcessGapManager: () => null }))
vi.mock('../components/Discovery/ValidationWarningModal', () => ({ ValidationWarningModal: () => null }))

/** Stands in for the real modal, exposing both the confirm and the strategy options. */
vi.mock('../components/shared/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, confirmAction, options }: {
    isOpen: boolean
    confirmAction?: { label: string; onClick: () => void }
    options?: Array<{ label: string; onClick: () => void }>
  }) =>
    isOpen ? (
      <>
        {confirmAction && !options ? (
          <button onClick={() => void confirmAction.onClick()}>Confirm {confirmAction.label}</button>
        ) : null}
        {options?.map(option => (
          <button key={option.label} onClick={() => void option.onClick()}>{option.label}</button>
        ))}
      </>
    ) : null,
}))

/** Selects the two adjacent steps under test, so the toolbar's Delete appears. */
vi.mock('../components/Discovery/EditableRowTable', () => ({
  EditableRowTable: ({ setSelectedIds }: {
    setSelectedIds: (ids: Set<string>) => void
  }) => (
    <button onClick={() => setSelectedIds(new Set(['m1-step-1', 'm1-step-2']))}>
      Select The First Two Steps
    </button>
  ),
}))

import DiscoveryGrid from '../components/Discovery/DiscoveryGrid'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useTeamsStore } from '../state/teamsStore'
import { beginProjectScope } from '../state/workspaceScope'

const milestone = (id: string, order: number, name: string): Milestone => ({
  id, projectId: 'project-1', name, order, relatedPolicies: [], createdAt: 0, updatedAt: 0,
})

const milestones = [milestone('m1', 0, 'Requisition'), milestone('m2', 1, 'Approval')]

/**
 * Nobody's customer turns up as the next step's supplier and nobody's output as
 * its input, so every step that has a successor in its own milestone carries
 * chain issues — which is what makes the pass want to raise a gap on it.
 */
const step = (id: string, milestoneId: string, order: number): Step => ({
  id,
  projectId: 'project-1',
  label: `Step ${id}`,
  teamId: 'team-1',
  milestoneId,
  order,
  suppliers: ['Supplier'],
  inputs: ['Input'],
  outputs: ['Output'],
  customers: ['Customer'],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
})

const steps: EditableStep[] = [
  step('m1-step-1', 'm1', 1),
  step('m1-step-2', 'm1', 2),
  step('m1-step-3', 'm1', 3),
  step('m1-step-4', 'm1', 4),
  step('m2-step-1', 'm2', 1),
  step('m2-step-2', 'm2', 2),
]

const gapOn = (id: string, stepId: string, observed: string): Gap => ({
  id,
  projectId: 'project-1',
  stepId,
  observed,
  expected: 'Process flow should be continuous without breaks',
  severity: 'H',
  priority: 1,
  status: 'Open',
  missingField: 'customer',
  links: [],
  createdAt: 0,
  updatedAt: 0,
})

const team: Team = {
  id: 'team-1', projectId: 'project-1', name: 'Operations',
  color: '#000000', order: 0, tags: [], createdAt: 0,
}
const system: System = { id: 'system-1', projectId: 'project-1', name: 'ERP', tags: [], createdAt: 0 }

/** The mutable rows the sequence module and the store reloads read. */
let db: SequenceDb

const seedStores = (gaps: Gap[]) => {
  useStepsStore.setState({
    steps,
    milestones,
    currentProjectId: 'project-1',
    currentStep: null,
    isLoading: false,
    loadSteps: vi.fn().mockImplementation(async () => {
      useStepsStore.setState({ steps: db.steps() })
    }),
  })
  useGapsStore.setState({
    gaps,
    currentProjectId: 'project-1',
    currentGap: null,
    isLoading: false,
    loadGaps: vi.fn().mockImplementation(async () => {
      useGapsStore.setState({ gaps: db.gaps() })
    }),
  })
}

const createdGaps = () => mockDbCreateGap.mock.calls.map(([data]) => data as Gap)

describe('DiscoveryGrid — deletion reads the gaps it is writing (#261)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListMilestones.mockResolvedValue(milestones)
    mockDbUpdateStep.mockResolvedValue(undefined)
    db = wireSequenceDb(
      {
        listSteps: mockListSteps,
        listGaps: mockListGaps,
        setStepOrders: mockSetStepOrders,
        setGapOrders: mockSetGapOrders,
        deleteStep: mockDbDeleteStep,
        deleteGap: mockDbDeleteGap,
      },
      steps,
      []
    )
    useTeamsStore.setState({
      teams: [team], currentProjectId: 'project-1', isLoading: false,
      loadTeams: vi.fn().mockResolvedValue(undefined),
    })
    useSystemsStore.setState({
      systems: [system], currentProjectId: 'project-1', isLoading: false,
      loadSystems: vi.fn().mockResolvedValue(undefined),
    })
    beginProjectScope('project-1')
  })

  /**
   * m1-step-3 already carries a chain-break gap, raised while this save was
   * running: the store learns about it from the reload the handler itself does
   * between the deletions and the chain pass, and the prop the pass used to ask
   * was captured before any of it. Off the prop, the pass opened a second
   * chain-break gap on a step that already had one.
   */
  it('raises no second chain gap on a step its own reload already shows one on', async () => {
    const existing = gapOn('gap-existing', 'm1-step-3', 'Chain break after deletion: Output does not match input in next step')
    db.reset(steps, [existing])
    // The gap is in the database but not yet in the store, so the render-time
    // prop cannot hold it either.
    seedStores([])

    render(<DiscoveryGrid projectId="project-1" />)

    fireEvent.click(screen.getByText('Select The First Two Steps'))
    fireEvent.click(await screen.findByRole('button', { name: /Delete \(2\)/ }))
    fireEvent.click(await screen.findByText('Confirm Delete'))

    await waitFor(() =>
      expect(mockDbDeleteStep.mock.calls.map(([id]) => id)).toEqual(['m1-step-1', 'm1-step-2'])
    )

    // m1-step-3 and m2-step-1 both hand to a successor that names neither their
    // customer nor their output, so both carry chain issues. m1-step-4 has no
    // successor inside m1, where the chain check still stops (#239), so the
    // check never runs on it; m2-step-2 closes the process and is exempt from
    // outputs and customers outright (#344). Of the two that do carry issues,
    // m1-step-3 already has a gap — leaving m2-step-1 as the only one to raise.
    await waitFor(() => expect(mockDbCreateGap).toHaveBeenCalled())
    expect(createdGaps().map(gap => gap.stepId)).toEqual(['m2-step-1'])
  })

  /**
   * The ghost strategy writes a gap per iteration, so the loop's later
   * iterations run against a store the earlier ones have already changed. Each
   * ghost still has to describe the step it is replacing, by that step's own
   * open gaps rather than a neighbour's.
   */
  it('describes each ghost gap by the step it replaces, iteration after iteration', async () => {
    const onFirst = gapOn('gap-first', 'm1-step-1', 'Missing handover to approval')
    const onSecond = gapOn('gap-second', 'm1-step-2', 'Missing approval evidence')
    db.reset(steps, [onFirst, onSecond])
    seedStores([onFirst, onSecond])

    render(<DiscoveryGrid projectId="project-1" />)

    fireEvent.click(screen.getByText('Select The First Two Steps'))
    fireEvent.click(await screen.findByRole('button', { name: /Delete \(2\)/ }))
    fireEvent.click(await screen.findByText('Confirm Delete'))
    fireEvent.click(await screen.findByText('Create Ghost Gap'))

    await waitFor(() =>
      expect(mockDbDeleteStep.mock.calls.map(([id]) => id)).toEqual(['m1-step-1', 'm1-step-2'])
    )

    const ghosts = createdGaps().filter(gap => gap.observed.startsWith('Step deleted'))
    expect(ghosts.map(gap => [gap.order, gap.observed])).toEqual([
      [1, 'Step deleted with 1 open gap(s): Missing handover to approval'],
      [2, 'Step deleted with 1 open gap(s): Missing approval evidence'],
    ])
  })
})
