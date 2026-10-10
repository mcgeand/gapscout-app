/**
 * Edit and delete on the post-#209 milestone strip (#106).
 *
 * The strip only filters; the active milestone's row beneath it carries Edit
 * and Delete. Edit writes name/description through `db.updateMilestone` and
 * never sends `order` or `relatedPolicies`. Delete reads the usage count first
 * so the dialog can name the steps that block it, then hands the write to
 * `stepsStore.deleteMilestone`, whose own guard is covered in
 * `stepsStore.deleteMilestone.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Milestone } from '../data/types'

const {
  mockUpdateMilestone,
  mockGetMilestoneUsageCount,
  mockDbDeleteMilestone,
  mockListMilestones,
  mockToast,
} = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return {
    mockUpdateMilestone: vi.fn(),
    mockGetMilestoneUsageCount: vi.fn(),
    mockDbDeleteMilestone: vi.fn(),
    mockListMilestones: vi.fn(),
    mockToast: toast,
  }
})

vi.mock('../services/db', () => ({
  createMilestone: vi.fn(),
  updateMilestone: mockUpdateMilestone,
  getMilestoneUsageCount: mockGetMilestoneUsageCount,
  deleteMilestone: mockDbDeleteMilestone,
  listMilestones: mockListMilestones,
  listSteps: vi.fn().mockResolvedValue([]),
  getMilestone: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

import { MilestoneManager } from '../components/Discovery/MilestoneManager'
import { useStepsStore } from '../state/stepsStore'

const APPROVAL: Milestone = {
  id: 'm-2',
  projectId: 'test-project',
  name: 'Approval',
  order: 1,
  description: 'Sign-off phase',
  relatedPolicies: ['POL-1'],
  createdAt: 0,
  updatedAt: 0,
}

const MAIN: Milestone = {
  id: 'm-1',
  projectId: 'test-project',
  name: 'Main Flow',
  order: 0,
  description: undefined,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

function renderManager(
  overrides: Partial<React.ComponentProps<typeof MilestoneManager>> = {}
) {
  const props = {
    projectId: 'test-project',
    milestones: [MAIN, APPROVAL],
    activeMilestoneId: 'm-2' as string | null,
    onSelectMilestone: vi.fn(),
    onMilestonesChanged: vi.fn(),
    ...overrides,
  }
  render(<MilestoneManager {...props} />)
  return props
}

describe('MilestoneManager — edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateMilestone.mockResolvedValue(undefined)
  })

  it('offers Edit and Delete only for a milestone, not for All steps', () => {
    renderManager({ activeMilestoneId: null })
    expect(screen.queryByRole('button', { name: /Edit milestone/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete milestone/ })).not.toBeInTheDocument()
  })

  it('seeds the dialog from the active milestone', () => {
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone Approval' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Milestone Name *')).toHaveValue('Approval')
    expect(within(dialog).getByLabelText('Description (Optional)')).toHaveValue('Sign-off phase')
  })

  it('writes name and description only, then reloads', async () => {
    const { onMilestonesChanged } = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone Approval' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Milestone Name *'), {
      target: { value: '  Sign-off  ' },
    })
    fireEvent.change(within(dialog).getByLabelText('Description (Optional)'), {
      target: { value: '' },
    })
    fireEvent.click(within(dialog).getByText('Save Changes'))

    await waitFor(() => {
      expect(mockUpdateMilestone).toHaveBeenCalledWith(
        'm-2',
        { name: 'Sign-off', description: '' },
        'test-project'
      )
    })
    // No `order`, no `relatedPolicies`: the UNIQUE order index is never in play
    // and the policies survive the edit.
    const changes = mockUpdateMilestone.mock.calls[0][1]
    expect(changes).not.toHaveProperty('order')
    expect(changes).not.toHaveProperty('relatedPolicies')
    await waitFor(() => expect(onMilestonesChanged).toHaveBeenCalled())
    expect(mockToast.success).toHaveBeenCalledWith('Milestone updated')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('will not save a blank name', () => {
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone Approval' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Milestone Name *'), {
      target: { value: '   ' },
    })
    expect(within(dialog).getByText('Save Changes')).toBeDisabled()
    expect(mockUpdateMilestone).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows the conflict sentence when the write is refused', async () => {
    mockUpdateMilestone.mockRejectedValueOnce(
      Object.assign(new Error('Milestone order 2 is already used in this project'), {
        name: 'MilestoneOrderConflictError',
      })
    )
    const { onMilestonesChanged } = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone Approval' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Save Changes'))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Milestone order 2 is already used in this project'
      )
    })
    expect(onMilestonesChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('uses the generic line for any other failure', async () => {
    mockUpdateMilestone.mockRejectedValueOnce(new Error('database is locked'))
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Edit milestone Approval' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Save Changes'))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to update milestone')
    })
  })
})

describe('MilestoneManager — delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbDeleteMilestone.mockResolvedValue(undefined)
    mockListMilestones.mockResolvedValue([MAIN])
    useStepsStore.setState({
      milestones: [MAIN, APPROVAL],
      steps: [],
      currentProjectId: 'test-project',
      isLoading: false,
    })
  })

  it('names the referencing steps and offers no delete when the milestone is in use', async () => {
    mockGetMilestoneUsageCount.mockResolvedValue({ steps: 3, processGaps: 0 })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Cannot delete milestone')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Approval is used by 3 steps')
    expect(within(dialog).queryByText('Delete Milestone')).not.toBeInTheDocument()
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
  })

  it('uses the singular for one step', async () => {
    mockGetMilestoneUsageCount.mockResolvedValue({ steps: 1, processGaps: 0 })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('used by 1 step.')
  })

  it('deletes an unused milestone after confirming, reloads, and leaves the deleted tab', async () => {
    mockGetMilestoneUsageCount.mockResolvedValue({ steps: 0, processGaps: 0 })
    const { onMilestonesChanged, onSelectMilestone } = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete milestone?')).toBeInTheDocument()
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByText('Delete Milestone'))

    await waitFor(() => {
      expect(mockDbDeleteMilestone).toHaveBeenCalledWith('m-2', 'test-project')
    })
    await waitFor(() => expect(onSelectMilestone).toHaveBeenCalledWith(null))
    expect(onMilestonesChanged).toHaveBeenCalled()
    expect(mockToast.success).toHaveBeenCalledWith('Milestone "Approval" deleted')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancelling deletes nothing', async () => {
    mockGetMilestoneUsageCount.mockResolvedValue({ steps: 0, processGaps: 0 })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('Cancel'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
  })

  it('keeps the tab selected when the store refuses a late-arriving step', async () => {
    // Count read says free; by the time the store re-checks, a step has landed.
    mockGetMilestoneUsageCount
      .mockResolvedValueOnce({ steps: 0, processGaps: 0 })
      .mockResolvedValueOnce({ steps: 2, processGaps: 0 })
    const { onSelectMilestone } = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Delete Milestone'))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Cannot delete milestone "Approval" — used by 2 steps'
      )
    })
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
    expect(onSelectMilestone).not.toHaveBeenCalled()
  })

  it('refuses a milestone that only holds process gaps, and names them', async () => {
    // Process gaps FK to milestones with ON DELETE SET NULL, so a delete would
    // not fail: it would strand them. The dialog has to block it up front.
    mockGetMilestoneUsageCount.mockResolvedValue({ steps: 0, processGaps: 2 })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Cannot delete milestone')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Approval is used by 2 process gaps')
    expect(within(dialog).queryByText('Delete Milestone')).not.toBeInTheDocument()
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
  })

  it('names both counts when steps and process gaps both use the milestone', async () => {
    mockGetMilestoneUsageCount.mockResolvedValue({ steps: 2, processGaps: 1 })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'used by 2 steps and 1 process gap.'
    )
  })

  it('says no steps and no process gaps use an empty milestone', async () => {
    mockGetMilestoneUsageCount.mockResolvedValue({ steps: 0, processGaps: 0 })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'No steps or process gaps use it.'
    )
  })

  it('keeps the tab selected when the store refuses a late-arriving process gap', async () => {
    mockGetMilestoneUsageCount
      .mockResolvedValueOnce({ steps: 0, processGaps: 0 })
      .mockResolvedValueOnce({ steps: 0, processGaps: 1 })
    const { onSelectMilestone } = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Delete milestone Approval' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Delete Milestone'))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Cannot delete milestone "Approval" — used by 1 process gap'
      )
    })
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
    expect(onSelectMilestone).not.toHaveBeenCalled()
  })
})
