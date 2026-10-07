/**
 * Round-trip tests for Policies CRUD (ZIP-369).
 *
 * Drives the full create -> get/list -> update -> delete lifecycle through
 * db.ts against an in-memory adapter that stores rows. Verifies that:
 *  - `related_milestones` and `tags` JSON columns survive write+read identically
 *  - Optional fields (sourceDoc, testNotes) round-trip via the null/undefined
 *    boundary correctly
 *  - `updatePolicy({ sourceDoc: '' })` clears the column (ZIP-371 / ZIP-144
 *    pattern — locks in the form-layer fix at the service layer too)
 *  - Partial updates merge correctly with unchanged fields
 *  - listPolicies returns only rows for the requested project
 *
 * Complements db.policies.test.ts (which verifies the emitted SQL strings on
 * the write path) by exercising the full chain through the row converter.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/db/sqlJsAdapter", async () => {
  const { InMemoryAdapter } = await import("./helpers/inMemoryAdapter");
  return { SqlJsAdapter: InMemoryAdapter };
});

import { InMemoryAdapter } from "./helpers/inMemoryAdapter";
import { setDB } from "../services/db/connection";
import {
  initDB,
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  deletePolicy,
} from "../services/db";

describe("Policies — full round-trip (ZIP-369)", () => {
  beforeEach(async () => {
    setDB(new InMemoryAdapter());
    await initDB();
  });

  it("createPolicy -> getPolicy returns the same shape that was written", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "P2P approval thresholds",
      content: "POs over $50k require dual approval.",
      sourceDoc: "https://example.com/policy.pdf",
      relatedMilestones: ["ms-1", "ms-2"],
      testNotes: "Verify in NetSuite approval queue",
      tags: ["finance", "sox"],
    });

    const policy = await getPolicy(id);

    expect(policy).not.toBeNull();
    expect(policy).toMatchObject({
      id,
      projectId: "proj-1",
      title: "P2P approval thresholds",
      content: "POs over $50k require dual approval.",
      sourceDoc: "https://example.com/policy.pdf",
      relatedMilestones: ["ms-1", "ms-2"],
      testNotes: "Verify in NetSuite approval queue",
      tags: ["finance", "sox"],
    });
    expect(typeof policy?.createdAt).toBe("number");
    expect(typeof policy?.updatedAt).toBe("number");
  });

  it("createPolicy with empty arrays round-trips to empty arrays (not null)", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "Minimal policy",
      content: "Body.",
      relatedMilestones: [],
      tags: [],
    });

    const policy = await getPolicy(id);
    expect(policy?.relatedMilestones).toEqual([]);
    expect(policy?.tags).toEqual([]);
  });

  it("createPolicy with omitted sourceDoc/testNotes round-trips as undefined", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "No optional fields",
      content: "Body.",
      relatedMilestones: [],
      tags: [],
    });

    const policy = await getPolicy(id);
    expect(policy?.sourceDoc).toBeUndefined();
    expect(policy?.testNotes).toBeUndefined();
  });

  it("listPolicies returns only policies for the requested project, ordered by created_at DESC", async () => {
    // Force distinct timestamps so the DESC ordering assertion is meaningful.
    // Without this, fast-running inserts can share a Date.now() millisecond and
    // ordering becomes implementation-defined.
    let now = 1000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    await createPolicy({
      projectId: "proj-A",
      title: "A1",
      content: "...",
      relatedMilestones: [],
      tags: [],
    });
    now = 2000;
    await createPolicy({
      projectId: "proj-A",
      title: "A2",
      content: "...",
      relatedMilestones: [],
      tags: [],
    });
    now = 3000;
    await createPolicy({
      projectId: "proj-B",
      title: "B1",
      content: "...",
      relatedMilestones: [],
      tags: [],
    });

    const aPolicies = await listPolicies("proj-A");
    const bPolicies = await listPolicies("proj-B");

    expect(aPolicies).toHaveLength(2);
    expect(bPolicies).toHaveLength(1);
    // Project isolation
    expect(aPolicies.map((p) => p.title).sort()).toEqual(["A1", "A2"]);
    expect(bPolicies[0]?.title).toBe("B1");
    // ORDER BY created_at DESC — A2 (newer) before A1 (older).
    // A regression to ASC or removed ORDER BY would fail this assertion.
    expect(aPolicies[0]?.title).toBe("A2");
    expect(aPolicies[1]?.title).toBe("A1");

    dateSpy.mockRestore();
  });

  it("updatePolicy with partial changes merges with unchanged fields", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "Original title",
      content: "Original content",
      sourceDoc: "https://original.example/doc",
      relatedMilestones: ["ms-1"],
      testNotes: "Original notes",
      tags: ["original-tag"],
    });

    await updatePolicy(id, { title: "Updated title" }, "proj-1");

    const policy = await getPolicy(id);
    expect(policy?.title).toBe("Updated title");
    expect(policy?.content).toBe("Original content");
    expect(policy?.sourceDoc).toBe("https://original.example/doc");
    expect(policy?.relatedMilestones).toEqual(["ms-1"]);
    expect(policy?.testNotes).toBe("Original notes");
    expect(policy?.tags).toEqual(["original-tag"]);
  });

  it("updatePolicy clearing sourceDoc with '' makes getPolicy return undefined (ZIP-371)", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "Has source doc",
      content: "...",
      sourceDoc: "https://will-be-cleared.example/doc",
      relatedMilestones: [],
      tags: [],
    });

    expect((await getPolicy(id))?.sourceDoc).toBe("https://will-be-cleared.example/doc");

    await updatePolicy(id, { sourceDoc: "" }, "proj-1");

    const policy = await getPolicy(id);
    expect(policy?.sourceDoc).toBeUndefined();
  });

  it("updatePolicy clearing testNotes with '' makes getPolicy return undefined", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "Has test notes",
      content: "...",
      relatedMilestones: [],
      testNotes: "Will be cleared",
      tags: [],
    });

    await updatePolicy(id, { testNotes: "" }, "proj-1");

    const policy = await getPolicy(id);
    expect(policy?.testNotes).toBeUndefined();
  });

  it("updatePolicy replaces JSON arrays atomically (not appended)", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "Has tags",
      content: "...",
      relatedMilestones: ["ms-1", "ms-2"],
      tags: ["a", "b"],
    });

    await updatePolicy(id, { relatedMilestones: ["ms-3"], tags: ["c"] }, "proj-1");

    const policy = await getPolicy(id);
    expect(policy?.relatedMilestones).toEqual(["ms-3"]);
    expect(policy?.tags).toEqual(["c"]);
  });

  it("updatePolicy clearing arrays with [] round-trips to empty arrays", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "Has tags",
      content: "...",
      relatedMilestones: ["ms-1"],
      tags: ["a"],
    });

    await updatePolicy(id, { relatedMilestones: [], tags: [] }, "proj-1");

    const policy = await getPolicy(id);
    expect(policy?.relatedMilestones).toEqual([]);
    expect(policy?.tags).toEqual([]);
  });

  it("deletePolicy makes subsequent getPolicy return null", async () => {
    const id = await createPolicy({
      projectId: "proj-1",
      title: "To be deleted",
      content: "...",
      relatedMilestones: [],
      tags: [],
    });

    expect(await getPolicy(id)).not.toBeNull();

    await deletePolicy(id, "proj-1");

    expect(await getPolicy(id)).toBeNull();
  });

  it("deletePolicy of one policy doesn't affect others", async () => {
    const aId = await createPolicy({
      projectId: "proj-1",
      title: "A",
      content: "...",
      relatedMilestones: [],
      tags: [],
    });
    const bId = await createPolicy({
      projectId: "proj-1",
      title: "B",
      content: "...",
      relatedMilestones: [],
      tags: [],
    });

    await deletePolicy(aId, "proj-1");

    expect(await getPolicy(aId)).toBeNull();
    expect(await getPolicy(bId)).not.toBeNull();
    expect(await listPolicies("proj-1")).toHaveLength(1);
  });
});
