/**
 * `stepsStore.reorderMilestones` reloads on the way out, not on success (#131).
 *
 * The write it wraps has no transaction behind it: `db.reorderMilestones` parks
 * a project's milestones above their final range and then places them one row
 * at a time, so a failure part-way through leaves the database holding orders
 * nobody asked for. A reload that only runs when the write succeeded is a
 * reload for the one case where the store was already right — the failure is
 * exactly when the tab strip would otherwise keep drawing the pre-reorder order
 * over a database that has moved on.
 *
 * These tests mock `../services/db` wholesale, so they say nothing about what
 * the write leaves on disk; `db.milestoneOrder.real.test.ts` covers that on the
 * real engine. What they pin here is the store's control flow: the reload runs
 * on both paths, and the error still reaches the caller.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Milestone } from '../data/types'

const {
  mockDbReorderMilestones,
  mockListSteps,
  mockListMilestones,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockDbReorderMilestones: vi.fn().mockResolvedValue(undefined),
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
  deleteMilestone: vi.fn(),
  reorderMilestones: mockDbReorderMilestones,
  getMilestoneUsageCount: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}))

import { useStepsStore } from '../state/stepsStore'

const seedMilestones: Milestone[] = [
  { id: 'ms-1', projectId: 'proj-1', name: 'Intake', order: 0, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
  { id: 'ms-2', projectId: 'proj-1', name: 'Approval', order: 1, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
]

describe('stepsStore.reorderMilestones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbReorderMilestones.mockResolvedValue(undefined)
    mockListMilestones.mockResolvedValue([])

    useStepsStore.setState({
      steps: [],
      milestones: seedMilestones,
      currentProjectId: 'proj-1',
      currentStep: null,
      isLoading: false,
    })
  })

  it('writes the order and redraws the milestones from the database', async () => {
    // The reloaded list is deliberately not the one that was asked for: the
    // store must show what came back, not the sequence it sent.
    mockListMilestones.mockResolvedValueOnce([
      { ...seedMilestones[1], order: 0 },
      { ...seedMilestones[0], order: 1 },
    ])

    await useStepsStore.getState().reorderMilestones('proj-1', ['ms-2', 'ms-1'])

    expect(mockDbReorderMilestones).toHaveBeenCalledWith('proj-1', ['ms-2', 'ms-1'])
    expect(mockListMilestones).toHaveBeenCalledWith('proj-1')
    expect(useStepsStore.getState().milestones.map((m) => m.id)).toEqual(['ms-2', 'ms-1'])
    expect(mockToastError).not.toHaveBeenCalled()
    expect(useStepsStore.getState().isLoading).toBe(false)
  })

  it('still reloads when the write fails, and rethrows', async () => {
    // A torn park-then-place: the call throws with rows already moved. The
    // reload is the only thing that can say which ones.
    mockDbReorderMilestones.mockRejectedValueOnce(new Error('database is locked'))
    mockListMilestones.mockResolvedValueOnce([{ ...seedMilestones[0], order: 1000000 }])

    await expect(
      useStepsStore.getState().reorderMilestones('proj-1', ['ms-2', 'ms-1'])
    ).rejects.toThrow('database is locked')

    expect(mockListMilestones).toHaveBeenCalledWith('proj-1')
    expect(useStepsStore.getState().milestones.map((m) => m.order)).toEqual([1000000])
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalledWith('Failed to reorder milestones')
    expect(useStepsStore.getState().isLoading).toBe(false)
  })
})
