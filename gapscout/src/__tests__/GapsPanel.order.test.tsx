import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { defaultFilters, useGapsStore } from "../state/gapsStore";
import { useStepsStore } from "../state/stepsStore";
import { useTeamsStore } from "../state/teamsStore";
import type { Gap } from "../data/types";

vi.mock("../components/Gaps", () => ({
  GapForm: () => null,
  GapFilters: () => null,
}));

import GapsPanel from "../components/Gaps/GapsPanel";

const processGap: Gap = {
  id: "gap-process-zero",
  projectId: "project-1",
  observed: "Missing first process step",
  expected: "First process step exists",
  severity: "M",
  status: "Open",
  order: 0,
  milestoneId: "milestone-1",
  links: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("GapsPanel process gap placement", () => {
  beforeEach(() => {
    useGapsStore.setState({
      gaps: [processGap],
      currentProjectId: "project-1",
      isLoading: false,
      filters: defaultFilters,
      loadGaps: vi.fn(),
    });
    useStepsStore.setState({
      steps: [],
      milestones: [{
        id: "milestone-1",
        projectId: "project-1",
        name: "Intake",
        order: 0,
        relatedPolicies: [],
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    useTeamsStore.setState({ teams: [] });
  });

  it("renders a process gap whose order is zero, at its process position", () => {
    render(<GapsPanel projectId="project-1" />);

    // Stored `order` 0 — the slot before the first step — is process position 1.
    // The panel lists every gap in the project, so it names the running position
    // rather than the per-milestone order (#345). What this still guards is the
    // original defect: a falsy `order` used to drop the row's label entirely.
    expect(screen.getByText("Order 1: Missing first process step")).toBeInTheDocument();
  });
});
