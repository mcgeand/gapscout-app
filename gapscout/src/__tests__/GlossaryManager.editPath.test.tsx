/**
 * Edit-path tests for GlossaryManager (ZIP-371).
 *
 * Same pattern as PolicyManager.editPath.test.tsx but for the GlossaryEntry
 * form. Locks down the regression where clearing the optional Acronym field
 * in edit mode would leave the prior value in the DB. Fix lives at
 * GlossaryManager.tsx:334 (`acronym: acronym.trim()` with NO `|| undefined`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../services/db", () => ({
  createGlossaryEntry: vi.fn().mockResolvedValue("g-new"),
  getGlossaryEntry: vi.fn(),
  listGlossaryEntries: vi.fn().mockResolvedValue([]),
  updateGlossaryEntry: vi.fn().mockResolvedValue(undefined),
  deleteGlossaryEntry: vi.fn().mockResolvedValue(undefined),
  listSteps: vi.fn().mockResolvedValue([]),
}));

import { updateGlossaryEntry } from "../services/db";
import GlossaryManager from "../components/Glossary/GlossaryManager";
import { useGlossaryStore } from "../state/glossaryStore";

const mockedUpdateGlossaryEntry = vi.mocked(updateGlossaryEntry);

function makeEntry(overrides: Partial<{ acronym: string | undefined }> = {}) {
  return {
    id: "g1",
    projectId: "project-1",
    term: "Purchase Requisition",
    definition: "Initial request to procure goods or services.",
    acronym: overrides.acronym,
    relatedSteps: [],
    tags: [],
    createdAt: 1,
  };
}

describe("GlossaryManager — edit-path (ZIP-371)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGlossaryStore.setState({ entries: [], currentProjectId: null, isLoading: false });
  });

  it("sends acronym: '' (not undefined) when user clears Acronym and saves", async () => {
    useGlossaryStore.setState({ entries: [makeEntry({ acronym: "PR" })], currentProjectId: "project-1", isLoading: false });

    render(<GlossaryManager projectId="project-1" />);

    const editButton = await screen.findByTitle("Edit term");
    fireEvent.click(editButton);

    // Pin to the edit-mode modal so we're not accidentally testing the create form.
    await screen.findByText("Edit Term");
    const acronymInput = await screen.findByPlaceholderText("e.g., PR");
    expect(acronymInput).toHaveValue("PR");

    fireEvent.change(acronymInput, { target: { value: "" } });

    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => {
      expect(mockedUpdateGlossaryEntry).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockedUpdateGlossaryEntry.mock.calls[0]?.[1] as { acronym?: unknown };
    expect(callArgs.acronym).toBe("");
    expect(callArgs.acronym).not.toBeUndefined();
  });
});
