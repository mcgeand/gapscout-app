/**
 * Tests for `stepsStore.deleteMilestone` pre-check guard.
 *
 * Replaces a prior in-memory `.filter(s => s.milestoneId === ...)` check that
 * depended on `get().steps` being loaded for the current project. The new
 * implementation calls `getMilestoneUsageCount` (DB query) — authoritative
 * regardless of in-memory state.
 *
 * Tests mock the db.ts module surface; they exercise only the store's
 * decision logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Milestone } from '../data/types'

const {
  mockGetMilestoneUsageCount,
  mockDbDeleteMilestone,
  mockListSteps,
  mockListMilestones,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockGetMilestoneUsageCount: vi.fn(),
  mockDbDeleteMilestone: vi.fn().mockResolvedValue(undefined),
  mockListSteps: vi.fn().mockResolvedValue([]),
  mockListMilestones: vi.fn().mockResolvedValue([]),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('../services/db', () => ({
  listSteps: mockListSteps,
  getStep: vi.fn(),
  createStep: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  listMilestones: mockListMilestones,
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: mockDbDeleteMilestone,
  getMilestoneUsageCount: mockGetMilestoneUsageCount,
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}))

import { useStepsStore } from '../state/stepsStore'

const seedMilestone: Milestone = {
  id: 'ms-1',
  projectId: 'proj-1',
  name: 'Approval',
  order: 0,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

describe('stepsStore.deleteMilestone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbDeleteMilestone.mockResolvedValue(undefined)

    useStepsStore.setState({
      steps: [],
      milestones: [seedMilestone],
      currentProjectId: 'proj-1',
      currentStep: null,
      isLoading: false,
    })
  })

  it('blocks deletion and toasts a friendly error when steps still use the milestone', async () => {
    mockGetMilestoneUsageCount.mockResolvedValueOnce(2)

    await useStepsStore.getState().deleteMilestone('ms-1')

    expect(mockGetMilestoneUsageCount).toHaveBeenCalledWith('ms-1', 'proj-1')
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastError.mock.calls[0][0]).toMatch(/Cannot delete milestone "Approval" — used by 2 steps$/)
  })

  it('uses singular "step" when exactly one step references the milestone', async () => {
    mockGetMilestoneUsageCount.mockResolvedValueOnce(1)

    await useStepsStore.getState().deleteMilestone('ms-1')

    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
    expect(mockToastError.mock.calls[0][0]).toMatch(/used by 1 step$/)
  })

  it('proceeds with deletion and toasts success when usage is 0', async () => {
    mockGetMilestoneUsageCount.mockResolvedValueOnce(0)

    await useStepsStore.getState().deleteMilestone('ms-1')

    expect(mockDbDeleteMilestone).toHaveBeenCalledWith('ms-1', 'proj-1')
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess.mock.calls[0][0]).toMatch(/Milestone "Approval" deleted/)

    // Locks in: local state is updated optimistically (no DB reload) after delete.
    expect(useStepsStore.getState().milestones).toEqual([])
  })

  it('bails with a friendly toast when no projectId is available', async () => {
    useStepsStore.setState({
      steps: [],
      milestones: [{ ...seedMilestone, projectId: '' }],
      currentProjectId: null,
      currentStep: null,
      isLoading: false,
    })

    await useStepsStore.getState().deleteMilestone('ms-1')

    expect(mockGetMilestoneUsageCount).not.toHaveBeenCalled()
    expect(mockDbDeleteMilestone).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('Cannot delete milestone: no project selected')
  })

  it('falls back to a domain error if a constraint failure still escapes the pre-check', async () => {
    mockGetMilestoneUsageCount.mockResolvedValueOnce(0)
    mockDbDeleteMilestone.mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'))

    await useStepsStore.getState().deleteMilestone('ms-1')

    expect(mockToastError).toHaveBeenCalledWith('Cannot delete milestone: steps are still assigned to it')
  })
})
