import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getStep, getGap } = vi.hoisted(() => ({
  getStep: vi.fn(),
  getGap: vi.fn(),
}))

vi.mock('../services/db', () => ({
  getStep,
  getGap,
  listSteps: vi.fn(),
  listMilestones: vi.fn(),
  createStep: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  listGaps: vi.fn(),
  listGapsByStep: vi.fn(),
  createGap: vi.fn(),
  updateGap: vi.fn(),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

import { useStepsStore } from '../state/stepsStore'
import { useGapsStore } from '../state/gapsStore'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const step = (id: string) => ({
  id, projectId: id, label: id, teamId: 'team', milestoneId: 'milestone', order: 1,
  suppliers: [], inputs: [], outputs: [], customers: [], systems: [], comments: [], links: [], gapIds: [], createdAt: 1, updatedAt: 1,
})
const gap = (id: string) => ({
  id, projectId: id, observed: id, expected: id, severity: 'M' as const, status: 'Open' as const, links: [], createdAt: 1, updatedAt: 1,
})

beforeEach(() => {
  vi.clearAllMocks()
  useStepsStore.setState({ steps: [], milestones: [], currentProjectId: null, currentStep: null, isLoading: false })
  useGapsStore.setState({ gaps: [], currentProjectId: null, currentGap: null, isLoading: false })
})

describe('selection request isolation', () => {
  it('commits only the latest step selection and clearSelection invalidates it', async () => {
    const a = deferred<ReturnType<typeof step> | null>()
    const b = deferred<ReturnType<typeof step> | null>()
    getStep.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)

    const selectA = useStepsStore.getState().selectStep('a')
    const selectB = useStepsStore.getState().selectStep('b')
    b.resolve(step('b')); await selectB
    a.resolve(step('a')); await selectA
    expect(useStepsStore.getState().currentStep).toEqual(step('b'))

    const pending = deferred<ReturnType<typeof step> | null>()
    getStep.mockReturnValueOnce(pending.promise)
    const selectAfterClear = useStepsStore.getState().selectStep('a')
    useStepsStore.getState().clearSelection()
    pending.resolve(step('a')); await selectAfterClear
    expect(useStepsStore.getState().currentStep).toBeNull()
  })

  it('commits only the latest gap selection and clearSelection invalidates it', async () => {
    const a = deferred<ReturnType<typeof gap> | null>()
    const b = deferred<ReturnType<typeof gap> | null>()
    getGap.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)

    const selectA = useGapsStore.getState().selectGap('a')
    const selectB = useGapsStore.getState().selectGap('b')
    b.resolve(gap('b')); await selectB
    a.resolve(gap('a')); await selectA
    expect(useGapsStore.getState().currentGap).toEqual(gap('b'))

    const pending = deferred<ReturnType<typeof gap> | null>()
    getGap.mockReturnValueOnce(pending.promise)
    const selectAfterClear = useGapsStore.getState().selectGap('a')
    useGapsStore.getState().clearSelection()
    pending.resolve(gap('a')); await selectAfterClear
    expect(useGapsStore.getState().currentGap).toBeNull()
  })

  it('clears a seeded step selection when the latest step lookup fails', async () => {
    useStepsStore.setState({ currentStep: step('old') })
    getStep.mockRejectedValueOnce(new Error('step failed'))

    await useStepsStore.getState().selectStep('new')

    expect(useStepsStore.getState().currentStep).toBeNull()
  })

  it('clears a seeded gap selection when the latest gap lookup fails', async () => {
    useGapsStore.setState({ currentGap: gap('old') })
    getGap.mockRejectedValueOnce(new Error('gap failed'))

    await useGapsStore.getState().selectGap('new')

    expect(useGapsStore.getState().currentGap).toBeNull()
  })
})
