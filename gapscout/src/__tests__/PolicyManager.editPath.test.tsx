/**
 * Edit-path tests for PolicyManager (ZIP-371).
 *
 * Locks down the regression where clearing an optional field in edit mode
 * would leave the prior value in the DB. The fix lives at PolicyManager.tsx:321
 * and :323 (`sourceDoc: sourceDoc.trim()` and `testNotes: testNotes.trim()`
 * with NO `|| undefined`).
 *
 * If someone reverts to `sourceDoc.trim() || undefined`, the form would send
 * `{ sourceDoc: undefined }` instead of `{ sourceDoc: '' }`. db.ts's
 * updatePolicy checks `if (changes.sourceDoc !== undefined)` — undefined would
 * skip the SET clause and the DB would retain the prior value. These tests
 * fail-on-revert by asserting the mock receives '' (the empty string), not
 * undefined.
 *
 * Mocks db.ts at the module boundary (same pattern as PolicyManager.smoke.test.tsx)
 * so the real Zustand store + form component still exercise their actual logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../services/db", () => ({
  createPolicy: vi.fn().mockResolvedValue("p-new"),
  getPolicy: vi.fn(),
  listPolicies: vi.fn().mockResolvedValue([]),
  updatePolicy: vi.fn().mockResolvedValue(undefined),
  deletePolicy: vi.fn().mockResolvedValue(undefined),
  listMilestones: vi.fn().mockResolvedValue([]),
}));

import { updatePolicy } from "../services/db";
import PolicyManager from "../components/Policies/PolicyManager";
import { usePoliciesStore } from "../state/policiesStore";

const mockedUpdatePolicy = vi.mocked(updatePolicy);

function makePolicy(overrides: Partial<{
  id: string;
  sourceDoc: string | undefined;
  testNotes: string | undefined;
}> = {}) {
  return {
    id: overrides.id ?? "p1",
    projectId: "project-1",
    title: "Test policy",
    content: "Policy content",
    sourceDoc: overrides.sourceDoc,
    relatedMilestones: [],
    testNotes: overrides.testNotes,
    tags: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("PolicyManager — edit-path (ZIP-371)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePoliciesStore.setState({ policies: [], currentProjectId: null, isLoading: false });
  });

  it("sends sourceDoc: '' (not undefined) when user clears Source Doc and saves", async () => {
    usePoliciesStore.setState({ policies: [makePolicy({ sourceDoc: "https://prior.example/doc" })], currentProjectId: "project-1", isLoading: false });

    render(<PolicyManager projectId="project-1" />);

    const editButton = await screen.findByTitle("Edit policy");
    fireEvent.click(editButton);

    // Pin the test to the edit-mode modal — guards against a future "Add Policy"
    // form sharing the same placeholders.
    await screen.findByText("Edit Policy");
    const sourceDocInput = await screen.findByPlaceholderText(
      "URL or document reference",
    );
    expect(sourceDocInput).toHaveValue("https://prior.example/doc");

    fireEvent.change(sourceDocInput, { target: { value: "" } });

    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => {
      expect(mockedUpdatePolicy).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockedUpdatePolicy.mock.calls[0]?.[1] as { sourceDoc?: unknown };
    expect(callArgs.sourceDoc).toBe("");
    expect(callArgs.sourceDoc).not.toBeUndefined();
  });

  it("sends testNotes: '' (not undefined) when user clears Test Notes and saves", async () => {
    usePoliciesStore.setState({ policies: [makePolicy({ testNotes: "Verify in NetSuite" })], currentProjectId: "project-1", isLoading: false });

    render(<PolicyManager projectId="project-1" />);

    const editButton = await screen.findByTitle("Edit policy");
    fireEvent.click(editButton);

    await screen.findByText("Edit Policy");
    const testNotesInput = await screen.findByPlaceholderText(
      "How to verify compliance...",
    );
    expect(testNotesInput).toHaveValue("Verify in NetSuite");

    fireEvent.change(testNotesInput, { target: { value: "" } });

    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => {
      expect(mockedUpdatePolicy).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockedUpdatePolicy.mock.calls[0]?.[1] as { testNotes?: unknown };
    expect(callArgs.testNotes).toBe("");
    expect(callArgs.testNotes).not.toBeUndefined();
  });

  it("sends both cleared fields as '' when user clears both Source Doc and Test Notes", async () => {
    usePoliciesStore.setState({ policies: [makePolicy({
      sourceDoc: "https://prior.example/doc",
      testNotes: "Prior notes",
    })], currentProjectId: "project-1", isLoading: false });

    render(<PolicyManager projectId="project-1" />);

    fireEvent.click(await screen.findByTitle("Edit policy"));

    const modal = await screen.findByText("Edit Policy");
    // Scope to the dialog by role rather than by a class: the shell is shared
    // and its classes are its own business (#204).
    const modalContainer = modal.closest('[role="dialog"]') as HTMLElement;
    expect(modalContainer).not.toBeNull();

    const utils = within(modalContainer);
    fireEvent.change(utils.getByPlaceholderText("URL or document reference"), {
      target: { value: "" },
    });
    fireEvent.change(utils.getByPlaceholderText("How to verify compliance..."), {
      target: { value: "" },
    });
    fireEvent.click(utils.getByText("Save Changes"));

    await waitFor(() => {
      expect(mockedUpdatePolicy).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockedUpdatePolicy.mock.calls[0]?.[1] as {
      sourceDoc?: unknown;
      testNotes?: unknown;
    };
    expect(callArgs.sourceDoc).toBe("");
    expect(callArgs.testNotes).toBe("");
  });
});
