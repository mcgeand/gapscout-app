/**
 * GapsPanel gap table: row rendering, header sorting, click-to-expand quick
 * view, row selection and the bulk status bar.
 *
 * Ticket: #161
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { defaultFilters, useGapsStore } from "../state/gapsStore";
import { useStepsStore } from "../state/stepsStore";
import { useTeamsStore } from "../state/teamsStore";
import type { Gap, GapStatus, Milestone, Step, Team } from "../data/types";

type GapsStoreBulkUpdate = (
  gapIds: string[],
  status: GapStatus,
  explicitProjectId?: string,
) => Promise<{ updated: string[]; failed: string[] }>;

vi.mock("../components/Gaps", () => ({
  GapForm: () => null,
  GapFilters: () => null,
}));

import GapsPanel from "../components/Gaps/GapsPanel";

function makeStep(id: string, order: number, label: string): Step {
  return {
    id,
    projectId: "project-1",
    label,
    teamId: "team-1",
    milestoneId: "milestone-1",
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

const steps: Step[] = [
  makeStep("step-1", 1, "Intake request"),
  makeStep("step-2", 2, "Review request"),
  makeStep("step-3", 3, "Approve request"),
];

const milestone: Milestone = {
  id: "milestone-1",
  projectId: "project-1",
  name: "Delivery",
  order: 0,
  relatedPolicies: [],
  createdAt: 1,
  updatedAt: 1,
};

const team: Team = {
  id: "team-1",
  projectId: "project-1",
  name: "Ops",
  color: "#3B82F6",
  order: 0,
  tags: [],
  createdAt: 1,
};

// Severity and createdAt are chosen so that id-asc, severity-asc and
// severity-desc each produce a different row order.
const alpha: Gap = {
  id: "gap-alpha",
  projectId: "project-1",
  stepId: "step-1",
  observed: "Alpha observed",
  expected: "Alpha expected",
  severity: "H",
  status: "Open",
  links: [],
  createdAt: 100,
  updatedAt: 100,
};

const bravo: Gap = {
  id: "gap-bravo",
  projectId: "project-1",
  stepId: "step-2",
  observed: "Bravo observed",
  expected: "Bravo expected",
  severity: "L",
  status: "Review",
  links: [],
  createdAt: 200,
  updatedAt: 200,
};

const charlie: Gap = {
  id: "gap-charlie",
  projectId: "project-1",
  stepId: "step-3",
  observed: "Charlie observed",
  expected: "Charlie expected",
  severity: "M",
  status: "Closed",
  links: [],
  createdAt: 300,
  updatedAt: 300,
};

function rowOrder(): string[] {
  return Array.from(
    screen.getByTestId("gaps-table").querySelectorAll('[data-testid^="gap-row-"]'),
  ).map((row) => row.getAttribute("data-testid") ?? "");
}

describe("GapsPanel gap table", () => {
  let bulkUpdateStatus: ReturnType<typeof vi.fn<GapsStoreBulkUpdate>>;

  beforeEach(() => {
    // Resolves with the real result shape: the panel destructures `failed` to
    // decide which rows stay selected.
    bulkUpdateStatus = vi.fn().mockResolvedValue({ updated: [], failed: [] });

    useGapsStore.setState({
      gaps: [alpha, bravo, charlie],
      currentProjectId: "project-1",
      isLoading: false,
      // The store default hides everything but Open; clear it so the Review and
      // Closed fixtures are visible.
      filters: { ...defaultFilters, statuses: [] },
      // Seeded explicitly: `sort` is module-singleton state that earlier header
      // clicks would otherwise leak into the next test.
      sort: { column: "id", direction: "asc" },
      loadGaps: vi.fn(),
      bulkUpdateStatus,
    });
    useStepsStore.setState({ steps, milestones: [milestone] });
    useTeamsStore.setState({ teams: [team] });
  });

  it("renders one row per visible gap", () => {
    render(<GapsPanel projectId="project-1" />);

    expect(screen.getByTestId("gaps-table")).toBeInTheDocument();
    expect(rowOrder()).toEqual(["gap-row-gap-alpha", "gap-row-gap-bravo", "gap-row-gap-charlie"]);
    expect(screen.getByText("Step 2: Review request")).toBeInTheDocument();
  });

  it("re-sorts the rows when a column header is clicked, and reverses on a second click", () => {
    render(<GapsPanel projectId="project-1" />);

    expect(rowOrder()).toEqual(["gap-row-gap-alpha", "gap-row-gap-bravo", "gap-row-gap-charlie"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Severity" }));
    expect(rowOrder()).toEqual(["gap-row-gap-bravo", "gap-row-gap-charlie", "gap-row-gap-alpha"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Severity" }));
    expect(rowOrder()).toEqual(["gap-row-gap-alpha", "gap-row-gap-charlie", "gap-row-gap-bravo"]);
  });

  it("sorts by step order when the Step header is clicked", () => {
    useGapsStore.setState({ sort: { column: "step", direction: "desc" } });
    render(<GapsPanel projectId="project-1" />);

    expect(rowOrder()).toEqual(["gap-row-gap-charlie", "gap-row-gap-bravo", "gap-row-gap-alpha"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Step" }));
    expect(rowOrder()).toEqual(["gap-row-gap-alpha", "gap-row-gap-bravo", "gap-row-gap-charlie"]);
  });

  it("expands a row on click and collapses it on a second click", () => {
    render(<GapsPanel projectId="project-1" />);

    expect(screen.queryByTestId("gap-detail-gap-alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Alpha expected")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("gap-row-gap-alpha"));
    expect(screen.getByTestId("gap-detail-gap-alpha")).toBeInTheDocument();
    expect(screen.getByText("Alpha expected")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("gap-row-gap-alpha"));
    expect(screen.queryByTestId("gap-detail-gap-alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Alpha expected")).not.toBeInTheDocument();
  });

  it("collapses the previously expanded row when a second row is expanded", () => {
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByTestId("gap-row-gap-alpha"));
    expect(screen.getByTestId("gap-detail-gap-alpha")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("gap-row-gap-bravo"));
    expect(screen.getByTestId("gap-detail-gap-bravo")).toBeInTheDocument();
    expect(screen.queryByTestId("gap-detail-gap-alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Bravo expected")).toBeInTheDocument();
    expect(screen.queryByText("Alpha expected")).not.toBeInTheDocument();
  });

  it("shows the bulk bar with the selected count once a row is checked", () => {
    render(<GapsPanel projectId="project-1" />);

    expect(screen.queryByTestId("gap-bulk-bar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select gap Alpha observed"));

    const bar = screen.getByTestId("gap-bulk-bar");
    expect(within(bar).getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select gap Bravo observed"));
    expect(within(screen.getByTestId("gap-bulk-bar")).getByText("2 selected")).toBeInTheDocument();
  });

  // Regression: selection used to be counted straight off `selectedIds`, so a
  // selected gap that later fell outside the filter still inflated the count
  // and was silently dropped from the bulk write.
  it("ignores selected gaps that the filter has since hidden", async () => {
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Select gap Alpha observed"));
    fireEvent.click(screen.getByLabelText("Select gap Bravo observed"));
    expect(within(screen.getByTestId("gap-bulk-bar")).getByText("2 selected")).toBeInTheDocument();

    // Bravo is status Review, so an Open-only filter hides it.
    act(() => {
      useGapsStore.setState({ filters: { ...defaultFilters, statuses: ["Open"] } });
    });

    expect(within(screen.getByTestId("gap-bulk-bar")).getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId("gap-bulk-bar")).getByRole("button", { name: "Review" }),
    );

    await waitFor(() => expect(bulkUpdateStatus).toHaveBeenCalledTimes(1));
    expect(bulkUpdateStatus).toHaveBeenCalledWith(["gap-alpha"], "Review", "project-1");
  });

  it("hides the bulk bar entirely when every selected gap is filtered out", () => {
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Select gap Bravo observed"));
    expect(screen.getByTestId("gap-bulk-bar")).toBeInTheDocument();

    act(() => {
      useGapsStore.setState({ filters: { ...defaultFilters, statuses: ["Open"] } });
    });

    expect(screen.queryByTestId("gap-bulk-bar")).not.toBeInTheDocument();
  });

  it("keeps rows that failed to update selected so they can be retried", async () => {
    bulkUpdateStatus.mockResolvedValue({ updated: ["gap-alpha"], failed: ["gap-bravo"] });
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Select gap Alpha observed"));
    fireEvent.click(screen.getByLabelText("Select gap Bravo observed"));

    fireEvent.click(
      within(screen.getByTestId("gap-bulk-bar")).getByRole("button", { name: "Closed" }),
    );

    await waitFor(() =>
      expect(within(screen.getByTestId("gap-bulk-bar")).getByText("1 selected")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Select gap Bravo observed")).toBeChecked();
    expect(screen.getByLabelText("Select gap Alpha observed")).not.toBeChecked();
  });

  it("does not expand a row when its checkbox is clicked", () => {
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Select gap Alpha observed"));

    expect(screen.queryByTestId("gap-detail-gap-alpha")).not.toBeInTheDocument();
  });

  it("selects every visible row with the select-all checkbox", () => {
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Select all gaps"));

    expect(within(screen.getByTestId("gap-bulk-bar")).getByText("3 selected")).toBeInTheDocument();
  });

  it("hides the bulk bar when Clear selection is clicked", () => {
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Select all gaps"));
    expect(screen.getByTestId("gap-bulk-bar")).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId("gap-bulk-bar")).getByRole("button", { name: "Clear selection" }),
    );

    expect(screen.queryByTestId("gap-bulk-bar")).not.toBeInTheDocument();
  });

  it("calls bulkUpdateStatus with the selected ids and clears the selection", async () => {
    render(<GapsPanel projectId="project-1" />);

    fireEvent.click(screen.getByLabelText("Select gap Charlie observed"));
    fireEvent.click(screen.getByLabelText("Select gap Alpha observed"));

    fireEvent.click(
      within(screen.getByTestId("gap-bulk-bar")).getByRole("button", { name: "Review" }),
    );

    // Ids arrive in visible row order (id asc), not in the order they were ticked.
    expect(bulkUpdateStatus).toHaveBeenCalledTimes(1);
    expect(bulkUpdateStatus).toHaveBeenCalledWith(["gap-alpha", "gap-charlie"], "Review", "project-1");

    await waitFor(() => expect(screen.queryByTestId("gap-bulk-bar")).not.toBeInTheDocument());
  });
});
