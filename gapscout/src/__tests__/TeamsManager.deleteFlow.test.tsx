/**
 * Delete-flow tests for TeamsManager (ZIP-379).
 *
 * Locks down the regression where confirming "Delete Team" on an in-use team
 * froze the renderer for 45s+. Root cause was a redundant synchronous
 * `window.confirm()` inside `handleDeleteTeam` — the DeleteConfirmModal already
 * provides the user confirmation, and the teamsStore already runs the
 * ZIP-328 pre-check, so the second native dialog was dead code with a sharp
 * side effect (blocked the JS main thread; under CDP automation, never
 * dismissed → 45s timeout).
 *
 * If someone reintroduces a blocking dialog in the delete handler, the
 * `window.confirm` spy assertion below will fail loudly.
 *
 * Mocks db.ts at the module boundary (same pattern as
 * PolicyManager.editPath.test.tsx) so the real Zustand store still runs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockListTeams,
  mockListSteps,
  mockGetTeamUsageCount,
  mockGetTeamReferenceCount,
  mockDbDeleteTeam,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockListTeams: vi.fn(),
  mockListSteps: vi.fn(),
  mockGetTeamUsageCount: vi.fn(),
  mockGetTeamReferenceCount: vi.fn(),
  mockDbDeleteTeam: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("../services/db", () => ({
  createTeam: vi.fn(),
  listTeams: mockListTeams,
  updateTeam: vi.fn(),
  deleteTeam: mockDbDeleteTeam,
  getTeamUsageCount: mockGetTeamUsageCount,
  getTeamReferenceCount: mockGetTeamReferenceCount,
  listSteps: mockListSteps,
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}));

import TeamsManager from "../components/Teams/TeamsManager";
import { useTeamsStore } from "../state/teamsStore";

const inUseTeam = {
  id: "team-1",
  projectId: "project-1",
  name: "Finance",
  color: "#1E3A8A",
  description: undefined,
  order: 0,
  tags: [],
  createdAt: 1,
};

const stepUsingTeam = {
  id: "step-1",
  projectId: "project-1",
  teamId: "team-1",
  milestoneId: "milestone-1",
  order: 0,
  label: "Approve PR",
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  trigger: "",
  result: "",
  kpi: "",
  comments: [],
  links: [],
  jiraLinks: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("TeamsManager — delete flow (ZIP-379)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTeams.mockResolvedValue([inUseTeam]);
    mockListSteps.mockResolvedValue([stepUsingTeam]);
    mockDbDeleteTeam.mockResolvedValue(undefined);
    // Explicit 0: `undefined > 0` is false, so a bare vi.fn() would hide a
    // broken reference path instead of failing.
    mockGetTeamReferenceCount.mockResolvedValue(0);
    useTeamsStore.setState({
      teams: [inUseTeam],
      currentProjectId: "project-1",
      isLoading: false,
    });
  });

  it("never calls window.confirm when the user confirms deletion of an in-use team", async () => {
    mockGetTeamUsageCount.mockResolvedValue(1);
    const confirmSpy = vi.spyOn(window, "confirm");

    render(
      <TeamsManager projectId="project-1" />,
    );

    fireEvent.click(await screen.findByTitle("Delete team"));
    fireEvent.click(await screen.findByText("Delete Team"));

    await waitFor(() => {
      expect(mockGetTeamUsageCount).toHaveBeenCalledWith("team-1", "project-1");
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("fires the friendly named-team toast and does not delete when the team is in use", async () => {
    mockGetTeamUsageCount.mockResolvedValue(1);

    render(
      <TeamsManager projectId="project-1" />,
    );

    fireEvent.click(await screen.findByTitle("Delete team"));
    fireEvent.click(await screen.findByText("Delete Team"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });

    const message = mockToastError.mock.calls[0][0];
    expect(message).toEqual(expect.stringContaining('Cannot delete team "Finance"'));
    expect(message).toEqual(expect.stringContaining("1 step"));
    expect(mockDbDeleteTeam).not.toHaveBeenCalled();
  });

  it("names both kinds of usage in the confirm dialog (#173)", async () => {
    mockGetTeamUsageCount.mockResolvedValue(1);
    mockGetTeamReferenceCount.mockResolvedValue(2);

    render(<TeamsManager projectId="project-1" />);

    fireEvent.click(await screen.findByTitle("Delete team"));

    // By name, not by id: the supplier/customer chips store the team's name.
    await waitFor(() => {
      expect(mockGetTeamReferenceCount).toHaveBeenCalledWith("Finance", "project-1");
    });

    expect(
      await screen.findByText(
        "This team owns 1 step; deleting it is blocked until that step is reassigned.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "2 steps name this team as a supplier or customer and will keep the name after it is deleted.",
      ),
    ).toBeInTheDocument();
    // The copy it replaces, which counted only steps.team_id.
    expect(screen.queryByText(/data inconsistencies/)).toBeNull();
  });

  it("says nothing about references when no step names the team", async () => {
    mockGetTeamUsageCount.mockResolvedValue(0);
    mockGetTeamReferenceCount.mockResolvedValue(0);

    render(<TeamsManager projectId="project-1" />);

    fireEvent.click(await screen.findByTitle("Delete team"));

    await waitFor(() => {
      expect(mockGetTeamReferenceCount).toHaveBeenCalledWith("Finance", "project-1");
    });

    expect(screen.queryByText(/supplier or customer/)).toBeNull();
    expect(screen.queryByText(/This team owns/)).toBeNull();
  });

  it("proceeds with deletion when the team has no steps assigned", async () => {
    mockGetTeamUsageCount.mockResolvedValue(0);
    // Simulate a real successful delete: initial load returns the team, the
    // post-delete reload (teamsStore + loadData) returns the empty list.
    // Without this, the store's loadTeams() re-populates with the same team
    // and any future assertion on post-delete state would silently pass.
    mockListTeams.mockResolvedValueOnce([inUseTeam]).mockResolvedValue([]);
    mockListSteps.mockResolvedValueOnce([stepUsingTeam]).mockResolvedValue([]);

    render(
      <TeamsManager projectId="project-1" />,
    );

    fireEvent.click(await screen.findByTitle("Delete team"));
    fireEvent.click(await screen.findByText("Delete Team"));

    await waitFor(() => {
      expect(mockDbDeleteTeam).toHaveBeenCalledWith("team-1", "project-1");
    });

    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess.mock.calls[0][0]).toEqual(
      expect.stringContaining('Team "Finance" deleted'),
    );
  });
});
