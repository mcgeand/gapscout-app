/**
 * `projects.updated_at` moves when anything the project owns is written (#395).
 *
 * Before this, the column moved only when `updateProject` wrote the project's
 * own name, description or state. `listProjects` sorts by it, so a project
 * whose steps and gaps were edited all afternoon sat below one that had been
 * renamed months ago and not opened since — the grid claimed to be ordered by
 * recency while reporting nothing of the sort.
 *
 * Real SQL.js, not `InMemoryAdapter`: the ordering case below reads the list
 * through `listProjects`, whose correlated count subqueries and
 * `ORDER BY p.updated_at DESC` are a shape that adapter does not parse at all.
 *
 * Foreign keys are asserted ON rather than assumed, and that is about the rows
 * hanging off the project, not the touch itself: every entity below is seeded
 * against a project id, and the delete cases depend on the RESTRICT that
 * `steps` declares on `team_id` and `milestone_id` to pick a subject the delete
 * is allowed to remove.
 *
 * The timestamps are separated by back-dating, never by sleeping. A write is
 * compared against a floor taken the instant before it ran, so the assertion
 * says "this stamp is from now", not "this stamp differs from the last one" —
 * which on a fast machine is the same millisecond and no assertion at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MilestoneOrderConflictError,
  closeGap,
  createGap,
  createGlossaryEntry,
  createMilestone,
  createPolicy,
  createProject,
  createStep,
  createSystem,
  createTeam,
  deleteGap,
  deleteGlossaryEntry,
  deleteMilestone,
  deletePolicy,
  deleteProject,
  deleteStep,
  deleteSystem,
  deleteTeam,
  getProject,
  listProjects,
  reorderMilestones,
  runMigrations,
  setGapOrders,
  setStepOrders,
  updateGap,
  updateGlossaryEntry,
  updateMilestone,
  updatePolicy,
  updateStep,
  updateSystem,
  updateTeam,
  upsertSipoc,
  resetProjectUpdatedAt,
  SCHEMA_SQL,
} from "../services/db";
import { setDB } from "../services/db/connection";
import { logger } from "../lib/logger";
import type { Step } from "../data/types";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

/** A stamp no clock will ever hand back, so "it moved" needs no tolerance. */
const BACKDATED = 1_000;

let adapter: SqlJsTestAdapter;
let projectId: string;
let teamId: string;
let milestoneId: string;

async function readUpdatedAt(id: string): Promise<number> {
  const rows = await adapter.select<Array<{ updated_at: number }>>(
    "SELECT updated_at FROM projects WHERE id = $1",
    [id]
  );
  if (rows.length === 0) throw new Error(`no project ${id}`);
  return rows[0].updated_at;
}

/** Straight at the adapter: the point is to move the row without a touch. */
async function backdate(id: string = projectId): Promise<void> {
  await adapter.execute("UPDATE projects SET updated_at = $1 WHERE id = $2", [BACKDATED, id]);
}

/** Back-date, run one write, and demand a stamp no older than that write. */
async function expectTouch(work: () => Promise<unknown>): Promise<void> {
  await backdate();
  const floor = Date.now();
  await work();
  expect(await readUpdatedAt(projectId)).toBeGreaterThanOrEqual(floor);
}

/** The other half: a call that wrote nothing leaves the project as it was. */
async function expectNoTouch(work: () => Promise<unknown>): Promise<void> {
  await backdate();
  await work();
  expect(await readUpdatedAt(projectId)).toBe(BACKDATED);
}

function stepData(label: string, order: number): Omit<Step, "id"> {
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
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

beforeEach(async () => {
  adapter = new SqlJsTestAdapter();
  await adapter.initialize();
  await adapter.execute(SCHEMA_SQL);
  await runMigrations(adapter);
  setDB(adapter);
  // After the migrations, not before: a pragma is a no-op inside an open
  // transaction.
  await adapter.execute("PRAGMA foreign_keys = ON");
  expect(await adapter.select("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);

  projectId = await createProject({ name: "Order to Cash" });
  teamId = await createTeam({ projectId, name: "Operations", color: "#201e1d", order: 0, tags: [] });
  milestoneId = await createMilestone({ projectId, name: "Intake", order: 0, relatedPolicies: [] });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await adapter.close();
});

describe("teams move their project's updated_at", () => {
  it("on create", async () => {
    await expectTouch(() =>
      createTeam({ projectId, name: "Finance", color: "#201e1d", order: 1, tags: [] })
    );
  });

  it("on edit", async () => {
    await expectTouch(() => updateTeam(teamId, { name: "Operations desk" }, projectId));
  });

  it("but not on an edit carrying no changes (#114)", async () => {
    // `updateTeam` returns before building a statement when nothing changed.
    // A touch there would report an edit the user never made.
    await expectNoTouch(() => updateTeam(teamId, {}, projectId));
  });

  it("on delete", async () => {
    // A team no step references: `steps.team_id` is RESTRICT, so the seeded
    // one cannot be the subject once a step exists.
    const spare = await createTeam({ projectId, name: "Spare", color: "#201e1d", order: 2, tags: [] });
    await expectTouch(() => deleteTeam(spare, projectId));
  });

  it("but not when the delete finds nothing to delete", async () => {
    await expectNoTouch(() => deleteTeam("no-such-team", projectId));
  });
});

describe("systems move their project's updated_at", () => {
  it("on create", async () => {
    await expectTouch(() => createSystem({ projectId, name: "ERP", tags: [] }));
  });

  it("on edit", async () => {
    const id = await createSystem({ projectId, name: "ERP", tags: [] });
    await expectTouch(() => updateSystem(id, { vendor: "SAP" }, projectId));
  });

  it("but not on an edit of a system that is not there", async () => {
    // A real change, so the early return on an empty change set is not what is
    // being measured here — the missing row is.
    await expectNoTouch(() => updateSystem("no-such-system", { vendor: "SAP" }, projectId));
  });

  it("on delete", async () => {
    const id = await createSystem({ projectId, name: "ERP", tags: [] });
    await expectTouch(() => deleteSystem(id, projectId));
  });
});

describe("milestones move their project's updated_at", () => {
  it("on create", async () => {
    await expectTouch(() =>
      createMilestone({ projectId, name: "Fulfilment", order: 1, relatedPolicies: [] })
    );
  });

  it("on edit", async () => {
    await expectTouch(() => updateMilestone(milestoneId, { name: "Request intake" }, projectId));
  });

  it("but not when the order pre-check refuses the edit (#131)", async () => {
    // `assertMilestoneOrderFree` throws before a statement is built, so the
    // milestone is unchanged and so is the project.
    await createMilestone({ projectId, name: "Fulfilment", order: 1, relatedPolicies: [] });
    await expectNoTouch(async () => {
      await expect(updateMilestone(milestoneId, { order: 1 }, projectId)).rejects.toBeInstanceOf(
        MilestoneOrderConflictError
      );
    });
  });

  it("on delete", async () => {
    const spare = await createMilestone({
      projectId,
      name: "Fulfilment",
      order: 1,
      relatedPolicies: [],
    });
    await expectTouch(() => deleteMilestone(spare, projectId));
  });

  it("on a reorder, which writes no index entry to hang a touch on", async () => {
    const second = await createMilestone({
      projectId,
      name: "Fulfilment",
      order: 1,
      relatedPolicies: [],
    });
    await expectTouch(() => reorderMilestones(projectId, [second, milestoneId]));
  });
});

describe("steps move their project's updated_at", () => {
  it("on create", async () => {
    await expectTouch(() => createStep(stepData("Receive request", 0)));
  });

  it("on edit", async () => {
    const id = await createStep(stepData("Receive request", 0));
    await expectTouch(() => updateStep(id, { label: "Receive the request" }, projectId));
  });

  it("but not on an edit of a step that is not there", async () => {
    // The UPDATE matches no row, so nothing was edited. The re-read that feeds
    // the reindex is the same test, and both hang off it (#395).
    await expectNoTouch(() => updateStep("no-such-step", { label: "Ghost" }, projectId));
  });

  it("on delete", async () => {
    const id = await createStep(stepData("Receive request", 0));
    await expectTouch(() => deleteStep(id, projectId));
  });

  it("on a bulk order write, which writes no index entry either", async () => {
    const id = await createStep(stepData("Receive request", 0));
    await expectTouch(() => setStepOrders(projectId, [{ id, order: 5 }]));
  });
});

describe("gaps move their project's updated_at", () => {
  it("on create", async () => {
    await expectTouch(() =>
      createGap({
        projectId,
        observed: "Requests arrive by email",
        expected: "Requests arrive in the queue",
        severity: "M",
        status: "Open",
        milestoneId,
        order: 0,
        links: [],
      })
    );
  });

  it("on edit", async () => {
    const id = await seedGap();
    await expectTouch(() => updateGap(id, { severity: "H" }, projectId));
  });

  it("but not on an edit carrying no changes", async () => {
    // `updateGap` re-reads and re-indexes the gap whether or not it wrote one,
    // so the touch has to follow the write rather than the call.
    const id = await seedGap();
    await expectNoTouch(() => updateGap(id, {}, projectId));
  });

  it("on close", async () => {
    const id = await seedGap();
    await expectTouch(() => closeGap(id, projectId));
  });

  it("on delete", async () => {
    const id = await seedGap();
    await expectTouch(() => deleteGap(id, projectId));
  });

  it("on a bulk order write", async () => {
    const id = await seedGap();
    await expectTouch(() => setGapOrders(projectId, [{ id, order: 3 }]));
  });

  async function seedGap(): Promise<string> {
    return createGap({
      projectId,
      observed: "Requests arrive by email",
      expected: "Requests arrive in the queue",
      severity: "M",
      status: "Open",
      milestoneId,
      order: 0,
      links: [],
    });
  }
});

describe("policies move their project's updated_at", () => {
  it("on create", async () => {
    await expectTouch(() =>
      createPolicy({ projectId, title: "Credit check", content: "Check credit", relatedMilestones: [], tags: [] })
    );
  });

  it("on edit", async () => {
    const id = await createPolicy({
      projectId,
      title: "Credit check",
      content: "Check credit",
      relatedMilestones: [],
      tags: [],
    });
    await expectTouch(() => updatePolicy(id, { content: "Check credit twice" }, projectId));
  });

  it("on delete", async () => {
    const id = await createPolicy({
      projectId,
      title: "Credit check",
      content: "Check credit",
      relatedMilestones: [],
      tags: [],
    });
    await expectTouch(() => deletePolicy(id, projectId));
  });
});

describe("glossary entries move their project's updated_at", () => {
  it("on create", async () => {
    await expectTouch(() =>
      createGlossaryEntry({ projectId, term: "SLA", definition: "Service level", relatedSteps: [], tags: [] })
    );
  });

  it("on edit", async () => {
    const id = await createGlossaryEntry({
      projectId,
      term: "SLA",
      definition: "Service level",
      relatedSteps: [],
      tags: [],
    });
    await expectTouch(() => updateGlossaryEntry(id, { definition: "Service level agreement" }, projectId));
  });

  it("on delete", async () => {
    const id = await createGlossaryEntry({
      projectId,
      term: "SLA",
      definition: "Service level",
      relatedSteps: [],
      tags: [],
    });
    await expectTouch(() => deleteGlossaryEntry(id, projectId));
  });
});

describe("the SIPOC summary moves its project's updated_at", () => {
  it("on upsert, which touches neither the search index nor a create path", async () => {
    await expectTouch(() =>
      upsertSipoc({
        projectId,
        suppliers: ["Sales"],
        inputs: ["Order"],
        process: "Order to cash",
        outputs: ["Invoice"],
        customers: ["Finance"],
      })
    );
  });
});

describe("what a touch must not reach", () => {
  it("leaves a sibling project alone when one project is deleted", async () => {
    const sibling = await createProject({ name: "Procure to Pay" });
    await backdate(sibling);

    await deleteProject(projectId);

    expect(await readUpdatedAt(sibling)).toBe(BACKDATED);
    expect((await listProjects()).map((project) => project.id)).toEqual([sibling]);
  });
});

describe("the order the grid is sorted by", () => {
  it("puts the older project first once a step is written to it", async () => {
    // `listProjects` orders by `updated_at DESC`. Back-dated explicitly so the
    // starting order is the test's, not whatever two `createProject` calls in
    // the same millisecond happen to produce.
    const other = await createProject({ name: "Procure to Pay" });
    await adapter.execute("UPDATE projects SET updated_at = $1 WHERE id = $2", [1_000, projectId]);
    await adapter.execute("UPDATE projects SET updated_at = $1 WHERE id = $2", [2_000, other]);

    expect((await listProjects()).map((project) => project.id)).toEqual([other, projectId]);

    await createStep(stepData("Receive request", 0));

    expect((await listProjects()).map((project) => project.id)).toEqual([projectId, other]);
  });
});


describe("a touch that fails must not fail the write it follows", () => {
  it("leaves setGapOrders resolved, with the orders it wrote still in place", async () => {
    // `applyChanges` in `lib/sequence` answers a rejected `setGapOrders` by
    // writing the steps back to their old orders. The gap write has already
    // landed by then, so a touch that threw would rewind a good renumber and
    // leave a step on an order a gap holds — the tie that draws as a parallel
    // branch nobody asked for (#307, #341).
    const gapId = await createGap({
      projectId,
      observed: "Requests arrive by email",
      expected: "Requests arrive in the queue",
      severity: "M",
      status: "Open",
      milestoneId,
      order: 0,
      links: [],
    });
    await backdate();

    // Bound before the spy so the pass-through is the adapter's own method
    // rather than the spy calling itself.
    const passThrough = adapter.execute.bind(adapter);
    vi.spyOn(adapter, "execute").mockImplementation((sql, params) =>
      /^\s*UPDATE\s+projects/i.test(sql)
        ? Promise.reject(new Error("database is locked"))
        : passThrough(sql, params)
    );
    const warned = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(setGapOrders(projectId, [{ id: gapId, order: 3 }])).resolves.toBeUndefined();

    const rows = await adapter.select<Array<{ order_num: number }>>(
      "SELECT order_num FROM gaps WHERE id = $1",
      [gapId]
    );
    expect(rows[0].order_num).toBe(3);
    expect(await readUpdatedAt(projectId)).toBe(BACKDATED);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining(projectId), expect.any(Error));
  });
});

describe("a project is created, not edited", () => {
  it("writes created_at and updated_at to the same stamp", async () => {
    // The card reads `updatedAt > createdAt` to choose between "Edited" and
    // "Created", so equal stamps at birth are the whole of its contract.
    const id = await createProject({ name: "Quote to Cash" });
    const project = await getProject(id);

    expect(project?.updatedAt).toBe(project?.createdAt);
  });

  it("puts the stamp back after a seed has moved it", async () => {
    // What the wizard and `applyTemplate` call last: the seeded team and
    // milestone in `beforeEach` have each touched this project already.
    await createStep(stepData("Receive request", 0));
    expect(await readUpdatedAt(projectId)).toBeGreaterThan(0);

    await resetProjectUpdatedAt(projectId);

    const project = await getProject(projectId);
    expect(project?.updatedAt).toBe(project?.createdAt);
  });

  it("raises rather than logs when the project is gone", async () => {
    // Unlike a touch, this runs inside creation: there is no landed write a
    // rejection could unwind, and a caller is still on the screen.
    await expect(resetProjectUpdatedAt("no-such-project")).rejects.toThrow(/no project/);
  });
});
