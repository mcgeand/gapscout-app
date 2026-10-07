import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gap, Step } from '../data/types'

const {
  mockDbUpdateStep,
  mockGetStep,
  mockListGapsByStep,
  mockDbUpdateGap,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockDbUpdateStep: vi.fn(),
  mockGetStep: vi.fn(),
  mockListGapsByStep: vi.fn(),
  mockDbUpdateGap: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('../services/db', () => ({
  // stepsStore
  listSteps: vi.fn(),
  getStep: mockGetStep,
  createStep: vi.fn(),
  updateStep: mockDbUpdateStep,
  deleteStep: vi.fn(),
  listMilestones: vi.fn(),
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  setStepOrders: vi.fn(),
  setGapOrders: vi.fn(),
  // gapsStore
  listGaps: vi.fn(),
  listGapsByStep: mockListGapsByStep,
  getGap: vi.fn(),
  createGap: vi.fn(),
  updateGap: mockDbUpdateGap,
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}))

import { useGapsStore } from '../state/gapsStore'
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

const gap = (overrides: Partial<Gap> = {}): Gap => ({
  id: 'gap-1',
  projectId: 'project-1',
  stepId: 'step-1',
  observed: 'No input recorded',
  expected: 'Purchase request received',
  severity: 'M',
  status: 'Open',
  missingField: 'input',
  links: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

/** dbUpdateGap returns the persisted row; echo the patch back like SQLite would. */
const echoUpdatedGap = (gaps: Gap[]) => async (gapId: string, data: Partial<Gap>) => {
  const existing = gaps.find(g => g.id === gapId)
  return existing ? { ...existing, ...data } : null
}

describe('stepsStore.updateStep — gap auto-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('moves an Open gap on the filled field to Review and persists it', async () => {
    const gaps = [gap()]
    mockListGapsByStep.mockResolvedValue(gaps)
    mockDbUpdateGap.mockImplementation(echoUpdatedGap(gaps))
    useGapsStore.setState({ gaps })

    await useStepsStore.getState().updateStep(step.id, { inputs: ['Purchase request'] })

    expect(mockListGapsByStep).toHaveBeenCalledWith('step-1', 'project-1')
    expect(mockDbUpdateGap).toHaveBeenCalledTimes(1)
    expect(mockDbUpdateGap).toHaveBeenCalledWith(
      'gap-1',
      { status: 'Review', closedAt: null },
      'project-1'
    )
    expect(useGapsStore.getState().gaps[0].status).toBe('Review')
    expect(mockToastSuccess).toHaveBeenCalledWith('1 gap moved to Review')
  })

  it('moves every matching gap on the step in one run and reports one toast', async () => {
    const gaps = [gap({ id: 'gap-1' }), gap({ id: 'gap-2' })]
    mockListGapsByStep.mockResolvedValue(gaps)
    mockDbUpdateGap.mockImplementation(echoUpdatedGap(gaps))
    useGapsStore.setState({ gaps })

    await useStepsStore.getState().updateStep(step.id, { inputs: ['Purchase request'] })

    expect(mockDbUpdateGap.mock.calls.map(call => call[0])).toEqual(['gap-1', 'gap-2'])
    expect(useGapsStore.getState().gaps.map(g => g.status)).toEqual(['Review', 'Review'])
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).toHaveBeenCalledWith('2 gaps moved to Review')
  })

  it('leaves gaps on other fields and gaps already past Open alone', async () => {
    const gaps = [
      gap({ id: 'gap-input' }),
      gap({ id: 'gap-output', missingField: 'output' }),
      gap({ id: 'gap-reviewed', status: 'Review' }),
      gap({ id: 'gap-closed', status: 'Closed' }),
      gap({ id: 'gap-no-field', missingField: undefined }),
    ]
    mockListGapsByStep.mockResolvedValue(gaps)
    mockDbUpdateGap.mockImplementation(echoUpdatedGap(gaps))

    await useStepsStore.getState().updateStep(step.id, { inputs: ['Purchase request'] })

    expect(mockDbUpdateGap.mock.calls.map(call => call[0])).toEqual(['gap-input'])
  })

  it('does not look for gaps when the patch fills no SIPOC field', async () => {
    await useStepsStore.getState().updateStep(step.id, { label: 'Renamed' })

    expect(mockListGapsByStep).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('does not look for gaps when the field already had a value', async () => {
    useStepsStore.setState({ steps: [{ ...step, inputs: ['Purchase request'] }] })

    await useStepsStore
      .getState()
      .updateStep(step.id, { inputs: ['Purchase request', 'Budget code'] })

    expect(mockListGapsByStep).not.toHaveBeenCalled()
  })

  it('says nothing when the filled field has no gaps waiting on it', async () => {
    mockListGapsByStep.mockResolvedValue([])

    await useStepsStore.getState().updateStep(step.id, { inputs: ['Purchase request'] })

    expect(mockDbUpdateGap).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('keeps the step saved when the gap promotion fails', async () => {
    mockListGapsByStep.mockRejectedValue(new Error('gap read failed'))

    await expect(
      useStepsStore.getState().updateStep(step.id, { inputs: ['Purchase request'] })
    ).resolves.toBeUndefined()

    expect(useStepsStore.getState().steps[0].inputs).toEqual(['Purchase request'])
    expect(mockToastError).toHaveBeenCalledWith('Step saved, but its gaps could not be moved to Review')
  })
})
