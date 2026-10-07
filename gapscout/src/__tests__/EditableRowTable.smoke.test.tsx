import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'

const {
  mockDbCreateStep,
  mockDbListSteps,
  mockDbUpdateStep,
  mockDbUpdateGap,
  mockListGapsByStep,
  mockSetStepOrders,
  mockDbListGaps,
  mockToast,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => {
  const mockToastError = vi.fn()
  const mockToastSuccess = vi.fn()
  return {
    mockDbCreateStep: vi.fn(),
    mockDbListSteps: vi.fn(),
    mockDbUpdateStep: vi.fn(),
    mockDbUpdateGap: vi.fn(),
    mockListGapsByStep: vi.fn(),
    mockSetStepOrders: vi.fn(),
    mockDbListGaps: vi.fn(),
    mockToast: Object.assign(vi.fn(), {
      error: mockToastError,
      success: mockToastSuccess,
    }),
    mockToastError,
    mockToastSuccess,
  }
})

vi.mock('../services/db', () => ({
  createStep: mockDbCreateStep,
  listSteps: mockDbListSteps,
  updateStep: mockDbUpdateStep,
  updateGap: mockDbUpdateGap,
  listGaps: mockDbListGaps,
  listGapsByStep: mockListGapsByStep,
  setStepOrders: mockSetStepOrders,
  setGapOrders: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

import { wireSequenceDb } from './helpers/sequenceDb'
import { EditableRowTable } from '../components/Discovery/EditableRowTable'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'

const step: EditableStep = {
  id: 'step-1',
  projectId: 'project-1',
  label: 'Review request',
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
}

const gap: Gap = {
  id: 'gap-1',
  projectId: 'project-1',
  stepId: step.id,
  observed: 'Supplier is missing',
  expected: 'A supplier is recorded',
  severity: 'M',
  status: 'Open',
  missingField: 'supplier',
  links: [],
  createdAt: 0,
  updatedAt: 0,
}

const noopProps = {
  projectId: 'project-1',
  displayNumbers: null,
  steps: [step],
  filteredSteps: [step],
  mergedItems: [{ ...step, _type: 'step' as const }],
  milestones: [],
  teams: [],
  systems: [],
  gaps: [gap],
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
}


/**
 * Mirrors DiscoveryGrid's store-to-props sync, which is what feeds the table a
 * post-write list. EditableRowTable takes its steps as props, so a bare render
 * would show the pre-edit list forever and prove nothing about a reorder.
 */
function Harness() {
  const storeSteps = useStepsStore((s) => s.steps) as EditableStep[]
  const storeGaps = useGapsStore((s) => s.gaps)
  const sorted = [...storeSteps].sort((x, y) => x.order - y.order)
  return (
    <EditableRowTable
      {...noopProps}
      steps={sorted}
      filteredSteps={sorted}
      mergedItems={sorted.map((s) => ({ ...s, _type: 'step' as const }))}
      gaps={storeGaps}
    />
  )
}

/**
 * Saving a new row and moving an existing one both go through `lib/sequence`,
 * which reads the milestone's live rows from the database (#353). Every suite
 * therefore needs these two to resolve; suites asserting on a move seed them
 * with `wireSequenceDb` instead.
 */
beforeEach(() => {
  mockDbListSteps.mockResolvedValue([])
  mockDbListGaps.mockResolvedValue([])
  mockSetStepOrders.mockResolvedValue(undefined)
})

describe('EditableRowTable — smoke', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mockDbListSteps.mockResolvedValue([])
    useStepsStore.setState({
      steps: [step],
      milestones: [],
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
    useGapsStore.setState({
      gaps: [gap],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
    })
  })
  it('renders nothing when steps array is empty', () => {
    const { container } = render(
      <EditableRowTable
        projectId="project-1"
        steps={[]}
        filteredSteps={[]}
        mergedItems={[]}
        displayNumbers={null}
        milestones={[]}
        teams={[]}
        systems={[]}
        gaps={[]}
        selectedIds={new Set()}
        setSelectedIds={vi.fn()}
        onUpdateNewRowLocally={vi.fn()}
        onRemoveNewRow={vi.fn()}
        draggedStepId={null}
        dragOverIndex={null}
        hoveredInsertIndex={null}
        setHoveredInsertIndex={vi.fn()}
        onDragStart={vi.fn()}
        onDragOver={vi.fn()}
        onDragEnd={vi.fn()}
        onDrop={vi.fn().mockResolvedValue(undefined)}
        onCreateProcessGap={vi.fn().mockResolvedValue(undefined)}
        onCloseProcessGap={vi.fn().mockResolvedValue(undefined)}
        onEditProcessGap={vi.fn()}
        onRequestDeleteGap={vi.fn()}
        onInsertRow={vi.fn()}
        onRequestCancelNewRow={vi.fn()}
        onRequestCancelWithConfirm={vi.fn()}
        onShowValidationWarning={vi.fn()}
      />
    )
    expect(container).toBeInTheDocument()
  })

  it('does not report success or update gaps when the step save fails', async () => {
    vi.useFakeTimers()
    const dbError = new Error('database write failed')
    mockDbUpdateStep.mockRejectedValueOnce(dbError)
    mockDbUpdateGap.mockResolvedValue(undefined)

    try {
      render(<EditableRowTable {...noopProps} />)

      fireEvent.click(screen.getByText(step.label))
      const input = screen.getByPlaceholderText('Enter process step...')
      fireEvent.change(input, { target: { value: 'Updated request' } })
      fireEvent.blur(input)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(mockDbUpdateStep).toHaveBeenCalledWith(
        step.id,
        { label: 'Updated request' },
        'project-1'
      )
      expect(mockDbUpdateGap).not.toHaveBeenCalled()
      expect(mockToastSuccess).not.toHaveBeenCalled()
      expect(screen.getByTestId('step-save-status')).toHaveTextContent('Failed')
      expect(screen.getByTestId('step-save-status')).not.toHaveTextContent('Saved')
      expect(mockToastError).toHaveBeenCalledTimes(1)
      expect(mockToastError).toHaveBeenCalledWith('Failed to update step')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('EditableRowTable — new-row Save Step (#171)', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mockDbCreateStep.mockResolvedValue(undefined)
    mockDbListSteps.mockResolvedValue([])
    useStepsStore.setState({
      steps: [],
      milestones: [],
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
    useGapsStore.setState({
      gaps: [],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
    })
  })

  // Mirrors DiscoveryGrid's new-row state ownership (handleUpdateNewRowLocally /
  // handleRemoveNewRow) so a commit actually reaches the row the tray reads.
  function NewRowHarness({ initialRow }: { initialRow: EditableStep }) {
    const [rows, setRows] = useState<EditableStep[]>([initialRow])
    return (
      <EditableRowTable
        {...noopProps}
        steps={rows}
        filteredSteps={rows}
        mergedItems={rows.map((r) => ({ ...r, _type: 'step' as const }))}
        gaps={[]}
        onUpdateNewRowLocally={(stepId, updates) =>
          setRows((prev) => prev.map((r) => (r.id === stepId ? { ...r, ...updates } : r)))
        }
        onRemoveNewRow={(stepId) => setRows((prev) => prev.filter((r) => r.id !== stepId))}
      />
    )
  }

  // Column order: checkbox, validation, #, Milestone, Supplier, Inputs,
  // Process, Output, Customer, Trigger, Notes, SIPOC.
  const openOutputsEditor = () => {
    const row = screen.getByText('Repro Step').closest('tr') as HTMLElement
    fireEvent.click(within(within(row).getAllByRole('cell')[7]).getByText('—'))
    return screen.getByPlaceholderText('Report, Result...')
  }

  const newRow: EditableStep = {
    ...step,
    id: 'new-step',
    label: '',
    _isNew: true,
  }

  // fireEvent.click does not move focus — the same reason the real bug bites in
  // Tauri's WKWebView, where clicking a <button> leaves the input focused and
  // its onBlur commit never fires.
  it('saves the value still open in a cell editor', async () => {
    render(<NewRowHarness initialRow={{ ...newRow, label: 'Repro Step' }} />)

    const outputs = openOutputsEditor()
    fireEvent.change(outputs, { target: { value: 'TEST OUTPUT' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Step' }))
    })

    expect(mockDbCreateStep).toHaveBeenCalledTimes(1)
    expect(mockDbCreateStep).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Repro Step', outputs: ['TEST OUTPUT'] })
    )
  })

  it('enables Save Step from an uncommitted editor value alone', async () => {
    render(<NewRowHarness initialRow={newRow} />)

    expect(screen.getByRole('button', { name: 'Save Step' })).toBeDisabled()

    fireEvent.click(screen.getByText('(empty)'))
    fireEvent.change(screen.getByPlaceholderText('Enter process step...'), {
      target: { value: 'Typed but not committed' },
    })

    const saveButton = screen.getByRole('button', { name: 'Save Step' })
    expect(saveButton).toBeEnabled()

    await act(async () => {
      fireEvent.click(saveButton)
    })

    expect(mockDbCreateStep).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Typed but not committed' })
    )
  })

  it('saves a value committed by blur immediately before the click', async () => {
    render(<NewRowHarness initialRow={{ ...newRow, label: 'Repro Step' }} />)

    const outputs = openOutputsEditor()
    fireEvent.change(outputs, { target: { value: 'BLURRED OUTPUT' } })

    // No timer advance: a debounced commit would still be pending here, and the
    // row unmounts on save, which cancels it.
    await act(async () => {
      fireEvent.blur(outputs)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Step' }))
    })

    expect(mockDbCreateStep).toHaveBeenCalledWith(
      expect.objectContaining({ outputs: ['BLURRED OUTPUT'] })
    )
  })

  it('validates against the pending order rather than the row\'s stale copy', async () => {
    render(
      <NewRowHarness
        initialRow={{
          ...newRow,
          label: 'Repro Step',
          order: 5,
          suppliers: ['Requestor'],
          inputs: ['Request'],
          outputs: ['Report'],
          customers: ['Procurement'],
        }}
      />
    )

    fireEvent.click(screen.getByTitle('Click to edit order number'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Step' }))
    })

    const saved = mockDbCreateStep.mock.calls[0][0]
    expect(saved.order).toBe(4)
    // Validation ran against the pending order, so the row read as complete and
    // no incomplete-SIPOC gap was raised.
    expect(mockToastSuccess).toHaveBeenCalledWith('Step saved at position 4')
  })

  it('refuses to save while an open editor holds an invalid order', async () => {
    render(<NewRowHarness initialRow={{ ...newRow, label: 'Repro Step' }} />)

    fireEvent.click(screen.getByTitle('Click to edit order number'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Step' }))
    })

    expect(mockDbCreateStep).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('Order must be a positive number')
  })
})

describe('EditableRowTable — gap auto-sync after auto-status (#88)', () => {
  // Not first and not last in its milestone, so every SIPOC field is required
  // and the step stays invalid after one of them is filled — the branch that
  // rewrites a gap's missingField.
  const midStep: EditableStep = {
    ...step,
    id: 'step-mid',
    order: 2,
    suppliers: ['Requester'],
    inputs: [],
    outputs: ['Approved order'],
    customers: [],
  }
  const lastStep: EditableStep = { ...step, id: 'step-last', order: 3 }

  const inputGap: Gap = { ...gap, id: 'gap-input', stepId: midStep.id, missingField: 'input' }

  const props = {
    ...noopProps,
    steps: [midStep, lastStep],
    filteredSteps: [midStep],
    mergedItems: [{ ...midStep, _type: 'step' as const }],
    gaps: [inputGap],
  }

  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mockDbListSteps.mockResolvedValue([])
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockListGapsByStep.mockResolvedValue([inputGap])
    mockDbUpdateGap.mockImplementation(async (gapId: string, data: Partial<Gap>) =>
      gapId === inputGap.id ? { ...inputGap, ...data } : null
    )
    useStepsStore.setState({
      steps: [midStep, lastStep],
      milestones: [],
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
    useGapsStore.setState({
      gaps: [inputGap],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
    })
  })

  /** Fill the Inputs cell on the mid step and let the save debounce run. */
  async function runPromotingEdit() {
    const { container } = render(<EditableRowTable {...props} />)

    // Column 5 is Inputs (drag/checkbox, validation, order, milestone, supplier,
    // inputs); the placeholder confirms the editor that opened is the right one.
    const stepRow = Array.from(container.querySelectorAll('tbody tr')).find(row =>
      row.textContent?.includes(midStep.label)
    )
    const inputsCell = stepRow!.querySelectorAll('td')[5] as HTMLElement
    fireEvent.click(within(inputsCell).getByText('—'))
    const editor = screen.getByPlaceholderText('Request, Data...')
    fireEvent.change(editor, { target: { value: 'Purchase request' } })
    fireEvent.blur(editor)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
  }

  it('does not rewrite a hand-authored gap the same edit moved to Review', async () => {
    // `inputGap` carries a typed `expected`, so its wording belongs to whoever
    // wrote it and the re-sync leaves it alone whatever its status. A gap this
    // machinery stamped IS refreshed after the promotion — that rule and its
    // opposite are covered in stepSaveGapSync.test.tsx (#279).
    vi.useFakeTimers()
    try {
      await runPromotingEdit()
    } finally {
      vi.useRealTimers()
    }

    expect(mockDbUpdateStep).toHaveBeenCalledWith(
      midStep.id,
      { inputs: ['Purchase request'] },
      'project-1'
    )
    // Exactly one gap write: the promotion, with no missingField rewrite behind it.
    expect(mockDbUpdateGap).toHaveBeenCalledTimes(1)
    expect(mockDbUpdateGap).toHaveBeenCalledWith(
      inputGap.id,
      { status: 'Review', closedAt: null },
      'project-1'
    )
    expect(useGapsStore.getState().gaps[0]).toMatchObject({
      status: 'Review',
      missingField: 'input',
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('1 gap moved to Review')
    expect(mockToastSuccess).not.toHaveBeenCalledWith(
      expect.stringContaining('auto-synced')
    )
  })
})

describe('EditableRowTable — inline order edit validation (#240)', () => {
  // Complete SIPOC at order 2, so the only thing that can make validation fail
  // is the chain check — and the only way that runs is if the step is not last.
  const orderStep: EditableStep = {
    ...step,
    id: 'step-order',
    order: 2,
    suppliers: ['Requester'],
    inputs: ['Purchase request'],
    outputs: ['Approved order'],
    customers: ['Finance'],
  }

  const openGap: Gap = { ...gap, id: 'gap-order', stepId: orderStep.id, missingField: 'customer' }

  const props = {
    ...noopProps,
    steps: [orderStep],
    filteredSteps: [orderStep],
    mergedItems: [{ ...orderStep, _type: 'step' as const }],
    gaps: [openGap],
  }

  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    // The order ceiling and the move are both computed from the milestone's
    // live rows now, so the database has to hold the step the store holds.
    wireSequenceDb(
      { listSteps: mockDbListSteps, listGaps: mockDbListGaps, setStepOrders: mockSetStepOrders },
      [orderStep],
      [openGap]
    )
    mockDbUpdateStep.mockResolvedValue(undefined)
    mockListGapsByStep.mockResolvedValue([openGap])
    mockDbUpdateGap.mockImplementation(async (gapId: string, data: Partial<Gap>) =>
      gapId === openGap.id ? { ...openGap, ...data } : null
    )
    useStepsStore.setState({
      steps: [orderStep],
      milestones: [],
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
    useGapsStore.setState({
      gaps: [openGap],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
    })
  })

  // Moving the step to order 1 makes it the only — therefore last — step in its
  // milestone, so chain validation should not run at all. Validated against the
  // unsubstituted list it does: the row's stale copy still sits at order 2 and
  // becomes the step's own "next step".
  it('does not validate a reordered step against its own stale copy', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<EditableRowTable {...props} />)

      fireEvent.click(screen.getByTitle('Click to edit order number'))
      const editor = container.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(editor, { target: { value: '1' } })
      fireEvent.blur(editor)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [{ id: orderStep.id, order: 1 }])
    // Order is not a SIPOC field, so nothing here should touch a gap: there is
    // no promotion to make and — once the step is validated against itself at
    // its new order — no chain break to record either.
    expect(mockDbUpdateGap).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalledWith(expect.stringContaining('auto-synced'))
    expect(useGapsStore.getState().gaps[0]).toMatchObject({
      status: 'Open',
      missingField: 'customer',
      observed: openGap.observed,
    })
  })
  it('commits an inline order edit through the reorder path, leaving no duplicate and no hole (#290)', async () => {
    vi.useFakeTimers()
    try {
      // Three steps in one milestone. Moving the last to order 1 must slide the
      // other two down, not park a second step on order 1.
      const a = { ...step, id: 'a', label: 'A', order: 1 }
      const b = { ...step, id: 'b', label: 'B', order: 2 }
      const c = { ...step, id: 'c', label: 'C', order: 3 }
      useStepsStore.setState({ steps: [a, b, c] })
      mockDbUpdateStep.mockResolvedValue(undefined)
      // The module reads the milestone's live rows before it writes and the
      // store reloads from them after, so the fixture has to be a mutable
      // stand-in rather than a fixed post-shift answer.
      wireSequenceDb(
        { listSteps: mockDbListSteps, listGaps: mockDbListGaps, setStepOrders: mockSetStepOrders },
        [a, b, c],
        []
      )

      render(<Harness />)

      fireEvent.click(screen.getByText('3'))
      const input = document.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '1' } })
      fireEvent.blur(input)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })

      // The moved step and the band it displaces go in one statement, computed
      // from the milestone's live rows: C to 1, A and B down one each. No raw
      // `updateStep` writing an order on its own.
      expect(mockSetStepOrders).toHaveBeenCalledWith('project-1', [
        { id: 'a', order: 2 },
        { id: 'b', order: 3 },
        { id: 'c', order: 1 },
      ])
      expect(mockDbUpdateStep).not.toHaveBeenCalled()

      const orders = useStepsStore.getState().steps
        .map((s) => [s.id, s.order])
        .sort((x, y) => (x[1] as number) - (y[1] as number))
      expect(orders).toEqual([['c', 1], ['a', 2], ['b', 3]])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an out-of-range order instead of rewriting it (#299)', async () => {
    vi.useFakeTimers()
    try {
      const a = { ...step, id: 'a', label: 'A', order: 1 }
      const b = { ...step, id: 'b', label: 'B', order: 2 }
      useStepsStore.setState({ steps: [a, b] })
      mockDbUpdateStep.mockResolvedValue(undefined)
      wireSequenceDb(
        { listSteps: mockDbListSteps, listGaps: mockDbListGaps, setStepOrders: mockSetStepOrders },
        [a, b],
        []
      )

      render(<Harness />)

      fireEvent.click(screen.getByText('1'))
      const input = document.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '99' } })
      fireEvent.blur(input)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })

      // 99 in a two-step milestone used to land at 2 — a number the user never
      // typed, written into the process sequence without saying so. Now nothing
      // is written and the range is named.
      expect(mockDbUpdateStep).not.toHaveBeenCalled()
      expect(mockSetStepOrders).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining('Order must be between 1 and 2')
      )
      expect(useStepsStore.getState().steps.find((s) => s.id === 'a')?.order).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts a process gap as a position the milestone holds (#299)', async () => {
    vi.useFakeTimers()
    try {
      // Steps and process gaps share one per-milestone sequence — the v5
      // migration ranks them together, so a milestone with two steps and a gap
      // legitimately runs 1..3 and a step can sit at 3. A ceiling counting
      // steps alone would refuse the order the grid is showing, which is the
      // #299 complaint from the other side.
      const a = { ...step, id: 'a', label: 'A', order: 1 }
      const b = { ...step, id: 'b', label: 'B', order: 3 }
      useStepsStore.setState({ steps: [a, b] })
      useGapsStore.setState({
        gaps: [{ ...gap, id: 'process-gap', stepId: undefined, order: 2, milestoneId: 'milestone-1', status: 'Open' }],
      })
      mockDbUpdateStep.mockResolvedValue(undefined)
      wireSequenceDb(
        { listSteps: mockDbListSteps, listGaps: mockDbListGaps, setStepOrders: mockSetStepOrders },
        [a, b],
        [{ ...gap, id: 'process-gap', stepId: undefined, order: 2, milestoneId: 'milestone-1', status: 'Open' }]
      )

      render(<Harness />)

      fireEvent.click(screen.getByText('3'))
      const input = document.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '3' } })
      fireEvent.blur(input)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })

      // 3 is within range, so it is not refused as out of bounds.
      expect(mockToastError).not.toHaveBeenCalledWith(
        expect.stringContaining('Order must be')
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the milestone when it holds a single step (#299 repro)', async () => {
    vi.useFakeTimers()
    try {
      // The reported case: one step in its milestone, so every typed order
      // clamped to 1. Typing 3 has to be refused, not silently rewritten.
      const only = { ...step, id: 'only', label: 'Pay Invoice', order: 1 }
      useStepsStore.setState({
        steps: [only],
        milestones: [
          { id: 'milestone-1', projectId: 'project-1', name: 'Payment', order: 3,
            relatedPolicies: [], createdAt: 0, updatedAt: 0 },
        ],
      })
      mockDbUpdateStep.mockResolvedValue(undefined)
      wireSequenceDb(
        { listSteps: mockDbListSteps, listGaps: mockDbListGaps, setStepOrders: mockSetStepOrders },
        [only],
        []
      )

      render(<Harness />)

      fireEvent.click(screen.getByText('1'))
      const input = document.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '3' } })
      fireEvent.blur(input)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })

      expect(mockDbUpdateStep).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith(
        'Order must be 1 — "Payment" has only one step'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("rewrites a SIBLING's open gap when an order edit changes its position (#291)", async () => {
    vi.useFakeTimers()
    try {
      // B is last, so its empty outputs/customers are not required and its gap
      // says only "Missing supplier". Moving A past it slides B to order 1: B is
      // now first (suppliers/inputs no longer required) and no longer last
      // (outputs/customers now are). Nothing about B was edited — only its
      // position — and its gap has to follow.
      const a = { ...step, id: 'a', label: 'A', order: 1, suppliers: ['S'], inputs: ['I'] }
      const b = {
        ...step, id: 'b', label: 'B', order: 2,
        suppliers: [], inputs: ['I'], outputs: [], customers: [],
      }
      const bGap: Gap = {
        ...gap, id: 'gap-b', stepId: 'b', observed: 'Missing supplier',
        expected: 'All SIPOC fields should be complete',
      }
      useStepsStore.setState({ steps: [a, b] })
      useGapsStore.setState({ gaps: [bGap] })
      mockDbUpdateStep.mockResolvedValue(undefined)
      mockDbUpdateGap.mockImplementation(async (_id: string, changes: Partial<Gap>) => ({
        ...bGap, ...changes,
      }))
      wireSequenceDb(
        { listSteps: mockDbListSteps, listGaps: mockDbListGaps, setStepOrders: mockSetStepOrders },
        [a, b],
        [bGap]
      )

      render(<Harness />)

      fireEvent.click(screen.getByText('1'))
      const input = document.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '2' } })
      fireEvent.blur(input)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })

      expect(mockDbUpdateGap).toHaveBeenCalledWith(
        'gap-b',
        expect.objectContaining({ observed: 'Missing output, customer' }),
        'project-1'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves an unchanged sibling gap alone rather than rewriting it (#291)', async () => {
    vi.useFakeTimers()
    try {
      // B keeps its position relative to the milestone's end, so its gap text
      // does not change and must not be written.
      const a = { ...step, id: 'a', label: 'A', order: 1, suppliers: ['S'], inputs: ['I'] }
      const b = { ...step, id: 'b', label: 'B', order: 2, suppliers: ['S'], inputs: ['I'] }
      const c = {
        ...step, id: 'c', label: 'C', order: 3,
        suppliers: [], inputs: ['I'], outputs: [], customers: [],
      }
      const cGap: Gap = {
        ...gap, id: 'gap-c', stepId: 'c', observed: 'Missing supplier',
        expected: 'All SIPOC fields should be complete',
      }
      useStepsStore.setState({ steps: [a, b, c] })
      useGapsStore.setState({ gaps: [cGap] })
      mockDbUpdateStep.mockResolvedValue(undefined)
      wireSequenceDb(
        { listSteps: mockDbListSteps, listGaps: mockDbListGaps, setStepOrders: mockSetStepOrders },
        [a, b, c],
        [cGap]
      )

      render(<Harness />)

      // Swap A and B. C stays last, so its gap text is unchanged.
      fireEvent.click(screen.getByText('1'))
      const input = document.querySelector('input[type="number"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '2' } })
      fireEvent.blur(input)
      await act(async () => { await vi.advanceTimersByTimeAsync(600) })

      expect(mockDbUpdateGap).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('EditableRowTable — a clearing edit flushed after the row unmounts (#257)', () => {
  // Order 1 and alone in its milestone, so supplier/input/output/customer are
  // all exempt and `label` is the one field whose clearing both trips the
  // "clearing SIPOC" check and fails validation.
  const props = {
    ...noopProps,
    gaps: [],
  }

  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mockDbListSteps.mockResolvedValue([])
    mockDbUpdateStep.mockResolvedValue(undefined)
    useStepsStore.setState({
      steps: [step],
      milestones: [],
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
    useGapsStore.setState({
      gaps: [],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
    })
  })

  const clearLabel = () => {
    fireEvent.click(screen.getByText(step.label))
    fireEvent.change(screen.getByPlaceholderText('Enter process step...'), {
      target: { value: '' },
    })
  }

  it('writes the edit instead of opening the validation-warning modal', async () => {
    vi.useFakeTimers()
    try {
      const view = render(<EditableRowTable {...props} />)

      clearLabel()

      // The milestone tab the user clicked no longer lists this row, so it
      // unmounts with the editor still open and still focused.
      await act(async () => {
        view.rerender(
          <EditableRowTable {...props} filteredSteps={[]} mergedItems={[]} />
        )
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockDbUpdateStep).toHaveBeenCalledWith(step.id, { label: '' }, 'project-1')
      expect(props.onShowValidationWarning).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still opens the modal for the same clearing edit while the row is on screen', async () => {
    vi.useFakeTimers()
    try {
      render(<EditableRowTable {...props} />)

      clearLabel()
      fireEvent.blur(screen.getByPlaceholderText('Enter process step...'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(props.onShowValidationWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          missingFields: ['process'],
          pendingUpdates: { label: '' },
        })
      )
      expect(mockDbUpdateStep).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * #303: the auto-fill buttons name the row they pull from. They named its stored
 * `order`, which restarts at 1 in every milestone (#299), while the `#` column
 * beside them shows a running process position — so a row displaying #5 offered
 * to "Fill from #1", a row that is not on screen.
 */
describe('EditableRowTable — auto-fill names the number the row above shows (#303)', () => {
  const milestones = [
    {
      id: 'milestone-1',
      projectId: 'project-1',
      name: 'Requisition',
      order: 0,
      relatedPolicies: [],
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'milestone-2',
      projectId: 'project-1',
      name: 'Fulfilment',
      order: 1,
      relatedPolicies: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ]

  const at = (id: string, milestoneId: string, order: number): EditableStep => ({
    ...step,
    id,
    label: id,
    milestoneId,
    order,
  })

  // Fulfilment's orders restart at 1, so its rows show 4 and 5 while storing 1
  // and 2. The last row's predecessor is the one that separates the two numbers.
  const rows = [
    at('raise', 'milestone-1', 1),
    at('approve', 'milestone-1', 2),
    at('release', 'milestone-1', 3),
    at('pack', 'milestone-2', 1),
    at('ship', 'milestone-2', 2),
  ]

  const displayNumbers = new Map(rows.map((row, index) => [row.id, index + 1]))

  const renderAllSteps = () =>
    render(
      <EditableRowTable
        {...noopProps}
        steps={rows}
        filteredSteps={rows}
        mergedItems={rows.map((s) => ({ ...s, _type: 'step' as const }))}
        displayNumbers={displayNumbers}
        milestones={milestones}
        gaps={[]}
      />
    )

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbListSteps.mockResolvedValue([])
    useStepsStore.setState({ steps: rows, milestones, currentProjectId: 'project-1' })
    useGapsStore.setState({ gaps: [], currentProjectId: 'project-1' })
  })

  it('labels each button with the running position of the row above it', () => {
    renderAllSteps()

    // Two buttons per row (Supplier and Inputs), four rows with a predecessor.
    const labels = screen
      .getAllByText(/↓ Fill from #/)
      .map((node) => node.textContent?.trim())

    expect(labels).toEqual([
      '↓ Fill from #1',
      '↓ Fill from #1',
      '↓ Fill from #2',
      '↓ Fill from #2',
      '↓ Fill from #3',
      '↓ Fill from #3',
      '↓ Fill from #4',
      '↓ Fill from #4',
    ])
  })

  it('puts the same number in the tooltip', () => {
    renderAllSteps()

    expect(screen.getByTitle("Auto-fill from previous step (row 4)'s Customer")).toBeInTheDocument()
    expect(screen.getByTitle("Auto-fill from previous step (row 4)'s Output")).toBeInTheDocument()

    // The stored order of that predecessor is 1, and no tooltip cites it for
    // this row — only the second row, whose predecessor really is position 1.
    expect(screen.getAllByTitle("Auto-fill from previous step (row 1)'s Customer")).toHaveLength(1)
  })

  it('keeps showing the stored order inside a milestone tab', () => {
    // A milestone tab passes no displayNumbers, because there the stored order
    // already is the position the column shows.
    const fulfilment = rows.slice(3)
    render(
      <EditableRowTable
        {...noopProps}
        steps={fulfilment}
        filteredSteps={fulfilment}
        mergedItems={fulfilment.map((s) => ({ ...s, _type: 'step' as const }))}
        displayNumbers={null}
        milestones={milestones}
        gaps={[]}
      />
    )

    expect(screen.getAllByText('↓ Fill from #1').length).toBe(2)
  })
})

/**
 * A StepRow's `index` reaches its neighbours in `allSteps` (= `filteredSteps`),
 * but the row loop runs over `mergedItems`, which interleaves process-gap rows.
 * Handing the merged index down made a row with a gap above it read the wrong
 * neighbour — with exactly one gap, itself.
 */
describe('EditableRowTable — a gap row does not skew the neighbour lookup', () => {
  const milestones = [
    {
      id: 'milestone-1',
      projectId: 'project-1',
      name: 'Requisition',
      order: 0,
      relatedPolicies: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ]

  // Distinct customers, so the write says which row auto-fill actually read.
  const first: EditableStep = {
    ...step,
    id: 'first',
    label: 'first',
    order: 1,
    customers: ['From The Step Above'],
  }
  const second: EditableStep = {
    ...step,
    id: 'second',
    label: 'second',
    order: 2,
    suppliers: [],
    customers: ['Its Own Customer'],
  }

  // The gap reserves order 2, so it sorts between the two steps and takes the
  // merged index the second step used to have.
  const processGap: Gap = {
    ...gap,
    id: 'process-gap',
    stepId: undefined,
    milestoneId: 'milestone-1',
    order: 2,
    observed: 'Nobody owns the handoff',
  }

  const rows = [first, second]

  it('names the step above, not the row itself', () => {
    render(
      <EditableRowTable
        {...noopProps}
        steps={rows}
        filteredSteps={rows}
        mergedItems={[
          { ...first, _type: 'step' as const },
          { ...processGap, _type: 'gap' as const },
          { ...second, _type: 'step' as const },
        ]}
        displayNumbers={null}
        milestones={milestones}
        gaps={[processGap]}
      />
    )

    // "second" sits at merged index 2, so the old lookup read filteredSteps[1] —
    // itself — and offered to fill a row from its own data at its own number.
    const labels = screen.getAllByText(/↓ Fill from #/).map((n) => n.textContent?.trim())
    expect(labels).toEqual(['↓ Fill from #1', '↓ Fill from #1'])
    expect(labels).not.toContain('↓ Fill from #2')
  })

  it('auto-fills from the step above, not from the row itself', async () => {
    mockDbUpdateStep.mockResolvedValue(undefined)

    render(
      <EditableRowTable
        {...noopProps}
        steps={rows}
        filteredSteps={rows}
        mergedItems={[
          { ...first, _type: 'step' as const },
          { ...processGap, _type: 'gap' as const },
          { ...second, _type: 'step' as const },
        ]}
        displayNumbers={null}
        milestones={milestones}
        gaps={[processGap]}
      />
    )

    // Only "second" has an empty Supplier cell, so only it offers the button.
    fireEvent.click(screen.getAllByText(/↓ Fill from #1/)[0])

    await waitFor(() => expect(mockDbUpdateStep).toHaveBeenCalled())
    const written = mockDbUpdateStep.mock.calls.at(-1)?.[1]
    expect(written).toMatchObject({ suppliers: ['From The Step Above'] })
    expect(written).not.toMatchObject({ suppliers: ['Its Own Customer'] })
  })
})
