/**
 * Migration v8 — UNIQUE `(project_id, "order")` on `milestones` — on the real
 * SQL.js engine (#131).
 *
 * A mock adapter cannot check any of this. `InMemoryAdapter` answers SQL its
 * regexes do not parse with `[]` and `rowsAffected: 0` (#369), so a constraint
 * test written against it passes without a constraint existing. What decides
 * whether this migration is safe is real SQLite: whether `CREATE UNIQUE INDEX`
 * throws on a database that still holds a tie, whether the dedupe collides with
 * its own index on a rerun, and whether the index it leaves is actually unique.
 *
 * The fixture therefore replays `SCHEMA_SQL` and then `runMigrations`, the way
 * `initDB` does, with foreign keys enforced from the moment the migration runs.
 *
 * A pre-v8 database is seeded by hand rather than by `SCHEMA_SQL`, because the
 * non-unique `idx_milestones_order` this migration drops no longer lives there
 * — v8 owns the index now, and the legacy one only exists on databases that
 * were created before it did.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, SCHEMA_SQL } from "../services/db";
import { setDB } from "../services/db/connection";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

/**
 * A real timestamp: every seed binds it per column rather than reusing one
 * numbered placeholder, because `SqlJsTestAdapter` rewrites `$n` to a
 * positional `?` and the same placeholder twice makes the bind list run short.
 */
const SEEDED_AT = 1_700_000_000_000;

interface MilestoneShape {
  id: string;
  order: number;
  updated_at: number;
}

let adapter: SqlJsTestAdapter;

async function addProject(id: string): Promise<void> {
  await adapter.execute(
    "INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)",
    [id, `Project ${id}`, SEEDED_AT, SEEDED_AT]
  );
}

/** Straight past `createMilestone`, so a tie can be seeded at all. */
async function addMilestone(
  id: string,
  projectId: string,
  order: number,
  createdAt: number
): Promise<void> {
  await adapter.execute(
    `INSERT INTO milestones (id, project_id, name, "order", related_policies, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '[]', $5, $6)`,
    [id, projectId, `Milestone ${id}`, order, createdAt, SEEDED_AT]
  );
}

async function milestonesOf(projectId: string): Promise<MilestoneShape[]> {
  return adapter.select<MilestoneShape[]>(
    `SELECT id, "order", updated_at FROM milestones WHERE project_id = $1 ORDER BY "order", id`,
    [projectId]
  );
}

/** `PRAGMA index_list` as a name → unique map, so both halves of the swap are checkable. */
async function milestoneIndexes(): Promise<Map<string, number>> {
  const rows = await adapter.select<Array<{ name: string; unique: number }>>(
    "PRAGMA index_list('milestones')"
  );
  return new Map(rows.map((row) => [row.name, row.unique]));
}

async function currentVersion(): Promise<number> {
  const rows = await adapter.select<Array<{ version: number | null }>>(
    "SELECT MAX(version) AS version FROM schema_version"
  );
  return rows[0]?.version ?? 0;
}

/** Run the migration the way the app does: foreign keys on, nothing stubbed. */
async function migrate(): Promise<void> {
  await adapter.execute("PRAGMA foreign_keys = ON");
  await runMigrations(adapter);
}

/**
 * Three projects as a pre-v8 database could hold them:
 *
 * - `tied` — two milestones sharing order 1, seeded newest-first so the
 *   dedupe's `created_at` tiebreak has something to do, plus a third at 3.
 * - `untied` — sparse but legal: 0 and 5, and nothing may move either.
 * - `twice` — two separate ties in one project, which makes the tie query
 *   return that project id twice and proves the dedupe runs once for it.
 */
async function seedLegacyProjects(): Promise<void> {
  await addProject("tied");
  await addMilestone("t-late", "tied", 1, SEEDED_AT + 200);
  await addMilestone("t-early", "tied", 1, SEEDED_AT + 100);
  await addMilestone("t-last", "tied", 3, SEEDED_AT + 300);

  await addProject("untied");
  await addMilestone("u-first", "untied", 0, SEEDED_AT);
  await addMilestone("u-second", "untied", 5, SEEDED_AT);

  await addProject("twice");
  await addMilestone("w-a", "twice", 1, SEEDED_AT + 10);
  await addMilestone("w-b", "twice", 1, SEEDED_AT + 20);
  await addMilestone("w-c", "twice", 2, SEEDED_AT + 30);
  await addMilestone("w-d", "twice", 2, SEEDED_AT + 40);
}

describe("v8 unique milestone order on the real SQL.js engine", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    await adapter.execute(SCHEMA_SQL);
    // A database as it stood before v8: the version rows for every migration
    // below this one, and the non-unique index v8 replaces. Both are what makes
    // the DROP half of this migration testable at all.
    await adapter.execute(
      "INSERT INTO schema_version (version, applied_at) VALUES (2, 0), (3, 0), (4, 0), (5, 0), (6, 0), (7, 0)"
    );
    await adapter.execute(
      `CREATE INDEX IF NOT EXISTS idx_milestones_order ON milestones(project_id, "order")`
    );
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("really enforces foreign keys while the migration runs", async () => {
    // Guards the fixture: with the pragma silently off, every claim below would
    // hold over a database that enforces nothing.
    await seedLegacyProjects();
    await migrate();

    const rows = await adapter.select<Array<Record<string, unknown>>>("PRAGMA foreign_keys");
    expect(Object.values(rows[0])[0]).toBe(1);
    await expect(addMilestone("m-orphan", "no-such-project", 9, SEEDED_AT)).rejects.toThrow(
      /FOREIGN KEY/i
    );
  });

  it("renumbers a tied project densely in (order, created_at) sequence", async () => {
    await seedLegacyProjects();
    await migrate();

    expect(await milestonesOf("tied")).toEqual([
      { id: "t-early", order: 0, updated_at: expect.any(Number) },
      { id: "t-late", order: 1, updated_at: expect.any(Number) },
      { id: "t-last", order: 2, updated_at: expect.any(Number) },
    ]);
    // The tiebreak is age, not id: `t-late` sorts first alphabetically and must
    // still land second.
    const renumbered = await milestonesOf("tied");
    expect(renumbered.every((row) => row.updated_at > SEEDED_AT)).toBe(true);
  });

  it("renumbers a project holding two separate ties exactly once", async () => {
    await seedLegacyProjects();
    await migrate();

    expect(await milestonesOf("twice")).toEqual([
      { id: "w-a", order: 0, updated_at: expect.any(Number) },
      { id: "w-b", order: 1, updated_at: expect.any(Number) },
      { id: "w-c", order: 2, updated_at: expect.any(Number) },
      { id: "w-d", order: 3, updated_at: expect.any(Number) },
    ]);
  });

  it("leaves an untied project's sparse orders and timestamps alone", async () => {
    await seedLegacyProjects();
    await migrate();

    expect(await milestonesOf("untied")).toEqual([
      { id: "u-first", order: 0, updated_at: SEEDED_AT },
      { id: "u-second", order: 5, updated_at: SEEDED_AT },
    ]);
  });

  it("records schema version 10 and swaps the index for a unique one", async () => {
    await seedLegacyProjects();
    await migrate();

    expect(await currentVersion()).toBe(10);

    const indexes = await milestoneIndexes();
    expect(indexes.get("idx_milestones_project_order")).toBe(1);
    expect(indexes.has("idx_milestones_order")).toBe(false);
    // The other milestone index is not v8's business and must survive.
    expect(indexes.get("idx_milestones_project")).toBe(0);
  });

  it("refuses a tie afterwards, per project rather than globally", async () => {
    await seedLegacyProjects();
    await migrate();

    await expect(addMilestone("t-clash", "tied", 1, SEEDED_AT)).rejects.toThrow(
      /UNIQUE constraint failed/i
    );
    // Same order, different project: the index is scoped, so this must land.
    await expect(addMilestone("u-fine", "untied", 1, SEEDED_AT)).resolves.toBeUndefined();
  });

  it("is a no-op when applied a second time", async () => {
    await seedLegacyProjects();
    await migrate();

    const after = [
      ...(await milestonesOf("tied")),
      ...(await milestonesOf("untied")),
      ...(await milestonesOf("twice")),
    ];

    // The runner short-circuits on MAX(version), so replay it the way a database
    // with a stale version row would: drop the v8 marker and rerun.
    await adapter.execute("DELETE FROM schema_version WHERE version >= 8");
    await runMigrations(adapter);

    expect([
      ...(await milestonesOf("tied")),
      ...(await milestonesOf("untied")),
      ...(await milestonesOf("twice")),
    ]).toEqual(after);
    expect(await currentVersion()).toBe(10);
  });

  it("recreates the index after a run torn between the DROP and the CREATE", async () => {
    await seedLegacyProjects();
    await migrate();

    // The tear: the old index is gone, the new one never landed, and the
    // version row was never written. One restart runs with no index at all.
    await adapter.execute("DROP INDEX idx_milestones_project_order");
    await adapter.execute("DELETE FROM schema_version WHERE version >= 8");
    expect((await milestoneIndexes()).has("idx_milestones_project_order")).toBe(false);

    await runMigrations(adapter);

    expect((await milestoneIndexes()).get("idx_milestones_project_order")).toBe(1);
    expect(await currentVersion()).toBe(10);
  });

  it("reruns cleanly when the index landed but the version row did not", async () => {
    await seedLegacyProjects();
    await migrate();

    const after = await milestonesOf("tied");

    // The other tear: the DDL is done, `runMigrations` died before writing the
    // version row. The dedupe now runs with its own unique index live — it must
    // find nothing to renumber rather than collide against it.
    await adapter.execute("DELETE FROM schema_version WHERE version >= 8");

    await expect(runMigrations(adapter)).resolves.toBeUndefined();

    expect(await milestonesOf("tied")).toEqual(after);
    expect((await milestoneIndexes()).get("idx_milestones_project_order")).toBe(1);
    expect(await currentVersion()).toBe(10);
  });

  it("finishes a run torn after the park and the first placement", async () => {
    await seedLegacyProjects();
    await migrate();

    // The tear the tie query cannot see. `tied` held 1, 1, 3; the park lifted
    // it to 1000001, 1000001, 1000003 and the place loop wrote one row before
    // the process died, leaving 0, 1000001, 1000003 — dense at the front, tie
    // free, and therefore invisible to a sweep that only looks for duplicates.
    // Rebuilt by hand from the finished state, with the unique index left live,
    // because that is what a rerun of a torn v8 actually finds.
    await adapter.execute(`UPDATE milestones SET "order" = 1000001 WHERE id = 't-late'`);
    await adapter.execute(`UPDATE milestones SET "order" = 1000003 WHERE id = 't-last'`);
    await adapter.execute("DELETE FROM schema_version WHERE version >= 8");

    await expect(runMigrations(adapter)).resolves.toBeUndefined();

    // Dense again, and in the sequence the interrupted run was aiming for:
    // the placed row keeps position 0 and the parked pair follow in the order
    // the park preserved.
    expect(await milestonesOf("tied")).toEqual([
      { id: "t-early", order: 0, updated_at: expect.any(Number) },
      { id: "t-late", order: 1, updated_at: expect.any(Number) },
      { id: "t-last", order: 2, updated_at: expect.any(Number) },
    ]);
    expect(await currentVersion()).toBe(10);
    // The parked arm must not widen the sweep: a project that was never broken
    // still keeps its sparse numbers.
    expect(await milestonesOf("untied")).toEqual([
      { id: "u-first", order: 0, updated_at: SEEDED_AT },
      { id: "u-second", order: 5, updated_at: SEEDED_AT },
    ]);
  });

  it("creates the unique index on a fresh database, in the same initDB", async () => {
    // `SCHEMA_SQL` no longer declares the index, so this is the case that would
    // silently lose it: a brand new database, schema then migrations, with no
    // legacy index and no rows to dedupe.
    const fresh = new SqlJsTestAdapter();
    await fresh.initialize();
    try {
      await fresh.execute(SCHEMA_SQL);
      await fresh.execute("PRAGMA foreign_keys = ON");
      await runMigrations(fresh);

      const rows = await fresh.select<Array<{ name: string; unique: number }>>(
        "PRAGMA index_list('milestones')"
      );
      const indexes = new Map(rows.map((row) => [row.name, row.unique]));

      expect(indexes.get("idx_milestones_project_order")).toBe(1);
      expect(indexes.has("idx_milestones_order")).toBe(false);
      expect(indexes.get("idx_milestones_project")).toBe(0);
    } finally {
      await fresh.close();
    }
  });
});
