/**
 * Gap re-sync after a step edit
 *
 * An open gap records what a step was missing when it was raised. Editing the
 * step can change that answer — and an order edit changes it for the step's
 * SIBLINGS too, because `validateStep` decides "first" and "last" from where a
 * step ranks in the whole process (#344), and chain breaks from the next one to
 * three steps in its milestone. Any of those can flip anywhere in the range a
 * reorder shifts, not just at the immediate neighbours (#291).
 *
 * The pure half lives here so the rule can be tested without a database, and so
 * the Discovery grid's inline editor and its Save tray cannot drift apart on
 * what an order edit is supposed to rewrite.
 */

import type { Gap, Milestone, MissingFieldType, Step } from '../data/types'
import { validateStep } from './sipocValidator'

/** The patch a gap needs to describe its step's current validation state. */
export interface GapResync {
  gapId: string
  missingField: MissingFieldType
  observed: string
  expected: string
}

/**
 * Stamped on every gap this rule writes, and the marker that identifies one it
 * may write again. Chain-break gaps carry their own `expected` and a
 * user-authored gap carries whatever the user typed; neither is ours to rewrite.
 */
const EXPECTED = 'All SIPOC fields should be complete'

/**
 * Which open gaps no longer describe their step, and what they should say.
 *
 * Deliberately narrow, matching the behaviour it was extracted from:
 *
 * - Only gaps attached to one of `steps` that were `Open` when the write began.
 *   A reorder never RAISES a gap on a sibling — that is a product decision no
 *   issue has made. A gap that was already in Review before the write is left
 *   alone; one THIS write promoted is not, because the edit that promoted it is
 *   the same edit that changed what the step is missing. Callers say which is
 *   which by snapshotting the open gap ids before their first await and passing
 *   them as `wasOpen` — after the await `promoteGapsForFilledFields` has already
 *   run, so status alone can no longer tell the two apart (#279).
 * - Only gaps this machinery wrote, identified by the `expected` sentinel it
 *   stamps on them. `GapForm` requires the user to type their own `expected`,
 *   so anything else is hand-authored. This matters more now than it did when
 *   the rule only ever ran against the one step being edited: an order edit
 *   re-syncs a whole milestone, and without the check a step's own gap wording
 *   would be overwritten because a DIFFERENT step moved.
 * - Only gaps whose text would actually change. Without this a single order
 *   edit fires one `updateGap` per sibling per keystroke, which is how #107
 *   started.
 * - A step that has become valid keeps its gap untouched, for the caller to
 *   surface as "consider closing" rather than silently rewrite.
 */
export function planGapResync(
  steps: Step[],
  allSteps: Step[],
  gaps: Gap[],
  milestoneById: Map<string, Milestone>,
  wasOpen?: ReadonlySet<string>
): GapResync[] {
  const plans: GapResync[] = []

  for (const step of steps) {
    const validation = validateStep(step, allSteps, milestoneById)
    if (validation.isValid) continue

    const missingField = validation.missingFields[0] as MissingFieldType
    const observed = `Missing ${validation.missingFields.join(', ')}`

    for (const gap of gaps) {
      if (gap.stepId !== step.id) continue
      if (gap.status !== 'Open' && !wasOpen?.has(gap.id)) continue
      if (gap.expected !== EXPECTED) continue
      if (gap.missingField === missingField && gap.observed === observed) continue
      plans.push({ gapId: gap.id, missingField, observed, expected: EXPECTED })
    }
  }

  return plans
}
