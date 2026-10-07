/**
 * Milestone order: the pre-check, the UNIQUE index behind it, and the reorder
 * that is the only way past both (#131).
 *
 * Real engine, not `InMemoryAdapter`: that adapter answers SQL its regexes do
 * not parse with `[]` and `rowsAffected: 0` (#369), so "the write was refused"
 * would pass there over a database with no constraint and no rows. Only real
 * SQLite can say whether `idx_milestones_project_order` exists, whether it
 * rejects a tie, and whether a swap gets past it.
 *
 * Foreign keys are ON, asserted rather than assumed, because every milestone
 * below hangs off a project seeded through `createProject`.
 *
 * The two failure paths are deliberately distinguished by error *class*. The
 * index refuses a tie too, so `rejects.toThrow()` alone would pass with the
 * pre-check deleted — `MilestoneOrderConflictError` is the only thing that says
 * the refusal came before the write, with a sentence a user can read.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMilestone,
  createProject,
  getMilestone,
  listMilestones,
  MilestoneOrderConflictError,
  reorderMilestones,
  runMigrations,
  SCHEMA_SQL,
  updateMilestone,
} from "../services/db";
import { setDB } from "../services/db/connection";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

let adapter: SqlJsTestAdapter;
let projectId: string;

async function orders(): Promise<Array<{ id: string; order: number }>> {
  const milestones = await listMilestones(projectId);
  return milestones.map((milestone) => ({ id: milestone.id, order: milestone.order }));
}

/** Straight past `createMilestone`, so the index is what does the refusing. */
async function insertRaw(id: string, order: number): Promise<void> {
  await adapter.execute(
    `INSERT INTO milestones (id, project_id, name, "order", related_policies, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '[]', $5, $6)`,
    [id, projectId, `Milestone ${id}`, order, Date.now(), Date.now()]
  );
}

describe("milestone order constraint and reorder on the real SQL.js engine", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    await adapter.execute(SCHEMA_SQL);
    await runMigrations(adapter);
    setDB(adapter);
    // After the migrations, not before: a pragma is a no-op inside an open
    // transaction. Asserted so a build that ignored it would fail here rather
    // than quietly weakening the cases below.
    await adapter.execute("PRAGMA foreign_keys = ON");
    expect(await adapter.select("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    projectId = await createProject({ name: "Order to Cash" });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("refuses a raw INSERT that ties an existing order", async () => {
    await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });

    await expect(insertRaw("m-clash", 0)).rejects.toThrow(/UNIQUE constraint failed/i);
    expect(await orders()).toEqual([{ id: expect.any(String), order: 0 }]);
  });

  it("refuses createMilestone at a taken order, before writing anything", async () => {
    const firstId = await createMilestone({
      projectId,
      name: "Intake",
      order: 2,
      relatedPolicies: [],
    });

    await expect(
      createMilestone({ projectId, name: "Fulfilment", order: 2, relatedPolicies: [] })
    ).rejects.toBeInstanceOf(MilestoneOrderConflictError);

    await expect(
      createMilestone({ projectId, name: "Fulfilment", order: 2, relatedPolicies: [] })
    ).rejects.toThrow("Milestone order 2 is already used in this project");

    expect(await orders()).toEqual([{ id: firstId, order: 2 }]);
  });

  it("carries the project, the order and the milestone in the way on the error", async () => {
    const firstId = await createMilestone({
      projectId,
      name: "Intake",
      order: 1,
      relatedPolicies: [],
    });

    const error = await createMilestone({
      projectId,
      name: "Fulfilment",
      order: 1,
      relatedPolicies: [],
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(MilestoneOrderConflictError);
    expect(error).toMatchObject({
      name: "MilestoneOrderConflictError",
      projectId,
      order: 1,
      conflictingId: firstId,
    });
  });

  it("creates at a taken order in another project, because the index is scoped", async () => {
    await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    const otherProjectId = await createProject({ name: "Procure to Pay" });

    await expect(
      createMilestone({ projectId: otherProjectId, name: "Sourcing", order: 0, relatedPolicies: [] })
    ).resolves.toEqual(expect.any(String));
  });

  it("refuses updateMilestone onto a taken order and changes nothing at all", async () => {
    const firstId = await createMilestone({
      projectId,
      name: "Intake",
      order: 0,
      description: "Receives the request",
      relatedPolicies: [],
    });
    const secondId = await createMilestone({
      projectId,
      name: "Fulfilment",
      order: 1,
      relatedPolicies: [],
    });
    const before = await getMilestone(secondId, projectId);

    // The name in the same call is the point: the pre-check runs before the
    // UPDATE is built, so a refused order cannot half-apply the rest of it.
    await expect(
      updateMilestone(secondId, { name: "Renamed", order: 0 }, projectId)
    ).rejects.toBeInstanceOf(MilestoneOrderConflictError);

    expect(await getMilestone(secondId, projectId)).toEqual(before);
    expect(await orders()).toEqual([
      { id: firstId, order: 0 },
      { id: secondId, order: 1 },
    ]);
  });

  it("still updates a milestone's other fields, and its order to a free one", async () => {
    const id = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    await createMilestone({ projectId, name: "Fulfilment", order: 1, relatedPolicies: [] });

    await updateMilestone(id, { name: "Request intake", description: "Receives it" }, projectId);
    expect(await getMilestone(id, projectId)).toMatchObject({
      name: "Request intake",
      description: "Receives it",
      order: 0,
    });

    await updateMilestone(id, { order: 7 }, projectId);
    expect(await getMilestone(id, projectId)).toMatchObject({ order: 7 });
  });

  it("lets a milestone be written back to the order it already holds", async () => {
    // The `id <> $3` half of the pre-check: without it a milestone would
    // collide with itself and no edit that resent its own order could land.
    const id = await createMilestone({ projectId, name: "Intake", order: 3, relatedPolicies: [] });

    await expect(
      updateMilestone(id, { name: "Request intake", order: 3 }, projectId)
    ).resolves.toBeUndefined();
    expect(await getMilestone(id, projectId)).toMatchObject({ name: "Request intake", order: 3 });
  });

  it("swaps two milestones and moves a third to the front", async () => {
    const a = await createMilestone({ projectId, name: "A", order: 0, relatedPolicies: [] });
    const b = await createMilestone({ projectId, name: "B", order: 1, relatedPolicies: [] });
    const c = await createMilestone({ projectId, name: "C", order: 2, relatedPolicies: [] });

    // The swap alone is the case a single UPDATE cannot express under the index:
    // SQLite checks UNIQUE row by row, so B → 0 fails while A still holds 0.
    await reorderMilestones(projectId, [b, a, c]);
    expect(await orders()).toEqual([
      { id: b, order: 0 },
      { id: a, order: 1 },
      { id: c, order: 2 },
    ]);

    await reorderMilestones(projectId, [c, b, a]);
    expect(await orders()).toEqual([
      { id: c, order: 0 },
      { id: b, order: 1 },
      { id: a, order: 2 },
    ]);
  });

  it("renumbers a sparse project densely and bumps only what it moved", async () => {
    const a = await createMilestone({ projectId, name: "A", order: 4, relatedPolicies: [] });
    const b = await createMilestone({ projectId, name: "B", order: 9, relatedPolicies: [] });

    await reorderMilestones(projectId, [b, a]);

    expect(await orders()).toEqual([
      { id: b, order: 0 },
      { id: a, order: 1 },
    ]);
  });

  it("repairs a milestone left at a parked order by a torn reorder", async () => {
    // The state the reorder's own doc comment admits to: the park landed, the
    // place did not finish, so one row sits above every final. It still sorts
    // last, and the next reorder puts it back in range.
    //
    // `1000000` exactly, not a value near it: that is the leftover a torn
    // reorder of a project whose first milestone sat at 0 actually leaves, and
    // it is the one a fixed `+ MILESTONE_ORDER_PARK` shift cannot clean up —
    // `a` would be moved straight onto it and SQLite would fail the statement
    // row by row. Anything else here passes whether the shift clears the
    // project's maximum or not.
    const a = await createMilestone({ projectId, name: "A", order: 0, relatedPolicies: [] });
    const b = await createMilestone({ projectId, name: "B", order: 1, relatedPolicies: [] });
    await adapter.execute(`UPDATE milestones SET "order" = 1000000 WHERE id = $1`, [b]);

    expect(await orders()).toEqual([
      { id: a, order: 0 },
      { id: b, order: 1000000 },
    ]);

    await reorderMilestones(projectId, [a, b]);

    expect(await orders()).toEqual([
      { id: a, order: 0 },
      { id: b, order: 1 },
    ]);
  });

  it("refuses an id set that is not exactly the project's milestones, writing nothing", async () => {
    const a = await createMilestone({ projectId, name: "A", order: 0, relatedPolicies: [] });
    const b = await createMilestone({ projectId, name: "B", order: 1, relatedPolicies: [] });
    const otherProjectId = await createProject({ name: "Procure to Pay" });
    const foreign = await createMilestone({
      projectId: otherProjectId,
      name: "Sourcing",
      order: 0,
      relatedPolicies: [],
    });
    const before = await orders();

    // Short: a milestone left out would stay parked above the finals.
    await expect(reorderMilestones(projectId, [a])).rejects.toThrow(/exactly once/);
    // Foreign: the place UPDATE is project-scoped, so this would silently
    // no-op that position and leave `b` parked.
    await expect(reorderMilestones(projectId, [a, foreign])).rejects.toThrow(/exactly once/);
    // Duplicated: two positions for one row, and one row never placed.
    await expect(reorderMilestones(projectId, [a, a, b])).rejects.toThrow(/the same milestone twice/);

    expect(await orders()).toEqual(before);
  });
});
