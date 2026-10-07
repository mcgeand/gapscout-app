/**
 * Splitting an inline-editor patch into the two writes it actually needs.
 *
 * `order` is not a plain field. It names a position in a sequence, so it goes
 * through `reorderSteps`, which slides the steps it displaces and leaves the
 * milestone a gap-free 1..n; writing it raw left duplicates and holes (#290).
 * Everything else is a field write. The autosave debounce MERGES patches
 * (`lib/autosave.ts`), so a single patch can carry both halves — they are not
 * alternatives, and every path that persists a pending patch has to make the
 * same split or one half goes missing.
 */

import type { Step } from '../data/types'

export interface StepPatchSplit {
  /** Everything but `order`, safe to hand to `updateStep`. */
  fieldUpdates: Partial<Step>
  /** The order to move to, or null when the patch does not move the step. */
  nextOrder: number | null
}

export function splitStepPatch(
  updates: Partial<Step>,
  currentOrder: number
): StepPatchSplit {
  const { order, ...fieldUpdates } = updates
  return {
    fieldUpdates,
    nextOrder: order !== undefined && order !== currentOrder ? order : null,
  }
}
