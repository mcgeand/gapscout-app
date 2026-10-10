/**
 * Both step save paths rewrite the same gap the same way (#279).
 *
 * The Discovery grid re-synced the gaps a save made stale; the Diagram's Edit
 * Step modal did not, so the same step saved from the two surfaces left
 * `gaps.observed` naming fields the step already had. `observed` is what the
 * Gaps register, the Gap Panel, the CSV export and the Markdown pack display,
 * so the two halves of one gap disagreeing drives the wrong triage.
 *
 * One step, one gap, the same patch through both surfaces — that is the point
 * of the file. The patch deliberately fills the gap's OWN missing field, so
 * `updateStep` promotes the gap to Review (#88) before either caller can
 * re-plan. A fix that filtered the re-sync on status would skip exactly the
 * edit most likely to have changed the wording, which is the reported bug.
 *
 * Mocks the db module at its boundary so the real Zustand stores still run.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap, Milestone } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'

const {
  mockDbUpdateStep,
  mockDbUpdateGap,
  mockListGapsByStep,
  mockListSteps,
  mockListGaps,
  mockToast,
  mockToastSuccess,
} = vi.hoisted(() => {
  const mockToastSuccess = vi.fn()
  return {
    mockDbUpdateStep: vi.fn(),
    mockDbUpdateGap: vi.fn(),
    mockListGapsByStep: vi.fn(),
    mockListSteps: vi.fn(),
    mockListGaps: vi.fn(),
    mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: mockToastSuccess }),
    mockToastSuccess,
  }
})

vi.mock('../services/db', () => ({
  createStep: vi.fn(),
  listSteps: mockListSteps,
  getStep: vi.fn(),
  updateStep: mockDbUpdateStep,
  updateGap: mockDbUpdateGap,
  listGaps: mockListGaps,
  listGapsByStep: mockListGapsByStep,
  setStepOrders: vi.fn(),
  setGapOrders: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

import { EditableRowTable } from '../components/Discovery/EditableRowTable'
import StepEditModal from '../components/Diagram/StepEditModal'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useTeamsStore } from '../state/teamsStore'

const milestone: Milestone = {
  id: 'milestone-1',
  projectId: 'project-1',
  name: 'Requisition',
  order: 0,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

/**
 * Not first and not last in its milestone, so every SIPOC field is required and
 * the step stays invalid after `inputs` is filled — the branch that rewrites a
 * gap rather than the one that offers to close it.
 */
const midStep: EditableStep = {
  id: 'step-mid',
  projectId: 'project-1',
  label: 'Senior Manager Approval',
  teamId: 'team-1',
  milestoneId: milestone.id,
  order: 2,
  suppliers: ['Requester'],
  inputs: [],
  outputs: ['Approved order'],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
}

const lastStep: EditableStep = { ...midStep, id: 'step-last', order: 3 }

/** Machine-stamped `expected`, so the re-sync owns this gap's wording. */
const inputGap: Gap = {
  id: 'gap-input',
  projectId: 'project-1',
  stepId: midStep.id,
  observed: 'Missing input, customer',
  expected: 'All SIPOC fields should be complete',
  severity: 'M',
  status: 'Open',
  missingField: 'input',
  links: [],
  createdAt: 0,
  updatedAt: 0,
}

/** What the gap must say once `inputs` is filled and only the customer is left. */
const CORRECTED = {
  missingField: 'customer',
  observed: 'Missing customer',
  expected: 'All SIPOC fields should be complete',
}

const gridProps = {
  projectId: 'project-1',
  displayNumbers: null,
  steps: [midStep, lastStep],
  filteredSteps: [midStep],
  mergedItems: [{ ...midStep, _type: 'step' as const }],
  milestones: [milestone],
  teams: [],
  systems: [],
  gaps: [inputGap],
  selectedIds: new Set<string>(),
  setSelectedIds: vi.fn(),
  onUpdateNewRowLocally: vi.fn(),
  onRemoveNewRow: vi.fn(),
  draggedStepId: null,
  dragOverIndex: null,
  hoveredInsertIndex: null,
  setHoveredInsertIndex: vi.fn(),
  onDragStart: vi.fn(),
  onDragOver: vi.fn(),
  onDragEnd: vi.fn(),
  onDrop: vi.fn().mockResolvedValue(undefined),
  onCreateProcessGap: vi.fn().mockResolvedValue(undefined),
  onCloseProcessGap: vi.fn().mockResolvedValue(undefined),
  onEditProcessGap: vi.fn(),
  onRequestDeleteGap: vi.fn(),
  onInsertRow: vi.fn(),
  onRequestCancelNewRow: vi.fn(),
  onRequestCancelWithConfirm: vi.fn(),
  onShowValidationWarning: vi.fn(),
  onOpenStepDetails: vi.fn(),
}

const seedStores = (gaps: Gap[] = [inputGap], step: EditableStep = midStep) => {
  mockListGapsByStep.mockResolvedValue(gaps)
  // The modal save now reseals the milestones it touched (#335), and a reseal
  // reloads both stores from the database — so the database has to hold what
  // the stores hold, or the reload wipes the fixture out from under the
  // re-sync that runs after it.
  mockListSteps.mockResolvedValue([step, lastStep])
  mockListGaps.mockResolvedValue(gaps)
  useStepsStore.setState({
    steps: [step, lastStep],
    milestones: [milestone],
    currentProjectId: 'project-1',
    currentStep: null,
    isLoading: false,
  })
  useGapsStore.setState({
    gaps,
    currentProjectId: 'project-1',
    currentGap: null,
    isLoading: false,
  })
}

/** The re-sync's write on the gap, as distinct from #88's status promotion. */
const resyncWrite = (): Partial<Gap> | undefined =>
  mockDbUpdateGap.mock.calls.find(([, data]) => 'observed' in data)?.[1]

/** Fill the Inputs cell on the mid step and let the save debounce run. */
async function fillInputsInGrid() {
  const { container } = render(<EditableRowTable {...gridProps} />)

  // Column 5 is Inputs (drag/checkbox, validation, order, milestone, supplier).
  const stepRow = Array.from(container.querySelectorAll('tbody tr')).find(row =>
    row.textContent?.includes(midStep.label)
  )
  const inputsCell = stepRow!.querySelectorAll('td')[5] as HTMLElement
  fireEvent.click(within(inputsCell).getByText(/— add inputs/))
  const editor = screen.getByPlaceholderText('Request, Data...')
  fireEvent.change(editor, { target: { value: 'Purchase request' } })
  fireEvent.blur(editor)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}

/** Add one input in the Edit Step modal and save. */
function fillInputsInModal(step: EditableStep = midStep) {
  render(<StepEditModal projectId="project-1" step={step} isOpen={true} onClose={vi.fn()} />)
  fireEvent.change(screen.getByPlaceholderText('Add input'), {
    target: { value: 'Purchase request' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add input' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save step' }))
}

describe('gap auto-sync is the same from either save path (#279)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockDbUpdateGap.mockImplementation(async (gapId: string, data: Partial<Gap>) => {
      const current = useGapsStore.getState().gaps.find(g => g.id === gapId)
      return current ? { ...current, ...data } : null
    })
    useTeamsStore.setState({
      teams: [{
        id: 'team-1', projectId: 'project-1', name: 'Operations',
        color: '#000000', order: 0, tags: [], createdAt: 0,
      }],
      currentProjectId: 'project-1',
      isLoading: false,
    })
    useSystemsStore.setState({ systems: [] })
    seedStores()
  })

  it('rewrites the gap when the step is saved from the Discovery grid', async () => {
    vi.useFakeTimers()
    try {
      await fillInputsInGrid()
    } finally {
      vi.useRealTimers()
    }

    expect(mockDbUpdateStep).toHaveBeenCalledWith(
      midStep.id, { inputs: ['Purchase request'] }, 'project-1'
    )
    expect(resyncWrite()).toMatchObject(CORRECTED)
    expect(mockToastSuccess).toHaveBeenCalledWith('Step updated • 1 gap auto-synced')
  })

  it('rewrites the same gap the same way from the Edit Step modal', async () => {
    fillInputsInModal()

    await waitFor(() => expect(resyncWrite()).toBeDefined())

    expect(mockDbUpdateStep).toHaveBeenCalledWith(
      midStep.id, expect.objectContaining({ inputs: ['Purchase request'] }), 'project-1'
    )
    expect(resyncWrite()).toMatchObject(CORRECTED)
    expect(useGapsStore.getState().gaps[0]).toMatchObject(CORRECTED)
    expect(mockToastSuccess).toHaveBeenCalledWith('Step updated • 1 gap auto-synced')
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Step updated!')
  })

  it('corrects a gap naming three fields when the modal fills two of them', async () => {
    // The reported repro (docs/QA_RESULTS_2026-09-03.md): the modal sends every
    // SIPOC field at once, so `suppliers` and `inputs` land together and the
    // supplier gap is promoted to Review by the same write that fixed it.
    const emptyStep: EditableStep = { ...midStep, suppliers: [], inputs: [] }
    const supplierGap: Gap = {
      ...inputGap,
      id: 'gap-supplier',
      missingField: 'supplier',
      observed: 'Missing supplier, input, customer',
    }
    seedStores([supplierGap], emptyStep)

    render(
      <StepEditModal projectId="project-1" step={emptyStep} isOpen={true} onClose={vi.fn()} />
    )
    fireEvent.change(screen.getByPlaceholderText('Add supplier'), {
      target: { value: 'Requester' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }))
    fireEvent.change(screen.getByPlaceholderText('Add input'), {
      target: { value: 'Purchase request' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add input' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save step' }))

    await waitFor(() => expect(resyncWrite()).toBeDefined())
    expect(resyncWrite()).toMatchObject(CORRECTED)
  })

  it('reports a plain save from the modal when there is nothing to re-sync', async () => {
    seedStores([])

    render(<StepEditModal projectId="project-1" step={midStep} isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save step' }))

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Step updated!'))
    expect(mockDbUpdateGap).not.toHaveBeenCalled()
  })

  it('still reports the modal save when the gap re-sync write fails', async () => {
    // `updateGap` toasts its own failure and rethrows. The step write has
    // already committed by then, so letting it through would follow a save that
    // worked with "Failed to update step" — the rule stepsStore applies to gap
    // promotion for the same reason.
    mockDbUpdateGap.mockRejectedValue(new Error('gap write failed'))

    fillInputsInModal()

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Step updated!'))
    expect(mockDbUpdateStep).toHaveBeenCalledWith(
      midStep.id, expect.objectContaining({ inputs: ['Purchase request'] }), 'project-1'
    )
    // The re-sync ran and threw — without that the assertion above would pass
    // on a build that simply never attempted one.
    expect(mockDbUpdateGap).toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalledWith('Failed to update step')
  })

  it('leaves a gap a reviewer already held alone when the modal saves', async () => {
    // The other side of the rule: only a gap THIS write promoted is refreshed.
    // One that was already in Review belongs to whoever is reviewing it.
    seedStores([{ ...inputGap, status: 'Review' }])

    fillInputsInModal()

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Step updated!'))
    expect(mockDbUpdateGap).not.toHaveBeenCalled()
  })
})
