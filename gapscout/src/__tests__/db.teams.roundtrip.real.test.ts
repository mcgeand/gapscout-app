/**
 * Team CRUD through the real SQL.js FTS5 engine (#114).
 *
 * `updateTeam` built its SET clause from whatever `changes` carried and then
 * always executed, so `updateTeam(id, {}, projectId)` emitted
 * `UPDATE teams SET  WHERE ...` — a syntax error on real SQLite. The
 * InMemoryAdapter cannot show that: it returns `rowsAffected: 0` for SQL it
 * does not parse (#369), so the statement looks like a harmless no-op there.
 * Only the real engine rejects it, which is why this file runs on
 * `SqlJsTestAdapter` rather than the in-memory one. Remove the
 * `if (updates.length === 0) return;` guard in `updateTeam` and the
 * empty-changes case below is the one that fails.
 *
 * `teams` was the last registry updater without the guard; `systems` and
 * `glossary` share the no-timestamp shape and were already guarded.
 *
 * `validateRow` only warns, so a row that violates `TeamSchema` still lists.
 * That makes "no warning" a real assertion rather than a tautology, and the
 * last case proves the spy can see a warning when there is one.
 *
 * Foreign keys are ON, matching the Tauri build (sqlx defaults, per
 * connection), so every row hangs off a project seeded with `createProject`
 * and the step in the RESTRICT case hangs off a real team and a real
 * milestone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMilestone,
  createProject,
  createStep,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  runMigrations,
  SCHEMA_SQL,
  updateTeam,
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

describe("team CRUD on the real SQL.js FTS5 engine", () => {
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

  it("lists teams created out of order sorted by order, every field round-tripped, with no warning", async () => {
    const warnings = captureWarnings();

    const secondId = await createTeam({
      projectId,
      name: "Fulfilment",
      color: "#201e1d",
      order: 2,
      description: "Ships the order",
      tags: ["warehouse", "night shift"],
    });
    const firstId = await createTeam({
      projectId,
      name: "Intake",
      color: "#ec3013",
      order: 1,
      tags: [],
    });

    const listed = await listTeams(projectId);
    const seen = warnings.read();

    expect(listed.map((team) => team.id)).toEqual([firstId, secondId]);
    expect(listed[0]).toEqual({
      id: firstId,
      projectId,
      name: "Intake",
      color: "#ec3013",
      description: undefined,
      order: 1,
      tags: [],
      createdAt: expect.any(Number),
    });
    expect(listed[1]).toEqual({
      id: secondId,
      projectId,
      name: "Fulfilment",
      color: "#201e1d",
      description: "Ships the order",
      order: 2,
      tags: ["warehouse", "night shift"],
      createdAt: expect.any(Number),
    });
    expect(seen).toEqual([]);
  });

  it("gets a team by id and returns null through the wrong project scope", async () => {
    const id = await createTeam({ projectId, name: "Intake", color: "#201e1d", order: 0, tags: ["ops"] });
    const otherProjectId = await createProject({ name: "Procure to Pay" });
    const otherId = await createTeam({ projectId: otherProjectId, name: "Sourcing", color: "#201e1d", order: 0, tags: [] });

    expect(await getTeam(id)).toMatchObject({ id, projectId, name: "Intake", tags: ["ops"] });
    expect(await getTeam(id, projectId)).toMatchObject({ id, name: "Intake" });
    expect(await getTeam(id, otherProjectId)).toBeNull();

    const listed = await listTeams(projectId);
    expect(listed.map((team) => team.id)).toEqual([id]);
    expect(listed.map((team) => team.id)).not.toContain(otherId);
  });

  it("renames and retags on update, leaves the untouched columns alone, and the FTS index follows", async () => {
    const id = await createTeam({
      projectId,
      name: "Intake",
      color: "#201e1d",
      order: 1,
      description: "Receives the request",
      tags: ["ops"],
    });

    const before = await getTeam(id, projectId);
    expect(before).not.toBeNull();
    expect(await search("Intake", projectId)).toHaveLength(1);

    await updateTeam(id, { name: "Fulfilment", tags: ["warehouse", "night shift"] }, projectId);

    const after = await getTeam(id, projectId);
    expect(after).toEqual({
      id,
      projectId,
      name: "Fulfilment",
      color: "#201e1d",
      description: "Receives the request",
      order: 1,
      tags: ["warehouse", "night shift"],
      createdAt: before?.createdAt,
    });

    // `buildTeamContent` indexes name and description only, so the rename moves
    // the index entry and the retag is invisible to search by design.
    expect(await search("Intake", projectId)).toHaveLength(0);
    expect(await search("Fulfilment", projectId)).toHaveLength(1);
  });

  it("accepts empty changes without throwing and writes nothing", async () => {
    const id = await createTeam({
      projectId,
      name: "Intake",
      color: "#201e1d",
      order: 1,
      description: "Receives the request",
      tags: ["ops"],
    });
    // A second indexed row, so this row isn't the only one in `search_index`.
    // SQLite reuses rowid 1 for the next insert once a table is completely
    // empty, which would make a delete-then-reinsert of a lone row invisible
    // to the assertion below. With a sibling row still present, a reindex is
    // forced to take a rowid above the table's current high-water mark.
    await createTeam({ projectId, name: "Fulfilment", color: "#201e1d", order: 2, tags: [] });

    const rowBefore = await adapter.select("SELECT * FROM teams WHERE id = $1", [id]);
    // `reindexEntity` is a DELETE then an INSERT, so a reindex gives the row a
    // fresh rowid even when the indexed content is byte-for-byte identical. A
    // COUNT comparison can't see that: it stays 1 whether the row was left
    // alone or deleted and reinserted. The rowid is the only observable that
    // distinguishes "untouched" from "reindexed with the same content".
    const rowidBefore = await adapter.select(
      "SELECT rowid FROM search_index WHERE entity_type = $1 AND entity_id = $2",
      ["team", id]
    );

    // Without the guard this is `UPDATE teams SET  WHERE ...`, which real
    // SQLite rejects with a syntax error before it ever reaches `getTeam`.
    await expect(updateTeam(id, {}, projectId)).resolves.toBeUndefined();

    expect(await adapter.select("SELECT * FROM teams WHERE id = $1", [id])).toEqual(rowBefore);
    expect(
      await adapter.select(
        "SELECT rowid FROM search_index WHERE entity_type = $1 AND entity_id = $2",
        ["team", id]
      )
    ).toEqual(rowidBefore);
  });

  it("does not update or delete a team through the wrong project scope", async () => {
    const id = await createTeam({ projectId, name: "Intake", color: "#201e1d", order: 0, tags: [] });
    const secondId = await createTeam({ projectId, name: "Fulfilment", color: "#201e1d", order: 1, tags: [] });
    const otherProjectId = await createProject({ name: "Procure to Pay" });

    // Neither call throws: `updateTeam`'s WHERE clause matches zero rows and
    // `deleteTeam` returns early when `getTeam` finds nothing in that scope, so
    // both are silent no-ops rather than a rejection or a result to check.
    await updateTeam(id, { name: "Changed" }, otherProjectId);
    await deleteTeam(id, otherProjectId);

    expect(await getTeam(id, projectId)).toMatchObject({ id, name: "Intake" });
    expect(await search("Intake", projectId)).toHaveLength(1);
    expect(await listTeams(projectId)).toEqual([
      expect.objectContaining({ id }),
      expect.objectContaining({ id: secondId }),
    ]);
  });

  it("deletes the row out of the list, out of getTeam and out of the FTS index", async () => {
    const id = await createTeam({
      projectId,
      name: "Fulfilment",
      color: "#201e1d",
      order: 0,
      description: "Ships the order",
      tags: [],
    });
    const survivorId = await createTeam({ projectId, name: "Intake", color: "#201e1d", order: 1, tags: [] });
    expect(await search("Fulfilment", projectId)).toHaveLength(1);

    await deleteTeam(id, projectId);

    expect(await listTeams(projectId)).toEqual([expect.objectContaining({ id: survivorId })]);
    expect(await getTeam(id, projectId)).toBeNull();
    expect(await getTeam(id)).toBeNull();
    expect(await search("Fulfilment", projectId)).toHaveLength(0);
    expect(await getTeam(survivorId, projectId)).not.toBeNull();
  });

  it("rejects deleting a team a step still references, via ON DELETE RESTRICT", async () => {
    const teamId = await createTeam({ projectId, name: "Operations", color: "#201e1d", order: 0, tags: [] });
    const milestoneId = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
    await createStep(stepData(projectId, teamId, milestoneId, "Receive request", 0));

    await expect(deleteTeam(teamId, projectId)).rejects.toThrow();

    // The row survives, and so does its index entry: `deleteTeam` drops the FTS
    // row only after the DELETE succeeds, so a rejected delete leaves the team
    // searchable (#426).
    expect(await getTeam(teamId, projectId)).not.toBeNull();
    expect(
      await adapter.select(
        "SELECT COUNT(*) AS count FROM search_index WHERE entity_type = 'team' AND entity_id = $1",
        [teamId]
      )
    ).toEqual([{ count: 1 }]);
    expect(await search("Operations", projectId)).toEqual([
      expect.objectContaining({ entityType: "team", entityId: teamId }),
    ]);
  });

  it("treats a NULL tags column as [] with no warning", async () => {
    await adapter.execute(
      `INSERT INTO teams (id, project_id, name, color, description, "order", tags, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["team-null-tags", projectId, "Intake", "#201e1d", null, 0, null, Date.now()]
    );

    const warnings = captureWarnings();
    const listed = await listTeams(projectId);
    const seen = warnings.read();

    expect(listed).toHaveLength(1);
    expect(listed[0].tags).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("warns when a stored row violates TeamSchema instead of hiding it", async () => {
    // Straight past `createTeam`, because nothing in the app writes this.
    // `TeamSchema` requires `order >= 0`; -1 is the cheapest violation that no
    // column constraint rejects first.
    await adapter.execute(
      `INSERT INTO teams (id, project_id, name, color, description, "order", tags, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ["team-invalid", projectId, "Negative order", "#201e1d", null, -1, "[]", Date.now()]
    );

    const warnings = captureWarnings();
    const listed = await listTeams(projectId);
    const seen = warnings.read();

    // The row still comes back: validation warns, it does not filter.
    expect(listed.map((team) => team.id)).toEqual(["team-invalid"]);
    expect(seen.join("\n")).toContain("schema validation failed");
    expect(seen.join("\n")).toContain("team[team-invalid]");
  });
});
