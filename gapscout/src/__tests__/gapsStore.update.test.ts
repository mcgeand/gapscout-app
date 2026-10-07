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

describe("gapsStore.updateGap", () => {
  beforeEach(() => {
    mockedDbUpdateGap.mockReset().mockResolvedValue(null);
  });

  it("rejects when the database cannot return the updated gap", async () => {
    await expect(
      useGapsStore.getState().updateGap("missing-gap", { observed: "Updated" }, "project-1")
    ).rejects.toThrow(/not found/i);
    expect(useGapsStore.getState().isLoading).toBe(false);
  });
});
