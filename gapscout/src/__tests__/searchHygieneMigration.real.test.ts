/**
 * Migrations v9–v10 — orphaned search_index sweep and step-comment reindex (#374,
 * #378) on the real SQL.js FTS5 engine.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, SCHEMA_SQL } from "../services/db";
import { buildStepContent } from "../services/searchIndex";
import { setDB } from "../services/db/connection";
import { search } from "../services/searchService";
import { DEFAULT_COLORS } from "../data/constants";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

const SEEDED_AT = 1_700_000_000_000;
const PROJECT_ID = "proj-hygiene";
const GHOST_PROJECT_ID = "ghost-project-deleted";
const STEP_ID = "step-with-comment";
const UNIQUE_COMMENT = "xylophoneretrofit378";

let adapter: SqlJsTestAdapter;

async function orphanIndexCount(): Promise<number> {
  const rows = await adapter.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM search_index
     WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = search_index.project_id)`
  );
  return rows[0]?.count ?? 0;
}

async function stepIndexCount(stepId: string): Promise<number> {
  const rows = await adapter.select<Array<{ count: number }>>(
    "SELECT COUNT(*) AS count FROM search_index WHERE entity_type = $1 AND entity_id = $2",
    ["step", stepId]
  );
  return rows[0]?.count ?? 0;
}

async function seedProjectWithIndexedStep(): Promise<void> {
  await adapter.execute(
    "INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)",
    [PROJECT_ID, "Hygiene project", SEEDED_AT, SEEDED_AT]
  );
  await adapter.execute(
    `INSERT INTO milestones (id, project_id, name, "order", created_at, updated_at)
     VALUES ($1, $2, 'Main', 1, $3, $4)`,
    [`m-${PROJECT_ID}`, PROJECT_ID, SEEDED_AT, SEEDED_AT]
  );
  await adapter.execute(
    `INSERT INTO teams (id, project_id, name, color, "order", tags, created_at)
     VALUES ($1, $2, 'General', $3, 1, '[]', $4)`,
    [`t-${PROJECT_ID}`, PROJECT_ID, DEFAULT_COLORS[0], SEEDED_AT]
  );

  const comments = JSON.stringify([{ id: "c1", text: UNIQUE_COMMENT, author: "test", createdAt: SEEDED_AT }]);
  await adapter.execute(
    `INSERT INTO steps (
       id, project_id, label, team_id, milestone_id, "order", comments,
       suppliers, inputs, outputs, customers, systems, links, gap_ids,
       created_at, updated_at
     ) VALUES ($1, $2, 'Approve PO', $3, $4, 1, $5, '[]', '[]', '[]', '[]', '[]', '[]', '[]', $6, $7)`,
    [STEP_ID, PROJECT_ID, `t-${PROJECT_ID}`, `m-${PROJECT_ID}`, comments, SEEDED_AT, SEEDED_AT]
  );

  // Stale index row as v4 left it — label only, no comment text (#378).
  await adapter.execute(
    "INSERT INTO search_index (entity_type, entity_id, project_id, content) VALUES ($1, $2, $3, $4)",
    ["step", STEP_ID, PROJECT_ID, "Approve PO"]
  );
}

async function seedOrphanedIndexRows(): Promise<void> {
  const orphans: Array<[string, string, string]> = [
    ["team", "orphan-team", GHOST_PROJECT_ID],
    ["system", "orphan-system", GHOST_PROJECT_ID],
    ["step", "orphan-step", GHOST_PROJECT_ID],
    ["milestone", "orphan-milestone", GHOST_PROJECT_ID],
  ];
  for (const [type, id, projectId] of orphans) {
    await adapter.execute(
      "INSERT INTO search_index (entity_type, entity_id, project_id, content) VALUES ($1, $2, $3, $4)",
      [type, id, projectId, "ghost content"]
    );
  }
}

async function migrateFromV8(): Promise<void> {
  await adapter.execute("PRAGMA foreign_keys = ON");
  await runMigrations(adapter);
}

describe("search index hygiene migrations on the real SQL.js engine", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    await adapter.execute(SCHEMA_SQL);
    await adapter.execute(
      "INSERT INTO schema_version (version, applied_at) VALUES (2, 0), (3, 0), (4, 0), (5, 0), (6, 0), (7, 0), (8, 0)"
    );
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("v9 removes search_index rows whose project no longer exists", async () => {
    await seedProjectWithIndexedStep();
    await seedOrphanedIndexRows();

    expect(await orphanIndexCount()).toBe(4);

    await migrateFromV8();

    expect(await orphanIndexCount()).toBe(0);
    expect(await stepIndexCount(STEP_ID)).toBe(1);
  });

  it("v10 makes a pre-#366 step comment searchable without a save", async () => {
    await seedProjectWithIndexedStep();

    const before = await search(UNIQUE_COMMENT, PROJECT_ID);
    expect(before).toHaveLength(0);

    await migrateFromV8();

    const after = await search(UNIQUE_COMMENT, PROJECT_ID);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      entityType: "step",
      entityId: STEP_ID,
      projectId: PROJECT_ID,
    });
  });

  it("v10 reindex is idempotent — one index row per step when replayed", async () => {
    await seedProjectWithIndexedStep();
    await migrateFromV8();

    const expectedContent = buildStepContent({
      id: STEP_ID,
      projectId: PROJECT_ID,
      label: "Approve PO",
      teamId: `t-${PROJECT_ID}`,
      milestoneId: `m-${PROJECT_ID}`,
      order: 1,
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
      systems: [],
      comments: [{ id: "c1", text: UNIQUE_COMMENT, author: "test", createdAt: SEEDED_AT }],
      links: [],
      gapIds: [],
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });

    expect(await stepIndexCount(STEP_ID)).toBe(1);

    await adapter.execute("DELETE FROM schema_version WHERE version >= 9");
    await runMigrations(adapter);

    expect(await stepIndexCount(STEP_ID)).toBe(1);
    const rows = await adapter.select<Array<{ content: string }>>(
      "SELECT content FROM search_index WHERE entity_type = $1 AND entity_id = $2",
      ["step", STEP_ID]
    );
    expect(rows[0]?.content).toBe(expectedContent);
  });
});
