/**
 * What delete-with-shift moves, and what it measures the move against.
 *
 * #331: `steps."order"` is scoped to its milestone, so a shift that filters on
 * `order > deleted` alone walks into every later milestone and renumbers steps
 * nobody touched — the same blindness #311 fixed in GapForm's lookups.
 * #339: each deletion renumbers the milestone, so a loop that reads the
 * component's pre-deletion array measures the second one against orders the
 * first has already moved.
 * #341: process gaps number themselves in the same sequence, so a shift that
 * moves only the steps drops one onto an order a gap still holds.
 *
 * Mocks the db module at its boundary so the real Zustand stores still run.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Milestone, Step, System, Team } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'
import { sequenceOf, wireSequenceDb, type SequenceDb } from './helpers/sequenceDb'

const {
  mockDbUpdateStep,
  mockDbDeleteStep,
  mockSetStepOrders,
  mockSetGapOrders,
  mockListGaps,
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
  mockDbDeleteGap: vi.fn(),
  mockListSteps: vi.fn(),
  mockListMilestones: vi.fn(),
  mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../services/db', () => ({
  createStep: vi.fn(),
  createGap: vi.fn(),
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

/** Stands in for the real modal so the Delete confirmation can be clicked. */
vi.mock('../components/shared/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, confirmAction }: {
    isOpen: boolean
    confirmAction?: { label: string; onClick: () => void }
  }) =>
    isOpen && confirmAction ? (
      <button onClick={() => void confirmAction.onClick()}>Confirm {confirmAction.label}</button>
    ) : null,
}))

/** Selects the steps under test, so the toolbar's Delete button appears. */
vi.mock('../components/Discovery/EditableRowTable', () => ({
  EditableRowTable: ({ setSelectedIds }: {
    setSelectedIds: (ids: Set<string>) => void
  }) => (
    <>
      <button onClick={() => setSelectedIds(new Set(['m1-step-1']))}>Select First Step</button>
      <button onClick={() => setSelectedIds(new Set(['m1-step-1', 'm1-step-3']))}>
        Select Steps 1 And 3
      </button>
    </>
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

// Orders restart per milestone, so m2 carries its own 1, 2 — exactly the rows an
// unscoped `order > 1` filter would sweep up.
const steps: EditableStep[] = [
  step('m1-step-1', 'm1', 1),
  step('m1-step-2', 'm1', 2),
  step('m1-step-3', 'm1', 3),
  step('m1-step-4', 'm1', 4),
  step('m2-step-1', 'm2', 1),
  step('m2-step-2', 'm2', 2),
]

const team: Team = {
  id: 'team-1', projectId: 'project-1', name: 'Operations',
  color: '#000000', order: 0, tags: [], createdAt: 0,
}
const system: System = { id: 'system-1', projectId: 'project-1', name: 'ERP', tags: [], createdAt: 0 }

/** The mutable rows the sequence module reads and writes. */
let db: SequenceDb

describe('DiscoveryGrid — delete with shift (#331, #339, #341)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListMilestones.mockResolvedValue(milestones)
    mockDbUpdateStep.mockResolvedValue(undefined)
    // The reseal reads the milestone's live rows, so the fixture lives in a
    // mutable stand-in for SQLite rather than only in the stores: a delete has
    // to actually remove the row before the next one is measured (#339).
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
      gaps: [],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
      loadGaps: vi.fn().mockImplementation(async () => {
        useGapsStore.setState({ gaps: db.gaps() })
      }),
    })
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

  it('renumbers only the deleted step\'s own milestone', async () => {
    render(<DiscoveryGrid projectId="project-1" />)

    fireEvent.click(screen.getByText('Select First Step'))
    fireEvent.click(await screen.findByRole('button', { name: /Delete \(1\)/ }))
    fireEvent.click(await screen.findByText('Confirm Delete'))

    await waitFor(() => expect(mockDbDeleteStep).toHaveBeenCalledWith('m1-step-1', 'project-1'))

    // One statement closes the hole in m1, and only m1's rows are named — which
    // is what keeps m2, numbering itself from 1, out of the update entirely.
    await waitFor(() => expect(mockSetStepOrders).toHaveBeenCalledTimes(1))
    expect(db.steps().find(s => s.id === 'm1-step-2')?.order).toBe(1)
    expect(db.steps().find(s => s.id === 'm1-step-3')?.order).toBe(2)
    expect(db.steps().find(s => s.id === 'm2-step-1')?.order).toBe(1)
    expect(db.steps().find(s => s.id === 'm2-step-2')?.order).toBe(2)
    const moved = mockSetStepOrders.mock.calls.flatMap(
      call => (call[1] as Array<{ id: string }>).map(assignment => assignment.id)
    )
    expect(moved).not.toContain('m2-step-1')
    expect(moved).not.toContain('m2-step-2')
    // And not one row at a time, which could tear (#343, #350).
    expect(mockDbUpdateStep).not.toHaveBeenCalled()
  })

  /**
   * #339: each iteration renumbers the milestone, so the second deletion has to
   * measure itself against the sequence the first one left behind. Reading the
   * component's `steps` array — captured before either delete — put step 3's
   * shift a slot too high.
   */
  it('measures the second deletion against the orders the first one left', async () => {
    render(<DiscoveryGrid projectId="project-1" />)

    fireEvent.click(screen.getByText('Select Steps 1 And 3'))
    fireEvent.click(await screen.findByRole('button', { name: /Delete \(2\)/ }))
    fireEvent.click(await screen.findByText('Confirm Delete'))

    await waitFor(() =>
      expect(mockDbDeleteStep.mock.calls.map(([id]) => id)).toEqual(['m1-step-1', 'm1-step-3'])
    )

    // Step 1 leaves a hole at 1, so everything from 2 up comes down and step 3
    // is then sitting at 2. Measuring the second deletion against the
    // pre-deletion array put its shift a slot too high and left m1 as 1, 3.
    await waitFor(() => expect(sequenceOf(db, 'm1')).toEqual([
      [1, 'Step m1-step-2'],
      [2, 'Step m1-step-4'],
    ]))
    expect(useStepsStore.getState().steps.find(s => s.id === 'm1-step-2')?.order).toBe(1)
    expect(useStepsStore.getState().steps.find(s => s.id === 'm1-step-4')?.order).toBe(2)
  })

  /**
   * #341: the step-axis twin of #312. A process gap holds a position in the
   * milestone's sequence exactly as a step does, so a delete that moved only the
   * steps dropped one onto an order the gap still held — and the grid reads the
   * tie as a parallel branch nobody asked for.
   */
  it('moves the process gaps the deletion displaces, not just the steps', async () => {
    // step(1), step(2), gap(3), step(4) — one sequence, shared numbering.
    const m1Steps = [
      step('m1-step-1', 'm1', 1),
      step('m1-step-2', 'm1', 2),
      step('m1-step-4', 'm1', 4),
    ]
    const laterGap = {
      id: 'gap-later',
      projectId: 'project-1',
      observed: 'Missing handover',
      expected: 'Handover exists',
      severity: 'M' as const,
      status: 'Open' as const,
      order: 3,
      milestoneId: 'm1',
      links: [],
      createdAt: 0,
      updatedAt: 0,
    }
    useStepsStore.setState({ steps: m1Steps })
    useGapsStore.setState({ gaps: [laterGap] })
    db.reset(m1Steps, [laterGap])
    render(<DiscoveryGrid projectId="project-1" />)

    fireEvent.click(screen.getByText('Select First Step'))
    fireEvent.click(await screen.findByRole('button', { name: /Delete \(1\)/ }))
    fireEvent.click(await screen.findByText('Confirm Delete'))

    // The gap comes down 3→2 with the steps. Left behind, it would have shared
    // order 3 with the step arriving there from 4.
    await waitFor(() => expect(sequenceOf(db, 'm1')).toEqual([
      [1, 'Step m1-step-2'],
      [2, 'Missing handover'],
      [3, 'Step m1-step-4'],
    ]))
    expect(useGapsStore.getState().gaps.find(g => g.id === 'gap-later')?.order).toBe(2)
    expect(useStepsStore.getState().steps.find(s => s.id === 'm1-step-4')?.order).toBe(3)
  })
})
