/**
 * The paste dialog (#155).
 *
 * What the modal owes the user: fresh rows in the milestone they chose, in
 * order, with the connections between the copied steps still pointing at each
 * other. `db` is mocked at its module boundary so the real stores run, as in
 * `stepSaveGapSync.test.tsx`; `sequenceOps` is mocked too, so the `at` each
 * insert asks for is readable and the reseal does not have to be simulated.
 * `lib/sequence` is NOT mocked — the append path's `nextPosition` runs for real
 * against the mocked `db`, which is why `listGaps` below resolves.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Milestone, Step, Team } from '../data/types'
import type { StepClipboard } from '../state/diagramClipboard'

const {
  mockCreateStep,
  mockListSteps,
  mockOpenSlotForInsert,
  mockResealAfterMutation,
  mockToast,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => {
  const mockToastError = vi.fn()
  const mockToastSuccess = vi.fn()
  return {
    mockCreateStep: vi.fn(),
    mockListSteps: vi.fn(),
    mockOpenSlotForInsert: vi.fn(),
    mockResealAfterMutation: vi.fn(),
    mockToast: Object.assign(vi.fn(), { error: mockToastError, success: mockToastSuccess }),
    mockToastError,
    mockToastSuccess,
  }
})

vi.mock('../services/db', () => ({
  createStep: mockCreateStep,
  listSteps: mockListSteps,
  // Resolved rather than bare: the append path runs the real `nextPosition`,
  // which reads both lists and iterates the gaps.
  listGaps: vi.fn(async () => []),
  listGapsByStep: vi.fn(),
  getStep: vi.fn(),
  updateStep: vi.fn(),
  updateGap: vi.fn(),
  setStepOrders: vi.fn(),
  setGapOrders: vi.fn(),
}))

vi.mock('../state/sequenceOps', () => ({
  openSlotForInsert: mockOpenSlotForInsert,
  resealAfterMutation: mockResealAfterMutation,
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

import { PasteStepsModal } from '../components/Diagram/PasteStepsModal'
import { useDiagramClipboard } from '../state/diagramClipboard'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'
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

const secondMilestone: Milestone = { ...milestone, id: 'milestone-2', name: 'Approval', order: 1 }

const operations: Team = {
  id: 'team-1',
  projectId: 'project-1',
  name: 'Operations',
  color: '#000000',
  order: 0,
  tags: [],
  createdAt: 0,
}

const finance: Team = { ...operations, id: 'team-2', name: 'Finance', order: 1 }

/** One step already in the target milestone, so an append starts past it. */
const existingStep: Step = {
  id: 'step-existing',
  projectId: 'project-1',
  label: 'Receive request',
  teamId: 'team-1',
  milestoneId: milestone.id,
  order: 2,
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

/**
 * Two copied steps from another project's milestone, the second branching back
 * onto the first and out to a step that was not copied.
 */
const clipboard: StepClipboard = {
  kind: 'gapscout/steps',
  version: 1,
  sourceProjectId: 'project-source',
  steps: [
    {
      id: 'src-1',
      label: 'Draft request',
      teamId: 'team-1',
      milestoneId: 'milestone-elsewhere',
      suppliers: ['Requester'],
      inputs: [],
      outputs: [],
      customers: [],
      systems: [],
    },
    {
      id: 'src-2',
      label: 'Check budget',
      teamId: 'team-2',
      milestoneId: 'milestone-elsewhere',
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
      systems: [],
      decision: true,
      branches: [
        { when: 'Rejected', toStepId: 'src-1' },
        { when: 'Escalate', toStepId: 'src-never-copied' },
      ],
    },
  ],
}

const seedStores = (buffer: StepClipboard | null = clipboard) => {
  mockListSteps.mockResolvedValue([existingStep])
  useDiagramClipboard.setState({ clipboard: buffer })
  useStepsStore.setState({
    steps: [existingStep],
    milestones: [milestone, secondMilestone],
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
  useTeamsStore.setState({
    teams: [operations, finance],
    currentProjectId: 'project-1',
    isLoading: false,
  })
}

const renderModal = (props: Partial<React.ComponentProps<typeof PasteStepsModal>> = {}) => {
  const onClose = vi.fn()
  const { rerender } = render(
    <PasteStepsModal projectId="project-1" isOpen onClose={onClose} {...props} />
  )
  // `isOpen` is a constant here, so a modal that called `onClose` is still
  // mounted; a test about closing has to drive the prop the parent owns.
  const close = () =>
    rerender(<PasteStepsModal projectId="project-1" isOpen={false} onClose={onClose} {...props} />)
  return { onClose, close }
}

/** The `(data, id)` pairs `createStep` was called with, in call order. */
const writes = () => mockCreateStep.mock.calls.map(([data, id]) => ({ data, id }))

describe('PasteStepsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateStep.mockResolvedValue('written')
    mockResealAfterMutation.mockResolvedValue({ syncedCount: 0 })
    // The real one runs the caller's write inside its lock; that is the only
    // part of its contract this file depends on.
    mockOpenSlotForInsert.mockImplementation(
      async ({ write }: { write?: () => Promise<void> }) => {
        await write?.()
      }
    )
    seedStores()
  })

  it('says nothing is copied yet when the buffer is empty', () => {
    seedStores(null)
    renderModal()

    expect(
      screen.getByText('Nothing copied yet — right-click a step and choose Copy as JSON.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Paste/ })).not.toBeInTheDocument()
  })

  it('lists the copied steps as an ordered list, not as numbered strings', () => {
    renderModal()

    expect(screen.getByRole('heading', { name: 'Paste 2 steps' })).toBeInTheDocument()

    // An <ol> marker numbers the buffer; "Step 2 · ..." would read as a process
    // position, which the stored `order` of a copied step is not (#345).
    expect(screen.getByRole('list').tagName).toBe('OL')
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Draft request',
      'Check budget',
    ])
    expect(screen.queryByText(/^Step \d+ ·/)).not.toBeInTheDocument()
  })

  it('writes fresh rows into the chosen milestone, in order, with the branch remapped', async () => {
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    const [first, second] = writes()

    expect(first.id).toBeTruthy()
    expect(second.id).toBeTruthy()
    expect(first.id).not.toBe(second.id)
    expect([first.id, second.id]).not.toContain('src-1')
    expect([first.id, second.id]).not.toContain('src-2')

    // The clipboard's milestone belongs to another project, so the default
    // falls through to this project's first milestone; `existingStep` holds
    // order 2, so the append starts at 3.
    expect(first.data).toMatchObject({
      projectId: 'project-1',
      milestoneId: 'milestone-1',
      label: 'Draft request',
      order: 3,
    })
    expect(second.data).toMatchObject({
      projectId: 'project-1',
      milestoneId: 'milestone-1',
      label: 'Check budget',
      order: 4,
    })

    // Inside the copied set it survives, remapped; outside it is dropped.
    expect(second.data.branches).toEqual([{ when: 'Rejected', toStepId: first.id }])

    // The reseal reloads the steps itself, so the modal asserts the reseal
    // rather than a second `loadSteps` it no longer makes.
    await waitFor(() =>
      expect(mockResealAfterMutation).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'project-1', milestoneIds: ['milestone-1'] })
      )
    )
    expect(mockToastSuccess).toHaveBeenCalledWith('Pasted 2 steps')
  })

  it('drops every branch when the connections box is unticked', async () => {
    renderModal()

    fireEvent.click(screen.getByLabelText('Keep connections between the pasted steps'))
    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    expect(writes().map(write => write.data.branches)).toEqual([[], []])
  })

  it('applies one chosen owner team to every pasted step', async () => {
    renderModal()

    fireEvent.change(screen.getByLabelText('Owner team'), { target: { value: 'team-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    expect(writes().map(write => write.data.teamId)).toEqual(['team-2', 'team-2'])
  })

  it("offers to keep each step's own team when every copied team resolves here", () => {
    renderModal()

    expect(screen.getByRole('option', { name: "Keep each step's owner team" })).toBeInTheDocument()
  })

  it("omits the keep option when a copied step's team does not exist in this project", async () => {
    // `src-2` was copied under team-2, which this project does not have. Keeping
    // it would write a team_id no team here resolves — the dangling FK of #104.
    useTeamsStore.setState({ teams: [operations] })
    renderModal()

    expect(
      screen.queryByRole('option', { name: "Keep each step's owner team" })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))
    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))
    expect(writes().map(write => write.data.teamId)).toEqual(['team-1', 'team-1'])
  })

  it('pastes directly after the anchor when the milestone is still its own', async () => {
    renderModal({ anchorStep: existingStep })

    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    expect(mockOpenSlotForInsert).toHaveBeenCalledTimes(2)
    expect(mockOpenSlotForInsert.mock.calls.map(([args]) => args.at)).toEqual([3, 4])
    expect(writes().map(write => write.data.order)).toEqual([3, 4])
  })

  it('appends to the chosen milestone when it is not the anchor\'s', async () => {
    // Choosing another milestone takes the anchor out of play: `order` is scoped
    // to its milestone (#299), so "after the anchor" names a position in a
    // sequence these rows are not joining. The empty milestone appends from 1.
    renderModal({ anchorStep: existingStep })

    fireEvent.change(screen.getByLabelText('Milestone'), { target: { value: 'milestone-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    expect(writes().map(write => write.data.milestoneId)).toEqual(['milestone-2', 'milestone-2'])
    expect(writes().map(write => write.data.order)).toEqual([1, 2])
    // Under the lock on this path too. A slot opened past the end of the
    // milestone shifts nothing, so the append pays for the lock and no more —
    // and a bare write is what lands on an order a concurrent insert claimed.
    expect(mockOpenSlotForInsert).toHaveBeenCalledTimes(2)
    expect(mockOpenSlotForInsert.mock.calls.map(([args]) => args.at)).toEqual([1, 2])
    expect(mockOpenSlotForInsert.mock.calls.map(([args]) => args.milestoneId)).toEqual([
      'milestone-2',
      'milestone-2',
    ])
    expect(mockResealAfterMutation).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', milestoneIds: ['milestone-2'] })
    )
  })

  it('keeps the dialog open and says so when a write fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateStep.mockRejectedValueOnce(new Error('disk is full'))
    const { onClose } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Could not paste the steps')
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('reports how many landed when a write fails partway, and closes on it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The first row is written and committed; the second is not. Nothing can
    // take the first one back — the Tauri adapter has no transaction (#236).
    mockCreateStep.mockResolvedValueOnce('written').mockRejectedValueOnce(new Error('disk is full'))
    const { onClose, close } = renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Pasted 1 of 2 steps'))
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()

    // Resealed even on the failure: the surviving row left the milestone holed.
    expect(mockResealAfterMutation).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', milestoneIds: ['milestone-1'] })
    )

    // Closed, which is what stops a retry rewriting the row that landed. The
    // dialog is only gone once the parent honours it, so drive the prop.
    expect(onClose).toHaveBeenCalled()
    expect(mockCreateStep).toHaveBeenCalledTimes(2)
    close()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockCreateStep).toHaveBeenCalledTimes(2)

    consoleError.mockRestore()
  })

  it('suffixes a label that already exists here and still mints fresh ids', async () => {
    // A paste back into the project the steps came from: `existingStep` already
    // carries this label, so the copy has to be tellable from it, and the rows
    // must not reuse the source ids whatever the source project was.
    seedStores({
      ...clipboard,
      sourceProjectId: 'project-1',
      steps: [
        { ...clipboard.steps[0], id: existingStep.id, label: existingStep.label },
        clipboard.steps[1],
      ],
    })
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))

    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    const [first, second] = writes()
    expect(first.data.label).toBe('Receive request (copy)')
    expect(second.data.label).toBe('Check budget')

    expect(first.id).not.toBe(second.id)
    expect([first.id, second.id]).not.toContain(existingStep.id)
    expect([first.id, second.id]).not.toContain('src-2')
  })

  it('falls back to a real team when keep stops being on offer', async () => {
    renderModal()

    // Chosen while every copied team resolved here.
    fireEvent.change(screen.getByLabelText('Owner team'), { target: { value: 'keep' } })

    // The buffer then changes under the open dialog: the second step now
    // carries a team from another project, so keep is withdrawn.
    act(() => {
      useDiagramClipboard.setState({
        clipboard: {
          ...clipboard,
          steps: [clipboard.steps[0], { ...clipboard.steps[1], teamId: 'team-elsewhere' }],
        },
      })
    })

    expect(
      screen.queryByRole('option', { name: "Keep each step's owner team" })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Paste 2 steps' }))
    await waitFor(() => expect(mockCreateStep).toHaveBeenCalledTimes(2))

    // The default team, not the stale ids the withdrawn choice would have kept.
    expect(writes().map(write => write.data.teamId)).toEqual(['team-1', 'team-1'])
  })

  it('counts one step in the singular', async () => {
    seedStores({ ...clipboard, steps: [clipboard.steps[0]] })
    renderModal()

    expect(screen.getByRole('heading', { name: 'Paste 1 step' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Paste 1 step' }))

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Pasted 1 step'))
  })
})
