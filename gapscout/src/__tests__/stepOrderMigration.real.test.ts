/**
 * The v5 renumbering migration, on the real SQL.js engine.
 *
 * A mock adapter cannot check this: the whole migration is one DENSE_RANK
 * window function and three correlated updates, so the thing under test is the
 * SQL itself. #299 shipped it to repair projects holding a project-wide
 * sequence, and getting it wrong rewrites the user's process.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, SCHEMA_SQL } from "../services/db";
import { setDB } from "../services/db/connection";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

const PROJECT_ID = "project-1";

let adapter: SqlJsTestAdapter;

async function seedProjectWideSequence(): Promise<void> {
  await adapter.execute(`
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES ('${PROJECT_ID}', 'P2P - Acme Corp', 0, 0)
  `);
  await adapter.execute(`
    INSERT INTO milestones (id, project_id, name, "order", created_at, updated_at) VALUES
      ('requisition',    '${PROJECT_ID}', 'Requisition',    0, 0, 0),
      ('approval',       '${PROJECT_ID}', 'Approval',       1, 0, 0),
      ('purchase-order', '${PROJECT_ID}', 'Purchase Order', 2, 0, 0),
      ('payment',        '${PROJECT_ID}', 'Payment',        3, 0, 0)
  `);
  await adapter.execute(`
    INSERT INTO teams (id, project_id, name, color, "order", created_at)
    VALUES ('team-1', '${PROJECT_ID}', 'Operations', '#000000', 0, 0)
  `);
  // The 08-31 QA fixture: one sequence running 1..6 across four milestones.
  await adapter.execute(`
    INSERT INTO steps (id, project_id, label, team_id, milestone_id, "order", created_at, updated_at) VALUES
      ('s1', '${PROJECT_ID}', 'Create Purchase Requisition', 'team-1', 'requisition',    1, 0, 0),
      ('s2', '${PROJECT_ID}', 'Submit for Budget Check',     'team-1', 'requisition',    2, 0, 0),
      ('s3', '${PROJECT_ID}', 'Validate Budget',             'team-1', 'approval',       3, 0, 0),
      ('s4', '${PROJECT_ID}', 'Senior Manager Approval',     'team-1', 'approval',       4, 0, 0),
      ('s5', '${PROJECT_ID}', 'Create PO',                   'team-1', 'purchase-order', 5, 0, 0),
      ('s6', '${PROJECT_ID}', 'Pay Invoice',                 'team-1', 'payment',        6, 0, 0)
  `);
}

async function stepOrders(): Promise<Array<[string, string, number]>> {
  const rows = await adapter.select<Array<{ id: string; milestone_id: string; order: number }>>(
    `SELECT id, milestone_id, "order" FROM steps ORDER BY milestone_id, "order", id`
  );
  return rows.map((r) => [r.id, r.milestone_id, r.order]);
}

describe("v5 step order renumbering on the real SQL.js engine", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    await adapter.execute(SCHEMA_SQL);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("renumbers a project-wide sequence to 1..n within each milestone", async () => {
    await seedProjectWideSequence();

    await runMigrations(adapter);

    expect(await stepOrders()).toEqual([
      ["s3", "approval", 1],
      ["s4", "approval", 2],
      ["s6", "payment", 1],
      ["s5", "purchase-order", 1],
      ["s1", "requisition", 1],
      ["s2", "requisition", 2],
    ]);
  });

  it("leaves the process in the same order it was already in", async () => {
    await seedProjectWideSequence();

    await runMigrations(adapter);

    // Renumbering must not reshuffle anybody: reading back by (milestone order,
    // step order) has to give the sequence the user authored.
    const rows = await adapter.select<Array<{ id: string }>>(`
      SELECT s.id FROM steps s
      JOIN milestones m ON m.id = s.milestone_id
      ORDER BY m."order", s."order"
    `);
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
  });

  it("is a no-op on a project already numbered within its milestones", async () => {
    await seedProjectWideSequence();
    await runMigrations(adapter);
    const afterFirst = await stepOrders();

    // Force it to run again against the already-correct data.
    await adapter.execute("DELETE FROM schema_version WHERE version = 5");
    await runMigrations(adapter);

    expect(await stepOrders()).toEqual(afterFirst);
  });

  it("keeps parallel steps sharing one position", async () => {
    await seedProjectWideSequence();
    // Two steps deliberately at the same position — the grid draws them with
    // `∥`. Ordinal numbering would split them into a sequence nobody authored.
    await adapter.execute(`
      INSERT INTO steps (id, project_id, label, team_id, milestone_id, "order", created_at, updated_at)
      VALUES ('s3b', '${PROJECT_ID}', 'Parallel Check', 'team-1', 'approval', 3, 0, 0)
    `);

    await runMigrations(adapter);

    const approval = (await stepOrders()).filter(([, milestoneId]) => milestoneId === "approval");
    expect(approval).toEqual([
      ["s3", "approval", 1],
      ["s3b", "approval", 1],
      ["s4", "approval", 2],
    ]);
  });

  it("renumbers process gaps alongside the steps they sit among", async () => {
    await seedProjectWideSequence();
    // A gap reserving position 4 pushes the steps after it along, so the old
    // project-wide sequence reads 1,2,3,[gap 4],5,6,7. Renumbering the steps
    // alone would leave the gap pointing at a position that no longer exists.
    await adapter.execute(`UPDATE steps SET "order" = "order" + 1 WHERE "order" >= 4`);
    await adapter.execute(`
      INSERT INTO gaps (id, project_id, observed, expected, severity, status, order_num, milestone_id, created_at, updated_at)
      VALUES ('g1', '${PROJECT_ID}', 'Missing approver', 'An approver is named', 'M', 'Open', 4, 'approval', 0, 0)
    `);

    await runMigrations(adapter);

    const gap = await adapter.select<Array<{ order_num: number }>>(
      "SELECT order_num FROM gaps WHERE id = 'g1'"
    );
    // Approval now runs: Validate Budget 1, the gap 2, Senior Approval 3.
    expect(gap[0].order_num).toBe(2);
    const approval = (await stepOrders()).filter(([, milestoneId]) => milestoneId === "approval");
    expect(approval).toEqual([
      ["s3", "approval", 1],
      ["s4", "approval", 3],
    ]);
  });
});
