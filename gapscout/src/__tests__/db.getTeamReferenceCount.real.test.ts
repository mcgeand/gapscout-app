/**
 * `getTeamReferenceCount` through the real SQL.js engine (#173).
 *
 * The sibling `db.getTeamUsageCount.test.ts` asserts the SQL string against an
 * adapter mock, which cannot tell a working predicate from a broken one. This
 * function's whole job is a substring match inside a JSON TEXT column, so the
 * only useful test is one that runs it: "Budget" must not match
 * `["Budget Owner"]`, and "finance" must not match `["Finance"]` — the second
 * is exactly what a `LIKE` predicate would get wrong, since SQLite's LIKE is
 * case-insensitive for ASCII.
 *
 * Harness copied from `db.milestones.roundtrip.real.test.ts`: SCHEMA_SQL, then
 * the migrations, then `PRAGMA foreign_keys = ON` (a pragma is a no-op inside
 * an open transaction, so it goes after), so every step below hangs off a real
 * project, team and milestone the way the Tauri build requires.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMilestone,
  createProject,
  createStep,
  createTeam,
  getTeamReferenceCount,
  getTeamUsageCount,
  runMigrations,
  SCHEMA_SQL,
} from "../services/db";
import { setDB } from "../services/db/connection";
import type { Step } from "../data/types";
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
 * Inserts a step with `suppliers`/`customers` left as SQL `NULL`, which
 * `createStep` can never produce — it always serializes an array, even an
 * empty one, to `'[]'`. A NULL column is reachable in the real app only
 * through a legacy row or a hand-edited database, but the schema allows it
 * (`schema.sql`: `suppliers TEXT`, `customers TEXT`, no `NOT NULL`), and
 * `instr(NULL, ...)` evaluates to NULL rather than 0, which makes `NULL > 0`
 * NULL too. The predicate only works if SQLite's `OR` still resolves true
 * when just the other side matches — this is the direct proof of that.
 */
async function insertRawStep(
  adapter: SqlJsTestAdapter,
  id: string,
  projectId: string,
  teamId: string,
  milestoneId: string,
  order: number,
  suppliers: string | null,
  customers: string | null
): Promise<void> {
  const now = Date.now();
  await adapter.execute(
    `INSERT INTO steps (
      id, project_id, label, team_id, milestone_id, "order",
      suppliers, customers, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, projectId, "Raw step", teamId, milestoneId, order, suppliers, customers, now, now]
  );
}

/** `createStep` takes `Omit<Step, "id">`, so the timestamps have to be supplied even though the INSERT stamps its own. */
function stepData(
  projectId: string,
  teamId: string,
  milestoneId: string,
  label: string,
  order: number,
  sipoc: { suppliers?: string[]; customers?: string[] } = {}
): Omit<Step, "id"> {
  const now = Date.now();
  return {
    projectId,
    label,
    teamId,
    milestoneId,
    order,
    suppliers: sipoc.suppliers ?? [],
    inputs: [],
    outputs: [],
    customers: sipoc.customers ?? [],
    systems: [],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("getTeamReferenceCount on the real SQL.js engine", () => {
  let adapter: SqlJsTestAdapter;
  let projectId: string;
  let teamId: string;
  let milestoneId: string;

  beforeEach(async () => {
    adapter = await createAdapter();
    await adapter.execute("PRAGMA foreign_keys = ON");
    expect(await adapter.select("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    projectId = await createProject({ name: "Order to Cash" });
    teamId = await createTeam({ projectId, name: "Operations", color: "#201e1d", order: 0, tags: [] });
    milestoneId = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("counts a step naming the team as a supplier and a step naming it as a customer", async () => {
    await createStep(
      stepData(projectId, teamId, milestoneId, "Receive request", 0, { suppliers: ["Finance"] })
    );
    await createStep(
      stepData(projectId, teamId, milestoneId, "Send statement", 1, { customers: ["Finance"] })
    );
    await createStep(
      stepData(projectId, teamId, milestoneId, "File the paperwork", 2, {
        suppliers: ["Legal"],
        customers: ["Legal"],
      })
    );

    expect(await getTeamReferenceCount("Finance", projectId)).toBe(2);
  });

  it("counts a step once when it names the team as both supplier and customer", async () => {
    await createStep(
      stepData(projectId, teamId, milestoneId, "Reconcile", 0, {
        suppliers: ["Finance"],
        customers: ["Finance"],
      })
    );

    expect(await getTeamReferenceCount("Finance", projectId)).toBe(1);
  });

  it("does not match a name that is only a prefix of a longer entry", async () => {
    await createStep(
      stepData(projectId, teamId, milestoneId, "Approve spend", 0, {
        suppliers: ["Budget Owner"],
        customers: ["Budget Holder"],
      })
    );

    expect(await getTeamReferenceCount("Budget", projectId)).toBe(0);
    expect(await getTeamReferenceCount("Budget Owner", projectId)).toBe(1);
  });

  it("matches case-sensitively, the way StepRow resolves a chip to a team", async () => {
    await createStep(
      stepData(projectId, teamId, milestoneId, "Receive request", 0, { suppliers: ["Finance"] })
    );

    expect(await getTeamReferenceCount("Finance", projectId)).toBe(1);
    expect(await getTeamReferenceCount("finance", projectId)).toBe(0);
    expect(await getTeamReferenceCount("FINANCE", projectId)).toBe(0);
  });

  it("counts a step with a NULL suppliers column when customers names the team", async () => {
    await insertRawStep(adapter, "step-null-suppliers", projectId, teamId, milestoneId, 0, null, '["Finance"]');

    expect(await getTeamReferenceCount("Finance", projectId)).toBe(1);
  });

  it("does not count a step where both suppliers and customers are NULL", async () => {
    await insertRawStep(adapter, "step-null-both", projectId, teamId, milestoneId, 0, null, null);

    expect(await getTeamReferenceCount("Finance", projectId)).toBe(0);
  });

  it("ignores steps in another project", async () => {
    const otherProjectId = await createProject({ name: "Procure to Pay" });
    const otherTeamId = await createTeam({
      projectId: otherProjectId,
      name: "Operations",
      color: "#201e1d",
      order: 0,
      tags: [],
    });
    const otherMilestoneId = await createMilestone({
      projectId: otherProjectId,
      name: "Sourcing",
      order: 0,
      relatedPolicies: [],
    });
    await createStep(
      stepData(otherProjectId, otherTeamId, otherMilestoneId, "Raise PO", 0, {
        suppliers: ["Finance"],
      })
    );

    expect(await getTeamReferenceCount("Finance", projectId)).toBe(0);
    expect(await getTeamReferenceCount("Finance", otherProjectId)).toBe(1);
  });

  it("returns 0 when no step names the team, and does not confuse ownership with a reference", async () => {
    const financeTeamId = await createTeam({
      projectId,
      name: "Finance",
      color: "#201e1d",
      order: 1,
      tags: [],
    });
    // Owned by Finance, but nothing names "Finance" in its SIPOC.
    await createStep(stepData(projectId, financeTeamId, milestoneId, "Post journal", 0));

    expect(await getTeamUsageCount(financeTeamId, projectId)).toBe(1);
    expect(await getTeamReferenceCount("Finance", projectId)).toBe(0);
  });
});
