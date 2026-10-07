/**
 * Tests for the FTS5 search index pipeline (ZIP-105 + ZIP-344).
 *
 * Two layers:
 *  1. Content builders — pure-function unit tests, no DB needed.
 *  2. DB integration — verifies that CRUD functions emit the correct
 *     search_index SQL, using the mock-adapter pattern from db.policies.test.ts.
 *
 * Real FTS5 engine coverage lives in fts5Migration.real.test.ts. The mock
 * adapter here keeps CRUD call ordering and payload assertions focused.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildStepContent,
  buildGapContent,
  buildTeamContent,
  buildGlossaryContent,
} from "../services/searchIndex";
import type { Step, Gap, Team, GlossaryEntry } from "../data/types";

// ============================================================================
// CONTENT BUILDERS (pure functions, no adapter needed)
// ============================================================================

describe("buildStepContent", () => {
  const base: Step = {
    id: "s-1",
    projectId: "proj-1",
    label: "Approve PO",
    teamId: "t-1",
    milestoneId: "ms-1",
    order: 0,
    suppliers: [],
    inputs: [],
    outputs: [],
    customers: [],
    systems: [],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: 0,
    updatedAt: 0,
  };

  it("includes label in content", () => {
    expect(buildStepContent(base)).toContain("Approve PO");
  });

  it("includes optional fields when present", () => {
    const step: Step = { ...base, trigger: "PO arrives", result: "PO approved", kpi: "< 2 days", notes: "Finance only" };
    const content = buildStepContent(step);
    expect(content).toContain("PO arrives");
    expect(content).toContain("PO approved");
    expect(content).toContain("< 2 days");
    expect(content).toContain("Finance only");
  });

  it("omits undefined optional fields", () => {
    const content = buildStepContent(base);
    expect(content.trim()).toBe("Approve PO");
  });

  // #366: the discussion thread is step content too, so a term someone only
  // ever wrote in a comment is findable.
  it("includes comment text", () => {
    const step: Step = {
      ...base,
      comments: [
        { id: "c-1", text: "Blocked on the vendor portal", createdAt: 1 },
        { id: "c-2", text: "Chased finance again", createdAt: 2, author: "Danny" },
      ],
    };
    const content = buildStepContent(step);
    expect(content).toContain("Blocked on the vendor portal");
    expect(content).toContain("Chased finance again");
  });

  it("indexes only the comment text, not its id, author or timestamp", () => {
    const step: Step = {
      ...base,
      comments: [{ id: "c-1", text: "Vendor portal", createdAt: 1755000000000, author: "Danny" }],
    };
    const content = buildStepContent(step);
    expect(content.trim()).toBe("Approve PO Vendor portal");
  });

  it("survives a row whose comments column was null", () => {
    // `Step.comments` is non-optional in the type, but a row deserialized from
    // a NULL column reaches here as undefined.
    const step = { ...base, comments: undefined } as unknown as Step;
    expect(buildStepContent(step).trim()).toBe("Approve PO");
  });
});

describe("buildGapContent", () => {
  const base: Gap = {
    id: "g-1",
    projectId: "proj-1",
    stepId: "s-1",
    severity: "H",
    status: "Open",
    rootCause: "Config",
    observed: "Missing approval step",
    expected: "Dual approval required",
    links: [],
    createdAt: 0,
    updatedAt: 0,
  };

  it("includes observed and expected", () => {
    const content = buildGapContent(base);
    expect(content).toContain("Missing approval step");
    expect(content).toContain("Dual approval required");
  });

  it("includes fixIdea when present", () => {
    const gap: Gap = { ...base, fixIdea: "Add second approver" };
    expect(buildGapContent(gap)).toContain("Add second approver");
  });
});

describe("buildTeamContent", () => {
  const base: Team = {
    id: "t-1",
    projectId: "proj-1",
    name: "Finance",
    color: "#000",
    order: 0,
    tags: [],
    createdAt: 0,
  };

  it("includes name", () => {
    expect(buildTeamContent(base)).toContain("Finance");
  });

  it("includes description when present", () => {
    expect(buildTeamContent({ ...base, description: "P2P owners" })).toContain("P2P owners");
  });
});

describe("buildGlossaryContent", () => {
  const base: GlossaryEntry = {
    id: "g-1",
    projectId: "proj-1",
    term: "SIPOC",
    definition: "Supplier Input Process Output Customer",
    relatedSteps: [],
    tags: [],
    createdAt: 0,
  };

  it("includes term and definition", () => {
    const content = buildGlossaryContent(base);
    expect(content).toContain("SIPOC");
    expect(content).toContain("Supplier Input Process Output Customer");
  });

  it("includes acronym when present", () => {
    expect(buildGlossaryContent({ ...base, acronym: "S" })).toContain("S");
  });
});

// ============================================================================
// DB INTEGRATION — mock-adapter layer
// Verifies that CRUD functions emit the right search_index SQL shapes.
// ============================================================================

const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
}));

vi.mock("../services/db/sqlJsAdapter", () => ({
  SqlJsAdapter: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    execute = mockExecute;
    select = mockSelect;
    close = vi.fn();
  },
}));

import { initDB, createStep, deleteStep, createGap } from "../services/db";
import { search } from "../services/searchService";

describe("search index wiring — createStep (ZIP-344)", () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([]);
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 });
    await initDB();
    mockExecute.mockClear();
    mockSelect.mockClear();
  });

  it("emits INSERT INTO search_index after INSERT INTO steps", async () => {
    await createStep({
      projectId: "proj-1",
      label: "Approve PO",
      teamId: "team-1",
      milestoneId: "ms-1",
      order: 0,
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
      systems: [],
      comments: [],
      links: [],
      gapIds: [],
      createdAt: 0,
      updatedAt: 0,
    });

    const calls = mockExecute.mock.calls as [string, unknown[]][];
    const searchIndexCall = calls.find(([sql]) => /INSERT\s+INTO\s+search_index/i.test(sql));
    expect(searchIndexCall).toBeDefined();
    const [, params] = searchIndexCall!;
    expect(params[0]).toBe("step");
    expect(params[3]).toContain("Approve PO");
  });
});

describe("search index wiring — deleteStep cascade (ZIP-344)", () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([]);
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 });
    await initDB();
    mockExecute.mockClear();
    mockSelect.mockClear();
  });

  it("removes the step's and its child gaps' index entries after deleting the step", async () => {
    mockSelect
      .mockResolvedValueOnce([{ id: "step-to-delete" }])
      .mockResolvedValueOnce([{ id: "gap-a" }, { id: "gap-b" }]);
    await deleteStep("step-to-delete", "project-1");

    // Child gap ids are read before the DELETE, because the FK cascade removes them.
    expect(mockSelect.mock.calls[1][0]).toMatch(/SELECT\s+id\s+FROM\s+gaps\s+WHERE\s+step_id/i);

    const calls = mockExecute.mock.calls as [string, unknown[]][];
    const deleteAt = calls.findIndex(([sql]) => /DELETE\s+FROM\s+steps/i.test(sql));
    const indexDeletes = calls
      .map(([sql, params], at) => ({ sql, params, at }))
      .filter(({ sql }) => /DELETE\s+FROM\s+search_index/i.test(sql));

    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(indexDeletes.map(({ params }) => params)).toEqual([
      ["step", "step-to-delete"],
      ["gap", "gap-a"],
      ["gap", "gap-b"],
    ]);
    // A DELETE that fails leaves every index row in place (#426).
    for (const { at } of indexDeletes) expect(at).toBeGreaterThan(deleteAt);
  });
});

describe("search index wiring — createGap (ZIP-344)", () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([]);
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 });
    await initDB();
    mockExecute.mockClear();
    mockSelect.mockClear();
  });

  it("emits INSERT INTO search_index with gap content after INSERT INTO gaps", async () => {
    await createGap({
      projectId: "proj-1",
      severity: "H",
      status: "Open",
      rootCause: "Config",
      observed: "Missing dual approval",
      expected: "Dual approval required by policy",
      links: [],
    });

    const calls = mockExecute.mock.calls as [string, unknown[]][];
    const searchIndexCall = calls.find(([sql]) => /INSERT\s+INTO\s+search_index/i.test(sql));
    expect(searchIndexCall).toBeDefined();
    const [, params] = searchIndexCall!;
    expect(params[0]).toBe("gap");
    expect(params[3]).toContain("Missing dual approval");
  });
});

describe("search() — SQL shape (ZIP-105)", () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([]);
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 });
    await initDB();
    mockSelect.mockClear();
  });

  it("queries search_index with MATCH and project filter", async () => {
    await search("approve", "proj-1");

    const calls = mockSelect.mock.calls as [string, unknown[]][];
    const matchCall = calls.find(([sql]) => /MATCH/i.test(sql));
    expect(matchCall).toBeDefined();
    const [sql, params] = matchCall!;
    expect(sql).toMatch(/FROM\s+search_index/i);
    expect(sql).toMatch(/ORDER\s+BY\s+rank/i);
    expect(params[0]).toBe("approve");
    expect(params[1]).toBe("proj-1");
  });

  it("returns empty array without querying when query is blank", async () => {
    const results = await search("  ", "proj-1");
    expect(results).toEqual([]);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("maps rows to SearchResult shape", async () => {
    mockSelect.mockResolvedValueOnce([
      { entity_type: "step", entity_id: "s-1", project_id: "proj-1", content: "Approve PO", rank: -1.5 },
    ]);
    const results = await search("approve", "proj-1");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      entityType: "step",
      entityId: "s-1",
      projectId: "proj-1",
      content: "Approve PO",
      rank: -1.5,
    });
  });
});
