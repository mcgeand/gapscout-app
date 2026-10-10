/**
 * A gap-closing new row resolves itself within its own milestone (#332).
 *
 * `steps."order"` restarts at 1 in every milestone (#299), so looking the saved
 * step up by `order` alone found whichever same-numbered step the store happened
 * to return first — and then wrote the gap-closure note, and ran the chain
 * re-validation, against a step in a different milestone entirely. The sibling
 * lookup further down the same handler was already milestone-scoped.
 *
 * Mocks the db module at its boundary so the real Zustand stores still run.
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
  mockDbUpdateGap,
  mockDbCreateGap,
  mockToast,
} = vi.hoisted(() => ({
  mockDbCreateStep: vi.fn(),
  mockDbUpdateStep: vi.fn(),
  mockDbListSteps: vi.fn(),
  mockSetStepOrders: vi.fn(),
  mockSetGapOrders: vi.fn(),
  mockDbUpdateGap: vi.fn(),
  mockDbCreateGap: vi.fn(),
  mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('../services/db', () => ({
  createStep: mockDbCreateStep,
  listSteps: mockDbListSteps,
  updateStep: mockDbUpdateStep,
  updateGap: mockDbUpdateGap,
  createGap: mockDbCreateGap,
  // `addGap` reads the row back after creating it; without this the store
  // logged "Failed to create gap" inside four passing tests.
  getGap: vi.fn().mockResolvedValue(null),
  listGaps: vi.fn().mockResolvedValue([]),
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
  { id: 'm2', projectId: 'project-1', name: 'Approval', order: 1, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
]

const base = {
  projectId: 'project-1',
  teamId: 'team-1',
  suppliers: ['Requester'],
  inputs: ['Purchase request'],
  outputs: ['Approved order'],
  customers: ['Finance'],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
}

/**
 * The decoy: same `order` as the row being saved, different milestone, and it
 * sorts ahead in `listSteps`' `milestone_id ASC` ordering, so an unscoped
 * `find` on `order` lands here.
 */
const decoy: Step = { ...base, id: 'm1-decoy', label: 'Decoy in m1', milestoneId: 'm1', order: 2 }
const m1Filler: Step = { ...base, id: 'm1-filler', label: 'Filler in m1', milestoneId: 'm1', order: 1 }
const m2First: Step = { ...base, id: 'm2-first', label: 'First in m2', milestoneId: 'm2', order: 1 }

/** What the save creates: order 2 in m2, closing a process gap. */
const savedStep: Step = { ...base, id: 'm2-saved', label: 'Saved in m2', milestoneId: 'm2', order: 2 }

const newRow: EditableStep = {
  ...savedStep,
  id: 'temp-row',
  _isNew: true,
  _closingGapId: 'gap-closing',
}

const closingGap: Gap = {
  id: 'gap-closing',
  projectId: 'project-1',
  stepId: undefined,
  milestoneId: 'm2',
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

const persisted = [m1Filler, decoy, m2First, savedStep]

const props = {
  projectId: 'project-1',
  displayNumbers: null,
  steps: [newRow],
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

describe('EditableRowTable — a gap-closing row stays in its milestone (#332)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbCreateStep.mockResolvedValue(savedStep.id)
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockDbUpdateGap.mockResolvedValue({ ...closingGap, status: 'Closed' })
    mockDbCreateGap.mockImplementation(async (data) => ({
      ...data,
      id: `chain-${Math.random()}`,
      createdAt: 0,
      updatedAt: 0,
    }))
    // Mirrors listSteps' `ORDER BY milestone_id, "order"`, which is why the
    // decoy is reached before the real step.
    mockDbListSteps.mockResolvedValue(persisted)
    useStepsStore.setState({
      steps: [newRow] as Step[],
      milestones,
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
    useGapsStore.setState({
      gaps: [closingGap],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
      loadGaps: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('writes the gap-closure note onto the step it created, not a same-numbered one elsewhere', async () => {
    render(<EditableRowTable {...props} />)

    await act(async () => {
      fireEvent.click(screen.getByText('Save Step'))
    })

    await waitFor(() =>
      expect(mockDbUpdateStep).toHaveBeenCalledWith(
        savedStep.id,
        expect.objectContaining({ notes: expect.stringContaining('closing Process Gap') }),
        'project-1'
      )
    )
    const noted = mockDbUpdateStep.mock.calls
      .filter(([, patch]) => typeof patch.notes === 'string')
      .map(([id]) => id)
    expect(noted).not.toContain(decoy.id)
  })

  it('names the chain gaps it raises by their process position (#345)', async () => {
    // The All Steps view: the caller hands down a map, so the toast has to cite
    // the running position. It cannot reuse the map it was given — the step it
    // is naming was created after that map was built — so it rebuilds one from
    // the same live store read the steps come from.
    //
    // Positions over `persisted` plus the still-open closing gap: m1-filler 1,
    // m1-decoy 2, m2-first 3, and m2-saved 4 (sharing rank with the gap at the
    // same order). The chain break lands on the previous step, m2-first, whose
    // stored order is 1 — the number "Log request" would carry in the first
    // milestone, and the one this toast used to print.
    render(<EditableRowTable {...props} displayNumbers={new Map([['temp-row', 1]])} />)

    await act(async () => {
      fireEvent.click(screen.getByText('Save Step'))
    })

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled())

    const chainToast = mockToast.success.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes('chain gap'))

    expect(chainToast).toBe('Gap closed • 1 chain gap created (Step 3)')
  })

  /**
   * A row replacing a process gap in place keeps the gap's position and skips
   * the slot, because the gap is closed a moment later and the position is
   * already spoken for.
   */
  it('does not open a slot when the row really is replacing the gap in place', async () => {
    render(<EditableRowTable {...props} />)

    await act(async () => {
      fireEvent.click(screen.getByText('Save Step'))
    })

    await waitFor(() => expect(mockDbCreateStep).toHaveBeenCalled())
    // Nothing moved out of the way: m2's other row keeps order 1, and the only
    // order write is the reseal afterwards, which finds the milestone dense.
    expect(mockSetStepOrders).not.toHaveBeenCalled()
  })

  /**
   * Addendum A of #353. `handleCloseProcessGap` falls back to `milestones[0]`
   * for a gap that carries no milestone of its own, so the row can arrive
   * holding that gap's order against a milestone the gap was never in. Taking
   * the position for granted there writes the step straight onto whatever m1
   * already holds at that order, and the reseal freezes the tie as a parallel
   * branch nobody asked for.
   */
  it('opens a slot when the closing gap belongs to another milestone', async () => {
    const homelessGap: Gap = { ...closingGap, id: 'gap-homeless', milestoneId: undefined }
    // The row landed in m1 — `milestones[0]` — carrying the gap's order 2,
    // which is exactly where the decoy sits.
    const strandedRow: EditableStep = {
      ...newRow,
      milestoneId: 'm1',
      order: 2,
      _closingGapId: homelessGap.id,
    }
    useGapsStore.setState({ gaps: [homelessGap] })

    render(
      <EditableRowTable
        {...props}
        steps={[strandedRow]}
        filteredSteps={[strandedRow]}
        mergedItems={[{ ...strandedRow, _type: 'step' as const }]}
        gaps={[homelessGap]}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByText('Save Step'))
    })

    // The decoy is m1's order 2, so it moves up to make room rather than
    // sharing the position with the new step.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [{ id: decoy.id, order: 3 }])
    )
  })

  /**
   * The grid's Milestone cell is editable inline, so it moves a step between
   * milestones exactly as the Edit Step modal does — the grid twin of #335, and
   * a site neither #353's table nor its addendum names. Found by driving the
   * running app on 2026-09-04.
   *
   * `order` is scoped to its milestone (#299), so the number travelling with the
   * step belongs to the sequence it is leaving. Written verbatim it lands on
   * whatever the destination already holds at that order, and the reseal then
   * freezes the tie as a parallel branch nobody asked for.
   */
  it('opens a slot in the destination when the Milestone cell moves a step', async () => {
    const moving: Step = { ...base, id: 'm2-mover', label: 'Mover', milestoneId: 'm2', order: 2 }
    useStepsStore.setState({ steps: [m1Filler, decoy, moving], milestones })
    useGapsStore.setState({ gaps: [] })
    mockDbListSteps.mockResolvedValue([m1Filler, decoy, moving])

    render(
      <EditableRowTable
        {...props}
        steps={[m1Filler, decoy, moving]}
        filteredSteps={[moving]}
        mergedItems={[{ ...moving, _type: 'step' as const }]}
        gaps={[]}
      />
    )

    // Open the Milestone cell and pick m1, whose order 2 the decoy already holds.
    fireEvent.click(screen.getByText('Approval'))
    const select = document.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'm1' } })
    fireEvent.blur(select)

    // The decoy moves 2 -> 3 to make room, rather than sharing the position.
    await waitFor(() =>
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [{ id: decoy.id, order: 3 }])
    )
    expect(mockDbUpdateStep).toHaveBeenCalledWith(
      moving.id,
      expect.objectContaining({ milestoneId: 'm1' }),
      'project-1'
    )
  })
})
