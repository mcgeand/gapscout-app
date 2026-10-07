/**
 * `MilestoneManager` renders, and its add path says what actually went wrong
 * (#131).
 *
 * This is the one path in the tree that can produce a
 * `MilestoneOrderConflictError`: the order it sends is `max(order) + 1` over a
 * React prop, so two tabs — or one tab a beat behind the database — ask for the
 * same number. The modal used to answer every failure with "Failed to create
 * milestone", which turned the one error carrying a written explanation into
 * the same blank line as a disk failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockCreateMilestone, mockToast } = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return { mockCreateMilestone: vi.fn(), mockToast: toast }
})

vi.mock('../services/db', () => ({
  createMilestone: mockCreateMilestone,
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

import { MilestoneManager } from '../components/Discovery/MilestoneManager'

const MILESTONE = {
  id: 'm-1',
  projectId: 'test-project',
  name: 'Main Flow',
  order: 0,
  description: undefined,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

/** Open the add dialog, name the milestone, and save. */
function createMilestoneNamed(name: string): void {
  fireEvent.click(screen.getByTitle('Add new milestone'))
  fireEvent.change(screen.getByPlaceholderText('e.g., Discovery, Planning, Execution'), {
    target: { value: name },
  })
  fireEvent.click(screen.getByText('Create Milestone'))
}

describe('MilestoneManager — smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateMilestone.mockResolvedValue('m-new')
  })

  it('renders without throwing on empty milestones', () => {
    const { container } = render(
      <MilestoneManager
        projectId="test-project"
        milestones={[]}
        activeMilestoneId={null}
        onSelectMilestone={vi.fn()}
        onMilestoneCreated={vi.fn()}
      />
    )
    expect(container).toBeInTheDocument()
  })

  it('renders without throwing with milestones present', () => {
    const { container } = render(
      <MilestoneManager
        projectId="test-project"
        milestones={[MILESTONE]}
        activeMilestoneId="m-1"
        onSelectMilestone={vi.fn()}
        onMilestoneCreated={vi.fn()}
      />
    )
    expect(container.querySelector('div')).toBeInTheDocument()
  })
})

describe('MilestoneManager — a refused order reaches the user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateMilestone.mockResolvedValue('m-new')
  })

  it('shows the conflict sentence the database wrote', async () => {
    // Shaped by name rather than by importing the class: this suite mocks
    // `../services/db` wholesale, which is the situation the message helper
    // matches on `name` for.
    mockCreateMilestone.mockRejectedValueOnce(
      Object.assign(new Error('Milestone order 1 is already used in this project'), {
        name: 'MilestoneOrderConflictError',
      })
    )
    const onMilestoneCreated = vi.fn()

    render(
      <MilestoneManager
        projectId="test-project"
        milestones={[MILESTONE]}
        activeMilestoneId={null}
        onSelectMilestone={vi.fn()}
        onMilestoneCreated={onMilestoneCreated}
      />
    )

    createMilestoneNamed('Approval')

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Milestone order 1 is already used in this project'
      )
    })
    expect(mockToast.success).not.toHaveBeenCalled()
    expect(onMilestoneCreated).not.toHaveBeenCalled()
  })

  it('keeps the generic line for every other failure', async () => {
    mockCreateMilestone.mockRejectedValueOnce(new Error('database is locked'))

    render(
      <MilestoneManager
        projectId="test-project"
        milestones={[MILESTONE]}
        activeMilestoneId={null}
        onSelectMilestone={vi.fn()}
        onMilestoneCreated={vi.fn()}
      />
    )

    createMilestoneNamed('Approval')

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to create milestone')
    })
  })
})
