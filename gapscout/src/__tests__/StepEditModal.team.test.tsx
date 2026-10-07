/**
 * The step editor owns the step's team (#175).
 *
 * `steps.team_id` existed, was auto-assigned to whatever team sorts first, and
 * was then unreachable: no surface could change it. These tests hold the field
 * in place — it hydrates from the step and it reaches `updateStep` on save.
 *
 * Mocks the db module at its boundary so the real Zustand stores still run,
 * following TeamsManager.deleteFlow.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const {
  mockUpdateStep,
  mockToastError,
  mockToastSuccess,
  mockListSteps,
  mockListGaps,
  mockSetStepOrders,
  mockSetGapOrders,
} = vi.hoisted(() => ({
  mockUpdateStep: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockListSteps: vi.fn(),
  mockListGaps: vi.fn(),
  mockSetStepOrders: vi.fn(),
  mockSetGapOrders: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: { error: mockToastError, success: mockToastSuccess },
}))

// Saving now reseals the milestones the step touched (#335), which reads and
// writes through the db module — so it has to be mocked here even for the team
// cases, or every save fails on a missing connection.
vi.mock('../services/db', () => ({
  listSteps: mockListSteps,
  listGaps: mockListGaps,
  listGapsByStep: vi.fn().mockResolvedValue([]),
  setStepOrders: mockSetStepOrders,
  setGapOrders: mockSetGapOrders,
  getStep: vi.fn(),
  updateStep: vi.fn(),
  updateGap: vi.fn(),
  createGap: vi.fn(),
  deleteStep: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
}))

import StepEditModal from '../components/Diagram/StepEditModal'
import { useStepsStore } from '../state/stepsStore'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useGapsStore } from '../state/gapsStore'
import { wireSequenceDb } from './helpers/sequenceDb'
import type { Milestone, Step, Team } from '../data/types'

const team = (id: string, name: string, order: number): Team => ({
  id,
  projectId: 'project-1',
  name,
  color: '#10B981',
  order,
  tags: [],
  createdAt: 1,
})

const teams = [team('team-ops', 'Operations', 0), team('team-approver', 'Approver', 1)]

const step: Step = {
  id: 'step-1',
  projectId: 'project-1',
  label: 'Approve PR',
  teamId: 'team-ops',
  milestoneId: 'milestone-1',
  order: 1,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 1,
  updatedAt: 1,
}

const teamSelect = () => screen.getByLabelText('Owner team') as HTMLSelectElement

const renderModal = () =>
  render(
    <StepEditModal projectId="project-1" step={step} isOpen={true} onClose={vi.fn()} />
  )

describe('StepEditModal — owner team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateStep.mockResolvedValue(undefined)
    wireSequenceDb(
      { listSteps: mockListSteps, listGaps: mockListGaps, setStepOrders: mockSetStepOrders, setGapOrders: mockSetGapOrders },
      [step],
      []
    )
    useTeamsStore.setState({ teams, currentProjectId: 'project-1', isLoading: false })
    useSystemsStore.setState({ systems: [] })
    useGapsStore.setState({ gaps: [], currentProjectId: 'project-1', isLoading: false })
    useStepsStore.setState({
      steps: [step],
      milestones: [
        {
          id: 'milestone-1',
          projectId: 'project-1',
          name: 'Requisition',
          order: 0,
          relatedPolicies: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      updateStep: mockUpdateStep,
    })
  })

  it('hydrates the select from the step owner team', () => {
    renderModal()
    expect(teamSelect().value).toBe('team-ops')
  })

  it('offers every team in the registry', () => {
    renderModal()
    const options = Array.from(teamSelect().options).map(o => o.textContent)
    expect(options).toEqual(['Operations', 'Approver'])
  })

  it('sends the reassigned team to updateStep', async () => {
    renderModal()

    fireEvent.change(teamSelect(), { target: { value: 'team-approver' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save step' }))

    await waitFor(() => expect(mockUpdateStep).toHaveBeenCalled())
    expect(mockUpdateStep.mock.calls[0][1]).toMatchObject({ teamId: 'team-approver' })
  })

  describe('when the step points at a team that no longer exists', () => {
    // Legacy rows carry a dangling team_id (#104).
    const orphaned = { ...step, teamId: 'team-deleted' }

    const renderOrphaned = () => {
      useStepsStore.setState({ steps: [orphaned] })
      return render(
        <StepEditModal projectId="project-1" step={orphaned} isOpen={true} onClose={vi.fn()} />
      )
    }

    it('shows the placeholder rather than an unrelated team', () => {
      renderOrphaned()
      expect(teamSelect().value).toBe('')
      expect(Array.from(teamSelect().options)[0].textContent).toBe('Select team...')
    })

    it('refuses to save, instead of re-persisting the stale id', async () => {
      // The field renders blank, so a guard that only tested for an empty string
      // would let this through and write 'team-deleted' straight back.
      renderOrphaned()
      fireEvent.click(screen.getByRole('button', { name: 'Save step' }))

      await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Owner team is required'))
      expect(mockUpdateStep).not.toHaveBeenCalled()
    })
  })

  it('refuses to save without a team, because team_id is NOT NULL', async () => {
    renderModal()

    fireEvent.change(teamSelect(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save step' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Owner team is required'))
    expect(mockUpdateStep).not.toHaveBeenCalled()
  })
})

/**
 * #301: auto-fill pulls from "the previous step", and the editor found it by
 * sorting on `order` alone. `order` is scoped to its milestone (#299), so that
 * flat sort interleaved the milestones and offered a previous step from the
 * wrong one.
 */
describe('StepEditModal — the previous step is the one before it in the process', () => {
  const milestones = [
    {
      id: 'milestone-1',
      projectId: 'project-1',
      name: 'Requisition',
      order: 0,
      relatedPolicies: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'milestone-2',
      projectId: 'project-1',
      name: 'Fulfilment',
      order: 1,
      relatedPolicies: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  const at = (id: string, milestoneId: string, order: number, customers: string[]): Step => ({
    ...step,
    id,
    label: id,
    milestoneId,
    order,
    customers,
  })

  // Orders restart at 1 in Fulfilment. A flat sort on `order` is stable, so it
  // lands Fulfilment's first step directly after Requisition's first step and
  // calls that the predecessor. The step actually before it is Requisition's
  // last one.
  const requisitionFirst = at('requisition-first', 'milestone-1', 1, ['Wrong Handoff'])
  const requisitionLast = at('requisition-last', 'milestone-1', 3, ['Right Handoff'])
  const fulfilmentFirst = at('fulfilment-first', 'milestone-2', 1, [])

  const allSteps = [
    requisitionFirst,
    at('requisition-middle', 'milestone-1', 2, []),
    requisitionLast,
    fulfilmentFirst,
    at('fulfilment-second', 'milestone-2', 2, []),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateStep.mockResolvedValue(undefined)
    wireSequenceDb(
      { listSteps: mockListSteps, listGaps: mockListGaps, setStepOrders: mockSetStepOrders, setGapOrders: mockSetGapOrders },
      [step],
      []
    )
    useTeamsStore.setState({ teams, currentProjectId: 'project-1', isLoading: false })
    useSystemsStore.setState({ systems: [] })
    useGapsStore.setState({ gaps: [], currentProjectId: 'project-1', isLoading: false })
    useStepsStore.setState({ steps: allSteps, milestones, updateStep: mockUpdateStep })
  })

  it('auto-fills suppliers from the last step of the previous milestone', () => {
    render(
      <StepEditModal
        projectId="project-1"
        step={fulfilmentFirst}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    // Named by the previous step's process position, and by the field it
    // pulls from, so the two fill actions stay distinguishable (#218).
    const fillSuppliers = screen.getByRole('button', { name: /^Fill from step 3 —.*Customer$/ })
    fireEvent.click(fillSuppliers)

    expect(screen.getByText('Right Handoff')).toBeInTheDocument()
    expect(screen.queryByText('Wrong Handoff')).not.toBeInTheDocument()
  })

  it('offers no previous step for the very first step in the process', () => {
    render(
      <StepEditModal
        projectId="project-1"
        step={requisitionFirst}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /Fill from step/ })).not.toBeInTheDocument()
  })
})

/**
 * #335: the modal can move a step between milestones, and `order` is scoped to
 * its milestone (#299) — so the number travelling with the step belongs to the
 * sequence it is leaving. Both sides are sequence events: the origin has the
 * hole the step left, the destination has to make room for it.
 *
 * The origin id has to be read BEFORE the write. Afterwards the step only knows
 * where it landed, so a handler reading it from the live store would reseal the
 * destination twice and never touch the origin. These fixtures model that: the
 * `updateStep` stub moves the row in the store exactly as the real action does,
 * so a post-write read would silently lose the origin.
 */
describe('StepEditModal — moving a step between milestones (#335)', () => {
  const ORIGIN = 'milestone-1'
  const DESTINATION = 'milestone-2'

  const milestone = (id: string, name: string, order: number): Milestone => ({
    id,
    projectId: 'project-1',
    name,
    order,
    relatedPolicies: [],
    createdAt: 1,
    updatedAt: 1,
  })

  // Origin runs 1 (the mover), 2. Destination runs 1, so the mover's order 1
  // collides on arrival unless a slot is opened for it.
  const mover: Step = { ...step, id: 'mover', milestoneId: ORIGIN, order: 1 }
  const originSibling: Step = { ...step, id: 'origin-sibling', milestoneId: ORIGIN, order: 2 }
  const destinationHolder: Step = { ...step, id: 'dest-holder', milestoneId: DESTINATION, order: 1 }

  let db: ReturnType<typeof wireSequenceDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = wireSequenceDb(
      {
        listSteps: mockListSteps,
        listGaps: mockListGaps,
        setStepOrders: mockSetStepOrders,
        setGapOrders: mockSetGapOrders,
      },
      [mover, originSibling, destinationHolder],
      []
    )
    // Models the real store action: the row moves, so anything reading the
    // origin after this point reads the destination instead.
    mockUpdateStep.mockImplementation(async (id: string, patch: Partial<Step>) => {
      db.reset(
        db.steps().map(s => (s.id === id ? { ...s, ...patch } : s)),
        db.gaps()
      )
      useStepsStore.setState({
        steps: useStepsStore.getState().steps.map(s => (s.id === id ? { ...s, ...patch } : s)),
      })
    })
    useTeamsStore.setState({ teams, currentProjectId: 'project-1', isLoading: false })
    useSystemsStore.setState({ systems: [] })
    useGapsStore.setState({
      gaps: [],
      currentProjectId: 'project-1',
      isLoading: false,
      loadGaps: vi.fn().mockResolvedValue(undefined),
    })
    useStepsStore.setState({
      steps: [mover, originSibling, destinationHolder],
      milestones: [milestone(ORIGIN, 'Requisition', 0), milestone(DESTINATION, 'Approval', 1)],
      currentProjectId: 'project-1',
      updateStep: mockUpdateStep,
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: db.steps() })
      }),
    })
  })

  const moveToDestination = () => {
    render(
      <StepEditModal projectId="project-1" step={mover} isOpen={true} onClose={vi.fn()} />
    )
    const milestoneSelect = screen.getByDisplayValue('Requisition') as HTMLSelectElement
    fireEvent.change(milestoneSelect, { target: { value: DESTINATION } })
    fireEvent.click(screen.getByRole('button', { name: 'Save step' }))
  }

  it('opens a slot in the destination before writing the step there', async () => {
    moveToDestination()

    // The destination's own row goes up first, so the arriving step does not
    // land on it — a tie there is read as a parallel branch nobody asked for.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [{ id: 'dest-holder', order: 2 }])
    )
    const openSlotCallIndex = mockSetStepOrders.mock.calls.findIndex(
      call => call[1].some((a: { id: string }) => a.id === 'dest-holder')
    )
    const writeCallOrder = mockUpdateStep.mock.invocationCallOrder[0]
    const slotCallOrder = mockSetStepOrders.mock.invocationCallOrder[openSlotCallIndex]
    expect(slotCallOrder).toBeLessThan(writeCallOrder)
  })

  it('reseals the origin as well as the destination', async () => {
    moveToDestination()

    // The origin closes the hole the step left: its sibling comes down 2 -> 1.
    // This is the assertion that fails if the origin id is read after the
    // write, because by then the row names the destination.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [{ id: 'origin-sibling', order: 1 }])
    )

    const finalOrders = Object.fromEntries(db.steps().map(s => [s.id, [s.milestoneId, s.order]]))
    expect(finalOrders).toEqual({
      mover: [DESTINATION, 1],
      'origin-sibling': [ORIGIN, 1],
      'dest-holder': [DESTINATION, 2],
    })
  })

  it('re-syncs the gaps of both milestones, once each', async () => {
    // `resyncGapsAfterStepWrite` is milestone-wide only when the step actually
    // crossed a boundary (#291, #344). It reads the live stores, so the reload
    // driven by the reseal is what it sees — asserting on the reload is the
    // observable edge of "the re-sync ran for this milestone".
    const loadSteps = vi.fn().mockImplementation(async () => {
      useStepsStore.setState({ steps: db.steps() })
    })
    const loadGaps = vi.fn().mockResolvedValue(undefined)
    useStepsStore.setState({ loadSteps })
    useGapsStore.setState({ loadGaps })

    moveToDestination()

    await waitFor(() => expect(loadSteps).toHaveBeenCalled())
    // One reload per resealed milestone, and both milestones were resealed.
    await waitFor(() => expect(loadSteps.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(loadGaps.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

