import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStepsStore } from "../state/stepsStore";
import { useGapsStore, defaultFilters } from "../state/gapsStore";
import type { Step, Gap } from "../data/types";

vi.mock("../components/Gaps", () => ({
  GapForm: ({
    isOpen,
    mode,
    prefilledStepId,
    gap,
  }: {
    isOpen: boolean;
    mode: string;
    prefilledStepId?: string | null;
    gap?: Gap | null;
  }) =>
    isOpen ? (
      <div data-testid="gap-form">
        {mode}|{prefilledStepId}|{gap?.id ?? "none"}
      </div>
    ) : null,
  GapFilters: () => null,
  GapsPanel: () => null,
}));

import RightPanel from "../app/layout/RightPanel";

const step: Step = {
  id: "step-1",
  projectId: "project-1",
  label: "Review request",
  teamId: "team-1",
  milestoneId: "milestone-1",
  order: 1,
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

const matchingGap: Gap = {
  id: "gap-1",
  projectId: "project-1",
  stepId: "step-1",
  observed: "No approval trail",
  expected: "Approval trail recorded",
  severity: "M",
  status: "Open",
  links: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const otherMatchingGap: Gap = {
  id: "gap-2",
  projectId: "project-1",
  stepId: "step-1",
  observed: "Second gap for step",
  expected: "Fixed",
  severity: "L",
  status: "Open",
  links: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const otherStepGap: Gap = {
  id: "gap-3",
  projectId: "project-1",
  stepId: "step-999",
  observed: "Belongs to a different step",
  expected: "N/A",
  severity: "H",
  status: "Open",
  links: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const processGap: Gap = {
  id: "gap-process",
  projectId: "project-1",
  observed: "Missing step in flow",
  expected: "Step exists",
  severity: "H",
  status: "Open",
  order: 3,
  milestoneId: "milestone-1",
  links: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("RightPanel step gaps", () => {
  beforeEach(() => {
    useStepsStore.setState({
      currentStep: null,
      clearSelection: vi.fn(),
    });
    useGapsStore.setState({
      gaps: [],
      filters: defaultFilters,
      addGap: vi.fn(),
    });
  });

  it("renders nothing when no step is selected", () => {
    const { container } = render(<RightPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the step label and order when a step is selected", () => {
    useStepsStore.setState({ currentStep: step });
    render(<RightPanel />);
    expect(screen.getByText("Step 1: Review request")).toBeInTheDocument();
  });

  it("shows only gaps whose stepId matches the selected step", () => {
    useStepsStore.setState({ currentStep: step });
    useGapsStore.setState({ gaps: [matchingGap, otherMatchingGap, otherStepGap] });
    render(<RightPanel />);

    expect(screen.getByText("No approval trail")).toBeInTheDocument();
    expect(screen.getByText("Second gap for step")).toBeInTheDocument();
    expect(screen.queryByText("Belongs to a different step")).not.toBeInTheDocument();
  });

  it("does not show a process gap with no stepId", () => {
    useStepsStore.setState({ currentStep: step });
    useGapsStore.setState({ gaps: [processGap] });
    render(<RightPanel />);

    expect(screen.queryByText("Missing step in flow")).not.toBeInTheDocument();
    expect(screen.getByText("No gaps for this step")).toBeInTheDocument();
  });

  it("toggles expand/collapse to reveal gap detail", () => {
    useStepsStore.setState({ currentStep: step });
    useGapsStore.setState({ gaps: [matchingGap] });
    render(<RightPanel />);

    expect(screen.queryByText("Approval trail recorded")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("No approval trail"));
    expect(screen.getByText("Approval trail recorded")).toBeInTheDocument();

    fireEvent.click(screen.getByText("No approval trail"));
    expect(screen.queryByText("Approval trail recorded")).not.toBeInTheDocument();
  });

  it("opens the gap form in create mode prefilled with the selected step", () => {
    useStepsStore.setState({ currentStep: step });
    useGapsStore.setState({ gaps: [] });
    render(<RightPanel />);

    expect(screen.queryByTestId("gap-form")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add gap/i }));
    expect(screen.getByTestId("gap-form")).toHaveTextContent("create|step-1|none");
  });

  it("opens the gap form in edit mode from an expanded gap", () => {
    useStepsStore.setState({ currentStep: step });
    useGapsStore.setState({ gaps: [matchingGap] });
    render(<RightPanel />);

    fireEvent.click(screen.getByText("No approval trail"));
    fireEvent.click(screen.getByRole("button", { name: /edit gap/i }));
    expect(screen.getByTestId("gap-form")).toHaveTextContent("edit|step-1|gap-1");
  });
});
