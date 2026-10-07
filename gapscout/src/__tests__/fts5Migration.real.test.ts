import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTeam, runMigrations, SCHEMA_SQL } from "../services/db";
import {
  buildGapContent,
  buildGlossaryContent,
  buildMilestoneContent,
  buildPolicyContent,
  buildStepContent,
  buildSystemContent,
  buildTeamContent,
} from "../services/searchIndex";
import { search } from "../services/searchService";
import { setDB } from "../services/db/connection";
import type { DatabaseAdapter } from "../services/db/dbInterface";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

const PROJECT_ID = "project-1";

const LEGACY_TABLES_SQL = `
  CREATE TABLE steps (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL,
    trigger TEXT, result TEXT, kpi TEXT, notes TEXT, validation_status TEXT
  );
  CREATE TABLE gaps (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, observed TEXT NOT NULL,
    expected TEXT NOT NULL, fix_idea TEXT, root_cause TEXT, order_num INTEGER
  );
  CREATE TABLE teams (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
    description TEXT, "order" INTEGER NOT NULL DEFAULT 0, tags TEXT
  );
  CREATE TABLE systems (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT, vendor TEXT
  );
  CREATE TABLE milestones (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT
  );
  CREATE TABLE policies (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
    content TEXT NOT NULL, test_notes TEXT
  );
  CREATE TABLE glossary (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, term TEXT NOT NULL,
    definition TEXT NOT NULL, acronym TEXT
  );
  CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
  INSERT INTO schema_version (version, applied_at) VALUES (3, 0);

  INSERT INTO steps (id, project_id, label, trigger, result, kpi, notes)
    VALUES ('step-1', '${PROJECT_ID}', ' Legacy step ', '', ' legacy result ', '', ' legacy notes ');
  INSERT INTO gaps (id, project_id, observed, expected, fix_idea, root_cause)
    VALUES ('gap-1', '${PROJECT_ID}', ' legacy observed ', ' legacy expected ', '', 'Config');
  INSERT INTO teams (id, project_id, name, color, description)
    VALUES ('team-1', '${PROJECT_ID}', ' Legacy team ', '#000000', '');
  INSERT INTO systems (id, project_id, name, description, vendor)
    VALUES ('system-1', '${PROJECT_ID}', ' Legacy system ', '', ' legacy vendor ');
  INSERT INTO milestones (id, project_id, name, description)
    VALUES ('milestone-1', '${PROJECT_ID}', ' Legacy milestone ', ' legacy description ');
  INSERT INTO policies (id, project_id, title, content, test_notes)
    VALUES ('policy-1', '${PROJECT_ID}', ' Legacy policy ', '', ' legacy notes ');
  INSERT INTO glossary (id, project_id, term, definition, acronym)
    VALUES ('glossary-1', '${PROJECT_ID}', ' Legacy glossary ', ' legacy definition ', '');
`;

async function createAdapter(): Promise<SqlJsTestAdapter> {
  const adapter = new SqlJsTestAdapter();
  await adapter.initialize();
  return adapter;
}

async function countIndexRows(adapter: DatabaseAdapter): Promise<number> {
  const rows = await adapter.select<Array<{ count: number }>>(
    "SELECT COUNT(*) AS count FROM search_index"
  );
  return rows[0]?.count ?? 0;
}

describe("v4 FTS5 migration on the real SQL.js engine", () => {
  let adapter: SqlJsTestAdapter;

  beforeEach(async () => {
    adapter = await createAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("supports FTS5 MATCH queries", async () => {
    await adapter.execute(
      "CREATE VIRTUAL TABLE search_index USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, project_id UNINDEXED, content)"
    );
    await adapter.execute(
      "INSERT INTO search_index (entity_type, entity_id, project_id, content) VALUES ($1, $2, $3, $4)",
      ["team", "team-1", PROJECT_ID, "approver workflow"]
    );

    const rows = await adapter.select<Array<{ entity_id: string }>>(
      "SELECT entity_id FROM search_index WHERE content MATCH $1",
      ["approver"]
    );

    expect(rows).toEqual([{ entity_id: "team-1" }]);
  });

  it("backfills all seven legacy entity types and remains duplicate-free when v4 is rerun", async () => {
    await adapter.execute(LEGACY_TABLES_SQL);

    await runMigrations(adapter);

    const rows = await adapter.select<Array<{ entity_type: string; content: string }>>(
      "SELECT entity_type, content FROM search_index WHERE content MATCH $1 AND project_id = $2 ORDER BY entity_type",
      ["legacy", PROJECT_ID]
    );

    expect(rows).toEqual([
      {
        entity_type: "gap",
        content: buildGapContent({
          id: "gap-1",
          projectId: PROJECT_ID,
          observed: " legacy observed ",
          expected: " legacy expected ",
          severity: "H",
          rootCause: "Config",
          status: "Open",
          links: [],
          createdAt: 0,
          updatedAt: 0,
        }),
      },
      {
        entity_type: "glossary",
        content: buildGlossaryContent({
          id: "glossary-1",
          projectId: PROJECT_ID,
          term: " Legacy glossary ",
          definition: " legacy definition ",
          relatedSteps: [],
          tags: [],
          createdAt: 0,
        }),
      },
      {
        entity_type: "milestone",
        content: buildMilestoneContent({
          id: "milestone-1",
          projectId: PROJECT_ID,
          name: " Legacy milestone ",
          order: 0,
          description: " legacy description ",
          relatedPolicies: [],
          createdAt: 0,
          updatedAt: 0,
        }),
      },
      {
        entity_type: "policy",
        content: buildPolicyContent({
          id: "policy-1",
          projectId: PROJECT_ID,
          title: " Legacy policy ",
          content: "",
          relatedMilestones: [],
          tags: [],
          testNotes: " legacy notes ",
          createdAt: 0,
          updatedAt: 0,
        }),
      },
      {
        entity_type: "step",
        content: buildStepContent({
          id: "step-1",
          projectId: PROJECT_ID,
          label: " Legacy step ",
          teamId: "team-1",
          milestoneId: "milestone-1",
          order: 0,
          suppliers: [],
          inputs: [],
          outputs: [],
          customers: [],
          systems: [],
          result: " legacy result ",
          notes: " legacy notes ",
          comments: [],
          links: [],
          gapIds: [],
          createdAt: 0,
          updatedAt: 0,
        }),
      },
      {
        entity_type: "system",
        content: buildSystemContent({
          id: "system-1",
          projectId: PROJECT_ID,
          name: " Legacy system ",
          description: "",
          vendor: " legacy vendor ",
          tags: [],
          createdAt: 0,
        }),
      },
      {
        entity_type: "team",
        content: buildTeamContent({
          id: "team-1",
          projectId: PROJECT_ID,
          name: " Legacy team ",
          color: "#000000",
          description: "",
          order: 0,
          tags: [],
          createdAt: 0,
        }),
      },
    ]);

    await adapter.execute("DELETE FROM schema_version WHERE version = 4");
    await runMigrations(adapter);

    expect(await countIndexRows(adapter)).toBe(7);
    expect(
      await adapter.select<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM search_index WHERE entity_type = $1 AND entity_id = $2",
        ["team", "team-1"]
      )
    ).toEqual([{ count: 1 }]);
  });

  it("allows a fresh schema entity create and MATCH search with a numeric rank", async () => {
    await adapter.execute(SCHEMA_SQL);
    await runMigrations(adapter);
    setDB(adapter);

    const teamId = await createTeam({
      projectId: PROJECT_ID,
      name: "Fresh approver team",
      color: "#000000",
      order: 0,
      tags: [],
    });

    const results = await search("approver", PROJECT_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      entityType: "team",
      entityId: teamId,
      projectId: PROJECT_ID,
    });
    expect(typeof results[0]?.rank).toBe("number");
  });
});
