import { describe, expect, it } from "vitest";
import {
  getProcessGapsToShiftAfterGapDeletion,
  getStepsToShiftAfterGapDeletion,
} from "../lib/gapDeletion";
import type { Gap } from "../data/types";

const steps = [
  { id: "step-a", order: 2, milestoneId: "milestone-a" },
  { id: "step-b", order: 2, milestoneId: "milestone-b" },
  { id: "step-new", order: 3, milestoneId: "milestone-a", _isNew: true },
];

describe("getStepsToShiftAfterGapDeletion", () => {
  it("shifts only persisted later steps in the deleted gap milestone", () => {
    expect(
      getStepsToShiftAfterGapDeletion(steps, { order: 1, milestoneId: "milestone-a" }).map((step) => step.id)
    ).toEqual(["step-a"]);
  });

  it("does not shift one-based steps after deleting an order-zero gap", () => {
    expect(
      getStepsToShiftAfterGapDeletion(steps, { order: 0, milestoneId: "milestone-a" })
    ).toEqual([]);
  });
});

const gaps: Pick<Gap, "id" | "order" | "milestoneId" | "stepId" | "status">[] = [
  { id: "gap-a", order: 2, milestoneId: "milestone-a", status: "Open" },
  { id: "gap-b", order: 3, milestoneId: "milestone-a", status: "Open" },
  { id: "gap-other", order: 3, milestoneId: "milestone-b", status: "Open" },
  { id: "gap-closed", order: 4, milestoneId: "milestone-a", status: "Closed" },
  { id: "gap-on-step", order: 4, milestoneId: "milestone-a", status: "Open", stepId: "step-a" },
];

describe("getProcessGapsToShiftAfterGapDeletion", () => {
  it("shifts only later open process gaps in the deleted gap milestone", () => {
    expect(
      getProcessGapsToShiftAfterGapDeletion(gaps, {
        id: "gap-a",
        order: 2,
        milestoneId: "milestone-a",
      }).map((gap) => gap.id)
    ).toEqual(["gap-b"]);
  });

  it("does not shift the gap being deleted", () => {
    expect(
      getProcessGapsToShiftAfterGapDeletion(gaps, {
        id: "gap-b",
        order: 3,
        milestoneId: "milestone-a",
      }).map((gap) => gap.id)
    ).toEqual([]);
  });

  it("does not shift after deleting an order-zero gap", () => {
    expect(
      getProcessGapsToShiftAfterGapDeletion(gaps, {
        id: "gap-zero",
        order: 0,
        milestoneId: "milestone-a",
      })
    ).toEqual([]);
  });

  it("shifts nothing for a gap with no milestone, which the SQL cannot match either", () => {
    expect(
      getProcessGapsToShiftAfterGapDeletion(gaps, {
        id: "gap-loose",
        order: 1,
        milestoneId: undefined,
      })
    ).toEqual([]);
  });
});
