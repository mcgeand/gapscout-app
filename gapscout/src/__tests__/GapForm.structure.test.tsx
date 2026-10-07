/**
 * #217: GapForm is two sections — "the gap" (what a save refuses to go without)
 * and "triage" (what you can decide later) — and three of triage's controls
 * stopped being selects.
 *
 * Two things are worth a test here and the rest is styling. The first is that
 * the split is real: a field is in one section or the other, not merely under a
 * heading that says so. The second is that Severity, Priority and Root cause
 * still write what they show — a select and a radio group agree on nothing at
 * the DOM level, and `GapForm.submit`'s clearing test used to address them by
 * their index among the comboboxes, which a restructure can satisfy while
 * writing the wrong field.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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

import { createGap, getGap } from "../services/db";
import GapForm from "../components/Gaps/GapForm";
import { useStepsStore } from "../state/stepsStore";
import { useTeamsStore } from "../state/teamsStore";
import { useGapsStore } from "../state/gapsStore";
import type { Step } from "../data/types";

const mockedCreateGap = vi.mocked(createGap);

const testStep: Step = {
  id: "step-1",
  projectId: "project-1",
  label: "Receive purchase request",
  teamId: "team-1",
  milestoneId: "milestone-1",
  order: 2,
  suppliers: [],
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

/** The <section> a heading owns, so membership can be asserted rather than order. */
function sectionFor(heading: string): HTMLElement {
  const title = screen.getByText(heading);
  const section = title.closest("section");
  if (!section) throw new Error(`No <section> around "${heading}"`);
  return section;
}

function fillRequiredText() {
  fireEvent.change(
    screen.getByPlaceholderText("What do we currently see? What is the problem?"),
    { target: { value: "No supplier is recorded" } }
  );
  fireEvent.change(
    screen.getByPlaceholderText("What should we see? What is the ideal outcome?"),
    { target: { value: "The supplier is named on the step" } }
  );
}

function renderCreateForm() {
  render(
    <GapForm
      projectId="project-1"
      isOpen
      onClose={vi.fn()}
      mode="create"
      prefilledStepId="step-1"
    />
  );
}

describe("GapForm — the gap, then triage (#217)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGap).mockResolvedValue({
      id: "gap-new",
      projectId: "project-1",
      stepId: "step-1",
      observed: "No supplier is recorded",
      expected: "The supplier is named on the step",
      severity: "M" as const,
      status: "Open" as const,
      missingField: "supplier" as const,
      links: [],
      createdAt: 1,
      updatedAt: 1,
    } as never);
    useStepsStore.setState({ steps: [testStep], currentProjectId: "project-1", isLoading: false });
    useTeamsStore.setState({ teams: [], currentProjectId: null, isLoading: false });
    useGapsStore.setState({ gaps: [], currentProjectId: null, isLoading: false });
  });

  it("puts every field a save requires under 'The gap', and the rest under 'Triage'", () => {
    renderCreateForm();

    const required = sectionFor("The gap");
    expect(within(required).getByLabelText(/Observed/)).toBeInTheDocument();
    expect(within(required).getByLabelText(/Expected/)).toBeInTheDocument();
    expect(
      within(required).getAllByRole("radio", { name: /supplier|input|output|customer/i })
    ).toHaveLength(4);

    const deferred = sectionFor("Triage");
    expect(within(deferred).getByLabelText("Owner team")).toBeInTheDocument();
    expect(within(deferred).getByLabelText("Time to fix")).toBeInTheDocument();
    expect(within(deferred).getByPlaceholderText("Proposed solution or next steps...")).toBeInTheDocument();
    expect(within(deferred).getByRole("radio", { name: "1 — critical" })).toBeInTheDocument();
    expect(within(deferred).getByRole("radio", { name: "Config — configuration issue" })).toBeInTheDocument();

    // The two sections say what they are for, and neither is behind a
    // disclosure — the block this replaced was "Additional Details (Optional)".
    expect(screen.getByText("Required to save")).toBeInTheDocument();
    expect(screen.getByText("All optional — fill it in when you review")).toBeInTheDocument();
    expect(screen.queryByText(/Additional Details/i)).not.toBeInTheDocument();
  });

  it("leaves triage empty and still saves", async () => {
    renderCreateForm();
    fillRequiredText();
    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    expect(mockedCreateGap.mock.calls[0]?.[0]).toMatchObject({
      severity: "M",
      priority: undefined,
      rootCause: undefined,
      timeToFix: undefined,
    });
  });

  it("writes what the three converted controls show", async () => {
    renderCreateForm();
    fillRequiredText();

    // Severity defaults to Med and is the one control here that is never null.
    expect(screen.getByRole("radio", { name: "Med — notable impact" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "High — critical issue" }));
    fireEvent.click(screen.getByRole("radio", { name: "3 — medium" }));
    fireEvent.click(screen.getByRole("radio", { name: "Behavior — human behavior" }));

    fireEvent.click(screen.getByRole("button", { name: "Save gap" }));

    await waitFor(() => expect(mockedCreateGap).toHaveBeenCalledTimes(1));
    expect(mockedCreateGap.mock.calls[0]?.[0]).toMatchObject({
      severity: "H",
      priority: 3,
      rootCause: "Behavior",
    });
    expect(screen.getByRole("radio", { name: "High — critical issue" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Med — notable impact" })).not.toBeChecked();
  });

  it("carries no glyph in the submit label", () => {
    renderCreateForm();
    const submit = screen.getByRole("button", { name: "Save gap" });
    expect(submit.textContent).toBe("Save gap");
    // The dialog title and the button are different strings on purpose: with
    // both reading "Create Gap" a getByText would match two nodes and throw.
    expect(screen.getByText("New gap")).toBeInTheDocument();
  });

  it("adds the close block only when editing an open gap", () => {
    const { unmount } = render(
      <GapForm
        projectId="project-1"
        isOpen
        onClose={vi.fn()}
        mode="edit"
        gap={{
          id: "gap-1",
          projectId: "project-1",
          stepId: "step-1",
          observed: "Observed",
          expected: "Expected",
          severity: "M",
          status: "Open",
          missingField: "supplier",
          links: [],
          createdAt: 1,
          updatedAt: 1,
        }}
      />
    );
    expect(screen.getByText("Close this gap")).toBeInTheDocument();
    unmount();

    renderCreateForm();
    expect(screen.queryByText("Close this gap")).not.toBeInTheDocument();
  });
});
