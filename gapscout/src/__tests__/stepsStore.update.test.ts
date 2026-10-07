import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Step } from '../data/types'

const { mockDbUpdateStep, mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockDbUpdateStep: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('../services/db', () => ({
  listSteps: vi.fn(),
  getStep: vi.fn(),
  createStep: vi.fn(),
  updateStep: mockDbUpdateStep,
  deleteStep: vi.fn(),
  listMilestones: vi.fn(),
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}))

import { useStepsStore } from '../state/stepsStore'

const step: Step = {
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

describe('stepsStore.updateStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStepsStore.setState({
      steps: [step],
      milestones: [],
      currentProjectId: 'project-1',
      currentStep: null,
      isLoading: false,
    })
  })

  it('rejects database write failures after showing the existing error toast', async () => {
    const dbError = new Error('database write failed')
    mockDbUpdateStep.mockRejectedValueOnce(dbError)

    await expect(
      useStepsStore.getState().updateStep(step.id, { label: 'Updated request' })
    ).rejects.toBe(dbError)

    expect(mockToastError).toHaveBeenCalledWith('Failed to update step')
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(useStepsStore.getState().steps).toEqual([step])
  })
})
