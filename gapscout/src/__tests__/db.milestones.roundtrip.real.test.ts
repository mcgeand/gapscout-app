/**
 * Milestone CRUD through the real SQL.js FTS5 engine (#103).
 *
 * Gaps already have this coverage; milestones had none, so nothing proved that
 * the write path and the read path agree on a milestone. The two-tier types are
 * the reason that matters: `relatedPolicies` is a JS array on one side and a
 * TEXT column on the other, and `milestoneRowToMilestone` is the only thing
 * joining them. `validateRow` returns the object it was handed rather than
 * Zod's parsed output, so a schema `.default([])` never reaches a caller — the
 * `[]` in case six comes from `deserializeArray("[]")`, not `deserializeArray(null)`.
 * A separate case below writes a row with `related_policies` NULL directly, to
 * drive the null path itself.
 *
 * `validateRow` also only warns, so a row that violates `MilestoneSchema` still
 * lists. That makes "no warning" a real assertion rather than a tautology, and
 * the last case proves the spy can see a warning when there is one.
 *
 * Foreign keys are ON here, unlike the gaps file, which uses a bare
 * `"project-1"` string. The Tauri build enforces FKs (sqlx defaults, per
 * connection), so every row below hangs off a project seeded with
 * `createProject` and the steps in case five hang off a real team and a real
 * milestone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGap,
  createMilestone,
  createProject,
  createStep,
  createTeam,
  deleteMilestone,
  deleteStep,
  getMilestone,
  getMilestoneUsageCount,
  listMilestones,
  runMigrations,
  SCHEMA_SQL,
  updateMilestone,
} from "../services/db";
import { setDB } from "../services/db/connection";
import type { Step } from "../data/types";
import { search } from "../services/searchService";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

async function createAdapter(): Promise<SqlJsTestAdapter> {
  const adapter = new SqlJsTestAdapter();
  await adapter.initialize();
  await adapter.execute(SCHEMA_SQL);
  await runMigrations(adapter);
  setDB(adapter);
  return adapter;
}

/**
 * Records warnings without printing them. Returns the messages seen while the
 * spy was live, then puts the real `console.warn` back — `mockRestore` clears
 * the recorded calls, so the messages are read out first.
 */
function captureWarnings(): { read: () => string[] } {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  return {
    read: () => {
      const messages = spy.mock.calls.map((args) => args.map(String).join(" "));
      spy.mockRestore();
      return messages;
    },
  };
}

/** `createStep` takes `Omit<Step, "id">`, so the timestamps have to be supplied even though the INSERT stamps its own. */
function stepData(projectId: string, teamId: string, milestoneId: string, label: string, order: number): Omit<Step, "id"> {
  const now = Date.now();
  return {
    projectId,
    label,
    teamId,
    milestoneId,
    order,
    suppliers: [],
    inputs: [],
    outputs: [],
    customers: [],
    systems: [],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("milestone CRUD on the real SQL.js FTS5 engine", () => {
  let adapter: SqlJsTestAdapter;
  let projectId: string;

  beforeEach(async () => {
    adapter = await createAdapter();
    // After the migrations, not before: a pragma is a no-op inside an open
    // transaction. Asserted rather than assumed, so a build of SQL.js that
    // ignored it would fail here instead of quietly weakening every case below.
    await adapter.execute("PRAGMA foreign_keys = ON");
    expect(await adapter.select("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    projectId = await createProject({ name: "Order to Cash" });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await adapter.close();
  });

  it("lists milestones created out of order sorted by order, every field round-tripped, with no warning", async () => {
    const warnings = captureWarnings();

    const secondId = await createMilestone({
      projectId,
      name: "Fulfilment",
      order: 2,
      description: "Ships the order",
      relatedPolicies: ["policy-a", "policy-b"],
    });
    const firstId = await createMilestone({
      projectId,
      name: "Intake",
      order: 1,
      description: "Receives the request",
      relatedPolicies: [],
    });

    const listed = await listMilestones(projectId);
    const seen = warnings.read();

    expect(listed.map((milestone) => milestone.id)).toEqual([firstId, secondId]);
    expect(listed[0]).toEqual({
      id: firstId,
      projectId,
      name: "Intake",
      order: 1,
      description: "Receives the request",
      relatedPolicies: [],
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(listed[1]).toEqual({
      id: secondId,
      projectId,
      name: "Fulfilment",
      order: 2,
      description: "Ships the order",
      relatedPolicies: ["policy-a", "policy-b"],
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    // `listed[0]` (Intake) was freshly created, never updated, so its two
    // timestamps must be the same stamp rather than merely both numeric.
    expect(listed[0].createdAt).toBe(listed[0].updatedAt);
    expect(seen).toEqual([]);
  });

  it("gets a milestone by id and returns null through the wrong project scope", async () => {
    const id = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    const otherProjectId = await createProject({ name: "Procure to Pay" });
    const otherId = await createMilestone({ projectId: otherProjectId, name: "Sourcing", order: 0, relatedPolicies: [] });

    expect(await getMilestone(id)).toMatchObject({ id, projectId, name: "Intake", order: 0 });
    expect(await getMilestone(id, projectId)).toMatchObject({ id, name: "Intake" });
    expect(await getMilestone(id, otherProjectId)).toBeNull();

    const listed = await listMilestones(projectId);
    expect(listed.map((milestone) => milestone.id)).toEqual([id]);
    expect(listed.map((milestone) => milestone.id)).not.toContain(otherId);
  });

  it("renames, reorders and reindexes on update, bumping updatedAt", async () => {
    const id = await createMilestone({
      projectId,
      name: "Intake",
      order: 1,
      description: "Receives the request",
      relatedPolicies: ["policy-a"],
    });

    const before = await getMilestone(id, projectId);
    expect(before).not.toBeNull();
    expect(await search("Intake", projectId)).toHaveLength(1);

    // `updated_at` is `Date.now()`, so without a gap the bump can land on the
    // same millisecond and the assertion below would pass or fail by luck.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await updateMilestone(
      id,
      { name: "Fulfilment", order: 4, relatedPolicies: ["policy-b", "policy-c"] },
      projectId
    );

    const after = await getMilestone(id, projectId);
    expect(after).toMatchObject({
      id,
      name: "Fulfilment",
      order: 4,
      description: "Receives the request",
      relatedPolicies: ["policy-b", "policy-c"],
    });
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.updatedAt).toBeGreaterThan(before?.updatedAt ?? Number.POSITIVE_INFINITY);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(after?.createdAt ?? Number.POSITIVE_INFINITY);

    expect(await search("Intake", projectId)).toHaveLength(0);
    expect(await search("Fulfilment", projectId)).toHaveLength(1);
  });

  it("deletes the row out of the list, out of getMilestone and out of the FTS index", async () => {
    const id = await createMilestone({
      projectId,
      name: "Fulfilment",
      order: 0,
      description: "Ships the order",
      relatedPolicies: [],
    });
    const survivorId = await createMilestone({ projectId, name: "Intake", order: 1, relatedPolicies: [] });
    expect(await search("Fulfilment", projectId)).toHaveLength(1);

    await deleteMilestone(id, projectId);

    expect(await listMilestones(projectId)).toEqual([expect.objectContaining({ id: survivorId })]);
    expect(await getMilestone(id, projectId)).toBeNull();
    expect(await getMilestone(id)).toBeNull();
    expect(await search("Fulfilment", projectId)).toHaveLength(0);
    expect(await getMilestone(survivorId, projectId)).not.toBeNull();
  });

  it("does not update or delete a milestone through the wrong project scope", async () => {
    const id = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    const secondId = await createMilestone({ projectId, name: "Fulfilment", order: 1, relatedPolicies: [] });
    const otherProjectId = await createProject({ name: "Procure to Pay" });

    // Neither call throws: `updateMilestone`'s WHERE clause matches zero rows
    // and its early-return guard skips the write, so both are silent no-ops
    // rather than a rejection or a truthy/falsy result to check.
    await updateMilestone(id, { name: "Changed" }, otherProjectId);
    await deleteMilestone(id, otherProjectId);

    expect(await getMilestone(id, projectId)).toMatchObject({ id, name: "Intake" });
    expect(await search("Intake", projectId)).toHaveLength(1);
    expect(await listMilestones(projectId)).toEqual([
      expect.objectContaining({ id }),
      expect.objectContaining({ id: secondId }),
    ]);
  });

  it("counts the steps that reference a milestone, and zero for one nothing uses", async () => {
    const usedId = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    const unusedId = await createMilestone({ projectId, name: "Fulfilment", order: 1, relatedPolicies: [] });
    const teamId = await createTeam({ projectId, name: "Operations", color: "#201e1d", order: 0, tags: [] });

    await createStep(stepData(projectId, teamId, usedId, "Receive request", 0));
    await createStep(stepData(projectId, teamId, usedId, "Check request", 1));

    const otherProjectId = await createProject({ name: "Procure to Pay" });
    const otherMilestoneId = await createMilestone({ projectId: otherProjectId, name: "Intake", order: 0, relatedPolicies: [] });
    const otherTeamId = await createTeam({ projectId: otherProjectId, name: "Operations", color: "#201e1d", order: 0, tags: [] });
    await createStep(stepData(otherProjectId, otherTeamId, otherMilestoneId, "Other project's step", 0));

    expect(await getMilestoneUsageCount(usedId, projectId)).toBe(2);
    expect(await getMilestoneUsageCount(unusedId, projectId)).toBe(0);
  });

  it("rejects deleting a milestone a step still references, via ON DELETE RESTRICT", async () => {
    const milestoneId = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    const teamId = await createTeam({ projectId, name: "Operations", color: "#201e1d", order: 0, tags: [] });
    await createStep(stepData(projectId, teamId, milestoneId, "Receive request", 0));

    await expect(deleteMilestone(milestoneId, projectId)).rejects.toThrow();

    // The index entry outlives the rejected DELETE with the row (#426).
    expect(await getMilestone(milestoneId, projectId)).not.toBeNull();
    expect(await search("Intake", projectId)).toEqual([
      expect.objectContaining({ entityType: "milestone", entityId: milestoneId }),
    ]);
  });

  it("deletes a step with its cascaded gaps out of the FTS index, after the DELETE", async () => {
    const milestoneId = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    const teamId = await createTeam({ projectId, name: "Operations", color: "#201e1d", order: 0, tags: [] });
    const stepId = await createStep(stepData(projectId, teamId, milestoneId, "Receive request", 0));
    const gapId = await createGap({
      projectId,
      stepId,
      observed: "Requests arrive by fax",
      expected: "Requests arrive through the portal",
      severity: "M",
      status: "Review",
      order: 0,
      milestoneId,
      links: [],
    });
    expect(await search("fax", projectId)).toEqual([expect.objectContaining({ entityId: gapId })]);

    await deleteStep(stepId, projectId);

    // The gap went with the step through ON DELETE CASCADE; its index row went
    // too, even though `deleteStep` only clears the index after the DELETE (#426).
    expect(await adapter.select("SELECT id FROM gaps WHERE id = $1", [gapId])).toEqual([]);
    expect(
      await adapter.select(
        "SELECT entity_type FROM search_index WHERE entity_id IN ($1, $2)",
        [stepId, gapId]
      )
    ).toEqual([]);
  });

  it("round-trips an empty relatedPolicies as [] with no description and no warning", async () => {
    const warnings = captureWarnings();

    const id = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    const listed = await listMilestones(projectId);
    const fetched = await getMilestone(id, projectId);

    const seen = warnings.read();

    expect(listed).toHaveLength(1);
    expect(listed[0].relatedPolicies).toEqual([]);
    expect(listed[0].description).toBeUndefined();
    expect(fetched?.relatedPolicies).toEqual([]);
    expect(fetched?.description).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("treats a NULL related_policies column as [] with no warning", async () => {
    await adapter.execute(
      `INSERT INTO milestones (id, project_id, name, "order", description, related_policies, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["milestone-null-policies", projectId, "Intake", 0, null, null, Date.now(), Date.now()]
    );

    const warnings = captureWarnings();
    const listed = await listMilestones(projectId);
    const seen = warnings.read();

    expect(listed).toHaveLength(1);
    expect(listed[0].relatedPolicies).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("warns when a stored row violates MilestoneSchema instead of hiding it", async () => {
    // Straight past `createMilestone`, because nothing in the app writes this.
    // `MilestoneSchema` requires `order >= 0`; -1 is the cheapest violation that
    // no column constraint rejects first.
    await adapter.execute(
      `INSERT INTO milestones (id, project_id, name, "order", description, related_policies, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["milestone-invalid", projectId, "Negative order", -1, null, "[]", Date.now(), Date.now()]
    );

    const warnings = captureWarnings();
    const listed = await listMilestones(projectId);
    const seen = warnings.read();

    // The row still comes back: validation warns, it does not filter.
    expect(listed.map((milestone) => milestone.id)).toEqual(["milestone-invalid"]);
    expect(seen.join("\n")).toContain("schema validation failed");
    expect(seen.join("\n")).toContain("milestone[milestone-invalid]");
  });
});
