/**
 * Migration v7 — `steps.team_id = ''` → the project's Unassigned team — on the
 * real SQL.js engine (#104).
 *
 * A mock adapter cannot check this. The `InMemoryAdapter` returns `[]` for any
 * SQL its regexes do not parse (#369), so a backfill test written against it
 * passes without the migration having done anything at all. What decides
 * whether this repair is safe is real SQLite: the `team_id = ''` filter, the
 * `teams` FK the empty string violates, and the FTS5 row the new team needs.
 *
 * The fixture therefore replays `SCHEMA_SQL` and then `runMigrations`, the way
 * `initDB` does, with foreign keys enforced from the moment the migration runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSteps, runMigrations, SCHEMA_SQL } from "../services/db";
import { setDB } from "../services/db/connection";
import { search } from "../services/searchService";
import { DEFAULT_COLORS } from "../data/constants";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

interface TeamShape {
  id: string;
  name: string;
  color: string;
  order: number;
}

interface StepShape {
  id: string;
  team_id: string;
  updated_at: number;
}

/**
 * A real timestamp: `StepSchema` requires `createdAt`/`updatedAt` to be > 0, so
 * a fixture at 0 would warn for a reason that has nothing to do with #104.
 *
 * Every seed below binds it once per column rather than reusing one numbered
 * placeholder: `SqlJsTestAdapter` rewrites `$n` to a positional `?`, so `$3`
 * twice becomes two parameters and the bind list runs short.
 */
const SEEDED_AT = 1_700_000_000_000;

let adapter: SqlJsTestAdapter;

async function teamsOf(projectId: string): Promise<TeamShape[]> {
  return adapter.select<TeamShape[]>(
    `SELECT id, name, color, "order" FROM teams WHERE project_id = $1 ORDER BY "order", id`,
    [projectId]
  );
}

async function stepsOf(projectId: string): Promise<StepShape[]> {
  return adapter.select<StepShape[]>(
    "SELECT id, team_id, updated_at FROM steps WHERE project_id = $1 ORDER BY id",
    [projectId]
  );
}

async function indexRows(): Promise<Array<Record<string, unknown>>> {
  return adapter.select<Array<Record<string, unknown>>>(
    "SELECT entity_type, entity_id, project_id, content FROM search_index ORDER BY entity_type, entity_id"
  );
}

async function addProject(id: string): Promise<void> {
  await adapter.execute(
    "INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)",
    [id, `Project ${id}`, SEEDED_AT, SEEDED_AT]
  );
  await adapter.execute(
    `INSERT INTO milestones (id, project_id, name, "order", created_at, updated_at)
     VALUES ($1, $2, 'Main', 1, $3, $4)`,
    [`m-${id}`, id, SEEDED_AT, SEEDED_AT]
  );
}

async function addTeam(id: string, projectId: string, name: string, order: number): Promise<void> {
  await adapter.execute(
    `INSERT INTO teams (id, project_id, name, color, "order", tags, created_at)
     VALUES ($1, $2, $3, $4, $5, '[]', $6)`,
    [id, projectId, name, DEFAULT_COLORS[0], order, SEEDED_AT]
  );
}

async function addStep(
  id: string,
  projectId: string,
  teamId: string,
  order: number,
  label = `Step ${id}`
): Promise<void> {
  await adapter.execute(
    `INSERT INTO steps (id, project_id, label, team_id, milestone_id, "order", created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, projectId, label, teamId, `m-${projectId}`, order, SEEDED_AT, SEEDED_AT]
  );
}

/**
 * Two projects as a pre-ZIP-381 wizard could leave them: A with steps the
 * wizard never gave an owner, B with the same damage but an `Unassigned` team
 * already in place from a later run.
 */
async function seedLegacyProjects(): Promise<void> {
  await addProject("A");
  await addTeam("t-a-general", "A", "General", 1);
  await addStep("s-a1", "A", "", 1);
  await addStep("s-a2", "A", "", 2);
  await addStep("s-a3", "A", "t-a-general", 3);

  await addProject("B");
  await addTeam("t-b-unassigned", "B", "Unassigned", 1);
  await addStep("s-b1", "B", "", 1);
}

/** Run the migration the way the app does: foreign keys on, nothing stubbed. */
async function migrate(): Promise<void> {
  await adapter.execute("PRAGMA foreign_keys = ON");
  await runMigrations(adapter);
}

async function unassignedTeam(projectId: string): Promise<TeamShape> {
  const teams = (await teamsOf(projectId)).filter((t) => t.name === "Unassigned");
  expect(teams).toHaveLength(1);
  return teams[0];
}

describe("v7 empty-team backfill on the real SQL.js engine", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    // A database as `initDB` leaves it: the live schema, then the version rows
    // for every migration below the one under test, so only v7 runs.
    await adapter.execute(SCHEMA_SQL);
    await adapter.execute(
      "INSERT INTO schema_version (version, applied_at) VALUES (2, 0), (3, 0), (4, 0), (5, 0), (6, 0)"
    );
    // Seeding the broken rows needs the FK off — `team_id = ''` is exactly the
    // value the constraint exists to refuse.
    await adapter.execute("PRAGMA foreign_keys = OFF");
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("really enforces foreign keys while the migration runs", async () => {
    // Guards the fixture: with the pragma silently off, every claim below about
    // pointing at a real team would hold over a database that enforces nothing.
    await seedLegacyProjects();
    await migrate();

    const rows = await adapter.select<Array<Record<string, unknown>>>("PRAGMA foreign_keys");
    expect(Object.values(rows[0])[0]).toBe(1);
    await expect(addStep("s-a9", "A", "no-such-team", 9)).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("files a project's empty-team steps under a new Unassigned team", async () => {
    await seedLegacyProjects();
    await migrate();

    const unassigned = await unassignedTeam("A");
    expect(unassigned.color).toBe(DEFAULT_COLORS[11]);
    expect(unassigned.order).toBe(2);

    expect(await stepsOf("A")).toEqual([
      { id: "s-a1", team_id: unassigned.id, updated_at: expect.any(Number) },
      { id: "s-a2", team_id: unassigned.id, updated_at: expect.any(Number) },
      // The owned step is untouched, `updated_at` included.
      { id: "s-a3", team_id: "t-a-general", updated_at: SEEDED_AT },
    ]);

    const repaired = await stepsOf("A");
    expect(repaired[0].updated_at).toBeGreaterThan(SEEDED_AT);
    expect(repaired[1].updated_at).toBeGreaterThan(SEEDED_AT);
  });

  it("reuses an Unassigned team the project already has", async () => {
    await seedLegacyProjects();
    await migrate();

    expect(await teamsOf("B")).toEqual([
      { id: "t-b-unassigned", name: "Unassigned", color: DEFAULT_COLORS[0], order: 1 },
    ]);
    expect(await stepsOf("B")).toEqual([
      { id: "s-b1", team_id: "t-b-unassigned", updated_at: expect.any(Number) },
    ]);
  });

  it("records schema version 10", async () => {
    await seedLegacyProjects();
    await migrate();

    const rows = await adapter.select<Array<{ version: number }>>(
      "SELECT MAX(version) AS version FROM schema_version"
    );
    expect(rows[0].version).toBe(10);
  });

  it("reads a repaired project through listSteps without a validation warning", async () => {
    await seedLegacyProjects();
    await migrate();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const steps = await listSteps("A");
      expect(steps).toHaveLength(3);
      expect(steps.every((s) => s.teamId.length > 0)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("still warns on that same path when a row really is invalid", async () => {
    // Positive control for the test above: without it, a `listSteps` that never
    // validated anything would pass just as quietly.
    await seedLegacyProjects();
    await migrate();
    await addStep("s-a4", "A", "t-a-general", 4, "");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await listSteps("A");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/schema validation failed/));
    } finally {
      warn.mockRestore();
    }
  });

  it("is a no-op when applied a second time", async () => {
    await seedLegacyProjects();
    await migrate();

    const teamsAfterFirst = [...(await teamsOf("A")), ...(await teamsOf("B"))];
    const stepsAfterFirst = [...(await stepsOf("A")), ...(await stepsOf("B"))];
    // The index rows too — but a clean rerun proves only that the
    // `team_id = ''` filter finds nothing left to touch, not that the index
    // INSERT's `WHERE NOT EXISTS` guard fires: there is no `''` step left, so
    // that INSERT is never reached at all. The torn-run case below is what
    // actually exercises the guard.
    const indexAfterFirst = await indexRows();

    // The runner short-circuits on MAX(version), so replay it the way a database
    // with a stale version row would: drop the v7 marker and rerun. Every
    // marker above it goes too — MAX(version) is the gate, so leaving v8 in
    // place would skip v7 instead of replaying it.
    await adapter.execute("DELETE FROM schema_version WHERE version >= 7");
    await runMigrations(adapter);

    expect([...(await teamsOf("A")), ...(await teamsOf("B"))]).toEqual(teamsAfterFirst);
    expect([...(await stepsOf("A")), ...(await stepsOf("B"))]).toEqual(stepsAfterFirst);
    expect(await indexRows()).toEqual(indexAfterFirst);
  });

  it("finishes a run torn after the team was created", async () => {
    await seedLegacyProjects();
    await migrate();
    const unassigned = await unassignedTeam("A");

    // The tear: the team and its index row landed, but the steps UPDATE that
    // assigns them to it did not — put s-a1/s-a2 back to `''` without
    // touching s-a3, which that UPDATE's `WHERE team_id = ''` never matched.
    await adapter.execute("PRAGMA foreign_keys = OFF");
    await adapter.execute(
      "UPDATE steps SET team_id = '' WHERE project_id = 'A' AND team_id = $1",
      [unassigned.id]
    );
    // `>= 7` for the same reason as the rerun case above: MAX(version) gates
    // the replay, so a v8 marker left behind would skip v7 entirely.
    await adapter.execute("DELETE FROM schema_version WHERE version >= 7");
    await adapter.execute("PRAGMA foreign_keys = ON");

    await runMigrations(adapter);

    expect((await teamsOf("A")).filter((t) => t.name === "Unassigned")).toHaveLength(1);
    expect((await indexRows()).filter((r) => r.entity_id === unassigned.id)).toHaveLength(1);
    expect((await stepsOf("A")).filter((s) => s.team_id === unassigned.id)).toHaveLength(2);
  });

  it("creates no Unassigned team when no step is missing an owner", async () => {
    await addProject("C");
    await addTeam("t-c-general", "C", "General", 1);
    await addStep("s-c1", "C", "t-c-general", 1);

    await migrate();

    expect(await teamsOf("C")).toEqual([
      { id: "t-c-general", name: "General", color: DEFAULT_COLORS[0], order: 1 },
    ]);
    expect(await stepsOf("C")).toEqual([
      { id: "s-c1", team_id: "t-c-general", updated_at: SEEDED_AT },
    ]);
  });

  it("indexes the team it creates so search can find it", async () => {
    await seedLegacyProjects();
    await migrate();

    const unassigned = await unassignedTeam("A");
    const results = await search("Unassigned", "A");

    expect(results).toEqual([
      expect.objectContaining({
        entityType: "team",
        entityId: unassigned.id,
        projectId: "A",
        content: "Unassigned",
      }),
    ]);
  });

  it("leaves an orphaned step alone rather than bricking on the team insert", async () => {
    // A `''`-team step whose project row is gone — e.g. a partial delete that
    // removed the project but not its steps. Seeded with FKs off, the same as
    // every other broken row in this file.
    await addStep("s-ghost", "ghost", "", 1, "Orphan Step");

    await migrate();

    expect(await teamsOf("ghost")).toEqual([]);
    const rows = await adapter.select<Array<{ version: number }>>(
      "SELECT MAX(version) AS version FROM schema_version"
    );
    expect(rows[0].version).toBe(10);
  });
});
