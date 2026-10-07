/**
 * Store-level coverage for the gap-list bulk status action.
 *
 * The component tests mock this action as always-succeeding, so every failure
 * path — write errors, gaps that vanished, partial success — is only exercised
 * here.
 *
 * Ticket: #161
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedDbUpdateGap } = vi.hoisted(() => ({
  mockedDbUpdateGap: vi.fn(),
}));

vi.mock("../services/db", () => ({
  listGaps: vi.fn(),
  listGapsByStep: vi.fn(),
  getGap: vi.fn(),
  createGap: vi.fn(),
  updateGap: mockedDbUpdateGap,
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
}));

import { useGapsStore } from "../state/gapsStore";
import type { Gap } from "../data/types";

function makeGap(id: string): Gap {
  return {
    id,
    projectId: "project-1",
    observed: `${id} observed`,
    expected: `${id} expected`,
    severity: "M",
    status: "Open",
    links: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

const gaps = [makeGap("gap-1"), makeGap("gap-2"), makeGap("gap-3")];

describe("gapsStore.bulkUpdateStatus", () => {
  beforeEach(() => {
    mockedDbUpdateGap.mockReset();
    useGapsStore.setState({
      gaps: gaps.map(gap => ({ ...gap })),
      currentProjectId: "project-1",
      currentGap: null,
      isLoading: false,
    });
  });

  it("returns immediately for an empty selection without touching the database", async () => {
    const result = await useGapsStore.getState().bulkUpdateStatus([], "Closed", "project-1");

    expect(result).toEqual({ updated: [], failed: [] });
    expect(mockedDbUpdateGap).not.toHaveBeenCalled();
  });

  it("updates every gap and merges the results into the store", async () => {
    mockedDbUpdateGap.mockImplementation(async (id: string) => ({
      ...makeGap(id),
      status: "Review",
    }));

    const result = await useGapsStore
      .getState()
      .bulkUpdateStatus(["gap-1", "gap-2"], "Review", "project-1");

    expect(result).toEqual({ updated: ["gap-1", "gap-2"], failed: [] });
    expect(useGapsStore.getState().gaps.find(g => g.id === "gap-1")?.status).toBe("Review");
    expect(useGapsStore.getState().gaps.find(g => g.id === "gap-2")?.status).toBe("Review");
    // Untouched gaps keep their original status.
    expect(useGapsStore.getState().gaps.find(g => g.id === "gap-3")?.status).toBe("Open");
    expect(useGapsStore.getState().isLoading).toBe(false);
  });

  it("stamps closedAt when closing and clears it when reopening", async () => {
    mockedDbUpdateGap.mockImplementation(async (id: string) => makeGap(id));

    await useGapsStore.getState().bulkUpdateStatus(["gap-1"], "Closed", "project-1");
    const closePatch = mockedDbUpdateGap.mock.calls[0][1];
    expect(closePatch.status).toBe("Closed");
    expect(typeof closePatch.closedAt).toBe("number");

    mockedDbUpdateGap.mockClear();

    await useGapsStore.getState().bulkUpdateStatus(["gap-1"], "Open", "project-1");
    const reopenPatch = mockedDbUpdateGap.mock.calls[0][1];
    expect(reopenPatch.status).toBe("Open");
    expect(reopenPatch.closedAt).toBeNull();
  });

  it("reports a gap that no longer exists as failed and leaves the others applied", async () => {
    mockedDbUpdateGap.mockImplementation(async (id: string) =>
      id === "gap-2" ? null : { ...makeGap(id), status: "Review" }
    );

    const result = await useGapsStore
      .getState()
      .bulkUpdateStatus(["gap-1", "gap-2"], "Review", "project-1");

    expect(result.updated).toEqual(["gap-1"]);
    expect(result.failed).toEqual(["gap-2"]);
    expect(useGapsStore.getState().gaps.find(g => g.id === "gap-1")?.status).toBe("Review");
  });

  it("keeps going after a write error and reports the failed id", async () => {
    mockedDbUpdateGap.mockImplementation(async (id: string) => {
      if (id === "gap-1") throw new Error("database is locked");
      return { ...makeGap(id), status: "Review" };
    });

    const result = await useGapsStore
      .getState()
      .bulkUpdateStatus(["gap-1", "gap-2"], "Review", "project-1");

    expect(result.updated).toEqual(["gap-2"]);
    expect(result.failed).toEqual(["gap-1"]);
    // A failure partway through must not abandon the rest of the batch.
    expect(mockedDbUpdateGap).toHaveBeenCalledTimes(2);
    expect(useGapsStore.getState().gaps.find(g => g.id === "gap-2")?.status).toBe("Review");
    expect(useGapsStore.getState().isLoading).toBe(false);
  });

  it("reports every id as failed when the project cannot be resolved", async () => {
    useGapsStore.setState({ gaps: [], currentProjectId: null });

    const result = await useGapsStore.getState().bulkUpdateStatus(["gap-1"], "Closed");

    expect(result).toEqual({ updated: [], failed: ["gap-1"] });
    expect(mockedDbUpdateGap).not.toHaveBeenCalled();
  });
});
