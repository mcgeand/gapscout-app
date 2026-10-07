/**
 * `listProjects` counts, against real SQLite (#213).
 *
 * The project card stopped claiming "Active" and "Ready for mapping" and now
 * says how many steps and open gaps a project holds. Those two numbers come
 * from correlated subqueries in the list read, so there is a whole hidden
 * layer between the write and the card: two columns that exist nowhere in
 * `schema.sql`, a row type that has to name them, and a Zod schema that would
 * strip them silently if it were the base `ProjectSchema`. Only a real
 * database catches that, which is why this runs on sql.js rather than the
 * in-memory adapter — that one parses no aggregates at all.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGap,
  createMilestone,
  createProject,
  createStep,
  createTeam,
  listProjects,
  SCHEMA_SQL,
  updateGap,
} from "../services/db";
import { setDB } from "../services/db/connection";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

let adapter: SqlJsTestAdapter;

/** A project with the scaffolding a step needs: one team, one milestone. */
async function seedProject(name: string) {
  const projectId = await createProject({ name });
  const teamId = await createTeam({
    projectId,
    name: "Ops",
    color: "#201e1d",
    order: 0,
    tags: [],
  });
  const milestoneId = await createMilestone({
    projectId,
    name: "Main Flow",
    order: 0,
    relatedPolicies: [],
  });
  return { projectId, teamId, milestoneId };
}

async function addStep(
  projectId: string,
  teamId: string,
  milestoneId: string,
  order: number
) {
  return createStep({
    projectId,
    label: `Step ${order}`,
    teamId,
    milestoneId,
    order,
    suppliers: [],
    inputs: [],
    outputs: [],
    customers: [],
    systems: [],
    decision: false,
    branches: [],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

async function addGap(projectId: string, stepId: string) {
  return createGap({
    projectId,
    stepId,
    observed: "No handover",
    expected: "A handover",
    severity: "M",
    rootCause: "Policy",
    status: "Open",
    links: [],
  });
}

/** The summary for one project, by name. */
async function summaryFor(name: string) {
  const summary = (await listProjects()).find((p) => p.name === name);
  if (!summary) throw new Error(`No summary for ${name}`);
  return summary;
}

describe("listProjects counts (#213)", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    await adapter.execute(SCHEMA_SQL);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("counts a new project's steps and gaps at zero", async () => {
    await seedProject("Empty map");

    expect(await summaryFor("Empty map")).toMatchObject({
      stepCount: 0,
      openGapCount: 0,
    });
  });

  it("counts the steps and open gaps a project actually holds", async () => {
    const { projectId, teamId, milestoneId } = await seedProject("Order to Cash");
    const first = await addStep(projectId, teamId, milestoneId, 0);
    await addStep(projectId, teamId, milestoneId, 1);
    await addStep(projectId, teamId, milestoneId, 2);
    await addGap(projectId, first);
    await addGap(projectId, first);

    expect(await summaryFor("Order to Cash")).toMatchObject({
      stepCount: 3,
      openGapCount: 2,
    });
  });

  it("stops counting a gap once it is closed", async () => {
    const { projectId, teamId, milestoneId } = await seedProject("Procure to Pay");
    const stepId = await addStep(projectId, teamId, milestoneId, 0);
    const gapId = await addGap(projectId, stepId);
    await addGap(projectId, stepId);

    await updateGap(gapId, { status: "Closed" }, projectId);

    // The board header counts open gaps; a card saying "2 open gaps" beside a
    // header saying "1" would be the page disagreeing with itself.
    expect(await summaryFor("Procure to Pay")).toMatchObject({
      stepCount: 1,
      openGapCount: 1,
    });
  });

  it("counts each project separately", async () => {
    const a = await seedProject("Project A");
    await seedProject("Project B");
    await addStep(a.projectId, a.teamId, a.milestoneId, 0);
    await addStep(a.projectId, a.teamId, a.milestoneId, 1);

    expect(await summaryFor("Project A")).toMatchObject({ stepCount: 2 });
    expect(await summaryFor("Project B")).toMatchObject({ stepCount: 0 });
  });
});
