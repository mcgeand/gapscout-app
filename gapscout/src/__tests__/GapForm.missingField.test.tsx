/**
 * #181: the Create Gap form's "Missing SIPOC Field" control is single-select.
 *
 * `gaps.missing_field` is a single-valued column
 * (`CHECK(missing_field IN ('supplier','input','output','customer'))`), and PRD §4.7.1
 * specifies one Missing Field per gap. The form used checkboxes and submitted
 * `missingFields[0]`, so a second tick was accepted by the UI and silently dropped on
 * save. These tests pin the control to radio semantics: what the form shows selected is
 * what reaches `createGap`/`updateGap`.
 *
 * Mocks db.ts at the module boundary; the real Zustand store + GapForm component
 * exercise their actual logic (same pattern as GapForm.submit.test.tsx).
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
}));

import { createGap, getGap, updateGap } from "../services/db";
import GapForm from "../components/Gaps/GapForm";
import { useStepsStore } from "../state/stepsStore";
import { useTeamsStore } from "../state/teamsStore";
import { useGapsStore } from "../state/gapsStore";
import type { Step } from "../data/types";

const mockedCreateGap = vi.mocked(createGap);
const mockedGetGap = vi.mocked(getGap);
const mockedUpdateGap = vi.mocked(updateGap);

/**
 * The 2026-08-31 QA repro: a step with neither an output nor a customer, so
 * detectMissingSIPOCFields returns ['output', 'customer'] — two fields, one column.
 */
const stepMissingOutputAndCustomer: Step = {
  id: "step-1",
  projectId: "project-1",
  label: "Receive purchase request",
  teamId: "team-1",
  milestoneId: "milestone-1",
  order: 2,
  suppliers: ["Requester"],
  inputs: ["Purchase request"],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 1,
  updatedAt: 1,
};

/** Missing only 'supplier' — nothing it lacks overlaps with step-1's two. */
const stepMissingSupplier: Step = {
  ...stepMissingOutputAndCustomer,
  id: "step-2",
  label: "Approve purchase request",
  order: 3,
  suppliers: [],
  outputs: ["Approved request"],
  customers: ["Finance"],
};

/** Missing 'customer' too, so a pick of 'customer' on step-1 still applies here. */
const stepMissingCustomer: Step = {
  ...stepMissingOutputAndCustomer,
  id: "step-3",
  label: "Issue purchase order",
  order: 4,
  outputs: ["Purchase order"],
  customers: [],
};

function selectStep(stepId: string) {
  fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: stepId } });
}

function fillRequiredText() {
  fireEvent.change(
    screen.getByPlaceholderText("What do we currently see? What is the problem?"),
    { target: { value: "No output is recorded for this step" } }
  );
  fireEvent.change(
    screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
    { target: { value: "The step records its output and downstream customer" } }
  );
}

describe("GapForm — one missing SIPOC field per gap (#181)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetGap.mockResolvedValue(null as never);
    useStepsStore.setState({
      steps: [stepMissingOutputAndCustomer, stepMissingSupplier, stepMissingCustomer],
      currentProjectId: "project-1",
      isLoading: false,
    });
    useTeamsStore.setState({ teams: [], currentProjectId: null, isLoading: false });
    useGapsStore.setState({ gaps: [], currentProjectId: null, isLoading: false });
  });

  it("offers the four SIPOC fields as radios, not checkboxes", () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledStepId="step-1"
      />
    );

    expect(screen.getAllByRole("radio", { name: /supplier|input|output|customer/i })).toHaveLength(4);
  });

  it("pre-selects the first auto-detected field in SIPOC order and badges every detected one", () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledStepId="step-1"
      />
    );

    // supplier → input → output → customer: 'output' comes first of the two detected.
    expect(screen.getByRole("radio", { name: /output/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /customer/i })).not.toBeChecked();
    // Both are still surfaced as auto-detected so the user can see the step lacks two.
    expect(screen.getAllByText("Auto-detected")).toHaveLength(2);
  });

  it("replaces the selection instead of adding to it, and stores what is shown", async () => {
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="create"
        prefilledStepId="step-1"
      />
    );

    // The QA repro: 'output' is pre-selected, the user also wants 'customer'.
    fireEvent.click(screen.getByRole("radio", { name: /customer/i }));

    expect(screen.getByRole("radio", { name: /customer/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /output/i })).not.toBeChecked();

    fillRequiredText();
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    // Before #181 this stored 'output' — the first entry of the checkbox array.
    expect(mockedCreateGap.mock.calls[0]?.[0]).toMatchObject({ missingField: "customer" });
  });

  it("re-proposes when the picked field is not missing on the newly chosen step", () => {
    render(
      <GapForm projectId="project-1" isOpen={true} onClose={vi.fn()} mode="create" />
    );

    selectStep("step-1");
    expect(screen.getByRole("radio", { name: /output/i })).toBeChecked();

    // step-2 has an output and a customer; carrying 'output' over would offer a field
    // the step already has.
    selectStep("step-2");
    expect(screen.getByRole("radio", { name: /supplier/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /output/i })).not.toBeChecked();
  });

  it("keeps a pick that still applies to the newly chosen step", () => {
    render(
      <GapForm projectId="project-1" isOpen={true} onClose={vi.fn()} mode="create" />
    );

    selectStep("step-1");
    fireEvent.click(screen.getByRole("radio", { name: /customer/i }));

    // step-3 is missing 'customer' as well, so the deliberate pick survives.
    selectStep("step-3");
    expect(screen.getByRole("radio", { name: /customer/i })).toBeChecked();
  });

  it("clears the selection when the step is deselected", () => {
    render(
      <GapForm projectId="project-1" isOpen={true} onClose={vi.fn()} mode="create" />
    );

    selectStep("step-1");
    expect(screen.getByRole("radio", { name: /output/i })).toBeChecked();

    selectStep("");
    for (const radio of screen.getAllByRole("radio", { name: /supplier|input|output|customer/i })) {
      expect(radio).not.toBeChecked();
    }
    expect(screen.getByRole("button", { name: "Save gap" })).toBeDisabled();
  });

  it("pre-selects the stored field when editing an existing gap", () => {
    const existingGap = {
      id: "gap-1",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Current state",
      expected: "Expected state",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "input" as const,
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
        gap={existingGap}
      />
    );

    expect(screen.getByRole("radio", { name: /input/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /supplier/i })).not.toBeChecked();
  });

  it("submits the re-picked field when editing", async () => {
    const existingGap = {
      id: "gap-1",
      projectId: "project-1",
      stepId: "step-1",
      observed: "Current state",
      expected: "Expected state",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "input" as const,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    };
    mockedUpdateGap.mockResolvedValue({ ...existingGap, missingField: "supplier" } as never);
    render(
      <GapForm
        projectId="project-1"
        isOpen={true}
        onClose={vi.fn()}
        mode="edit"
        gap={existingGap}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /supplier/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedUpdateGap).toHaveBeenCalledTimes(1));
    expect(mockedUpdateGap.mock.calls[0]?.[1]).toMatchObject({ missingField: "supplier" });
  });

  it("blocks submission until a field is picked", async () => {
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

    // A process gap has no step, so nothing is auto-detected and nothing is pre-selected.
    for (const radio of screen.getAllByRole("radio", { name: /supplier|input|output|customer/i })) {
      expect(radio).not.toBeChecked();
    }

    fillRequiredText();
    // Everything else is filled, so the missing field is the only thing holding it back.
    const submit = screen.getByRole("button", { name: "Save gap" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(mockedCreateGap).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: /supplier/i }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    expect(mockedCreateGap.mock.calls[0]?.[0]).toMatchObject({ missingField: "supplier" });
  });
});
