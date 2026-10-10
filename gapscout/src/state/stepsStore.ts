/**
 * Steps Store - Zustand store for managing process steps and milestones
 *
 * Handles step list, current step selection, and all CRUD operations.
 * Integrates with SQLite database via Tauri plugin.
 *
 * References: PRD Section 6.3 - State Management
 */

import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Step, Milestone } from '../data/types'
import {
  listSteps,
  getStep,
  createStep as dbCreateStep,
  updateStep as dbUpdateStep,
  deleteStep as dbDeleteStep,
  listMilestones,
  getMilestone,
  createMilestone as dbCreateMilestone,
  updateMilestone as dbUpdateMilestone,
  deleteMilestone as dbDeleteMilestone,
  reorderMilestones as dbReorderMilestones,
  getMilestoneUsageCount,
} from '../services/db'
import { logger } from '../lib/logger'
import { milestoneWriteMessage } from '../lib/milestoneWriteMessage'
import { describeMilestoneUsage, isMilestoneInUse } from '../lib/milestoneUsage'
import { detectFilledSipocFields } from '../lib/gapAutoStatus'
import { useGapsStore } from './gapsStore'
import { createRequestGuard } from './requestGuard'
import { moveWithinMilestone, positionCount, withMilestoneSequence } from '../lib/sequence'
import { captureProjectScope, isProjectScopeCurrent, resolveProjectId } from './workspaceScope'

/**
 * A typed order the user asked for that the milestone cannot hold.
 *
 * Carries a message written for the user, because the callers show it verbatim.
 * It is thrown before any write, so a caller catching it knows nothing moved —
 * unlike the generic failure, which can leave a torn reorder behind.
 */
export class StepOrderRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StepOrderRangeError'
  }
}

const loadGuard = createRequestGuard()
const selectionGuard = createRequestGuard()

interface StepsStore {
  // State
  steps: Step[]
  milestones: Milestone[]
  currentProjectId: string | null
  currentStep: Step | null
  isLoading: boolean

  // Step Actions
  loadSteps: (projectId: string) => Promise<void>
  addStep: (data: Omit<Step, 'id'>) => Promise<Step | null>
  updateStep: (stepId: string, data: Partial<Step>, explicitProjectId?: string) => Promise<void>
  deleteStep: (stepId: string, explicitProjectId?: string) => Promise<void>
  reorderSteps: (stepId: string, newOrder: number, explicitProjectId?: string) => Promise<void>
  selectStep: (stepId: string) => Promise<void>
  clearSelection: () => void

  // Milestone Actions
  loadMilestones: (projectId: string) => Promise<void>
  addMilestone: (
    data: Omit<Milestone, 'id' | 'createdAt' | 'updatedAt'>,
    options?: { silent?: boolean },
  ) => Promise<Milestone | null>
  updateMilestone: (milestoneId: string, data: Partial<Milestone>, explicitProjectId?: string) => Promise<void>
  deleteMilestone: (milestoneId: string, explicitProjectId?: string) => Promise<void>
  reorderMilestones: (projectId: string, orderedIds: string[]) => Promise<void>

  // Utility
  clearSteps: () => void
}

// `isLoading` follows the contract written above `useGapsStore` in
// `./gapsStore.ts`: cleared whenever `loadGuard.finish` says this was the last
// request in flight, never gated on project scope (#98, #405).
export const useStepsStore = create<StepsStore>((set, get) => ({
  // Initial state
  steps: [],
  milestones: [],
  currentProjectId: null,
  currentStep: null,
  isLoading: false,

  // ============================================================================
  // STEP ACTIONS
  // ============================================================================

  /**
   * Load all steps for a project
   */
  loadSteps: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId, 'steps')
    try {
      set({ isLoading: true, currentProjectId: projectId })

      const steps = await listSteps(projectId)
      if (loadGuard.isCurrent(requestId, projectId, 'steps') && isProjectScopeCurrent(scope)) {
        logger.info(`Loaded ${steps.length} steps for project ${projectId}`)
        set({ steps })
      }
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId, 'steps') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load steps', error)
        toast.error('Failed to load steps')
        set({ steps: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId, 'steps')) set({ isLoading: false })
    }
  },

  /**
   * Add a new step
   */
  addStep: async (data: Omit<Step, 'id'>) => {
    const scope = captureProjectScope(data.projectId)
    if (!scope) return null
    const operationId = loadGuard.begin(data.projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      // Validate
      if (!data.label || data.label.trim().length === 0) {
        toast.error('Step label is required')
        return null
      }

      // Create step
      const stepId = await dbCreateStep(data)

      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      logger.info('Created step', stepId)
      toast.success('Step created')

      // Reload steps for current project
      await get().loadSteps(data.projectId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null

      // Get the newly created step
      const createdStep = await getStep(stepId, data.projectId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      return createdStep
    } catch (error) {
      if (loadGuard.isCurrent(operationId, data.projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to create step', error)
        toast.error('Failed to create step')
      }
      return null
    } finally {
      if (loadGuard.finish(operationId, data.projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Update an existing step
   */
  updateStep: async (stepId: string, data: Partial<Step>, explicitProjectId?: string) => {
    const entity = get().steps.find(s => s.id === stepId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    // Read off the pre-update step: after the local state merge below there is
    // nothing left to compare the patch against. Empty when the step is not
    // loaded, since the previous SIPOC values are then unknown.
    const filledFields = entity ? detectFilledSipocFields(entity, data) : []
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      await dbUpdateStep(stepId, data, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Updated step', stepId)

      // Update local state
      const steps = get().steps
      const updatedSteps = steps.map(s =>
        s.id === stepId ? { ...s, ...data } : s
      )
      set({ steps: updatedSteps })

      // If this is the current step, update it too
      if (get().currentStep?.id === stepId) {
        const updatedStep = await getStep(stepId, projectId)
        if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
        set({ currentStep: updatedStep })
      }

      // Filling a missing SIPOC field resolves the gaps raised against it.
      // Deliberately does not rethrow: the step write has already committed, so
      // failing the caller here would report a save that actually succeeded.
      if (filledFields.length > 0) {
        try {
          await useGapsStore.getState().promoteGapsForFilledFields(stepId, filledFields, projectId)
        } catch (gapError) {
          if (isProjectScopeCurrent(scope)) {
            logger.error('Failed to move gaps to Review after step update', gapError)
            toast.error('Step saved, but its gaps could not be moved to Review')
          }
        }
      }
    } catch (error) {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to update step', error)
        toast.error('Failed to update step')
        throw error
      }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Delete a step, and say so when it fails.
   *
   * It used to catch, toast and return normally. Every caller then went on to
   * reseal the milestone as though a row had gone — closing a hole that was
   * never opened, which pulled the sequence one short and re-created the exact
   * `(milestone_id, "order")` tie the reseal exists to prevent, from the other
   * direction (#349). Rethrowing is what lets a caller skip the reseal, and it
   * matches `updateStep` and `reorderSteps`, which already do.
   *
   * The toast stays: the failure is still reported once, here, so no caller has
   * to decide whether to say something.
   */
  deleteStep: async (stepId: string, explicitProjectId?: string) => {
    const step = get().steps.find(s => s.id === stepId)
    const projectId = resolveProjectId(explicitProjectId, step?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      await dbDeleteStep(stepId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Deleted step', stepId)
      toast.success(`Step "${step?.label || 'Unknown'}" deleted`)

      // Clear selection if deleted step was selected
      if (get().currentStep?.id === stepId) {
        set({ currentStep: null })
      }

      // Reload steps for current project
      await get().loadSteps(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to delete step', error)
      toast.error('Failed to delete step')
      throw error
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Move a step to `newOrder` within its milestone.
   *
   * The arithmetic lives in `lib/sequence.moveWithinMilestone`, which is the
   * whole of #353: this action used to shift the displaced band itself, in a
   * statement that moved steps and left the milestone's process gaps behind —
   * #307 at a third site. The module moves both halves and dense-ranks the
   * result, so a reorder across a process gap now carries the gap.
   *
   * Still deliberately NOT wrapped in a transaction; the Tauri adapter has no
   * primitive that can deliver atomicity (#236). What replaces the old
   * write-ordering argument is exact compensation inside the module: the plan
   * carries every row's old order, so a failed second write is undone by
   * writing those values back rather than by guessing a counter-shift.
   *
   * No optimistic paint. A step-only patch would be a lie wherever the move
   * crosses a process gap — it would draw the step on the gap's position, which
   * the grid reads as a parallel branch — and the reload that follows is a
   * single query. On failure it re-reads for the reason #295 settled: painting
   * the pre-move sequence back over a torn write would hide it.
   */
  reorderSteps: async (stepId: string, newOrder: number, explicitProjectId?: string) => {
    const knownStep = get().steps.find(s => s.id === stepId)
    const projectId = resolveProjectId(explicitProjectId, knownStep?.projectId, get().currentProjectId)
    if (!projectId) return

    // Reject an out-of-range order rather than clamping it into range (#299).
    // `order` numbers a step within its milestone, so the ceiling is that
    // milestone's step count. Clamping meant typing 3 into the only step of a
    // milestone silently wrote 1 — a number the user never asked for, sitting
    // in the project's core artifact, and not reversible through the UI because
    // typing the old value back clamped again. Refusing the edit says so.
    if (knownStep) {
      // The ceiling counts every position the milestone holds, not just its
      // steps: a process gap reserves one too, so a milestone with two steps
      // and a gap runs 1..3. Counting steps alone would refuse an order the
      // grid is displaying — the same "the editor rejects the number it shows
      // you" complaint #299 opened with, just from the other side.
      //
      // Counted from the database rather than from the stores, so the number
      // the check enforces is the one the move is about to be measured against.
      const maxOrder = await positionCount(projectId, knownStep.milestoneId)
      if (!Number.isInteger(newOrder) || newOrder < 1 || newOrder > maxOrder) {
        const milestoneName =
          get().milestones.find(m => m.id === knownStep.milestoneId)?.name ?? 'this milestone'
        const message =
          maxOrder === 1
            ? `Order must be 1 — "${milestoneName}" has only one step`
            : `Order must be between 1 and ${maxOrder} — "${milestoneName}" has ${maxOrder} steps`
        toast.error(message)
        throw new StepOrderRangeError(message)
      }
    }

    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')

    try {
      set({ isLoading: true })

      const step = get().steps.find(s => s.id === stepId)
      if (!step) {
        throw new Error('Step not found')
      }
      if (step.order === newOrder) {
        return
      }

      // Serialised like every other sequence write. The mover plans absolute
      // values from a snapshot exactly as the reseal does, so a typed reorder
      // landing beside a concurrent reseal is the same lost update — the note
      // on `withMilestoneSequence` applies to it verbatim.
      await withMilestoneSequence(projectId, [step.milestoneId], () =>
        moveWithinMilestone(projectId, step.milestoneId, stepId, newOrder)
      )

      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      // A log line, not a label: nobody reads this in the product, and the
      // stored per-milestone orders are what a reorder is actually about, so
      // the process position would be the wrong number to record here (#345).
      // eslint-disable-next-line no-restricted-syntax
      logger.info(`Reordered step ${stepId} from ${step.order} to ${newOrder}`)
      toast.success('Step order updated')

      await get().loadSteps(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      await useGapsStore.getState().loadGaps(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to reorder steps', error)
      // Re-read rather than restoring a snapshot: the module compensates its
      // own second write, but a failure in the first leaves the database
      // holding whatever it holds, and only a read can say what that is.
      // `loadSteps` reports and handles its own failure.
      await get().loadSteps(projectId)
      toast.error('Failed to reorder steps')
      // Rethrow, as `updateStep` does. The Discovery grid's inline editor shows
      // a per-row save indicator and skips its gap re-sync on failure, and it
      // can only tell a failed reorder from a successful one if this surfaces.
      throw error
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Select and load a specific step
   */
  selectStep: async (stepId: string) => {
    const requestId = selectionGuard.begin(stepId)
    try {
      const step = await getStep(stepId)

      if (selectionGuard.isCurrent(requestId, stepId)) {
        if (step) {
          set({ currentStep: step })
          logger.info('Selected step', step.label)
        } else {
          set({ currentStep: null })
          toast.error('Step not found')
        }
      }
    } catch (error) {
      logger.error('Failed to select step', error)
      if (selectionGuard.isCurrent(requestId, stepId)) {
        set({ currentStep: null })
        toast.error('Failed to load step')
      }
    } finally {
      selectionGuard.finish(requestId, stepId)
    }
  },

  /**
   * Clear current step selection
   */
  clearSelection: () => {
    selectionGuard.invalidate()
    set({ currentStep: null })
    logger.info('Cleared step selection')
  },

  // ============================================================================
  // MILESTONE ACTIONS
  // ============================================================================

  /**
   * Load all milestones for a project
   */
  loadMilestones: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId, 'milestones')
    try {
      set({ isLoading: true, currentProjectId: projectId })

      const milestones = await listMilestones(projectId)
      if (loadGuard.isCurrent(requestId, projectId, 'milestones') && isProjectScopeCurrent(scope)) {
        logger.info(`Loaded ${milestones.length} milestones for project ${projectId}`)
        set({ milestones })
      }
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId, 'milestones') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load milestones', error)
        toast.error('Failed to load milestones')
        set({ milestones: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId, 'milestones')) set({ isLoading: false })
    }
  },

  /**
   * Add a new milestone
   */
  addMilestone: async (
    data: Omit<Milestone, 'id' | 'createdAt' | 'updatedAt'>,
    options?: { silent?: boolean },
  ) => {
    const scope = captureProjectScope(data.projectId)
    if (!scope) return null
    const operationId = loadGuard.begin(data.projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      // Validate
      if (!data.name || data.name.trim().length === 0) {
        toast.error('Milestone name is required')
        return null
      }

      // Create milestone
      const milestoneId = await dbCreateMilestone(data)

      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      logger.info('Created milestone', milestoneId)
      // `silent` suppresses the success toast only. Discovery auto-creates
      // "Main Flow" behind Add Step; that should not stack a milestone toast
      // over the step the user actually asked for (#282).
      if (!options?.silent) toast.success(`Milestone "${data.name}" created`)

      // Reload milestones for this project
      await get().loadMilestones(data.projectId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null

      // Get the newly created milestone
      const createdMilestone = await getMilestone(milestoneId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      return createdMilestone
    } catch (error) {
      if (loadGuard.isCurrent(operationId, data.projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to create milestone', error)
        toast.error(milestoneWriteMessage(error, 'Failed to create milestone'))
      }
      return null
    } finally {
      if (loadGuard.finish(operationId, data.projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Update an existing milestone
   */
  updateMilestone: async (milestoneId: string, data: Partial<Milestone>, explicitProjectId?: string) => {
    const entity = get().milestones.find(m => m.id === milestoneId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      await dbUpdateMilestone(milestoneId, data, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Updated milestone', milestoneId)
      toast.success('Milestone updated')

      // Update local state
      const milestones = get().milestones
      const updatedMilestones = milestones.map(m =>
        m.id === milestoneId ? { ...m, ...data } : m
      )
      set({ milestones: updatedMilestones })
    } catch (error) {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to update milestone', error)
        toast.error(milestoneWriteMessage(error, 'Failed to update milestone'))
      }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Move a project's milestones into `orderedIds`' sequence.
   *
   * Thin on purpose: `db.reorderMilestones` validates the id set and owns the
   * park-then-place write.
   *
   * **The reload runs in `finally`, and that is the whole point of it.** A torn
   * reorder throws out of the db call with some milestones already parked, so a
   * reload on the success path only ever redraws writes that went in whole —
   * the one case where the store's own copy was right already. Reloading on the
   * way out, failure included, is what stops the tab strip showing the order
   * that was asked for while the database holds the order that landed.
   * `loadSteps` is used the same way by `reorderSteps`, which reports and
   * handles its own read failure, and so does `loadMilestones`.
   *
   * Rethrown like `reorderSteps` and `updateStep`: a caller driving a drag can
   * only tell a failed reorder from a successful one if this surfaces.
   */
  reorderMilestones: async (projectId: string, orderedIds: string[]) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      await dbReorderMilestones(projectId, orderedIds)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Reordered milestones for project', projectId)
    } catch (error) {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to reorder milestones', error)
        toast.error('Failed to reorder milestones')
      }
      throw error
    } finally {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        await get().loadMilestones(projectId)
      }
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Delete a milestone (with dependency pre-check)
   */
  deleteMilestone: async (milestoneId: string, explicitProjectId?: string) => {
    const milestone = get().milestones.find(m => m.id === milestoneId)
    const projectId = resolveProjectId(explicitProjectId, milestone?.projectId, get().currentProjectId)
    if (!projectId) {
      logger.error('Cannot check milestone usage: no projectId available')
      toast.error('Cannot delete milestone: no project selected')
      return
    }
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      // Authoritative usage count from the DB (replaces a prior in-memory
      // filter that depended on `get().steps` being loaded and current).
      // Process gaps count too: their milestone FK is ON DELETE SET NULL, so a
      // delete would strand them rather than fail.
      const usage = await getMilestoneUsageCount(milestoneId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      if (isMilestoneInUse(usage)) {
        toast.error(
          `Cannot delete milestone "${milestone?.name || 'Unknown'}" — used by ${describeMilestoneUsage(usage)}`
        )
        return
      }

      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      await dbDeleteMilestone(milestoneId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Deleted milestone', milestoneId)
      toast.success(`Milestone "${milestone?.name || 'Unknown'}" deleted`)

      // Update local state
      const milestones = get().milestones.filter(m => m.id !== milestoneId)
      set({ milestones })
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to delete milestone', error)

      const errorStr = String(error)
      if (errorStr.includes('FOREIGN KEY') || errorStr.includes('constraint')) {
        toast.error('Cannot delete milestone: steps are still assigned to it')
      } else {
        toast.error('Failed to delete milestone')
      }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // ============================================================================
  // UTILITY
  // ============================================================================

  /**
   * Clear all steps and milestones (when switching projects)
   */
  clearSteps: () => {
    loadGuard.invalidate()
    selectionGuard.invalidate()
    // `invalidate()` empties the guard, so no in-flight `finally` can clear
    // `isLoading` any more; it has to be reset here.
    set({
      steps: [],
      milestones: [],
      currentProjectId: null,
      currentStep: null,
      isLoading: false,
    })
    logger.info('Cleared steps and milestones')
  },
}))
