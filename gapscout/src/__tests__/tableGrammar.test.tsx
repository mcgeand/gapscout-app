/**
 * The column-count invariant and the selection contract for the shared table
 * grammar (#203).
 *
 * EditableRowTable renders four kinds of row against one 12-column header —
 * step, process gap, insert zone, new-row tray — and three of them carried a
 * hand-written colSpan. Two disagreed with the header: the insert zone said 11
 * and the gap row summed to 8. Asserting the two literals would only re-encode
 * them, so this counts the header and sums each row instead, which fails for
 * any row type added later with the wrong span.
 */

import { render, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap } from '../data/types'
import type { EditableStep } from '../components/Discovery/types'

const { mockDbCreateStep, mockDbListSteps, mockDbUpdateStep, mockDbUpdateGap, mockListGapsByStep, mockToast } =
  vi.hoisted(() => ({
    mockDbCreateStep: vi.fn(),
    mockDbListSteps: vi.fn(),
    mockDbUpdateStep: vi.fn(),
    mockDbUpdateGap: vi.fn(),
    mockListGapsByStep: vi.fn(),
    mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  }))

vi.mock('../services/db', () => ({
  createStep: mockDbCreateStep,
  listSteps: mockDbListSteps,
  updateStep: mockDbUpdateStep,
  updateGap: mockDbUpdateGap,
  listGapsByStep: mockListGapsByStep,
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

import { EditableRowTable } from '../components/Discovery/EditableRowTable'
import GapsTable from '../components/Gaps/GapsTable'
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

const newStep: EditableStep = { ...step, id: 'step-2', order: 2, _isNew: true }

const processGap: Gap = {
  id: 'gap-1',
  projectId: 'project-1',
  stepId: undefined,
  observed: 'A step nobody documented',
  expected: 'The step is recorded',
  severity: 'M',
  status: 'Open',
  links: [],
  createdAt: 0,
  updatedAt: 0,
}

const gap: Gap = { ...processGap, id: 'gap-2', stepId: step.id, missingField: 'supplier' }

const baseProps = {
  projectId: 'project-1',
  milestones: [],
  teams: [],
  systems: [],
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

/** Cells a row occupies, honouring colSpan. */
function widthOf(row: HTMLTableRowElement): number {
  return Array.from(row.cells).reduce((total, cell) => total + (cell.colSpan || 1), 0)
}

describe('table grammar — column count invariant (#203)', () => {
  beforeEach(() => {
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
      gaps: [gap, processGap],
      currentProjectId: 'project-1',
      currentGap: null,
      isLoading: false,
    })
  })

  it('gives every EditableRowTable row type the header column count', () => {
    // A step, a process gap and a new row, so the render covers all four row
    // types at once: each data row is preceded by an insert zone, and the new
    // step drags in the Save/Cancel tray.
    const { container } = render(
      <EditableRowTable
        {...baseProps}
        steps={[step, newStep]}
        filteredSteps={[step, newStep]}
        gaps={[gap, processGap]}
        displayNumbers={null}
        mergedItems={[
          { ...step, _type: 'step' as const },
          { ...processGap, _type: 'gap' as const },
          { ...newStep, _type: 'step' as const },
        ]}
      />
    )

    const table = container.querySelector('table')
    expect(table).not.toBeNull()

    const headerCells = table!.tHead!.rows[0].cells.length
    expect(headerCells).toBe(12)

    const bodyRows = Array.from(table!.tBodies[0].rows)
    // step + gap + new step, each with an insert zone, plus the new-row tray.
    expect(bodyRows.length).toBe(7)
    for (const row of bodyRows) {
      expect(widthOf(row)).toBe(headerCells)
    }
  })

  it('spans the Gaps detail row across the whole header', () => {
    const { container } = render(
      <GapsTable
        gaps={[gap]}
        sort={{ column: 'id', direction: 'asc' }}
        onSortChange={vi.fn()}
        selectedIds={new Set([gap.id])}
        onToggleSelect={vi.fn()}
        onToggleSelectAll={vi.fn()}
        expandedGapId={gap.id}
        onToggleExpand={vi.fn()}
        onEditGap={vi.fn()}
        getStepLabel={() => 'Review request'}
        getMilestoneName={() => 'Main Flow'}
        getTeamName={() => 'Ops'}
      />
    )

    const table = container.querySelector('table')!
    const headerCells = table.tHead!.rows[0].cells.length
    for (const row of Array.from(table.tBodies[0].rows)) {
      expect(widthOf(row)).toBe(headerCells)
    }
  })
})

// aria-selected is the CSS hook the .tbl grammar keys on, and it replaces a
// bg-blue-50 class that carried the whole selection signal. It is not yet an
// announced accessibility state: the row role only supports aria-selected inside
// a grid or treegrid, and these are plain tables. Giving them role="grid" needs
// keyboard grid semantics too, so it is tracked separately.
describe('table grammar — selection is an attribute, not a class (#203)', () => {
  beforeEach(() => {
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

  it('marks a selected gap row with aria-selected', () => {
    const { rerender, getByTestId } = render(
      <GapsTable
        gaps={[gap]}
        sort={{ column: 'id', direction: 'asc' }}
        onSortChange={vi.fn()}
        selectedIds={new Set<string>()}
        onToggleSelect={vi.fn()}
        onToggleSelectAll={vi.fn()}
        expandedGapId={null}
        onToggleExpand={vi.fn()}
        onEditGap={vi.fn()}
        getStepLabel={() => 'Review request'}
        getMilestoneName={() => 'Main Flow'}
        getTeamName={() => 'Ops'}
      />
    )
    expect(getByTestId(`gap-row-${gap.id}`)).toHaveAttribute('aria-selected', 'false')

    rerender(
      <GapsTable
        gaps={[gap]}
        sort={{ column: 'id', direction: 'asc' }}
        onSortChange={vi.fn()}
        selectedIds={new Set([gap.id])}
        onToggleSelect={vi.fn()}
        onToggleSelectAll={vi.fn()}
        expandedGapId={null}
        onToggleExpand={vi.fn()}
        onEditGap={vi.fn()}
        getStepLabel={() => 'Review request'}
        getMilestoneName={() => 'Main Flow'}
        getTeamName={() => 'Ops'}
      />
    )
    const row = getByTestId(`gap-row-${gap.id}`)
    expect(row).toHaveAttribute('aria-selected', 'true')
    // The old contract was a bg-blue-50 class and nothing else.
    expect(row.className).not.toContain('bg-blue-50')
  })

  it('marks a selected step row with aria-selected', () => {
    const { container } = render(
      <EditableRowTable
        {...baseProps}
        steps={[step]}
        filteredSteps={[step]}
        gaps={[gap]}
        selectedIds={new Set([step.id])}
        displayNumbers={null}
        mergedItems={[{ ...step, _type: 'step' as const }]}
      />
    )
    const selected = container.querySelectorAll('tr[aria-selected="true"]')
    expect(selected.length).toBe(1)
    expect(within(selected[0] as HTMLElement).getByRole('checkbox')).toBeChecked()
  })
})
