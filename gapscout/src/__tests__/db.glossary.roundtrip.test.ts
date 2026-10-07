/**
 * Round-trip tests for Glossary CRUD (ZIP-369).
 *
 * Mirrors db.policies.roundtrip.test.ts but for GlossaryEntry. Key differences
 * from Policy: no `updatedAt` column (only `createdAt`), and `acronym` is the
 * optional string field that ZIP-371 specifically calls out as needing
 * clear-on-edit coverage.
 *
 * Verifies the create -> get/list -> update -> delete lifecycle through db.ts
 * against the in-memory adapter, including JSON array round-trips and the
 * '' -> null -> undefined chain for the acronym field.
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
  createGlossaryEntry,
  getGlossaryEntry,
  listGlossaryEntries,
  updateGlossaryEntry,
  deleteGlossaryEntry,
} from "../services/db";

describe("Glossary — full round-trip (ZIP-369)", () => {
  beforeEach(async () => {
    setDB(new InMemoryAdapter());
    await initDB();
  });

  it("createGlossaryEntry -> getGlossaryEntry returns the same shape", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "Purchase Requisition",
      definition: "Initial request to procure goods or services.",
      acronym: "PR",
      relatedSteps: ["step-1", "step-2"],
      tags: ["p2p", "procurement"],
    });

    const entry = await getGlossaryEntry(id);

    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      id,
      projectId: "proj-1",
      term: "Purchase Requisition",
      definition: "Initial request to procure goods or services.",
      acronym: "PR",
      relatedSteps: ["step-1", "step-2"],
      tags: ["p2p", "procurement"],
    });
    expect(typeof entry?.createdAt).toBe("number");
    // GlossaryEntry has no updatedAt field — confirm we're not getting an undefined leak
    expect("updatedAt" in (entry ?? {})).toBe(false);
  });

  it("createGlossaryEntry with empty arrays round-trips to empty arrays", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "SIPOC",
      definition: "Process-mapping framework.",
      relatedSteps: [],
      tags: [],
    });

    const entry = await getGlossaryEntry(id);
    expect(entry?.relatedSteps).toEqual([]);
    expect(entry?.tags).toEqual([]);
  });

  it("createGlossaryEntry with omitted acronym round-trips as undefined", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "Term without acronym",
      definition: "...",
      relatedSteps: [],
      tags: [],
    });

    const entry = await getGlossaryEntry(id);
    expect(entry?.acronym).toBeUndefined();
  });

  it("listGlossaryEntries returns only entries for the requested project, ordered by term ASC", async () => {
    // Insert in reverse-alphabetical order so the ASC sort actually has to
    // re-order. A regression to insertion-order or DESC would fail.
    await createGlossaryEntry({
      projectId: "proj-A",
      term: "Beta",
      definition: "...",
      relatedSteps: [],
      tags: [],
    });
    await createGlossaryEntry({
      projectId: "proj-A",
      term: "Alpha",
      definition: "...",
      relatedSteps: [],
      tags: [],
    });
    await createGlossaryEntry({
      projectId: "proj-B",
      term: "Gamma",
      definition: "...",
      relatedSteps: [],
      tags: [],
    });

    const aEntries = await listGlossaryEntries("proj-A");
    const bEntries = await listGlossaryEntries("proj-B");

    expect(aEntries).toHaveLength(2);
    expect(bEntries).toHaveLength(1);
    expect(bEntries[0]?.term).toBe("Gamma");
    // ORDER BY term ASC — Alpha before Beta despite insertion order.
    expect(aEntries[0]?.term).toBe("Alpha");
    expect(aEntries[1]?.term).toBe("Beta");
  });

  it("updateGlossaryEntry with partial changes merges with unchanged fields", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "Original term",
      definition: "Original definition",
      acronym: "OG",
      relatedSteps: ["step-1"],
      tags: ["original-tag"],
    });

    await updateGlossaryEntry(id, { definition: "Updated definition" }, "proj-1");

    const entry = await getGlossaryEntry(id);
    expect(entry?.term).toBe("Original term");
    expect(entry?.definition).toBe("Updated definition");
    expect(entry?.acronym).toBe("OG");
    expect(entry?.relatedSteps).toEqual(["step-1"]);
    expect(entry?.tags).toEqual(["original-tag"]);
  });

  it("updateGlossaryEntry clearing acronym with '' makes getGlossaryEntry return undefined (ZIP-371)", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "Has acronym",
      definition: "...",
      acronym: "ACR",
      relatedSteps: [],
      tags: [],
    });

    expect((await getGlossaryEntry(id))?.acronym).toBe("ACR");

    await updateGlossaryEntry(id, { acronym: "" }, "proj-1");

    const entry = await getGlossaryEntry(id);
    expect(entry?.acronym).toBeUndefined();
  });

  it("updateGlossaryEntry replaces JSON arrays atomically (not appended)", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "Has data",
      definition: "...",
      relatedSteps: ["step-1", "step-2"],
      tags: ["a", "b"],
    });

    await updateGlossaryEntry(id, { relatedSteps: ["step-3"], tags: ["c"] }, "proj-1");

    const entry = await getGlossaryEntry(id);
    expect(entry?.relatedSteps).toEqual(["step-3"]);
    expect(entry?.tags).toEqual(["c"]);
  });

  it("updateGlossaryEntry clearing arrays with [] round-trips to empty arrays", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "Has tags",
      definition: "...",
      relatedSteps: ["step-1"],
      tags: ["a"],
    });

    await updateGlossaryEntry(id, { relatedSteps: [], tags: [] }, "proj-1");

    const entry = await getGlossaryEntry(id);
    expect(entry?.relatedSteps).toEqual([]);
    expect(entry?.tags).toEqual([]);
  });

  it("deleteGlossaryEntry makes subsequent getGlossaryEntry return null", async () => {
    const id = await createGlossaryEntry({
      projectId: "proj-1",
      term: "To be deleted",
      definition: "...",
      relatedSteps: [],
      tags: [],
    });

    expect(await getGlossaryEntry(id)).not.toBeNull();

    await deleteGlossaryEntry(id, "proj-1");

    expect(await getGlossaryEntry(id)).toBeNull();
  });

  it("deleteGlossaryEntry of one entry doesn't affect others", async () => {
    const aId = await createGlossaryEntry({
      projectId: "proj-1",
      term: "A",
      definition: "...",
      relatedSteps: [],
      tags: [],
    });
    const bId = await createGlossaryEntry({
      projectId: "proj-1",
      term: "B",
      definition: "...",
      relatedSteps: [],
      tags: [],
    });

    await deleteGlossaryEntry(aId, "proj-1");

    expect(await getGlossaryEntry(aId)).toBeNull();
    expect(await getGlossaryEntry(bId)).not.toBeNull();
    expect(await listGlossaryEntries("proj-1")).toHaveLength(1);
  });
});
