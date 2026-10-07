/**
 * The Discovery grid renders steps and process gaps as one list (`mergedItems`),
 * and the tray and drag handlers are handed an index into that list. #302 fixed
 * `handleInsertRow` and `StepRow.index` on this axis; #306 fixes the three sites
 * left behind, and #307 makes the insertion shift move the gaps it displaces.
 *
 * Every fixture here therefore puts a process gap *above* the row under test.
 * Without one the two lists have the same indices and none of these bugs can
 * reproduce.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap, Milestone, Step, System, Team } from '../data/types'
import { sequenceOf, wireSequenceDb, type SequenceDb } from './helpers/sequenceDb'

const {
  mockSetStepOrders,
  mockSetGapOrders,
  mockListSteps,
  mockListGaps,
  mockDbDeleteStep,
  mockDbDeleteGap,
  mockListMilestones,
  mockDbUpdateStep,
  mockToast,
  mockToastError,
} = vi.hoisted(() => {
  const mockToastError = vi.fn()
  const mockToastSuccess = vi.fn()
  return {
    mockSetStepOrders: vi.fn(),
    mockSetGapOrders: vi.fn(),
    mockListSteps: vi.fn(),
    mockListGaps: vi.fn(),
    mockDbDeleteStep: vi.fn(),
    mockDbDeleteGap: vi.fn(),
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
  deleteStep: mockDbDeleteStep,
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
  deleteGap: mockDbDeleteGap,
  closeGap: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))
vi.mock('../components/Discovery/MilestoneManager', () => ({ MilestoneManager: () => null }))
vi.mock('../components/Discovery/ValidationWarningModal', () => ({
  ValidationWarningModal: () => null,
}))
// Closed is still nothing, so every test that never opens one is unaffected.
// Open, it offers just the confirm action, which is what the #312 tests need to
// reach `handleDeleteGap` — the real shell brings a focus trap and a portal
// neither of them is testing.
vi.mock('../components/shared/ConfirmModal', () => ({
  ConfirmModal: ({
    isOpen,
    title,
    confirmAction,
  }: {
    isOpen: boolean
    title: string
    confirmAction?: { label: string; onClick: () => void | Promise<void> }
  }) =>
    isOpen && confirmAction ? (
      <div role="dialog" aria-label={title}>
        <button onClick={() => void confirmAction.onClick()}>{confirmAction.label}</button>
      </div>
    ) : null,
}))

// The real manager renders a whole GapForm. What these tests need is the two
// values `handleCreateProcessGap` computed, so the stand-in just reports them.
vi.mock('../components/Discovery/ProcessGapManager', () => ({
  ProcessGapManager: ({ formState }: { formState: { order: number; milestoneId: string } | null }) =>
    formState === null ? null : (
      <div data-testid="gap-form-state">{`${formState.order}|${formState.milestoneId}`}</div>
    ),
}))

import DiscoveryGrid from '../components/Discovery/DiscoveryGrid'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useTeamsStore } from '../state/teamsStore'

const mainFlow: Milestone = {
  id: 'milestone-1',
  projectId: 'project-1',
  name: 'Main Flow',
  order: 0,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

const fulfilment: Milestone = {
  id: 'milestone-2',
  projectId: 'project-1',
  name: 'Fulfilment',
  order: 1,
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

const makeStep = (overrides: Partial<Step> & Pick<Step, 'id' | 'label' | 'milestoneId' | 'order'>): Step => ({
  projectId: 'project-1',
  teamId: team.id,
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

/** The mutable rows the sequence module reads and writes; see `helpers/sequenceDb`. */
let db: SequenceDb

const seedStores = (steps: Step[], gaps: Gap[], milestones: Milestone[]) => {
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
    gaps
  )
  useStepsStore.setState({
    steps: [],
    milestones,
    currentProjectId: 'project-1',
    currentStep: null,
    isLoading: false,
    // Off the same rows the reseal writes to, so a reload after a mutation
    // shows what the mutation did rather than re-seeding the fixture.
    loadSteps: vi.fn().mockImplementation(async () => {
      useStepsStore.setState({ steps: db.steps() })
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
    gaps,
    currentProjectId: 'project-1',
    currentGap: null,
    isLoading: false,
    loadGaps: vi.fn().mockImplementation(async () => {
      useGapsStore.setState({ gaps: db.gaps() })
    }),
  })
}

const renderGrid = () => render(<DiscoveryGrid projectId="project-1" />)

/** The 4px hover strip above merged row `idx`. */
const openTray = (container: HTMLElement, idx: number) => {
  fireEvent.mouseEnter(container.querySelectorAll('tbody tr.group')[idx])
}

const dragRowOnto = (container: HTMLElement, fromLabel: string, ontoLabel: string) => {
  const rowOf = (label: string) =>
    Array.from(container.querySelectorAll('tbody tr[draggable="true"]')).find((row) =>
      row.textContent?.includes(label)
    )!
  // jsdom fires drag events with no `dataTransfer`, and `handleDragStart` sets
  // `effectAllowed` on it.
  fireEvent.dragStart(rowOf(fromLabel), { dataTransfer: { effectAllowed: 'none' } })
  fireEvent.drop(rowOf(ontoLabel), { dataTransfer: { dropEffect: 'none' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDbUpdateStep.mockResolvedValue(undefined)
  mockListMilestones.mockResolvedValue([mainFlow, fulfilment])
})

/**
 * #306: three handlers indexed `filteredSteps` with a `mergedItems` index. With
 * a gap on screen the two lists are different lengths, so the last row's tray
 * read past the end of `filteredSteps` and threw, and every row below the gap
 * read some other step's order and milestone.
 */
describe('DiscoveryGrid tray and drop read the rendered row (#306)', () => {
  // One milestone, gap in the middle: mergedItems is [step-1, gap-1, step-2]
  // and filteredSteps is [step-1, step-2].
  const singleMilestone = () => {
    const steps = [
      makeStep({ id: 'step-1', label: 'First step', milestoneId: mainFlow.id, order: 1 }),
      makeStep({ id: 'step-2', label: 'Second step', milestoneId: mainFlow.id, order: 3 }),
    ]
    const gaps = [makeProcessGap({ id: 'gap-1', order: 2, milestoneId: mainFlow.id })]
    seedStores(steps, gaps, [mainFlow])
  }

  // Gap in milestone 1, two steps in milestone 2: mergedItems is
  // [step-1, gap-1, step-4, step-5], filteredSteps is [step-1, step-4, step-5].
  const twoMilestones = () => {
    const steps = [
      makeStep({ id: 'step-1', label: 'First step', milestoneId: mainFlow.id, order: 1 }),
      makeStep({ id: 'step-4', label: 'Pack order', milestoneId: fulfilment.id, order: 1 }),
      makeStep({ id: 'step-5', label: 'Ship order', milestoneId: fulfilment.id, order: 2 }),
    ]
    const gaps = [makeProcessGap({ id: 'gap-1', order: 2, milestoneId: mainFlow.id })]
    seedStores(steps, gaps, [mainFlow, fulfilment])
  }

  it('opens Create Gap from the last row’s tray instead of throwing', async () => {
    singleMilestone()
    const { container } = renderGrid()
    await waitFor(() => expect(screen.getByText('Second step')).toBeInTheDocument())

    // Tray index 2 is one past the end of `filteredSteps`, which is where the
    // old `filteredSteps[atIndex].order` threw.
    openTray(container, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Create Gap' }))

    await waitFor(() => {
      expect(screen.getByTestId('gap-form-state')).toHaveTextContent('3|milestone-1')
    })
  })

  it('prefills a gap from the clicked row, not the row above it', async () => {
    twoMilestones()
    const { container } = renderGrid()
    await waitFor(() => expect(screen.getByText('Pack order')).toBeInTheDocument())

    // Above "Pack order": order 1 of Fulfilment. The row above it is the gap,
    // which sits in Main Flow — and `order` is scoped to its milestone (#299),
    // so pairing Fulfilment's order with Main Flow's id names a position in a
    // sequence the gap is not in.
    openTray(container, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Create Gap' }))

    await waitFor(() => {
      expect(screen.getByTestId('gap-form-state')).toHaveTextContent('1|milestone-2')
    })
  })

  it('drops onto the row below a gap with that row’s order and milestone', async () => {
    twoMilestones()
    const { container } = renderGrid()
    await waitFor(() => expect(screen.getByText('Pack order')).toBeInTheDocument())

    dragRowOnto(container, 'First step', 'Pack order')

    await waitFor(() => {
      expect(mockDbUpdateStep).toHaveBeenCalledWith(
        'step-1',
        { order: 1, milestoneId: 'milestone-2' },
        'project-1'
      )
    })
  })

  it('no longer swallows a drop that the two index bases made look like a self-drop', async () => {
    twoMilestones()
    const { container } = renderGrid()
    await waitFor(() => expect(screen.getByText('Ship order')).toBeInTheDocument())

    // "Ship order" is index 2 of `filteredSteps`; "Pack order" is index 2 of
    // `mergedItems`. Comparing one against the other read this as dropping the
    // row onto itself and returned with no write and no message.
    dragRowOnto(container, 'Ship order', 'Pack order')

    await waitFor(() => {
      expect(mockDbUpdateStep).toHaveBeenCalledWith(
        'step-5',
        { order: 1, milestoneId: 'milestone-2' },
        'project-1'
      )
    })
  })
})

/**
 * #307: `shiftStepsForInsertion` moved steps only, so a step inserted directly
 * above a process gap took the order the gap still held. The pair then shared
 * `(milestone_id, "order")` — which the grid and the diagram both read as a
 * deliberate parallel branch.
 */
describe('DiscoveryGrid insertion moves the process gap it displaces (#307)', () => {
  beforeEach(() => {
    const steps = [
      makeStep({ id: 'step-1', label: 'First step', milestoneId: mainFlow.id, order: 1 }),
      makeStep({ id: 'step-2', label: 'Second step', milestoneId: mainFlow.id, order: 3 }),
    ]
    const gaps = [makeProcessGap({ id: 'gap-1', order: 2, milestoneId: mainFlow.id })]
    seedStores(steps, gaps, [mainFlow])
  })

  const insertAboveTheGap = async (container: HTMLElement) => {
    await waitFor(() => expect(screen.getByText('Second step')).toBeInTheDocument())
    openTray(container, 1) // the gap's own row
    fireEvent.click(screen.getByRole('button', { name: 'Insert Step' }))
  }

  it('moves the gap as well as the steps', async () => {
    const { container } = renderGrid()
    await insertAboveTheGap(container)

    // Position 2 is emptied for the new row, and the gap that held it goes up
    // with the step above it. Both halves come out of one plan, so a step
    // cannot arrive on an order a gap is still holding.
    await waitFor(() => expect(sequenceOf(db, mainFlow.id)).toEqual([
      [1, 'First step'],
      [3, 'Missing handover'],
      [4, 'Second step'],
    ]))
  })

  it('leaves the gap and the new step on different orders', async () => {
    const { container } = renderGrid()
    await insertAboveTheGap(container)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Step' })).toBeInTheDocument()
    })

    // The new row takes order 2; a gap left behind on 2 would tie with it and
    // `runningNumbers` would give the pair one `#`.
    const gap = db.gaps().find((g) => g.id === 'gap-1')
    expect(gap?.order).toBe(3)
  })

  it('puts the gap back when the insert is cancelled', async () => {
    const { container } = renderGrid()
    await insertAboveTheGap(container)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // The reseal closes the slot the insert opened, and the gap comes back down
    // with the step above it rather than being left one slot high.
    await waitFor(() => expect(sequenceOf(db, mainFlow.id)).toEqual([
      [1, 'First step'],
      [2, 'Missing handover'],
      [3, 'Second step'],
    ]))
  })

  it('abandons the cancel restore when the gap write fails, rather than tying a step to the gap', async () => {
    const { container } = renderGrid()
    await insertAboveTheGap(container)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })
    mockDbUpdateStep.mockClear()
    mockSetGapOrders.mockRejectedValueOnce(new Error('gap write failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Row canceled, but order numbers could not be restored'
      )
    })
    // Nothing moved. The step half was written and put back from the plan's own
    // `from` values, so "Second step" is not sitting on the gap's order — one
    // slot high everywhere is a hole, which nothing misreads; a shared order is
    // a parallel branch nobody asked for.
    expect(sequenceOf(db, mainFlow.id)).toEqual([
      [1, 'First step'],
      [3, 'Missing handover'],
      [4, 'Second step'],
    ])
    expect(mockDbUpdateStep).not.toHaveBeenCalled()
  })

  it('un-shifts the steps when the gap write fails, so no two rows share an order', async () => {
    mockSetGapOrders.mockRejectedValueOnce(new Error('gap write failed'))

    const { container } = renderGrid()
    await insertAboveTheGap(container)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to insert step')
    })
    // The compensation puts the steps back exactly, so the milestone is the one
    // the insert started from rather than a half-opened slot.
    expect(sequenceOf(db, mainFlow.id)).toEqual([
      [1, 'First step'],
      [2, 'Missing handover'],
      [3, 'Second step'],
    ])
    expect(screen.queryByRole('button', { name: 'Save Step' })).not.toBeInTheDocument()
  })
})

/**
 * #312: the deletion mirror of #307. `getStepsToShiftAfterGapDeletion` filtered
 * steps alone, so with step(1), gapA(2), gapB(3), step(4) in one milestone,
 * deleting gapA brought the step down 4→3 and left gapB on 3. The pair then
 * share `(milestone_id, "order")`, which the grid and the diagram both read as
 * a deliberate parallel branch.
 */
describe('DiscoveryGrid gap deletion moves the process gaps it displaces (#312)', () => {
  const seedTwoGaps = () => {
    const steps = [
      makeStep({ id: 'step-1', label: 'First step', milestoneId: mainFlow.id, order: 1 }),
      makeStep({ id: 'step-2', label: 'Second step', milestoneId: mainFlow.id, order: 4 }),
    ]
    const gaps = [
      makeProcessGap({ id: 'gap-a', order: 2, milestoneId: mainFlow.id }),
      makeProcessGap({ id: 'gap-b', order: 3, milestoneId: mainFlow.id, observed: 'Missing sign-off' }),
    ]
    seedStores(steps, gaps, [mainFlow])
  }

  /** Both the row control and the confirm button are labelled "Delete Gap". */
  const deleteGap = async (observed: string) => {
    const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) =>
      tr.textContent?.includes(observed)
    )!
    fireEvent.click(
      Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Delete Gap')!
    )
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Delete Gap')!
    )
  }

  it('shifts the later gap as well as the later steps', async () => {
    seedTwoGaps()
    renderGrid()
    await waitFor(() => expect(screen.getByText('Second step')).toBeInTheDocument())

    await deleteGap('Missing handover')

    // The step comes down 4→3, which is exactly the order gap-b has just
    // vacated — so the two halves have to move in one plan or they collide.
    await waitFor(() => expect(sequenceOf(db, mainFlow.id)).toEqual([
      [1, 'First step'],
      [2, 'Missing sign-off'],
      [3, 'Second step'],
    ]))
    // One statement per table, not a row at a time (#343, #350).
    expect(mockSetStepOrders).toHaveBeenCalledTimes(1)
    expect(mockSetGapOrders).toHaveBeenCalledTimes(1)
    expect(mockDbUpdateStep).not.toHaveBeenCalled()
  })

  it('leaves a milestone with no later gap alone', async () => {
    const steps = [
      makeStep({ id: 'step-1', label: 'First step', milestoneId: mainFlow.id, order: 1 }),
      makeStep({ id: 'step-2', label: 'Second step', milestoneId: mainFlow.id, order: 3 }),
    ]
    seedStores(steps, [makeProcessGap({ id: 'gap-a', order: 2, milestoneId: mainFlow.id })], [mainFlow])
    renderGrid()
    await waitFor(() => expect(screen.getByText('Second step')).toBeInTheDocument())

    await deleteGap('Missing handover')

    await waitFor(() => expect(sequenceOf(db, mainFlow.id)).toEqual([
      [1, 'First step'],
      [2, 'Second step'],
    ]))
    expect(mockDbUpdateStep).not.toHaveBeenCalled()
    // No gap left to move, so the gap half of the plan is empty and no
    // statement is issued for it at all — the compute-then-diff rule, rather
    // than a write whose predicate happens to match nothing.
    expect(mockSetGapOrders).not.toHaveBeenCalled()
    expect(db.gaps()).toHaveLength(0)
  })

  it('does not shift a gap in another milestone', async () => {
    const steps = [
      makeStep({ id: 'step-1', label: 'First step', milestoneId: mainFlow.id, order: 1 }),
      makeStep({ id: 'step-4', label: 'Pack order', milestoneId: fulfilment.id, order: 1 }),
    ]
    const gaps = [
      makeProcessGap({ id: 'gap-a', order: 2, milestoneId: mainFlow.id }),
      makeProcessGap({
        id: 'gap-other',
        order: 3,
        milestoneId: fulfilment.id,
        observed: 'Missing sign-off',
      }),
    ]
    seedStores(steps, gaps, [mainFlow, fulfilment])
    renderGrid()
    await waitFor(() => expect(screen.getByText('Pack order')).toBeInTheDocument())

    await deleteGap('Missing handover')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Only the deleted gap's milestone is resealed, so Fulfilment keeps its
    // gap on 3 — a hole of its own, but not this deletion's business (#331).
    expect(db.gaps().find((g) => g.id === 'gap-other')?.order).toBe(3)
    const movedGapIds = mockSetGapOrders.mock.calls.flatMap(
      (call) => (call[1] as Array<{ id: string }>).map((assignment) => assignment.id)
    )
    expect(movedGapIds).not.toContain('gap-other')
  })
})
