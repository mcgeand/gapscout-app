/**
 * ZIP-395: Regression — empty-string FK fields in GapForm submit coerce to undefined
 *
 * Codifies the ZIP-381/393 safe-pattern: form state uses '' for controlled inputs,
 * but the submit boundary MUST coerce '' → undefined for FK/optional DB columns.
 * Without coerceEmptyToUndefined (ZIP-396), ownerTeamId='' and milestoneId='' would
 * reach createGap as empty strings, violating the NOT NULL FK constraint.
 *
 * Mocks db.ts at the module boundary; the real Zustand store + GapForm component
 * exercise their actual logic (same pattern as PolicyManager.editPath.test.tsx).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../services/db", () => ({
  createGap: vi.fn().mockResolvedValue("gap-new"),
  getGap: vi.fn(),
  updateGap: vi.fn().mockResolvedValue(undefined),
  updateStep: vi.fn().mockResolvedValue(undefined),
  deleteGap: vi.fn().mockResolvedValue(undefined),
  listGaps: vi.fn().mockResolvedValue([]),
  listGapsByStep: vi.fn().mockResolvedValue([]),
  listSteps: vi.fn().mockResolvedValue([]),
  listTeams: vi.fn().mockResolvedValue([]),
  listMilestones: vi.fn().mockResolvedValue([]),
  setGapOrders: vi.fn().mockResolvedValue(undefined),
  setStepOrders: vi.fn().mockResolvedValue(undefined),
}));

import { createGap, getGap, updateGap, updateStep, deleteGap, listGaps, listSteps, setGapOrders, setStepOrders } from "../services/db";
import GapForm from "../components/Gaps/GapForm";
import { useStepsStore } from "../state/stepsStore";
import { useTeamsStore } from "../state/teamsStore";
import { useGapsStore } from "../state/gapsStore";
import type { Gap, Step } from "../data/types";

const mockedCreateGap = vi.mocked(createGap);
const mockedGetGap = vi.mocked(getGap);
const mockedUpdateGap = vi.mocked(updateGap);
const mockedUpdateStep = vi.mocked(updateStep);
const mockedDeleteGap = vi.mocked(deleteGap);
const mockedSetGapOrders = vi.mocked(setGapOrders);
const mockedSetStepOrders = vi.mocked(setStepOrders);

/**
 * The sequence module reads the milestone's live rows from the database rather
 * than from the stores (#353), so a test about what a deletion moves has to
 * seed the same rows on both sides: the stores for what the form renders, and
 * these two for what the reseal measures.
 */
function seedDatabase(steps: Step[], gaps: Gap[]) {
  vi.mocked(listSteps).mockResolvedValue(steps);
  vi.mocked(listGaps).mockResolvedValue(gaps);
}

const testStep: Step = {
  id: "step-1",
  projectId: "project-1",
  label: "Receive purchase request",
  teamId: "team-1",
  milestoneId: "milestone-1",
  order: 2,
  suppliers: [], // empty → detectMissingSIPOCFields returns ['supplier'], making form submittable
  inputs: [],
  outputs: ["Reviewed request"],
  customers: ["Finance"],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("GapForm submit — FK field coercion (ZIP-395)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUpdateGap.mockResolvedValue({
      id: "updated-gap",
      projectId: "project-1",
      observed: "Updated observed state",
      expected: "Updated expected state",
      severity: "M",
      status: "Open",
      links: [],
      createdAt: 1,
      updatedAt: 2,
    } as never);
    mockedGetGap.mockResolvedValue({
      id: "gap-new",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Missing supplier list",
      expected: "Complete supplier list",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "supplier" as const,
      links: [],
      gapIds: [],
      createdAt: 1,
      updatedAt: 1,
    } as never);

    useStepsStore.setState({
      steps: [testStep],
      currentProjectId: "project-1",
      isLoading: false,
    });
    useTeamsStore.setState({ teams: [], currentProjectId: null, isLoading: false });
    useGapsStore.setState({ gaps: [], currentProjectId: null, isLoading: false });
  });

  it("sends ownerTeamId: undefined (not '') when left unselected", async () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledStepId="step-1"
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Missing supplier documentation" } }
    );
    fireEvent.change(
      screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
      { target: { value: "Supplier list is complete and current" } }
    );

    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => {
      expect(mockedCreateGap).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockedCreateGap.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.ownerTeamId).toBeUndefined();
    expect(callArgs.ownerTeamId).not.toBe("");
  });

  it("sends milestoneId: undefined (not '') when no prefilledMilestoneId is given", async () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledStepId="step-1"
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Missing supplier documentation" } }
    );
    fireEvent.change(
      screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
      { target: { value: "Supplier list is complete and current" } }
    );

    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => {
      expect(mockedCreateGap).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockedCreateGap.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.milestoneId).toBeUndefined();
    expect(callArgs.milestoneId).not.toBe("");
  });

  it("sends both ownerTeamId and milestoneId as undefined when both are unset", async () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledStepId="step-1"
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Missing supplier documentation" } }
    );
    fireEvent.change(
      screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
      { target: { value: "Supplier list is complete and current" } }
    );

    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => {
      expect(mockedCreateGap).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockedCreateGap.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.ownerTeamId).toBeUndefined();
    expect(callArgs.milestoneId).toBeUndefined();
  });

  it("preserves a closed status when editing a gap", async () => {
    const closedGap = {
      id: "gap-closed",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Missing supplier list",
      expected: "Complete supplier list",
      severity: "M" as const,
      status: "Closed" as const,
      missingField: "supplier" as const,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="edit"
        gap={closedGap}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Updated observed state" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedUpdateGap).toHaveBeenCalledTimes(1));
    expect(mockedUpdateGap).toHaveBeenCalledWith("gap-closed", expect.anything(), "project-1");
    expect(mockedUpdateGap.mock.calls[0]?.[1]).toMatchObject({ status: "Closed" });
    expect(mockedUpdateGap.mock.calls[0]?.[1]).not.toHaveProperty("projectId");
  });

  it("replaces the local gap with the canonical row returned by update", async () => {
    const existingGap = {
      id: "gap-canonical",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Current state",
      expected: "Expected state",
      severity: "M" as const,
      status: "Review" as const,
      missingField: "supplier" as const,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const canonicalGap = { ...existingGap, observed: "Canonical state", order: 0, updatedAt: 9 };
    mockedUpdateGap.mockResolvedValueOnce(canonicalGap as never);
    useGapsStore.setState({ gaps: [existingGap] });
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="edit"
        gap={existingGap}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Changed state" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(useGapsStore.getState().gaps[0]).toEqual(canonicalGap));
  });

  it("creates a Process gap at position zero", async () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledOrder={0}
        prefilledMilestoneId="milestone-1"
      />
    );

    expect(screen.getAllByText("Process gap at position 0")).toHaveLength(2);
    // A process gap has no step to auto-detect from, so pick the missing field by hand.
    fireEvent.click(screen.getAllByRole("radio", { name: /supplier/i })[0]!);
    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Missing first process step" } }
    );
    fireEvent.change(
      screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
      { target: { value: "First process step is documented" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    expect(mockedCreateGap.mock.calls[0]?.[0]).toMatchObject({
      order: 0,
      milestoneId: "milestone-1",
    });
  });

  it("sends null for cleared optional values when editing", async () => {
    const gapWithOptionalValues = {
      id: "gap-options",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Current state",
      expected: "Expected state",
      severity: "M" as const,
      priority: 2,
      rootCause: "Config" as const,
      ownerTeamId: "team-1",
      fixIdea: "A workaround",
      timeToFix: "near" as const,
      status: "Review" as const,
      missingField: "supplier" as const,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="edit"
        gap={gapWithOptionalValues}
      />
    );

    // Addressed by label, not by index among the comboboxes: Priority and Root
    // cause are radio groups since #217, and an index-based selector would have
    // silently gone on clearing whichever two controls landed in slots 2 and 3.
    fireEvent.click(screen.getByRole("radio", { name: "None — no priority set" }));
    fireEvent.click(screen.getByRole("radio", { name: "Unknown — to be determined" }));
    fireEvent.change(screen.getByLabelText("Owner team"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Time to fix"), { target: { value: "" } });
    fireEvent.change(
      screen.getByPlaceholderText("Proposed solution or next steps..."),
      { target: { value: "" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedUpdateGap).toHaveBeenCalledTimes(1));
    expect(mockedUpdateGap.mock.calls[0]?.[1]).toMatchObject({
      priority: null,
      rootCause: null,
      ownerTeamId: null,
      fixIdea: null,
      timeToFix: null,
    });
  });

  it("does not shift one-based steps when deleting an order-zero gap", async () => {
    const laterStep = { ...testStep, id: "step-later", order: 1 };
    useStepsStore.setState({ steps: [laterStep], currentProjectId: "project-1", loadSteps: vi.fn() });
    const deletedGap = {
      id: "gap-process-zero",
      projectId: "project-1",
      observed: "Missing first step",
      expected: "First step exists",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "supplier" as const,
      order: 0,
      milestoneId: "milestone-1",
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="edit"
        gap={deletedGap}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Gap" }));
    expect(screen.queryByText(/shift later rows/i)).not.toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete Gap" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!);

    await waitFor(() => expect(mockedDeleteGap).toHaveBeenCalledTimes(1));
    expect(mockedDeleteGap).toHaveBeenCalledWith("gap-process-zero", "project-1");
    // The milestone is dense once the gap has gone, so the reseal writes
    // nothing — the compute-then-diff rule, seen from a call site.
    expect(mockedSetStepOrders).not.toHaveBeenCalled();
    expect(mockedSetGapOrders).not.toHaveBeenCalled();
    expect(mockedUpdateStep).not.toHaveBeenCalled();
    expect(useStepsStore.getState().steps[0]?.order).toBe(1);
  });

  it("renumbers only the deleted gap's own milestone", async () => {
    const milestoneAStep = { ...testStep, id: "step-a-later", milestoneId: "milestone-a", order: 2 };
    const milestoneBStep = { ...testStep, id: "step-b-later", milestoneId: "milestone-b", order: 2 };
    useStepsStore.setState({
      steps: [milestoneAStep, milestoneBStep],
      currentProjectId: "project-1",
      loadSteps: vi.fn(),
    });
    // The gap is already gone from the database by the time the reseal reads,
    // which is the point: the plan is measured against the live sequence, never
    // against a list captured before the delete (#339, #352).
    seedDatabase([milestoneAStep, milestoneBStep], []);
    const deletedGap = {
      id: "gap-milestone-a",
      projectId: "project-1",
      observed: "Missing step",
      expected: "Step exists",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "supplier" as const,
      order: 1,
      milestoneId: "milestone-a",
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
    render(<GapForm projectId="project-1" isOpen={true} onClose={vi.fn()} mode="edit" gap={deletedGap} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Gap" }));
    const deleteButtons = screen.getAllByRole("button", { name: "Delete Gap" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!);

    await waitFor(() => expect(mockedSetStepOrders).toHaveBeenCalledTimes(1));
    expect(mockedDeleteGap).toHaveBeenCalledTimes(1);
    // One statement naming exactly the rows that move, rather than a per-step
    // loop whose partial failure would leave a torn sequence (#343). The step
    // in milestone-b is not in the list, so it is not in the sequence being
    // resealed — the milestone scoping #299 asked for, at this site.
    expect(mockedSetStepOrders).toHaveBeenCalledWith("project-1", [
      { id: "step-a-later", order: 1 },
    ]);
    expect(mockedUpdateStep).not.toHaveBeenCalled();
  });

  /**
   * #312, GapForm's half. A process gap reserves a position in the milestone's
   * sequence exactly as a step does, so deleting one has to move the later gaps
   * with the later steps — the deletion mirror of #307. Without this the step
   * came down onto an order the next gap still held, and the pair read as a
   * parallel branch nobody asked for.
   *
   * Both halves now come out of one plan, so the assertion is that each table
   * got exactly one statement naming exactly the rows that moved.
   */
  it("renumbers the later process gap as well as the later steps", async () => {
    const firstStep = { ...testStep, id: "step-a-first", milestoneId: "milestone-a", order: 1 };
    const laterStep = { ...testStep, id: "step-a-later", milestoneId: "milestone-a", order: 4 };
    useStepsStore.setState({
      steps: [firstStep, laterStep],
      currentProjectId: "project-1",
      loadSteps: vi.fn(),
    });
    const processGap = (id: string, order: number, milestoneId: string): Gap => ({
      id,
      projectId: "project-1",
      observed: `Missing step ${id}`,
      expected: "Step exists",
      severity: "M" as const,
      status: "Open" as const,
      order,
      milestoneId,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const deletedGap = processGap("gap-a", 2, "milestone-a");
    const survivingGap = processGap("gap-b", 3, "milestone-a");
    const elsewhere = processGap("gap-elsewhere", 3, "milestone-b");
    useGapsStore.setState({
      gaps: [deletedGap, survivingGap, elsewhere],
      currentProjectId: "project-1",
      isLoading: false,
    });
    // Milestone-a runs 1, 2 (gap-a), 3 (gap-b), 4 — dense before the delete, so
    // what the reseal writes is attributable to the deletion alone.
    seedDatabase([firstStep, laterStep], [survivingGap, elsewhere]);

    render(<GapForm projectId="project-1" isOpen={true} onClose={vi.fn()} mode="edit" gap={deletedGap} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Gap" }));
    expect(screen.getByText(/shift later rows/i)).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete Gap" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!);

    await waitFor(() => expect(mockedDeleteGap).toHaveBeenCalledTimes(1));
    // The step comes down 4→3, which is exactly the order gap-b has vacated —
    // so the two halves have to move in the same plan or they collide.
    await waitFor(() =>
      expect(mockedSetGapOrders).toHaveBeenCalledWith("project-1", [{ id: "gap-b", order: 2 }])
    );
    expect(mockedSetStepOrders).toHaveBeenCalledWith("project-1", [
      { id: "step-a-later", order: 3 },
    ]);
    expect(mockedSetStepOrders).toHaveBeenCalledTimes(1);
    expect(mockedSetGapOrders).toHaveBeenCalledTimes(1);
    expect(mockedUpdateStep).not.toHaveBeenCalled();
  });

  it("keeps the form open when updating a gap fails", async () => {
    const onClose = vi.fn();
    mockedUpdateGap.mockRejectedValueOnce(new Error("FTS update failed"));
    const editableGap = {
      id: "gap-failure",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Current state",
      expected: "Expected state",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "supplier" as const,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
    render(<GapForm projectId="project-1" isOpen={true} onClose={onClose} mode="edit" gap={editableGap} />);

    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Changed state" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedUpdateGap).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Edit gap")).toBeInTheDocument();
  });
  // #280: the old parser matched from the first letter after a digit, so
  // P2P-42 was confirmed inline and saved as P-42.
  it("confirms and saves a Jira key with a digit in the project key", async () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledStepId="step-1"
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("What do we currently see? What is the problem?"),
      { target: { value: "Missing supplier documentation" } }
    );
    fireEvent.change(
      screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
      { target: { value: "Supplier list is complete and current" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Jira Link" }));
    fireEvent.change(screen.getByLabelText("Jira link URL"), {
      target: { value: "https://acme.atlassian.net/browse/P2P-42" },
    });

    expect(screen.getByText("Ticket: P2P-42")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    const callArgs = mockedCreateGap.mock.calls[0]?.[0] as { links: { label: string }[] };
    expect(callArgs.links.map((link) => link.label)).toEqual(["P2P-42"]);
  });

  it("re-derives a stale Jira label from its URL when editing", async () => {
    const staleGap = {
      id: "gap-stale",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Missing supplier list",
      expected: "Complete supplier list",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "supplier" as const,
      links: [
        {
          id: "l1",
          url: "https://acme.atlassian.net/browse/P2P-42",
          label: "P-42",
          type: "jira" as const,
          createdAt: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    render(
      <GapForm projectId="project-1" isOpen={true} onClose={vi.fn()} mode="edit" gap={staleGap} />
    );

    expect(screen.getByText("Ticket: P2P-42")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedUpdateGap).toHaveBeenCalledTimes(1));
    const changes = mockedUpdateGap.mock.calls[0]?.[1] as { links: { label: string }[] };
    expect(changes.links.map((link) => link.label)).toEqual(["P2P-42"]);
  });
});
