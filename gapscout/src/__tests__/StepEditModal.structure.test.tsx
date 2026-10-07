/**
 * #218: the step editor is the same field grammar as GapForm (design 7b).
 *
 * Three sections rather than one scroll, the SIPOC lists as removable chips,
 * the systems as a chip group, and the decision branches as a repeater that was
 * held in state and drawn nowhere — the checkbox wrote `decision: true` and the
 * diagram then drew a diamond with no way to say what the branches were.
 *
 * What is worth a test here is what a restyle can quietly break: that a value
 * shown as a chip can still be removed, that a control still writes the field
 * it shows, that a half-filled branch row never reaches the database, and that
 * the title names the step by the number the reader can find — the fixture has
 * two milestones precisely so the stored `order` and the process position are
 * different numbers (#345).
 *
 * Mocks the db module at its boundary so the real Zustand stores still run,
 * following StepEditModal.team.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

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
import type { Milestone, Step, System, Team } from '../data/types'

const milestone = (id: string, name: string, order: number): Milestone => ({
  id,
  projectId: 'project-1',
  name,
  order,
  relatedPolicies: [],
  createdAt: 1,
  updatedAt: 1,
})

const step = (id: string, label: string, milestoneId: string, order: number): Step => ({
  id,
  projectId: 'project-1',
  label,
  teamId: 'team-ops',
  milestoneId,
  order,
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
})

const MILESTONES = [milestone('m-intake', 'Intake', 0), milestone('m-approve', 'Approval', 1)]

/**
 * Orders restart at 1 in the second milestone, so the step under test stores
 * `order: 1` and holds process position 3. A title reading "Edit step 1" is the
 * defect this fixture exists to catch.
 */
const logStep = step('s-log', 'Log request', 'm-intake', 1)
const triageStep = step('s-triage', 'Triage request', 'm-intake', 2)
const approveStep: Step = {
  ...step('s-approve', 'Approve the spend', 'm-approve', 1),
  suppliers: ['Procurement'],
  customers: ['Finance'],
}

const STEPS = [logStep, triageStep, approveStep]

/**
 * The same step, already a decision. Its branches are the ones a reopened
 * editor has to show: stored data, never typed into this render.
 */
const decisionStep: Step = {
  ...approveStep,
  decision: true,
  branches: [
    { when: 'Over €10k', toStepId: 's-log' },
    { when: 'Under €10k', toStepId: 's-triage' },
  ],
}

const teams: Team[] = [
  { id: 'team-ops', projectId: 'project-1', name: 'Operations', color: '#10B981', order: 0, tags: [], createdAt: 1 },
]

const systems: System[] = [
  { id: 'sys-sap', projectId: 'project-1', name: 'SAP', tags: [], createdAt: 1 },
  { id: 'sys-mail', projectId: 'project-1', name: 'Email', tags: [], createdAt: 1 },
]

const renderEditor = (
  target: Step = approveStep,
  onDelete?: () => Promise<boolean>,
  onClose: () => void = vi.fn()
) =>
  render(
    <StepEditModal
      projectId="project-1"
      step={target}
      isOpen
      onClose={onClose}
      onDelete={onDelete}
    />
  )

/** The confirmation's own "Delete step", not the footer button of that name. */
const confirmDelete = () =>
  fireEvent.click(
    within(screen.getByText('Delete this step?').closest('[role="dialog"]')!).getByRole('button', {
      name: 'Delete step',
    })
  )

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save step' }))

/** The patch the save sent, once it has been sent. */
const savedPatch = async () => {
  await waitFor(() => expect(mockUpdateStep).toHaveBeenCalled())
  return mockUpdateStep.mock.calls[0][1] as Record<string, unknown>
}

describe('StepEditModal — the step, details, decision (#218)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateStep.mockResolvedValue(undefined)
    wireSequenceDb(
      { listSteps: mockListSteps, listGaps: mockListGaps, setStepOrders: mockSetStepOrders, setGapOrders: mockSetGapOrders },
      STEPS,
      []
    )
    useTeamsStore.setState({ teams, currentProjectId: 'project-1', isLoading: false })
    useSystemsStore.setState({ systems })
    useGapsStore.setState({ gaps: [], currentProjectId: 'project-1', isLoading: false })
    useStepsStore.setState({
      steps: STEPS,
      milestones: MILESTONES,
      currentProjectId: 'project-1',
      updateStep: mockUpdateStep,
    })
  })

  it('draws the three sections and says what each is for', () => {
    renderEditor()

    expect(screen.getByRole('heading', { name: 'The step' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Decision' })).toBeInTheDocument()
    expect(screen.getByText('Required to save')).toBeInTheDocument()
    expect(screen.getByText("The fields the grid doesn't show")).toBeInTheDocument()

    // Membership, not order: the fields a save refuses to go without are in the
    // first section, and the two the grid has no column for are in the second.
    const first = screen.getByRole('heading', { name: 'The step' }).closest('section')!
    expect(within(first).getByLabelText('Step label')).toBeInTheDocument()
    expect(within(first).getByLabelText('Owner team')).toBeInTheDocument()
    expect(within(first).getByLabelText('Milestone')).toBeInTheDocument()

    const second = screen.getByRole('heading', { name: 'Details' }).closest('section')!
    expect(within(second).getByLabelText('Result')).toBeInTheDocument()
    expect(within(second).getByLabelText('KPI')).toBeInTheDocument()
  })

  it('titles itself with the step process position, not the stored order', () => {
    renderEditor()

    // Stored `order` is 1; the step is third in the process.
    expect(screen.getByRole('dialog', { name: 'Edit step 3' })).toBeInTheDocument()
    expect(screen.queryByText('Edit step 1')).not.toBeInTheDocument()
    // The same scale in both autofill actions: the previous step is Intake's
    // last, and each names the field it pulls from.
    expect(screen.getByRole('button', { name: /^Fill from step 2 —.*Customer$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Fill from step 2 —.*Output$/ })).toBeInTheDocument()
  })

  it('shows each SIPOC value as a chip that can be removed', async () => {
    renderEditor()

    expect(screen.getByText('Procurement')).toHaveClass('chip-face')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Procurement' }))
    expect(screen.queryByText('Procurement')).not.toBeInTheDocument()
    expect(screen.getAllByText('— none yet').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByPlaceholderText('Add input'), {
      target: { value: 'Purchase request' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add input' }))
    expect(screen.getByText('Purchase request')).toHaveClass('chip-face')

    save()
    expect(await savedPatch()).toMatchObject({
      suppliers: [],
      inputs: ['Purchase request'],
      customers: ['Finance'],
    })
  })

  it('sends the systems the chips show', async () => {
    renderEditor()

    fireEvent.click(screen.getByLabelText('SAP'))
    save()

    expect(await savedPatch()).toMatchObject({ systems: ['sys-sap'] })
  })

  it('hides the branches until the step is a decision, then saves the ones that are filled in', async () => {
    renderEditor()

    expect(screen.queryByText('Branches')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('This step is a decision'))
    expect(screen.getByText('Branches')).toBeInTheDocument()
    expect(screen.getByText('No branches yet — add one to split the flow.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add branch' }))
    fireEvent.change(screen.getByLabelText('Branch condition'), {
      target: { value: 'Over €10k' },
    })
    // The targets are named by process position too.
    expect(
      within(screen.getByLabelText('Branch target step')).getByRole('option', {
        name: 'Step 2 · Triage request',
      })
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Branch target step'), {
      target: { value: 's-log' },
    })

    save()
    expect(await savedPatch()).toMatchObject({
      decision: true,
      branches: [{ when: 'Over €10k', toStepId: 's-log' }],
    })
  })

  it('drops a branch row that names no condition or no target', async () => {
    renderEditor()

    fireEvent.click(screen.getByLabelText('This step is a decision'))
    fireEvent.click(screen.getByRole('button', { name: 'Add branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add branch' }))

    const conditions = screen.getAllByLabelText('Branch condition')
    const targets = screen.getAllByLabelText('Branch target step')
    fireEvent.change(conditions[0], { target: { value: 'Under €10k' } })
    fireEvent.change(targets[0], { target: { value: 's-triage' } })
    // The second row is opened and left half filled — an edge to nowhere.
    fireEvent.change(conditions[1], { target: { value: 'Anything else' } })

    save()
    // Written as a repeater row, not written to the database.
    expect(await savedPatch()).toMatchObject({
      branches: [{ when: 'Under €10k', toStepId: 's-triage' }],
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove branch' })[0])
    expect(screen.getAllByLabelText('Branch condition')).toHaveLength(1)
  })

  it('submits under a plain label, with no glyph anywhere in the editor', () => {
    renderEditor()

    const submit = screen.getByRole('button', { name: 'Save step' })
    expect(submit.textContent).toBe('Save step')
    expect(screen.queryByText('Save Changes')).not.toBeInTheDocument()

    // The `↓ Fill` the old editor drew, the legacy quadrant colours, and emoji.
    const dialog = screen.getByRole('dialog', { name: 'Edit step 3' })
    expect(dialog.textContent).not.toMatch(/[↓⚠🔒✕]/u)
    expect(dialog.innerHTML).not.toMatch(
      /(bg|text|border|hover:bg|hover:text)-(blue|green|purple|orange|gray)-/
    )
  })

  it('offers the delete action only when the caller can run it', () => {
    const { unmount } = renderEditor()
    expect(screen.queryByRole('button', { name: 'Delete step' })).not.toBeInTheDocument()
    unmount()

    const onDelete = vi.fn().mockResolvedValue(true)
    renderEditor(approveStep, onDelete)
    fireEvent.click(screen.getByRole('button', { name: 'Delete step' }))
    // One confirmation, and the canvas runs the deletion itself.
    expect(screen.getByText('Delete this step?')).toBeInTheDocument()
    confirmDelete()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('reopens a decision with its stored branches in the repeater', () => {
    renderEditor(decisionStep)

    expect(screen.getByLabelText('This step is a decision')).toBeChecked()

    const conditions = screen.getAllByLabelText('Branch condition') as HTMLInputElement[]
    expect(conditions.map(input => input.value)).toEqual(['Over €10k', 'Under €10k'])

    // Each row's target is selected, and named by its process position.
    const targets = screen.getAllByLabelText('Branch target step') as HTMLSelectElement[]
    expect(targets.map(select => select.value)).toEqual(['s-log', 's-triage'])
    expect(within(targets[0]).getByRole('option', { selected: true })).toHaveTextContent(
      'Step 1 · Log request'
    )
    expect(within(targets[1]).getByRole('option', { selected: true })).toHaveTextContent(
      'Step 2 · Triage request'
    )
  })

  it('drops a stored branch that points at this step or at one that is gone', async () => {
    // Neither is offered by the select, so neither can be typed here — they are
    // what a step that was edited and then had a target deleted still holds.
    renderEditor({
      ...decisionStep,
      branches: [
        { when: 'Send it back', toStepId: 's-log' },
        { when: 'Round in a circle', toStepId: 's-approve' },
        { when: 'To a deleted step', toStepId: 's-vanished' },
      ],
    })

    save()
    const patch = await savedPatch()
    expect(patch.branches).toEqual([{ when: 'Send it back', toStepId: 's-log' }])
  })

  it('clears the branches when the step stops being a decision', async () => {
    renderEditor(decisionStep)

    fireEvent.click(screen.getByLabelText('This step is a decision'))
    save()

    // An empty list, not `undefined`: `updateStep` skips the column on
    // `undefined` and the diagram would keep drawing the old edges.
    const patch = await savedPatch()
    expect(patch).toMatchObject({ decision: false })
    expect(patch.branches).toEqual([])
  })

  it('keeps the editor open when the delete fails', async () => {
    const onClose = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(false)
    renderEditor(approveStep, onDelete, onClose)

    fireEvent.click(screen.getByRole('button', { name: 'Delete step' }))
    confirmDelete()

    // Flush the await inside the confirm handler before reading onClose, or the
    // negative assertion passes on timing rather than on behaviour.
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
    await act(async () => {})

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Edit step 3' })).toBeInTheDocument()
  })

  it('closes the editor when the delete succeeds', async () => {
    const onClose = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(true)
    renderEditor(approveStep, onDelete, onClose)

    fireEvent.click(screen.getByRole('button', { name: 'Delete step' }))
    confirmDelete()

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
