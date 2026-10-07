/**
 * Gap re-sync after a step write
 *
 * The side-effectful half of `lib/gapSync`. Three surfaces write a step and
 * must then rewrite the gaps that describe it: the Discovery grid's inline
 * editor, the Diagram's Edit Step modal (#279), and the validation-warning
 * modal's deferred patch (#298). Only the grid ever did, so the same step
 * saved from the other two kept gaps naming fields it already had.
 *
 * It lives here rather than inside `stepsStore.updateStep` because a grid save
 * is `updateStep` followed by `reorderSteps`, and the re-sync has to run once
 * after both — a store-level hook would fire twice and re-plan against a
 * half-applied move.
 *
 * Two rules every caller inherits, decided here rather than at each site:
 *
 * - **It never throws.** By the time it runs the step write has committed, so
 *   failing the caller would report a save that actually succeeded — the rule
 *   `stepsStore.updateStep` already states for gap promotion. `updateGap`
 *   toasts its own failure, so nothing goes unreported. This is a change for
 *   the grid, where a gap-write failure used to reach `StepRow`'s ✗ indicator
 *   and blame the step for it.
 * - **It writes silently and reports once.** `updateGap` toasts `Gap updated`
 *   per call, and a milestone-wide re-sync can rewrite every gap in the
 *   milestone; that is the toast storm #107 opened on. Callers decide what to
 *   say, from `syncedCount`.
 */

import { planGapResync } from '../lib/gapSync'
import { validateStep } from '../lib/sipocValidator'
import { milestonesById } from '../lib/stepSequence'
import { logger } from '../lib/logger'
import type { Gap, Step } from '../data/types'
import { useGapsStore } from './gapsStore'
import { useStepsStore } from './stepsStore'

export interface StepWriteResync {
  /** How many gaps had their wording rewritten. */
  syncedCount: number
  /** Which ones, so a caller can avoid writing the same gap again. */
  syncedGapIds: Set<string>
  /** The written step as the store now holds it, or undefined if it has gone. */
  editedStep: Step | undefined
  /** Gaps still Open on that step after the write. */
  openGapsForStep: Gap[]
  /** Whether the step passes SIPOC validation, or undefined if it has gone. */
  isValid: boolean | undefined
}

/**
 * The gap ids a write should still be allowed to rewrite once it has finished.
 *
 * Call this before the first await. `updateStep` promotes gaps whose missing
 * field the patch fills (#88), so by the time the write returns a gap this very
 * edit changed is indistinguishable by status from one a reviewer has been
 * sitting on for a week. The snapshot is what tells them apart.
 */
export function snapshotOpenGapIds(stepId?: string): ReadonlySet<string> {
  const gaps = useGapsStore.getState().gaps
  return new Set(
    gaps
      .filter(g => g.status === 'Open' && (stepId === undefined || g.stepId === stepId))
      .map(g => g.id)
  )
}

/**
 * Rewrite the gaps a completed step write has made stale.
 *
 * Reads steps and gaps live rather than from a caller's props: the write may
 * have moved gaps to Review (#88), and a reorder moved the neighbours' orders
 * too, so any list captured before the write now describes a layout that no
 * longer exists. The store is the only post-write truth.
 *
 * `milestoneWide` follows the same rule the grid established: an order edit
 * re-decides "is first", "is last" and every chain check for the whole
 * milestone, not just the immediate neighbours (#291), while a field edit only
 * changes the step it touched.
 *
 * Milestones come from the live store alongside the steps, because "first" and
 * "last" now rank on `(milestone.order, step.order)` (#344) — a stale milestone
 * list would rank a step into the wrong end of the process.
 */
export async function resyncGapsAfterStepWrite({
  stepId,
  projectId,
  milestoneWide = false,
  fallbackMilestoneId,
  wasOpen,
}: {
  stepId: string
  projectId: string
  milestoneWide?: boolean
  fallbackMilestoneId?: string
  wasOpen?: ReadonlySet<string>
}): Promise<StepWriteResync> {
  const liveSteps = useStepsStore.getState().steps
  const liveMilestones = milestonesById(useStepsStore.getState().milestones)
  const liveGaps = useGapsStore.getState().gaps
  const editedStep = liveSteps.find(s => s.id === stepId)

  const stepsToResync = milestoneWide
    ? liveSteps.filter(s => s.milestoneId === (editedStep?.milestoneId ?? fallbackMilestoneId))
    : editedStep
      ? [editedStep]
      : []

  const plans = planGapResync(stepsToResync, liveSteps, liveGaps, liveMilestones, wasOpen)
  const syncedGapIds = new Set<string>()
  for (const plan of plans) {
    try {
      await useGapsStore.getState().updateGap(plan.gapId, {
        missingField: plan.missingField,
        observed: plan.observed,
        expected: plan.expected,
      }, projectId, { silent: true })
      syncedGapIds.add(plan.gapId)
    } catch (error) {
      // One gap failing does not invalidate the rest of the plan, and the store
      // has already told the user. Carrying on stops a single bad row leaving
      // every other sibling stale as well.
      logger.error('Failed to re-sync a gap after a step write', error)
    }
  }

  return {
    syncedCount: syncedGapIds.size,
    syncedGapIds,
    editedStep,
    openGapsForStep: liveGaps.filter(g => g.stepId === stepId && g.status === 'Open'),
    isValid: editedStep ? validateStep(editedStep, liveSteps, liveMilestones).isValid : undefined,
  }
}
