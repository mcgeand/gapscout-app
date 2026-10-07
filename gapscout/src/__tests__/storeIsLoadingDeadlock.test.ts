/**
 * ZIP-121 regression: isLoading must always reset, even when the underlying
 * db.ts op throws mid-action. Stores that capture rollback state must also
 * restore it on error without clobbering the happy-path post-reload state.
 *
 * Before ZIP-121, store actions manually reset `isLoading: false` at every
 * exit point (happy path, catch, validation early-returns). One missed
 * early-return left the spinner stuck forever (audit finding B2). The fix
 * is a single try/finally per action — this test pins that contract so a
 * future refactor can't silently regress it.
 *
 * Covered actions:
 *   - teamsStore.loadTeams (simple load — happy + error)
 *   - gapsStore.loadGaps, loadGapsByStep (simple load — error)
 *   - stepsStore.reorderSteps (rollback-aware — proves the store shows the
 *     database and resets isLoading after the order write rejects)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Step } from '../data/types'

const {
  mockListTeams,
  mockListGaps,
  mockListGapsByStep,
  mockListSteps,
  mockSetStepOrders,
  mockToastError,
} = vi.hoisted(() => ({
  mockListTeams: vi.fn(),
  mockListGaps: vi.fn(),
  mockListGapsByStep: vi.fn(),
  mockListSteps: vi.fn(),
  mockSetStepOrders: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('../services/db', () => ({
  // teamsStore surface
  createTeam: vi.fn(),
  listTeams: mockListTeams,
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  getTeamUsageCount: vi.fn(),
  // gapsStore surface
  listGaps: mockListGaps,
  listGapsByStep: mockListGapsByStep,
  getGap: vi.fn(),
  createGap: vi.fn(),
  updateGap: vi.fn(),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
  // stepsStore surface
  listSteps: mockListSteps,
  getStep: vi.fn(),
  createStep: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  listMilestones: vi.fn(),
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  setStepOrders: mockSetStepOrders,
  setGapOrders: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockToastError,
    success: vi.fn(),
  },
}))

import { useTeamsStore } from '../state/teamsStore'
import { useGapsStore } from '../state/gapsStore'
import { useStepsStore } from '../state/stepsStore'

describe('store try/finally isLoading guards (ZIP-121)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTeamsStore.setState({ teams: [], currentProjectId: null, isLoading: false })
    useGapsStore.setState({ gaps: [], currentProjectId: null, isLoading: false })
    useStepsStore.setState({
      steps: [],
      milestones: [],
      currentProjectId: null,
      currentStep: null,
      isLoading: false,
    })
  })

  it('teamsStore.loadTeams: isLoading resets to false when db throws', async () => {
    mockListTeams.mockRejectedValueOnce(new Error('db unavailable'))

    await useTeamsStore.getState().loadTeams('proj-1')

    expect(useTeamsStore.getState().isLoading).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('Failed to load teams')
  })

  it('teamsStore.loadTeams: isLoading resets to false on the happy path', async () => {
    mockListTeams.mockResolvedValueOnce([])

    await useTeamsStore.getState().loadTeams('proj-1')

    expect(useTeamsStore.getState().isLoading).toBe(false)
  })

  it('gapsStore.loadGaps: isLoading resets to false when db throws', async () => {
    mockListGaps.mockRejectedValueOnce(new Error('db unavailable'))

    await useGapsStore.getState().loadGaps('proj-1')

    expect(useGapsStore.getState().isLoading).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('Failed to load gaps')
  })

  it('gapsStore.loadGapsByStep: isLoading resets to false when db throws', async () => {
    mockListGapsByStep.mockRejectedValueOnce(new Error('db unavailable'))

    await useGapsStore.getState().loadGapsByStep('step-1', 'project-1')

    expect(useGapsStore.getState().isLoading).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('Failed to load gaps for step')
  })

  it('stepsStore.reorderSteps: shows what the database actually holds AND resets isLoading when the order shift rejects', async () => {
    // Seed two steps in the same milestone so reorderSteps has work to do
    const stepA: Step = {
      id: 'step-a',
      projectId: 'proj-1',
      milestoneId: 'm-1',
      teamId: 't-1',
      label: 'A',
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
    const stepB: Step = { ...stepA, id: 'step-b', label: 'B', order: 2 }

    const initialSteps = [stepA, stepB]
    useStepsStore.setState({ steps: initialSteps, currentProjectId: 'proj-1' })

    // The order write rejects. `reorderSteps` does not run inside a
    // transaction — the Tauri adapter has no primitive that gives atomicity
    // (#236) — and the module's compensation only covers a failed SECOND table,
    // so a failure in the step write itself can still leave the database
    // holding whatever it holds. Here that is a duplicate at 2 and a hole at 1.
    //
    // The reorder reads the milestone twice before it writes — once for the
    // order ceiling, once for the plan — so those two see the pre-move layout
    // and everything after the failure sees the torn one.
    const tornDatabase = [{ ...stepA, order: 2 }, stepB]
    mockListSteps
      .mockResolvedValueOnce(initialSteps)
      .mockResolvedValueOnce(initialSteps)
      .mockResolvedValue(tornDatabase)
    // Both reads rank steps alongside process gaps, so the gap read has to
    // resolve even when there are none.
    mockListGaps.mockResolvedValue([])
    mockSetStepOrders.mockRejectedValueOnce(new Error('shift failed'))

    await expect(useStepsStore.getState().reorderSteps('step-a', 2)).rejects.toThrow('shift failed')

    // Three invariants must hold after the failed reorder:
    //   1. Local state shows the DATABASE, not the optimistic guess and not the
    //      pre-move snapshot. Painting a clean 1..n back over a torn write would
    //      hide the corruption until some unrelated load swapped the real one in.
    //   2. isLoading reset to false (no stuck spinner)
    //   3. The user is told the reorder failed
    expect(useStepsStore.getState().steps).toEqual(tornDatabase)
    expect(useStepsStore.getState().steps).not.toEqual(initialSteps)
    expect(useStepsStore.getState().isLoading).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('Failed to reorder steps')
  })
})
