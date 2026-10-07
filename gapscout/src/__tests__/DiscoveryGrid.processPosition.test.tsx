/**
 * The three numbers the Discovery grid speaks aloud.
 *
 * #345: `steps."order"` is scoped to its milestone, so the stored value names a
 * row nobody can find the moment a project has a second milestone — the grid's
 * `#` column shows a running position across the whole process instead. Three
 * strings here quote a position back to the user: the chain-gap toast after a
 * deletion, the toast that says where a canceled row's gap stayed, and the
 * "Delete Process Gap?" confirmation. Each now reads `processPositions`.
 *
 * Every fixture below therefore carries TWO milestones whose step orders both
 * restart at 1. That is the only shape in which the defect exists: with one
 * milestone the stored order and the running position are the same number, so a
 * single-milestone fixture passes against the bug as readily as against the fix.
 *
 * Mocks the db module at its boundary so the real Zustand stores still run.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap, Milestone, Step, System, Team } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'

const {
  mockDbUpdateStep,
  mockDbDeleteStep,
  mockDbCreateGap,
  mockGetGap,
  mockShiftStepOrders,
  mockShiftGapOrders,
  mockListSteps,
  mockListMilestones,
  mockToast,
} = vi.hoisted(() => ({
  mockDbUpdateStep: vi.fn(),
  mockDbDeleteStep: vi.fn(),
  mockDbCreateGap: vi.fn(),
  mockGetGap: vi.fn(),
  mockShiftStepOrders: vi.fn(),
  mockShiftGapOrders: vi.fn(),
  mockListSteps: vi.fn(),
  mockListMilestones: vi.fn(),
  mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../services/db', () => ({
  createStep: vi.fn(),
  createGap: mockDbCreateGap,
  updateStep: mockDbUpdateStep,
  updateGap: vi.fn(),
  getGap: mockGetGap,
  listMilestones: mockListMilestones,
  listSteps: mockListSteps,
  getStep: vi.fn(),
  deleteStep: mockDbDeleteStep,
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  // Resolved, not bare. A `vi.fn()` returns undefined, and the reseal that runs
  // after a delete spreads the result — so it threw `gaps is not iterable`, was
  // caught by the handler's own tidy-up guard, and every case below passed on
  // the toast text with the reseal never having run.
  listGaps: vi.fn().mockResolvedValue([]),
  listGapsByStep: vi.fn().mockResolvedValue([]),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
  shiftStepOrdersInRange: vi.fn(),
  shiftStepOrders: mockShiftStepOrders,
  shiftGapOrders: mockShiftGapOrders,
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))
vi.mock('../components/Discovery/MilestoneManager', () => ({ MilestoneManager: () => null }))
vi.mock('../components/Discovery/ProcessGapManager', () => ({ ProcessGapManager: () => null }))
vi.mock('../components/Discovery/ValidationWarningModal', () => ({ ValidationWarningModal: () => null }))

/**
 * Renders `description` as well as the confirm button, which neither existing
 * DiscoveryGrid mock does — the "Delete Process Gap?" number under test is in
 * the description and nowhere else. The real shell brings a focus trap and a
 * portal that none of these tests are about.
 */
vi.mock('../components/shared/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, title, description, confirmAction }: {
    isOpen: boolean
    title: string
    description?: React.ReactNode
    confirmAction?: { label: string; onClick: () => void | Promise<void> }
  }) =>
    isOpen && confirmAction ? (
      <div role="dialog" aria-label={title}>
        {description}
        <button onClick={() => void confirmAction.onClick()}>{confirmAction.label}</button>
      </div>
    ) : null,
}))

/**
 * Drives the three entry points the real table owns. The cancel button is keyed
 * off the `steps` prop rather than a fixed id because new rows mint a nanoid
 * at open time, which no test can know in advance.
 */
vi.mock('../components/Discovery/EditableRowTable', () => ({
  EditableRowTable: ({ steps, gaps, setSelectedIds, onCloseProcessGap, onRequestDeleteGap, onRequestCancelNewRow }: {
    steps: EditableStep[]
    gaps: Gap[]
    setSelectedIds: (ids: Set<string>) => void
    onCloseProcessGap: (gap: Gap) => Promise<void>
    onRequestDeleteGap: (gap: Gap) => void
    onRequestCancelNewRow: (stepId: string) => void
  }) => {
    const pendingRow = steps.find((step) => step._isNew)
    return (
      <>
        <button onClick={() => setSelectedIds(new Set(['a-step-3']))}>Select Last Step Of A</button>
        {gaps.map((gap) => (
          <div key={gap.id}>
            <button onClick={() => void onCloseProcessGap(gap)}>{`Close ${gap.id}`}</button>
            <button onClick={() => onRequestDeleteGap(gap)}>{`Request Delete ${gap.id}`}</button>
          </div>
        ))}
        {pendingRow && (
          <button onClick={() => onRequestCancelNewRow(pendingRow.id)}>Cancel Pending Row</button>
        )}
      </>
    )
  },
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

// Requisition runs first, Approval second. Both number their own steps from 1.
const milestoneA = milestone('milestone-a', 0, 'Requisition')
const milestoneB = milestone('milestone-b', 1, 'Approval')
const milestones = [milestoneA, milestoneB]

const makeStep = (
  overrides: Partial<Step> & Pick<Step, 'id' | 'label' | 'milestoneId' | 'order'>
): Step => ({
  projectId: 'project-1',
  teamId: 'team-1',
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
  ...overrides,
})

const makeProcessGap = (
  overrides: Partial<Gap> & Pick<Gap, 'id' | 'order' | 'milestoneId'>
): Gap => ({
  projectId: 'project-1',
  observed: 'Missing handover',
  expected: 'Handover recorded',
  severity: 'M',
  status: 'Open',
  links: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const team: Team = {
  id: 'team-1', projectId: 'project-1', name: 'Operations',
  color: '#000000', order: 0, tags: [], createdAt: 0,
}
const system: System = { id: 'system-1', projectId: 'project-1', name: 'ERP', tags: [], createdAt: 0 }

/**
 * Stands in for the steps table. The store's `deleteStep` does not splice its
 * own list — it writes and then reloads — so a `loadSteps` stub that resolves to
 * nothing leaves the deleted row in the store, and the chain-gap positions are
 * then counted against a process that still contains it.
 */
let dbSteps: Step[] = []

const seedStores = (steps: Step[], gaps: Gap[]) => {
  dbSteps = steps.map((step) => ({ ...step }))
  useStepsStore.setState({
    steps: dbSteps.map((step) => ({ ...step })),
    milestones,
    currentProjectId: 'project-1',
    currentStep: null,
    isLoading: false,
    loadSteps: vi.fn().mockImplementation(async () => {
      useStepsStore.setState({ steps: dbSteps.map((step) => ({ ...step })) })
    }),
  })
  useGapsStore.setState({
    gaps,
    currentProjectId: 'project-1',
    currentGap: null,
    isLoading: false,
    loadGaps: vi.fn().mockResolvedValue(undefined),
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
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListMilestones.mockResolvedValue(milestones)
  mockListSteps.mockResolvedValue([])
  mockDbDeleteStep.mockImplementation(async (stepId: string) => {
    dbSteps = dbSteps.filter((step) => step.id !== stepId)
  })
  mockDbUpdateStep.mockResolvedValue(undefined)
  mockDbCreateGap.mockResolvedValue('chain-gap-1')
  mockGetGap.mockResolvedValue(
    makeProcessGap({ id: 'chain-gap-1', order: 0, milestoneId: 'milestone-b', stepId: 'b-step-1' })
  )
  mockShiftStepOrders.mockImplementation(
    async (_projectId: string, milestoneId: string, threshold: number, delta: number) => {
      dbSteps = dbSteps.map((step) =>
        step.milestoneId === milestoneId && step.order >= threshold
          ? { ...step, order: step.order + delta }
          : step
      )
    }
  )
  mockShiftGapOrders.mockResolvedValue(undefined)
})

/**
 * The chain-gap toast names the steps a deletion broke. Its positions come from
 * a map rebuilt after the delete, because the delete reloads both stores and the
 * render-time map is a render behind.
 */
describe('DiscoveryGrid chain-gap toast names the process position (#345)', () => {
  // Requisition holds three steps that chain cleanly into one another; Approval
  // holds two that do not. Deleting Requisition's third step leaves
  // a1, a2, b1, b2 — so Approval's first step, stored at order 1, is the third
  // row of the process.
  const seedBrokenChainInSecondMilestone = () => {
    const steps = [
      makeStep({
        id: 'a-step-1', label: 'Raise requisition', milestoneId: milestoneA.id, order: 1,
        outputs: ['Docket'], customers: ['Approvals'],
      }),
      makeStep({
        id: 'a-step-2', label: 'Check budget', milestoneId: milestoneA.id, order: 2,
        suppliers: ['Approvals'], inputs: ['Docket'], outputs: ['Budget note'], customers: ['Finance'],
      }),
      makeStep({
        id: 'a-step-3', label: 'File requisition', milestoneId: milestoneA.id, order: 3,
        suppliers: ['Finance'], inputs: ['Budget note'],
      }),
      makeStep({
        id: 'b-step-1', label: 'Approve spend', milestoneId: milestoneB.id, order: 1,
        outputs: ['Approval'], customers: ['Warehouse'],
      }),
      makeStep({
        id: 'b-step-2', label: 'Notify supplier', milestoneId: milestoneB.id, order: 2,
        suppliers: ['Nobody'], inputs: ['Something else'],
      }),
    ]
    seedStores(steps, [])
  }

  const deleteTheLastRequisitionStep = async () => {
    fireEvent.click(screen.getByText('Select Last Step Of A'))
    fireEvent.click(await screen.findByRole('button', { name: /Delete \(1\)/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 Step?' })
    // Inside `act`, because the delete now runs a real reseal — a reload and a
    // gap re-sync that land after the click and update state. Before the mock
    // was fixed the reseal threw on the first line and none of that happened.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    })
  }

  it('quotes the running position of the broken step, not its per-milestone order', async () => {
    seedBrokenChainInSecondMilestone()
    render(<DiscoveryGrid projectId="project-1" />)

    await deleteTheLastRequisitionStep()

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        '1 chain gap detected (Step 3)',
        expect.objectContaining({ duration: 5000 })
      )
    )
    // "Approve spend" is stored at order 1 — Approval's own first step — and
    // there is no row 1 of the process for the reader to go and look at.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.stringContaining('(Step 1)'),
      expect.anything()
    )
  })
})

/**
 * The remaining two sites share a fixture: two steps in Requisition, then
 * Approval's step 1, a process gap at Approval's order 2, and Approval's step 3.
 * The gap is the fourth row of the process and stores the order 2.
 */
describe('DiscoveryGrid process-gap strings name the process position (#345)', () => {
  const gapInSecondMilestone = makeProcessGap({
    id: 'gap-b', order: 2, milestoneId: milestoneB.id,
  })

  beforeEach(() => {
    seedStores(
      [
        makeStep({ id: 'a-step-1', label: 'Raise requisition', milestoneId: milestoneA.id, order: 1 }),
        makeStep({ id: 'a-step-2', label: 'Check budget', milestoneId: milestoneA.id, order: 2 }),
        makeStep({ id: 'b-step-1', label: 'Approve spend', milestoneId: milestoneB.id, order: 1 }),
        makeStep({ id: 'b-step-3', label: 'Notify supplier', milestoneId: milestoneB.id, order: 3 }),
      ],
      [gapInSecondMilestone]
    )
  })

  it('tells the user where the gap stayed when its closing row is canceled', async () => {
    render(<DiscoveryGrid projectId="project-1" />)

    // Closing the gap drops an unsaved step onto the gap's own order, so the two
    // share a rank and therefore share a position.
    fireEvent.click(await screen.findByRole('button', { name: 'Close gap-b' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Pending Row' }))

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('Gap remains at position 4')
    )
    // Order 2 is Approval's second slot, which is the third row on screen.
    expect(mockToast).not.toHaveBeenCalledWith(
      'Gap remains at position 2',
      expect.anything()
    )
  })

  it('names the gap by its process position in the delete confirmation', async () => {
    render(<DiscoveryGrid projectId="project-1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Request Delete gap-b' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete Process Gap?' })
    expect(dialog.querySelector('p')!.textContent).toBe(
      'This will permanently delete the gap at position 4 and shift later rows down by 1.'
    )
  })
})
