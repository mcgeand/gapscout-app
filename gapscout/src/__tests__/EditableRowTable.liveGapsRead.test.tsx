/**
 * The new-row save handler decides create-versus-update against the store, not
 * the render-time `gaps` prop (#261).
 *
 * The handler is a chain of writes: it closes the gap the row replaces, reloads
 * the gaps store so the chain re-validation can read what that closing changed,
 * raises a chain-break gap on the step it just created, and only then asks
 * whether that step already has an open gap. Every one of those questions used
 * to be put to `gaps`, a closure captured when the button was rendered — so the
 * handler could not see its own writes, nor anything its own reload brought in,
 * and answered "no gap here" for a gap it had opened seconds earlier.
 *
 * Mocks the db module at its boundary so the real Zustand stores still run, and
 * wires create/read/update to one mutable table so a gap really lands and the
 * next read really sees it.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap, Milestone, Step } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'

const {
  mockDbCreateStep,
  mockDbUpdateStep,
  mockDbListSteps,
  mockSetStepOrders,
  mockSetGapOrders,
  mockDbCreateGap,
  mockDbGetGap,
  mockDbUpdateGap,
  mockDbListGaps,
  mockToast,
} = vi.hoisted(() => ({
  mockDbCreateStep: vi.fn(),
  mockDbUpdateStep: vi.fn(),
  mockDbListSteps: vi.fn(),
  mockSetStepOrders: vi.fn(),
  mockSetGapOrders: vi.fn(),
  mockDbCreateGap: vi.fn(),
  mockDbGetGap: vi.fn(),
  mockDbUpdateGap: vi.fn(),
  mockDbListGaps: vi.fn(),
  mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../services/db', () => ({
  createStep: mockDbCreateStep,
  listSteps: mockDbListSteps,
  updateStep: mockDbUpdateStep,
  updateGap: mockDbUpdateGap,
  createGap: mockDbCreateGap,
  getGap: mockDbGetGap,
  listGaps: mockDbListGaps,
  listGapsByStep: vi.fn().mockResolvedValue([]),
  setStepOrders: mockSetStepOrders,
  setGapOrders: mockSetGapOrders,
  listMilestones: vi.fn().mockResolvedValue([]),
  getStep: vi.fn(),
  deleteStep: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

import { EditableRowTable } from '../components/Discovery/EditableRowTable'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'

const milestones: Milestone[] = [
  { id: 'm1', projectId: 'project-1', name: 'Requisition', order: 0, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
]

const base = {
  projectId: 'project-1',
  teamId: 'team-1',
  milestoneId: 'm1',
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
}

/**
 * Four steps in one milestone, deliberately mismatched: nobody's customer turns
 * up as the next step's supplier and nobody's output turns up as its input, so
 * every step but the last carries chain issues. The last one closes the process
 * and is exempt from outputs and customers (#344), which keeps it valid and out
 * of the way.
 */
const first: Step = {
  ...base, id: 'step-first', label: 'Raise request', order: 1,
  suppliers: ['Requester'], inputs: ['Need'], outputs: ['Request'], customers: ['Buyer'],
}
/** What the new row becomes once saved. */
const saved: Step = {
  ...base, id: 'step-saved', label: 'Approve request', order: 2,
  suppliers: ['Approver'], inputs: ['Draft order'], outputs: ['Approved order'], customers: ['Finance'],
}
const next: Step = {
  ...base, id: 'step-next', label: 'Raise PO', order: 3,
  suppliers: ['Buyer'], inputs: ['Signed order'], outputs: ['PO'], customers: ['Supplier'],
}
const last: Step = {
  ...base, id: 'step-last', label: 'Receipt goods', order: 4,
  suppliers: ['Warehouse'], inputs: ['Delivery'], outputs: [], customers: [],
}

const persisted = [first, saved, next, last]

const newRow: EditableStep = { ...saved, id: 'temp-row', _isNew: true, _closingGapId: 'gap-closing' }

const closingGap: Gap = {
  id: 'gap-closing',
  projectId: 'project-1',
  milestoneId: 'm1',
  order: 2,
  observed: 'Process gap',
  expected: 'All SIPOC fields should be complete',
  severity: 'M',
  status: 'Open',
  missingField: 'output',
  links: [],
  createdAt: 0,
  updatedAt: 0,
}

/**
 * Chain-break gaps already on the neighbours. They are absent from the `gaps`
 * prop and from the store's opening state, and arrive only through the reload
 * the handler itself runs after closing the gap — which is the whole point: a
 * write that lands while the save is running is exactly what the render-time
 * closure cannot see.
 */
const chainGapOn = (stepId: string, id: string): Gap => ({
  id,
  projectId: 'project-1',
  stepId,
  observed: 'Chain break: Customer(s) not matched in next step: Buyer',
  expected: 'Outputs should match next step inputs, Customers should match next step suppliers',
  severity: 'H',
  priority: 1,
  status: 'Open',
  missingField: 'customer',
  links: [],
  createdAt: 0,
  updatedAt: 0,
})

/** The gap table the db mocks read and write. */
let gapRows: Gap[]

const props = {
  projectId: 'project-1',
  displayNumbers: null,
  steps: [first, newRow, next, last] as EditableStep[],
  filteredSteps: [newRow],
  mergedItems: [{ ...newRow, _type: 'step' as const }],
  milestones,
  teams: [],
  systems: [],
  gaps: [closingGap],
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

const createdGapsFor = (stepId: string) =>
  mockDbCreateGap.mock.calls.filter(([data]) => data.stepId === stepId)

describe('EditableRowTable — the save handler reads the gaps it is writing (#261)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gapRows = [
      { ...closingGap },
      chainGapOn(first.id, 'gap-on-first'),
      chainGapOn(next.id, 'gap-on-next'),
    ]

    mockDbCreateStep.mockResolvedValue(saved.id)
    mockDbUpdateStep.mockImplementation(async (id: string, patch: Partial<Step>) => {
      const step = persisted.find(s => s.id === id)
      return step ? { ...step, ...patch } : null
    })
    mockDbListSteps.mockResolvedValue(persisted)
    mockDbListGaps.mockImplementation(async () => gapRows.map(gap => ({ ...gap })))
    mockDbCreateGap.mockImplementation(async (data: Omit<Gap, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = `gap-new-${gapRows.length + 1}`
      gapRows.push({ ...data, id, createdAt: 0, updatedAt: 0 })
      return id
    })
    mockDbGetGap.mockImplementation(async (id: string) => {
      const gap = gapRows.find(g => g.id === id)
      return gap ? { ...gap } : null
    })
    mockDbUpdateGap.mockImplementation(async (id: string, patch: Partial<Gap>) => {
      const index = gapRows.findIndex(g => g.id === id)
      if (index < 0) return null
      gapRows[index] = { ...gapRows[index], ...patch }
      return { ...gapRows[index] }
    })

    useStepsStore.setState({
      steps: [newRow] as Step[],
      milestones,
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
    // The opening state is what the render-time prop was built from: only the
    // gap the row is closing. Everything else arrives through the reload.
    useGapsStore.setState({
      gaps: [closingGap],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
      loadGaps: vi.fn().mockImplementation(async () => {
        useGapsStore.setState({ gaps: gapRows.map(gap => ({ ...gap })) })
      }),
    })
  })

  /**
   * The neighbours both already carry a chain-break gap, and the handler's own
   * reload has put both in the store before it asks. Off the prop it asked a
   * list that predates the reload, got "no gap here" twice, and opened a second
   * chain-break gap on each neighbour.
   */
  it('does not re-raise a chain gap its own reload has already brought in', async () => {
    render(<EditableRowTable {...props} />)

    await act(async () => {
      fireEvent.click(screen.getByText('Save Step'))
    })

    await waitFor(() => expect(mockDbCreateGap).toHaveBeenCalled())

    expect(createdGapsFor(first.id)).toHaveLength(0)
    expect(createdGapsFor(next.id)).toHaveLength(0)
    // The step being saved is the only one the save has anything new to say
    // about, and it gets two gaps side by side: the H chain gap and the M
    // SIPOC gap.
    expect(mockDbCreateGap).toHaveBeenCalledTimes(2)
    expect(createdGapsFor(saved.id)).toHaveLength(2)
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  /**
   * The same handler raises a chain-break gap on the step it just created and
   * then, a few lines later, looks for an open gap on that step to carry the
   * incomplete-SIPOC message. That second lookup is kind-agnostic — it has to
   * exclude the chain-break gap the first half of the handler just raised, or
   * it adopts it: overwriting its observed/expected/missingField with SIPOC
   * text (losing the chain evidence) while keeping its H severity, and no
   * longer matching `includes('Chain break')`, so the next chain pass raises a
   * fresh chain gap beside it. The saved step should instead end up with two
   * gaps side by side: the H chain gap untouched, and a new M SIPOC gap.
   */
  it('raises a separate SIPOC gap instead of overwriting the chain gap it just created', async () => {
    render(<EditableRowTable {...props} />)

    await act(async () => {
      fireEvent.click(screen.getByText('Save Step'))
    })

    await waitFor(() => expect(mockDbCreateGap).toHaveBeenCalled())

    const gapsOnSaved = gapRows.filter(gap => gap.stepId === saved.id)
    expect(gapsOnSaved).toHaveLength(2)

    const chainGap = gapsOnSaved.find(gap => gap.observed?.includes('Chain break'))
    expect(chainGap).toMatchObject({ severity: 'H', observed: expect.stringContaining('Chain break') })

    const sipocGap = gapsOnSaved.find(gap => gap !== chainGap)
    expect(sipocGap).toMatchObject({
      severity: 'M',
      missingField: 'customer',
      observed: 'Missing customer, output',
      expected: 'All SIPOC fields should be complete',
    })

    // No update call may carry the SIPOC text — that would mean it landed on
    // top of the chain gap instead of alongside it.
    for (const call of mockDbUpdateGap.mock.calls) {
      const patch = call[1] as Partial<Gap>
      expect(patch.observed ?? '').not.toContain('Missing')
    }

    expect(mockToast.error).not.toHaveBeenCalled()
  })
})
