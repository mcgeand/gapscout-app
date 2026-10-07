import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { Comment, Step } from '../data/types'

const { updateStep, getStep } = vi.hoisted(() => ({
  updateStep: vi.fn(),
  getStep: vi.fn(),
}))

vi.mock('../services/db', () => ({
  updateStep,
  getStep,
  listSteps: vi.fn().mockResolvedValue([]),
  listMilestones: vi.fn().mockResolvedValue([]),
}))

// The gaps half of the drawer is not under test here, and mounting the real
// form would drag the whole gap store in with it.
vi.mock('../components/Gaps', () => ({
  GapForm: () => null,
  GapFilters: () => null,
  GapsPanel: () => null,
}))

import RightPanel from '../app/layout/RightPanel'
import { useStepsStore } from '../state/stepsStore'
import { useGapsStore } from '../state/gapsStore'

const baseStep: Step = {
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
  createdAt: 1,
  updatedAt: 1,
}

const withComments = (comments: Comment[]): Step => ({ ...baseStep, comments })

/** The patch `updateStep` was last called with. */
const lastWrittenComments = (): Comment[] =>
  updateStep.mock.calls.at(-1)![1].comments as Comment[]

/**
 * The stored row, so the mocked service behaves like the database rather than
 * echoing local state: `stepsStore.updateStep` re-reads the step to refresh
 * `currentStep`, and the thread on screen is whatever that read returns. A mock
 * that replayed the old value would let a write that never landed still look
 * like it had.
 */
let storedStep: Step = baseStep

function mount(step: Step) {
  storedStep = step
  useStepsStore.setState({
    steps: [step],
    currentStep: step,
    milestones: [],
    currentProjectId: 'project-1',
    isLoading: false,
  })
  useGapsStore.setState({ gaps: [], currentProjectId: 'project-1', isLoading: false })
  return render(<RightPanel />)
}

beforeEach(() => {
  vi.clearAllMocks()
  storedStep = baseStep
  updateStep.mockImplementation(async (_id: string, patch: Partial<Step>) => {
    storedStep = { ...storedStep, ...patch }
  })
  getStep.mockImplementation(async () => storedStep)
})

describe('CommentsSection in RightPanel', () => {
  it('adds a comment and persists the whole thread', async () => {
    mount(baseStep)

    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Approver is unnamed here' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add Comment' }))

    await waitFor(() => expect(updateStep).toHaveBeenCalledTimes(1))
    expect(updateStep.mock.calls[0][0]).toBe('step-1')
    expect(updateStep.mock.calls[0][2]).toBe('project-1')
    expect(lastWrittenComments()).toHaveLength(1)
    expect(lastWrittenComments()[0].text).toBe('Approver is unnamed here')

    // The composer only clears once the write has committed, and the comment
    // renders from the re-read row rather than from the draft.
    await waitFor(() =>
      expect(screen.getByLabelText('Add a comment')).toHaveValue('')
    )
    expect(screen.getByText('Approver is unnamed here')).toBeInTheDocument()
    expect(screen.getByText('0 gaps · 1 comment')).toBeInTheDocument()
  })

  it('submits on Enter and leaves Shift+Enter to insert a newline', async () => {
    mount(baseStep)
    const box = screen.getByLabelText('Add a comment')

    fireEvent.change(box, { target: { value: 'Typed then shift-entered' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(updateStep).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(updateStep).toHaveBeenCalledTimes(1))
    expect(lastWrittenComments()[0].text).toBe('Typed then shift-entered')
  })

  it('refuses an empty comment', () => {
    mount(baseStep)

    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Add Comment' })).toBeDisabled()

    fireEvent.keyDown(screen.getByLabelText('Add a comment'), { key: 'Enter' })
    expect(updateStep).not.toHaveBeenCalled()
  })

  it('displays comments newest first', () => {
    mount(
      withComments([
        { id: 'c1', text: 'Oldest note', createdAt: 1000 },
        { id: 'c2', text: 'Newest note', createdAt: 3000 },
        { id: 'c3', text: 'Middle note', createdAt: 2000 },
      ])
    )

    const rendered = screen
      .getAllByRole('article')
      .map(el => el.querySelector('p')?.textContent)
    expect(rendered).toEqual(['Newest note', 'Middle note', 'Oldest note'])
  })

  it('edits a comment in place without disturbing the others', async () => {
    mount(
      withComments([
        { id: 'c1', text: 'Oldest note', createdAt: 1000 },
        { id: 'c2', text: 'Newest note', createdAt: 3000 },
      ])
    )

    fireEvent.click(screen.getAllByRole('button', { name: /^Edit comment:/ })[0])
    const editor = screen.getByLabelText('Edit comment')
    expect(editor).toHaveValue('Newest note')

    fireEvent.change(editor, { target: { value: 'Rewritten note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateStep).toHaveBeenCalledTimes(1))
    expect(lastWrittenComments()).toEqual([
      { id: 'c1', text: 'Oldest note', createdAt: 1000 },
      { id: 'c2', text: 'Rewritten note', createdAt: 3000 },
    ])

    await waitFor(() => expect(screen.getByText('Rewritten note')).toBeInTheDocument())
    expect(screen.queryByLabelText('Edit comment')).not.toBeInTheDocument()
    expect(screen.getByText('Oldest note')).toBeInTheDocument()
  })

  it('submits an edit on Enter, like the composer', async () => {
    mount(withComments([{ id: 'c1', text: 'Oldest note', createdAt: 1000 }]))

    fireEvent.click(screen.getByRole('button', { name: /^Edit comment:/ }))
    const editor = screen.getByLabelText('Edit comment')

    fireEvent.change(editor, { target: { value: 'Rewritten by keyboard' } })
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    expect(updateStep).not.toHaveBeenCalled()

    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(updateStep).toHaveBeenCalledTimes(1))
    expect(lastWrittenComments()[0].text).toBe('Rewritten by keyboard')
  })

  it('names each row action after its own comment, so they are distinguishable', () => {
    mount(
      withComments([
        { id: 'c1', text: 'Oldest note', createdAt: 1000 },
        { id: 'c2', text: 'Newest note', createdAt: 3000 },
      ])
    )

    expect(
      screen.getByRole('button', { name: 'Edit comment: Newest note' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete comment: Oldest note' })
    ).toBeInTheDocument()
  })

  it('leaves the thread alone when an edit is cancelled', () => {
    mount(withComments([{ id: 'c1', text: 'Oldest note', createdAt: 1000 }]))

    fireEvent.click(screen.getByRole('button', { name: /^Edit comment:/ }))
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'Discarded' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(updateStep).not.toHaveBeenCalled()
    expect(screen.getByText('Oldest note')).toBeInTheDocument()
  })

  it('deletes a comment only after the confirmation is accepted', async () => {
    mount(
      withComments([
        { id: 'c1', text: 'Oldest note', createdAt: 1000 },
        { id: 'c2', text: 'Newest note', createdAt: 3000 },
      ])
    )

    fireEvent.click(screen.getAllByRole('button', { name: /^Delete comment:/ })[0])
    expect(updateStep).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Comment' }))

    await waitFor(() => expect(updateStep).toHaveBeenCalledTimes(1))
    expect(lastWrittenComments()).toEqual([
      { id: 'c1', text: 'Oldest note', createdAt: 1000 },
    ])

    await waitFor(() => expect(screen.queryByText('Newest note')).not.toBeInTheDocument())
    expect(screen.getByText('Oldest note')).toBeInTheDocument()
  })

  it('refuses a second write while the first is still in flight', async () => {
    let release: () => void = () => {}
    const inFlight = new Promise<void>(resolve => {
      release = resolve
    })
    updateStep.mockImplementation(async (_id: string, patch: Partial<Step>) => {
      await inFlight
      storedStep = { ...storedStep, ...patch }
    })

    mount(baseStep)
    const box = screen.getByLabelText('Add a comment')

    fireEvent.change(box, { target: { value: 'First' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    // The composer stays focusable while the write runs — disabling it would
    // blur the element the user just typed into.
    expect(box).toBeEnabled()
    fireEvent.change(box, { target: { value: 'Second' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(updateStep).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Add Comment' })).toBeDisabled()

    release()
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument())
    expect(updateStep).toHaveBeenCalledTimes(1)
    expect(lastWrittenComments().map(c => c.text)).toEqual(['First'])
    // What the user typed while the write was in flight is still there.
    expect(screen.getByLabelText('Add a comment')).toHaveValue('Second')
    expect(screen.getByRole('button', { name: 'Add Comment' })).toBeEnabled()
  })

  it('keeps the draft when the write fails, so the text is not lost', async () => {
    updateStep.mockRejectedValue(new Error('disk full'))

    mount(baseStep)

    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Survives' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Comment' }))

    await waitFor(() => expect(updateStep).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Comment' })).toBeEnabled()
    )
    expect(screen.getByLabelText('Add a comment')).toHaveValue('Survives')
  })

  it('counts comments beside gaps in the drawer header', () => {
    mount(
      withComments([
        { id: 'c1', text: 'One', createdAt: 1000 },
        { id: 'c2', text: 'Two', createdAt: 2000 },
      ])
    )

    expect(screen.getByText('0 gaps · 2 comments')).toBeInTheDocument()
  })

  it('renders an author when the comment carries one', () => {
    mount(withComments([{ id: 'c1', text: 'One', createdAt: 1000, author: 'Danny' }]))
    expect(screen.getByText(/^Danny · /)).toBeInTheDocument()
  })

  it('falls back to "You" when no author is stored', () => {
    mount(withComments([{ id: 'c1', text: 'One', createdAt: 1000 }]))
    expect(screen.getByText(/^You · /)).toBeInTheDocument()
  })

  it('treats a blank stored author as no author', () => {
    mount(withComments([{ id: 'c1', text: 'One', createdAt: 1000, author: '   ' }]))
    expect(screen.getByText(/^You · /)).toBeInTheDocument()
  })

  it('writes no author, so #125 can fill one in without rewriting old rows', async () => {
    mount(baseStep)

    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'Mine' } })
    fireEvent.keyDown(screen.getByLabelText('Add a comment'), { key: 'Enter' })

    await waitFor(() => expect(updateStep).toHaveBeenCalledTimes(1))
    expect(lastWrittenComments()[0]).not.toHaveProperty('author')
    await waitFor(() => expect(screen.getByText(/^You · /)).toBeInTheDocument())
  })
})
