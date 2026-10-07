import type { Gap, Step } from "../data/types";
import { isProcessGap } from "./stepSequence";

type DeletableStep = Pick<Step, "order" | "milestoneId"> & { _isNew?: boolean };

type DeletableGap = Pick<Gap, "id" | "order" | "milestoneId" | "stepId" | "status">;

export function getStepsToShiftAfterGapDeletion<T extends DeletableStep>(
  steps: T[],
  gap: Pick<Gap, "order" | "milestoneId">
): T[] {
  if (gap.order === undefined || gap.order === 0) return [];

  return steps.filter(
    (step) =>
      !step._isNew &&
      step.milestoneId === gap.milestoneId &&
      step.order > gap.order!
  );
}

/**
 * The process gaps that move down when `gap` is deleted.
 *
 * The companion to `getStepsToShiftAfterGapDeletion`, and the mirror of #307 on
 * the deletion side: a process gap reserves a position in the milestone's
 * sequence exactly as a step does, so a deletion that moves only steps drops a
 * step onto an order a later gap still holds. The pair then share
 * `(milestone_id, "order")` and the grid draws a parallel branch nobody asked
 * for (#312).
 *
 * `isProcessGap` is the same predicate `lib/sequence` ranks on, so what this
 * counts and what the reseal actually moves stay the same set. A gap with no
 * milestone is excluded for that reason too: it belongs to no milestone's
 * sequence, so there is nothing to reseal it into.
 */
export function getProcessGapsToShiftAfterGapDeletion<T extends DeletableGap>(
  gaps: T[],
  gap: Pick<Gap, "id" | "order" | "milestoneId">
): T[] {
  if (gap.order === undefined || gap.order === 0) return [];
  if (gap.milestoneId === undefined) return [];

  return gaps.filter(
    (candidate) =>
      candidate.id !== gap.id &&
      isProcessGap(candidate) &&
      candidate.milestoneId === gap.milestoneId &&
      candidate.order! > gap.order!
  );
}
