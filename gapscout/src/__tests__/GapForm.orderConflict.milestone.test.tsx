/**
 * #311: GapForm's process-gap conflict check is scoped to a milestone.
 *
 * `steps."order"` restarts at 1 inside every milestone (#299), so matching a
 * process gap's order against every step in the project reported a conflict
 * with an unrelated milestone's step — and accepting "Place Before" renumbered
 * the whole project rather than the one milestone the gap sits in.
 *
 * Mocks db.ts at the module boundary; the real Zustand stores and GapForm run
 * their actual logic, same pattern as GapForm.submit.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({
  default: Object.assign((msg: string) => toastSuccess(msg), {
    success: toastSuccess,
    error: toastError,
  }),
}));

vi.mock("../services/db", () => ({
  createGap: vi.fn().mockResolvedValue("gap-new"),
  getGap: vi.fn().mockResolvedValue(null),
  updateGap: vi.fn().mockResolvedValue(undefined),
  updateStep: vi.fn().mockResolvedValue(undefined),
  deleteGap: vi.fn().mockResolvedValue(undefined),
  listGaps: vi.fn().mockResolvedValue([]),
  listGapsByStep: vi.fn().mockResolvedValue([]),
  listSteps: vi.fn().mockResolvedValue([]),
  listTeams: vi.fn().mockResolvedValue([]),
  listMilestones: vi.fn().mockResolvedValue([]),
  setStepOrders: vi.fn().mockResolvedValue(undefined),
  setGapOrders: vi.fn().mockResolvedValue(undefined),
}));

import { createGap, updateStep, listSteps, setStepOrders } from "../services/db";
import GapForm from "../components/Gaps/GapForm";
import { useStepsStore } from "../state/stepsStore";
import { useTeamsStore } from "../state/teamsStore";
import { useGapsStore } from "../state/gapsStore";
import { resealAfterMutation } from "../state/sequenceOps";
import { beginProjectScope, clearProjectScope } from "../state/workspaceScope";
import type { Gap, Step } from "../data/types";

const mockedCreateGap = vi.mocked(createGap);
const mockedUpdateStep = vi.mocked(updateStep);
const mockedListSteps = vi.mocked(listSteps);
const mockedSetStepOrders = vi.mocked(setStepOrders);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function step(id: string, milestoneId: string, order: number): Step {
  return {
    id,
    projectId: "project-1",
    label: `Step ${id}`,
    teamId: "team-1",
    milestoneId,
    order,
    suppliers: [],
    inputs: [],
    outputs: [],
    customers: [],
    systems: [],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

/** Two milestones, each numbering its own steps from 1 — the #299 shape. */
const steps: Step[] = [
  step("ms1-first", "milestone-1", 1),
  step("ms1-second", "milestone-1", 2),
  step("ms2-first", "milestone-2", 1),
  step("ms2-second", "milestone-2", 2),
];

function renderProcessGapForm(milestoneId: string, order: number, displayOrder?: number) {
  const onClose = vi.fn();
  render(
    <GapForm
      projectId="project-1"
      isOpen={true}
      onClose={onClose}
      mode="create"
      prefilledOrder={order}
      prefilledDisplayOrder={displayOrder}
      prefilledMilestoneId={milestoneId}
    />
  );

  // A process gap has no step to auto-detect from, so pick the field by hand.
  fireEvent.click(screen.getAllByRole("radio", { name: /supplier/i })[0]!);
  fireEvent.change(
    screen.getByPlaceholderText("What do we currently see? What is the problem?"),
    { target: { value: "Missing a step here" } }
  );
  fireEvent.change(
    screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
    { target: { value: "The step is documented" } }
  );
  fireEvent.click(screen.getByRole("button", { name: "Save gap" }));
  return { onClose };
}

describe("GapForm process-gap order conflicts are milestone-scoped (#311)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProjectScope();
    beginProjectScope("project-1");
    mockedCreateGap.mockResolvedValue("gap-new");
    mockedUpdateStep.mockResolvedValue(undefined as never);
    mockedListSteps.mockResolvedValue(steps as never);

    useStepsStore.setState({
      steps,
      currentProjectId: "project-1",
      isLoading: false,
    });
    useTeamsStore.setState({ teams: [], currentProjectId: null, isLoading: false });
    useGapsStore.setState({ gaps: [], currentProjectId: "project-1", isLoading: false });
  });

  it("does not report a conflict against another milestone's step", async () => {
    // Order 1 is taken in both milestone-1 and milestone-2, but this gap sits in
    // milestone-3, which has no steps at all. Before #311 the project-wide match
    // found ms1-first and raised "Order Conflict Detected".
    renderProcessGapForm("milestone-3", 1);

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    expect(mockedCreateGap.mock.calls[0]?.[0]).toMatchObject({
      order: 1,
      milestoneId: "milestone-3",
    });
    expect(screen.queryByText("Order Conflict Detected")).toBeNull();
  });

  it("still reports a conflict inside the gap's own milestone", async () => {
    renderProcessGapForm("milestone-2", 1);

    await waitFor(() =>
      expect(screen.getByText("Order Conflict Detected")).toBeInTheDocument()
    );
    expect(screen.getByText("Step 1: Step ms2-first")).toBeInTheDocument();
    expect(mockedCreateGap).not.toHaveBeenCalled();
  });

  it("shifts only the conflicting milestone's steps on Place Before", async () => {
    const { onClose } = renderProcessGapForm("milestone-2", 1);

    await waitFor(() =>
      expect(screen.getByText("Order Conflict Detected")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText("Place before (position 1)"));

    // Must finish — not only call createGap. Passing createGapDirectly as the
    // openSlot write nested a reseal under the same milestone lock and hung
    // forever on Saving… (#484). Waiting for onClose is what catches that.
    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    // One statement naming exactly milestone-2's rows, rather than a per-step
    // `updateStep` loop reading the component's `steps` prop — which moved no
    // process gaps at all and could tear halfway (#307, #350).
    expect(mockedSetStepOrders).toHaveBeenCalledWith("project-1", [
      { id: "ms2-first", order: 2 },
      { id: "ms2-second", order: 3 },
    ]);
    expect(mockedUpdateStep).not.toHaveBeenCalled();
    // milestone-1's numbering is untouched — the bug renumbered it too.
    const shiftedIds = mockedSetStepOrders.mock.calls.flatMap((call) =>
      call[1].map((assignment) => assignment.id)
    );
    expect(shiftedIds.some((id) => id.startsWith("ms1-"))).toBe(false);

    // One toast folds create + shift (#484 Expected). Two steps at/after the
    // insert point → "shifted 2 rows", not a separate "Gap created".
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Gap created — shifted 2 rows");
    expect(toastError).not.toHaveBeenCalled();

    // The hang wedged the milestone chain for the rest of the process. A
    // follow-up reseal on the same key must still resolve (#484).
    await expect(
      resealAfterMutation({ projectId: "project-1", milestoneIds: ["milestone-2"] })
    ).resolves.toMatchObject({ syncedCount: expect.any(Number) });
  });

  it("does not toast or close when Place before's scope goes stale mid-open (#485)", async () => {
    // openSlotForInsert re-closes the slot and returns without calling `write`
    // when the project scope expires mid-operation. GapForm must not treat that
    // return as success — otherwise it toasts "Gap created" for a gap that
    // never landed and closes the form.
    const held = deferred<void>();
    mockedSetStepOrders.mockReturnValueOnce(held.promise as never);

    const { onClose } = renderProcessGapForm("milestone-2", 1);

    await waitFor(() =>
      expect(screen.getByText("Order Conflict Detected")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText("Place before (position 1)"));

    await waitFor(() => expect(mockedSetStepOrders).toHaveBeenCalled());
    beginProjectScope("project-2");
    held.resolve(undefined);

    // finally clears submitting once openSlotForInsert returns (write skipped).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save gap" })).toBeEnabled()
    );

    expect(mockedCreateGap).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  function existingGapIn(milestoneId: string): Gap {
    return {
      id: "gap-existing",
      projectId: "project-1",
      observed: `A gap in ${milestoneId}`,
      expected: "No gap",
      severity: "M",
      status: "Open",
      order: 1,
      milestoneId,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
  }

  it("does not report a conflict against another milestone's process gap", async () => {
    useGapsStore.setState({
      gaps: [existingGapIn("milestone-1")],
      currentProjectId: "project-1",
      isLoading: false,
    });

    renderProcessGapForm("milestone-3", 1);

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Order Conflict Detected")).toBeNull();
  });

  it("still reports a conflict against a process gap in its own milestone", async () => {
    // The positive half of the pair: without it, deleting the gap-vs-gap check
    // outright would leave the negative case above green.
    useGapsStore.setState({
      gaps: [existingGapIn("milestone-3")],
      currentProjectId: "project-1",
      isLoading: false,
    });

    renderProcessGapForm("milestone-3", 1);

    await waitFor(() =>
      expect(screen.getByText("Order Conflict Detected")).toBeInTheDocument()
    );
    expect(screen.getByText("Gap 1: A gap in milestone-3")).toBeInTheDocument();
    expect(mockedCreateGap).not.toHaveBeenCalled();
  });
});

/**
 * #333: the conflict modal named a row by `step.order`, the stored
 * per-milestone value. The Discovery grid's All Steps view numbers rows by the
 * running position from `runningNumbers`, so the modal cited a number that
 * appears nowhere on screen. The grid now passes the number the row is showing
 * and the form names positions with it — as the insertion toast already does
 * (#303).
 */
describe("GapForm names the position the grid is showing (#333)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateGap.mockResolvedValue("gap-new");
    mockedUpdateStep.mockResolvedValue(undefined as never);
    mockedListSteps.mockResolvedValue(steps as never);

    useStepsStore.setState({
      steps,
      currentProjectId: "project-1",
      isLoading: false,
    });
    useTeamsStore.setState({ teams: [], currentProjectId: null, isLoading: false });
    useGapsStore.setState({ gaps: [], currentProjectId: null, isLoading: false });
  });

  // milestone-2's step 1 is the third row of the whole process, so the grid's
  // `#` column shows 3 for the row this gap is going onto.
  it("cites the running position throughout the conflict modal", async () => {
    renderProcessGapForm("milestone-2", 1, 3);

    await waitFor(() =>
      expect(screen.getByText("Order Conflict Detected")).toBeInTheDocument()
    );
    expect(screen.getByText("Step 3: Step ms2-first")).toBeInTheDocument();
    expect(screen.queryByText("Step 1: Step ms2-first")).toBeNull();
    expect(screen.getByText("Place before (position 3)")).toBeInTheDocument();
    expect(screen.getByText("Place after (position 4)")).toBeInTheDocument();
  });

  // Both of them: the modal's own subtitle and the blue panel inside it. They
  // sit one above the other, so one converted and one left behind reads as two
  // different positions for the same gap — which is how the miss was caught, in
  // the running app rather than here.
  it("names the same position in the modal subtitle and the form header", () => {
    renderProcessGapForm("milestone-2", 1, 3);

    expect(screen.getAllByText("Process gap at position 3")).toHaveLength(2);
    expect(screen.queryByText("Process gap at position 1")).toBeNull();
  });

  it("still writes the stored order, not the position it shows", async () => {
    renderProcessGapForm("milestone-3", 1, 3);

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    expect(mockedCreateGap.mock.calls[0]?.[0]).toMatchObject({
      order: 1,
      milestoneId: "milestone-3",
    });
  });

  it("falls back to the stored order when the grid supplies no position", async () => {
    // The single-milestone view, and every caller with no grid behind it: the
    // `#` column shows the stored order there, so the form has to as well.
    renderProcessGapForm("milestone-2", 1);

    await waitFor(() =>
      expect(screen.getByText("Order Conflict Detected")).toBeInTheDocument()
    );
    expect(screen.getByText("Step 1: Step ms2-first")).toBeInTheDocument();
    expect(screen.getByText("Place before (position 1)")).toBeInTheDocument();
  });
});
