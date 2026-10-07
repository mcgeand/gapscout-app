import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap, Milestone, Step, System, Team } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'
import { wireSequenceDb } from './helpers/sequenceDb'

const {
  mockCreateStep,
  mockDbUpdateStep,
  mockSetStepOrders,
  mockListSteps,
  mockListGaps,
  mockCreateGap,
  mockUpdateGap,
  mockAddGapInStore,
  mockGetGap,
  mockListMilestones,
  mockToast,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => {
  const mockToastError = vi.fn()
  const mockToastSuccess = vi.fn()
  return {
    mockCreateStep: vi.fn(),
    mockDbUpdateStep: vi.fn(),
    mockSetStepOrders: vi.fn(),
    mockListSteps: vi.fn(),
    mockListGaps: vi.fn(),
    mockCreateGap: vi.fn(),
    mockUpdateGap: vi.fn(),
    mockAddGapInStore: vi.fn(),
    mockGetGap: vi.fn(),
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
  createStep: mockCreateStep,
  createGap: mockCreateGap,
  updateStep: mockDbUpdateStep,
  updateGap: mockUpdateGap,
  getGap: mockGetGap,
  listMilestones: mockListMilestones,
  listSteps: mockListSteps,
  getStep: vi.fn(),
  deleteStep: vi.fn(),
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  listGaps: mockListGaps,
  listGapsByStep: vi.fn(),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
  setStepOrders: mockSetStepOrders,
  setGapOrders: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))
vi.mock('../components/Discovery/MilestoneManager', () => ({ MilestoneManager: () => null }))
vi.mock('../components/Discovery/ProcessGapManager', () => ({ ProcessGapManager: () => null }))
vi.mock('../components/shared/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('../components/Discovery/ValidationWarningModal', () => ({
  ValidationWarningModal: ({ isOpen, onCreateGap, onGoBack, onClose }: {
    isOpen: boolean
    onCreateGap: () => Promise<void>
    onGoBack: () => void
    onClose: () => void
  }) =>
    isOpen ? (
      <>
        <button onClick={() => void onCreateGap()}>Create Gap</button>
        <button onClick={() => void onGoBack()}>Go Back &amp; Edit</button>
        {/* Stands in for the real Modal's X, Escape and backdrop, which all
            call onClose. */}
        <button onClick={() => void onClose()}>Dismiss Modal</button>
      </>
    ) : null,
}))

vi.mock('../components/Discovery/EditableRowTable', () => ({
  EditableRowTable: ({ projectId, onShowValidationWarning }: {
    projectId: string
    onShowValidationWarning: (context: {
      step: EditableStep
      missingFields: string[]
      pendingUpdates: Partial<Step>
    }) => void
  }) => {
    const step: EditableStep = {
      id: 'temp-step',
      projectId,
      label: '',
      teamId: 'team-1',
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
      createdAt: 0,
      updatedAt: 0,
      _isNew: true,
    }
    const existingStep: EditableStep = { ...step, id: 'existing-step', _isNew: false }
    const showWarning = (warningStep: EditableStep, pendingUpdates: Partial<Step> = { inputs: [] }) =>
      onShowValidationWarning({
        step: warningStep,
        missingFields: ['input'],
        pendingUpdates,
      })
    return (
      <>
        <button onClick={() => showWarning(step)}>Trigger Validation Warning</button>
        <button onClick={() => showWarning(existingStep)}>Trigger Existing Validation Warning</button>
        {/* A new row whose typed order is past the end of its milestone.
            `parseStepFieldValue` bounds an order only by `>= 1`, so this is a
            number the grid will accept and the raw INSERT will write. */}
        <button onClick={() => showWarning({ ...step, id: 'temp-far', order: 9 })}>
          Trigger Out Of Range New Step
        </button>
        {/* The autosave debounce merges patches, so one patch can both clear a
            SIPOC field (which is what opens this modal) and move the step. */}
        <button onClick={() => showWarning({ ...existingStep, id: 'step-1', order: 1 }, { inputs: [], order: 2 })}>
          Trigger Reordering Validation Warning
        </button>
        {/* #296: the row the modal is asking about is still on screen. */}
        <button onClick={() => showWarning({ ...existingStep, id: 'step-1', order: 1 }, { suppliers: [] })}>
          Trigger Warning For Mounted Row
        </button>
        {/* #296: 'gone-step' is not in the store, so DiscoveryGrid renders no
            row for it — the state the user is in after the row unmounts under
            the open modal. */}
        <button onClick={() => showWarning({ ...existingStep, id: 'gone-step' }, { suppliers: [] })}>
          Trigger Warning For Unmounted Row
        </button>
        {/* The shape production actually produces: EditableRowTable opens the
            modal with the MERGED step (`{...item, ...updates}`), so `step.order`
            is ALREADY the edited order while the database still holds the old
            one. A split that compares the patch against it sees a no-op. */}
        <button
          onClick={() =>
            showWarning({ ...existingStep, id: 'step-1', order: 2 }, { suppliers: [], order: 2 })
          }
        >
          Trigger Merged-Step Warning
        </button>
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

const realAddGapInStore = useGapsStore.getState().addGap
// Captured before any test swaps it: the #336 case replaces `updateStep` to
// write a gap mid-save, and without restoring it here that stub would leak into
// every test that runs after it in this file.
const realUpdateStepInStore = useStepsStore.getState().updateStep

const milestone: Milestone = {
  id: 'milestone-1',
  projectId: 'project-1',
  name: 'Main Flow',
  order: 0,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

const step: Step = {
  id: 'step-1',
  projectId: 'project-1',
  label: 'Existing step',
  teamId: 'team-1',
  milestoneId: milestone.id,
  order: 1,
  suppliers: ['Supplier'],
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

const persistedStep: Step = {
  ...step,
  id: 'persisted-step',
  label: '',
}

const persistedGap: Gap = {
  id: 'gap-1',
  projectId: 'project-1',
  stepId: persistedStep.id,
  observed: 'Missing input',
  expected: 'All SIPOC fields should be complete',
  severity: 'M',
  priority: 2,
  status: 'Open',
  missingField: 'input',
  links: [],
  createdAt: 0,
  updatedAt: 0,
}

const existingGap: Gap = { ...persistedGap, id: 'gap-existing', stepId: 'existing-step' }

const seedStores = () => {
  useStepsStore.setState({
    updateStep: realUpdateStepInStore,
    steps: [step],
    milestones: [milestone],
    currentProjectId: 'project-1',
    currentStep: null,
    isLoading: false,
    loadSteps: vi.fn().mockImplementation(async () => {
      useStepsStore.setState({ steps: [persistedStep] })
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
    addGap: mockAddGapInStore.mockResolvedValue(persistedGap),
    updateGap: vi.fn().mockResolvedValue(undefined),
    loadGaps: vi.fn().mockResolvedValue(undefined),
  })
}

describe('DiscoveryGrid validation gap sequencing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListMilestones.mockResolvedValue([milestone])
    mockGetGap.mockResolvedValue(persistedGap)
    mockCreateStep.mockResolvedValue(persistedStep.id)
    // The sequence module reads the milestone's live rows from the database
    // (#353), so anything that opens a slot or moves a row needs these seeded
    // alongside the stores. Cases about a move override `listSteps` with their
    // own fixture.
    mockListSteps.mockImplementation(async () => useStepsStore.getState().steps)
    mockListGaps.mockImplementation(async () => useGapsStore.getState().gaps)
    seedStores()
    beginProjectScope('project-1')
  })

  it('starts only one validation-gap orchestration for a double click', async () => {
    let resolveStep!: (stepId: string) => void
    mockCreateStep.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveStep = resolve
    }))

    render(<DiscoveryGrid projectId="project-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trigger Validation Warning' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Validation Warning' }))
    const createGapButton = await screen.findByRole('button', { name: 'Create Gap' })
    fireEvent.click(createGapButton)
    fireEvent.click(createGapButton)

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(1))
    expect(mockAddGapInStore).not.toHaveBeenCalled()

    resolveStep(persistedStep.id)
    await waitFor(() => expect(mockAddGapInStore).toHaveBeenCalledTimes(1))
    expect(mockCreateStep).toHaveBeenCalledTimes(1)
  })

  it('stops a delayed new-step validation flow after the project changes', async () => {
    let resolveOldStep!: (stepId: string) => void
    let resolveNewGap!: (gap: Gap) => void
    mockCreateStep
      .mockReturnValueOnce(new Promise<string>((resolve) => {
        resolveOldStep = resolve
      }))
      .mockResolvedValueOnce('project-2-step')
    mockAddGapInStore.mockImplementationOnce(() => new Promise<Gap>((resolve) => {
      resolveNewGap = resolve
    }))

    const view = render(<DiscoveryGrid projectId="project-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trigger Validation Warning' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Validation Warning' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create Gap' }))
    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(1))

    beginProjectScope('project-2')
    await act(async () => {
      useStepsStore.setState({ currentProjectId: 'project-2' })
      view.rerender(<DiscoveryGrid projectId="project-2" />)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Validation Warning' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create Gap' }))
    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveOldStep(persistedStep.id)
      await Promise.resolve()
    })
    await waitFor(() => expect(mockAddGapInStore).toHaveBeenCalledTimes(1))
    expect(mockCreateStep).toHaveBeenCalledTimes(2)
    expect(mockAddGapInStore).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-2' }))
    await act(async () => {
      resolveNewGap(persistedGap)
      await Promise.resolve()
    })
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1))
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('stops a delayed existing-step validation flow after the project changes', async () => {
    let resolveUpdate!: () => void
    useGapsStore.setState({ gaps: [existingGap] })
    mockDbUpdateStep.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveUpdate = resolve
    }))

    render(<DiscoveryGrid projectId="project-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trigger Existing Validation Warning' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Existing Validation Warning' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create Gap' }))
    beginProjectScope('project-2')

    resolveUpdate()
    await waitFor(() => expect(mockDbUpdateStep).toHaveBeenCalledTimes(1))
    expect(mockAddGapInStore).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('does not create a gap or report success when saving a new step fails', async () => {
    mockCreateStep.mockRejectedValueOnce(new Error('step write failed'))

    render(<DiscoveryGrid projectId="project-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trigger Validation Warning' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Validation Warning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Gap' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to create/update gap'))
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockCreateStep).toHaveBeenCalledTimes(1)
    expect(mockCreateGap).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('uses the persisted step id when creating a gap after a new step succeeds', async () => {
    render(<DiscoveryGrid projectId="project-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trigger Validation Warning' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Validation Warning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Gap' }))

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Gap created for incomplete step'))
    const addGap = useGapsStore.getState().addGap as ReturnType<typeof vi.fn>
    expect(addGap).toHaveBeenCalledWith(expect.objectContaining({ stepId: persistedStep.id }))
    expect(mockCreateStep.mock.invocationCallOrder[0]).toBeLessThan(addGap.mock.invocationCallOrder[0])
  })

  it('retries only the failed gap mutation after a new step is persisted', async () => {
    useGapsStore.setState({ addGap: realAddGapInStore })
    mockCreateGap
      .mockRejectedValueOnce(new Error('gap write failed'))
      .mockResolvedValueOnce(persistedGap.id)
    mockGetGap.mockResolvedValue(persistedGap)

    render(<DiscoveryGrid projectId="project-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trigger Validation Warning' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Validation Warning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Gap' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to create gap'))
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastError).not.toHaveBeenCalledWith('Failed to create/update gap')
    expect(screen.getByRole('button', { name: 'Create Gap' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create Gap' }))

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Gap created for incomplete step'))
    expect(mockCreateStep).toHaveBeenCalledTimes(1)
    expect(mockDbUpdateStep).not.toHaveBeenCalled()
    expect(mockCreateGap).toHaveBeenCalledTimes(2)
    expect(mockCreateGap.mock.calls[0][0]).toEqual(expect.objectContaining({ stepId: persistedStep.id }))
    expect(mockCreateGap.mock.calls[1][0]).toEqual(expect.objectContaining({ stepId: persistedStep.id }))
    expect(mockCreateGap.mock.invocationCallOrder[0]).toBeLessThan(mockCreateGap.mock.invocationCallOrder[1])
    expect(screen.queryByRole('button', { name: 'Create Gap' })).not.toBeInTheDocument()
  })

  it('does not update an existing gap when persisting the step fails', async () => {
    useGapsStore.setState({ gaps: [existingGap] })
    mockDbUpdateStep.mockRejectedValueOnce(new Error('step update failed'))

    render(<DiscoveryGrid projectId="project-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trigger Existing Validation Warning' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Existing Validation Warning' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Gap' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to update step'))
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastError).not.toHaveBeenCalledWith('Failed to create/update gap')
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockDbUpdateStep).toHaveBeenCalledTimes(1)
    const updateGap = useGapsStore.getState().updateGap as ReturnType<typeof vi.fn>
    expect(updateGap).not.toHaveBeenCalled()
    expect(mockCreateGap).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
  /**
   * The validation modal's own `createStep` is a raw INSERT carrying whatever
   * order the row holds, and `parseStepFieldValue` bounds that only by `>= 1`.
   * An order past the end of the milestone makes `openSlot` a no-op — nothing
   * sits at or above it — so the step lands there verbatim and leaves a hole
   * the sequence never closes. Open, write, THEN reseal is the module's
   * contract, and this path was skipping the third step (#353).
   */
  it('reseals after creating a new step at a typed order past the end', async () => {
    const second: Step = { ...step, id: 'step-2', label: 'Second', order: 2 }
    useStepsStore.setState({
      steps: [step, second],
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: db.steps() })
      }),
    })
    useGapsStore.setState({ gaps: [], loadGaps: vi.fn().mockResolvedValue(undefined) })

    const db = wireSequenceDb(
      { listSteps: mockListSteps, listGaps: mockListGaps, setStepOrders: mockSetStepOrders },
      [step, second],
      []
    )
    // The raw INSERT lands in the same rows the reseal then measures.
    mockCreateStep.mockImplementation(async (data: Step) => {
      db.reset([...db.steps(), { ...data, id: 'far-step' }], db.gaps())
      return 'far-step'
    })

    render(<DiscoveryGrid projectId="project-1" />)
    fireEvent.click(screen.getByText('Trigger Out Of Range New Step'))
    fireEvent.click(screen.getByText('Create Gap'))

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(1))
    // Written at 9, because that is what the user typed and the open slot
    // could not move anything out of its way...
    expect(mockCreateStep.mock.calls[0][0]).toMatchObject({ order: 9 })
    // ...and then pulled back onto the end of the sequence, so the milestone
    // is 1, 2, 3 rather than 1, 2, 9.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [{ id: 'far-step', order: 3 }])
    )
    expect(db.steps().map(s => s.order).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('splits a merged-step patch against the stored order, not the edited one (#299)', async () => {
    // The modal is opened with `{...item, ...updates}`, so the step it carries
    // already holds the edited order. Comparing the patch against that makes
    // every order edit read as unchanged: the move is dropped on the floor and
    // the user is told the step was updated. The database still holds order 1,
    // and that is what the split has to compare against.
    useStepsStore.setState({ steps: [step, { ...step, id: 'step-2', order: 2 }] })
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockSetStepOrders.mockResolvedValue(undefined)

    render(<DiscoveryGrid projectId="project-1" />)
    fireEvent.click(screen.getByText('Trigger Merged-Step Warning'))
    fireEvent.click(screen.getByText('Create Gap'))

    // The SIPOC half lands on its own...
    await waitFor(() =>
      expect(mockDbUpdateStep).toHaveBeenCalledWith('step-1', { suppliers: [] }, 'project-1')
    )
    // ...and so does the move, which is the half that used to go missing.
    // Step 1 goes to 2 and step 2 comes down to 1, both in one statement.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [
        { id: 'step-1', order: 2 },
        { id: 'step-2', order: 1 },
      ])
    )
  })

  it('re-syncs the milestone gaps a reorder made stale (#298)', async () => {
    // #295 sent the order through `reorderSteps` on this route, but not the gap
    // re-sync `EditableRowTable.onUpdate` runs afterwards. So the sequence
    // landed while the siblings kept gaps describing a position they no longer
    // held — the other half of #291.
    //
    // The move sends step-1 from order 1 to order 2, which slides the sibling
    // from 2 to 1. The sibling stops being last and starts being first, so what
    // it is missing flips from supplier/input to output/customer.
    const sibling: Step = {
      ...step,
      id: 'step-2',
      label: 'Sibling',
      order: 2,
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
    }
    const siblingGap: Gap = {
      ...persistedGap,
      id: 'gap-sibling',
      stepId: sibling.id,
      missingField: 'supplier',
      observed: 'Missing supplier, input',
    }
    const updateGapInStore = vi.fn().mockResolvedValue(undefined)

    // `seedStores` gives loadSteps a mock that swaps in the new-step fixture.
    // Here the state under test is what the reorder WROTE, and the reorder no
    // longer paints optimistically — a step-only patch would be a lie wherever
    // the move crosses a process gap — so the reload has to show the move, and
    // the mutable rows below are what it reloads from.
    const db = wireSequenceDb(
      { listSteps: mockListSteps, listGaps: mockListGaps, setStepOrders: mockSetStepOrders },
      [step, sibling],
      [siblingGap]
    )
    useStepsStore.setState({
      steps: [step, sibling],
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: db.steps() })
      }),
    })
    useGapsStore.setState({
      gaps: [siblingGap],
      updateGap: updateGapInStore,
      loadGaps: vi.fn().mockImplementation(async () => {
        useGapsStore.setState({ gaps: db.gaps() })
      }),
    })
    mockDbUpdateStep.mockResolvedValue(undefined)

    render(<DiscoveryGrid projectId="project-1" />)
    fireEvent.click(screen.getByText('Trigger Reordering Validation Warning'))
    fireEvent.click(screen.getByText('Create Gap'))

    await waitFor(() => expect(updateGapInStore).toHaveBeenCalled())
    expect(updateGapInStore).toHaveBeenCalledWith(
      siblingGap.id,
      {
        missingField: 'output',
        observed: 'Missing output, customer',
        expected: 'All SIPOC fields should be complete',
      },
      'project-1',
      // Silent: a milestone-wide re-sync can rewrite every gap in the milestone,
      // and one `Gap updated` toast per sibling is the storm #107 opened on.
      { silent: true }
    )
  })

  it('sees a gap written during the same save, not the render-time array (#336)', async () => {
    // The handler renders once, then creates or updates the step and re-syncs
    // its gaps. A `gaps` closure captured at render sees none of that, so the
    // existing-gap lookup missed a gap this very save had produced and created a
    // duplicate alongside it — #261's class, in the spot that issue does not name.
    const lateGap: Gap = { ...persistedGap, id: 'gap-late', stepId: 'step-1' }
    const updateGapInStore = vi.fn().mockResolvedValue(undefined)

    // The reorder no longer paints optimistically, so the reload is what shows
    // the move — and the re-sync's answer depends on where step-1 ended up.
    const db = wireSequenceDb(
      { listSteps: mockListSteps, listGaps: mockListGaps, setStepOrders: mockSetStepOrders },
      [step, { ...step, id: 'step-2', order: 2 }],
      []
    )
    useStepsStore.setState({
      steps: [step, { ...step, id: 'step-2', order: 2 }],
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: db.steps() })
      }),
      // The step write is what puts the gap in the store, after render.
      updateStep: vi.fn().mockImplementation(async () => {
        useGapsStore.setState({ gaps: [lateGap] })
      }),
    })
    // Render-time: no gaps at all. Only the store learns about `lateGap`, so
    // the reload must not paint the empty render-time list back over it.
    useGapsStore.setState({
      gaps: [],
      updateGap: updateGapInStore,
      loadGaps: vi.fn().mockResolvedValue(undefined),
    })

    render(<DiscoveryGrid projectId="project-1" />)
    fireEvent.click(screen.getByText('Trigger Merged-Step Warning'))
    fireEvent.click(screen.getByText('Create Gap'))

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Existing gap updated with current missing fields')
    )
    // It found the late gap and updated it, rather than creating a second one.
    expect(updateGapInStore).toHaveBeenCalledWith(
      lateGap.id, expect.objectContaining({ observed: 'Missing input' }), 'project-1'
    )
    expect(mockAddGapInStore).not.toHaveBeenCalled()
  })

  it('does not overwrite the re-sync correction with the pre-write missing fields', async () => {
    // The re-sync computes the edited step's own gap from the post-write store;
    // `context.missingFields` was captured before the move, against a list that
    // carries the edited row's new order but not the shifted neighbours. Writing
    // both means a round-trip that can replace the better answer with the worse.
    // Stale wording, so the re-sync actually has something to write: step-1
    // moves to order 2 and becomes last, which drops output/customer from what
    // it needs and leaves only the input.
    const ownGap: Gap = {
      ...persistedGap,
      id: 'gap-own',
      stepId: 'step-1',
      missingField: 'output',
      observed: 'Missing output, customer',
    }
    const updateGapInStore = vi.fn().mockResolvedValue(undefined)

    const db = wireSequenceDb(
      { listSteps: mockListSteps, listGaps: mockListGaps, setStepOrders: mockSetStepOrders },
      [step, { ...step, id: 'step-2', order: 2 }],
      [ownGap]
    )
    useStepsStore.setState({
      steps: [step, { ...step, id: 'step-2', order: 2 }],
      loadSteps: vi.fn().mockImplementation(async () => {
        useStepsStore.setState({ steps: db.steps() })
      }),
    })
    useGapsStore.setState({
      gaps: [ownGap],
      updateGap: updateGapInStore,
      loadGaps: vi.fn().mockResolvedValue(undefined),
    })
    mockDbUpdateStep.mockResolvedValue(undefined)

    render(<DiscoveryGrid projectId="project-1" />)
    fireEvent.click(screen.getByText('Trigger Reordering Validation Warning'))
    fireEvent.click(screen.getByText('Create Gap'))

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Existing gap updated with current missing fields')
    )
    const ownGapWrites = updateGapInStore.mock.calls.filter(([id]) => id === ownGap.id)
    expect(ownGapWrites).toHaveLength(1)
    expect(ownGapWrites[0][3]).toEqual({ silent: true })
  })

  it('still creates the gap when a sibling re-sync write fails', async () => {
    // The step write has already committed by then. Letting the failure through
    // would abandon the gap the button exists to create and log a save that
    // worked as "Failed to persist validation step".
    const sibling: Step = {
      ...step, id: 'step-2', label: 'Sibling', order: 2,
      suppliers: [], inputs: [], outputs: [], customers: [],
    }
    const siblingGap: Gap = {
      ...persistedGap, id: 'gap-sibling', stepId: sibling.id,
      missingField: 'supplier', observed: 'Missing supplier, input',
    }

    useStepsStore.setState({
      steps: [step, sibling],
      loadSteps: vi.fn().mockResolvedValue(undefined),
    })
    useGapsStore.setState({
      gaps: [siblingGap],
      updateGap: vi.fn().mockRejectedValue(new Error('gap write failed')),
    })
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockSetStepOrders.mockResolvedValue(undefined)

    render(<DiscoveryGrid projectId="project-1" />)
    fireEvent.click(screen.getByText('Trigger Reordering Validation Warning'))
    fireEvent.click(screen.getByText('Create Gap'))

    await waitFor(() => expect(mockAddGapInStore).toHaveBeenCalledTimes(1))
    expect(mockToastSuccess).toHaveBeenCalledWith('Gap created for incomplete step')
  })

  it('routes an order carried in the pending updates through the reorder path, not a raw write (#290)', async () => {
    // Two steps so a move has something to displace.
    useStepsStore.setState({ steps: [step, { ...step, id: 'step-2', order: 2 }] })
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockSetStepOrders.mockResolvedValue(undefined)

    render(<DiscoveryGrid projectId="project-1" />)
    fireEvent.click(screen.getByText('Trigger Reordering Validation Warning'))
    fireEvent.click(screen.getByText('Create Gap'))

    await waitFor(() => expect(mockSetStepOrders).toHaveBeenCalled())

    // The SIPOC half is written on its own, without the order riding along...
    expect(mockDbUpdateStep).toHaveBeenCalledWith('step-1', { inputs: [] }, 'project-1')
    // ...and the order half slides the step it displaces instead of landing raw.
    expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [
      { id: 'step-1', order: 2 },
      { id: 'step-2', order: 1 },
    ])
    // The bug this guards: a single `{ inputs: [], order: 2 }` write.
    expect(mockDbUpdateStep).not.toHaveBeenCalledWith(
      'step-1', expect.objectContaining({ inputs: [], order: 2 }), 'project-1'
    )
  })

  describe('Go Back & Edit when the row has gone (#296)', () => {
    it('writes the held-back edit instead of discarding it', async () => {
      // Clearing Suppliers commits on document mousedown, so the write is
      // attended at that instant and the modal legitimately opens. The row then
      // unmounts underneath it — a milestone tab switch, a filter — and the
      // step the modal names is no longer on screen. "Go Back & Edit" has
      // nowhere to send the user back to, so discarding the patch (what it used
      // to do) lost work the user had already done.
      useStepsStore.setState({ steps: [step] })
      mockDbUpdateStep.mockResolvedValue(undefined)

      render(<DiscoveryGrid projectId="project-1" />)
      fireEvent.click(screen.getByText('Trigger Warning For Unmounted Row'))
      fireEvent.click(screen.getByText('Go Back & Edit'))

      await waitFor(() =>
        expect(mockDbUpdateStep).toHaveBeenCalledWith(
          'gone-step',
          { suppliers: [] },
          'project-1'
        )
      )
      expect(mockToast).not.toHaveBeenCalledWith('Please complete the missing SIPOC fields')
    })

    it('still holds the edit back while the row is on screen', async () => {
      // The unchanged case: the user can actually go back and finish the row,
      // so the modal must not commit an edit it just warned about.
      useStepsStore.setState({ steps: [step] })
      mockDbUpdateStep.mockResolvedValue(undefined)

      render(<DiscoveryGrid projectId="project-1" />)
      fireEvent.click(screen.getByText('Trigger Warning For Mounted Row'))
      fireEvent.click(screen.getByText('Go Back & Edit'))

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith('Please complete the missing SIPOC fields')
      )
      expect(mockDbUpdateStep).not.toHaveBeenCalled()
    })

    it('does not resurrect a new row that was cancelled', async () => {
      // A new row that is gone was thrown away, not navigated away from.
      // Creating it here would put back a row the user deleted.
      useStepsStore.setState({ steps: [step] })
      mockCreateStep.mockResolvedValue('temp-step')

      render(<DiscoveryGrid projectId="project-1" />)
      fireEvent.click(screen.getByText('Trigger Validation Warning'))
      fireEvent.click(screen.getByText('Go Back & Edit'))

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith('Please complete the missing SIPOC fields')
      )
      expect(mockCreateStep).not.toHaveBeenCalled()
      expect(mockDbUpdateStep).not.toHaveBeenCalled()
    })

    it('writes the edit when the modal is dismissed with Escape, not just the button', async () => {
      // The X, Escape and the backdrop all leave by the same door as
      // "Go Back & Edit". Losing the edit to a keystroke is the same bug.
      useStepsStore.setState({ steps: [step] })
      mockDbUpdateStep.mockResolvedValue(undefined)

      render(<DiscoveryGrid projectId="project-1" />)
      fireEvent.click(screen.getByText('Trigger Warning For Unmounted Row'))
      fireEvent.click(screen.getByText('Dismiss Modal'))

      await waitFor(() =>
        expect(mockDbUpdateStep).toHaveBeenCalledWith(
          'gone-step',
          { suppliers: [] },
          'project-1'
        )
      )
    })
  })
})
