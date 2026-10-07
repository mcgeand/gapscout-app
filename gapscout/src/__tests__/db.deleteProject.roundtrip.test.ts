/**
 * Round-trip test for `deleteProject`'s hand-written cascade (#314).
 *
 * SQLite does enforce the schema's `ON DELETE CASCADE` in the desktop build —
 * sqlx opens every connection with `foreign_keys = ON` — but `InMemoryAdapter`
 * enforces nothing, which is exactly why this test is worth having: it passes
 * only because `deleteProject` writes the deletes out itself, so it holds that
 * list to the schema rather than to the database engine's behaviour.
 *
 * It seeds one row in every owned table for two projects, deletes one, and
 * asserts the other is untouched.
 *
 * The second project is the point. A cascade that deletes too much looks
 * identical to a correct one if you only check that the target's rows are gone.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/db/sqlJsAdapter", async () => {
  const { InMemoryAdapter } = await import("./helpers/inMemoryAdapter");
  return { SqlJsAdapter: InMemoryAdapter };
});

import { InMemoryAdapter } from "./helpers/inMemoryAdapter";
import { setDB } from "../services/db/connection";
import {
  initDB,
  createProject,
  getProject,
  deleteProject,
  createTeam,
  createSystem,
  createMilestone,
  createStep,
  createGap,
  createPolicy,
  createGlossaryEntry,
  upsertSipoc,
  getSipoc,
  listTeams,
  listSystems,
  listMilestones,
  listSteps,
  listGaps,
  listPolicies,
  listGlossaryEntries,
} from "../services/db";

/**
 * Seed one row in every table a project owns and return the project's id.
 *
 * Uses the real `create*` functions rather than writing rows straight into the
 * adapter, so the seed proves the same write path the app uses.
 */
async function seedProject(name: string): Promise<string> {
  const projectId = await createProject({ name });

  const teamId = await createTeam({
    projectId,
    name: `${name} team`,
    color: "#ec3013",
    order: 0,
    tags: [],
  });

  await createSystem({ projectId, name: `${name} system`, tags: [] });

  const milestoneId = await createMilestone({
    projectId,
    name: `${name} milestone`,
    order: 0,
    relatedPolicies: [],
  });

  const stepId = await createStep({
    projectId,
    label: `${name} step`,
    teamId,
    milestoneId,
    order: 1,
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
  });

  await createGap({
    projectId,
    stepId,
    observed: `${name} observed`,
    expected: `${name} expected`,
    severity: "M",
    status: "Open",
    links: [],
  });

  await createPolicy({
    projectId,
    title: `${name} policy`,
    content: "content",
    relatedMilestones: [],
    tags: [],
  });

  await createGlossaryEntry({
    projectId,
    term: `${name} term`,
    definition: "definition",
    relatedSteps: [],
    tags: [],
  });

  await upsertSipoc({
    projectId,
    suppliers: ["s"],
    inputs: ["i"],
    process: `${name} process`,
    outputs: ["o"],
    customers: ["c"],
  });

  return projectId;
}

/** Every owned table, read back through the list accessors db.ts exports. */
async function ownedRowCounts(projectId: string) {
  return {
    teams: (await listTeams(projectId)).length,
    systems: (await listSystems(projectId)).length,
    milestones: (await listMilestones(projectId)).length,
    steps: (await listSteps(projectId)).length,
    gaps: (await listGaps(projectId)).length,
    policies: (await listPolicies(projectId)).length,
    glossary: (await listGlossaryEntries(projectId)).length,
    sipoc: (await getSipoc(projectId)) ? 1 : 0,
  };
}

describe("deleteProject — hand-written cascade (#314)", () => {
  let doomed: string;
  let survivor: string;

  beforeEach(async () => {
    setDB(new InMemoryAdapter());
    await initDB();
    doomed = await seedProject("Doomed");
    survivor = await seedProject("Survivor");
  });

  it("seeds a row in every owned table, so the deletion has something to prove", async () => {
    expect(await ownedRowCounts(doomed)).toEqual({
      teams: 1,
      systems: 1,
      milestones: 1,
      steps: 1,
      gaps: 1,
      policies: 1,
      glossary: 1,
      sipoc: 1,
    });
  });

  it("removes the project row itself", async () => {
    await deleteProject(doomed);

    expect(await getProject(doomed)).toBeNull();
    expect(await getProject(survivor)).not.toBeNull();
  });

  it("removes every row the project owned", async () => {
    await deleteProject(doomed);

    expect(await ownedRowCounts(doomed)).toEqual({
      teams: 0,
      systems: 0,
      milestones: 0,
      steps: 0,
      gaps: 0,
      policies: 0,
      glossary: 0,
      sipoc: 0,
    });
  });

  it("leaves another project's rows alone", async () => {
    await deleteProject(doomed);

    expect(await ownedRowCounts(survivor)).toEqual({
      teams: 1,
      systems: 1,
      milestones: 1,
      steps: 1,
      gaps: 1,
      policies: 1,
      glossary: 1,
      sipoc: 1,
    });
  });

  it("clears the project's search_index rows and no others", async () => {
    const db = new InMemoryAdapter();
    setDB(db);
    await initDB();
    const a = await seedProject("A");
    const b = await seedProject("B");

    const indexed = async (projectId: string) =>
      (
        await db.select<Array<{ project_id: string }>>(
          "SELECT * FROM search_index WHERE project_id = $1",
          [projectId],
        )
      ).length;

    expect(await indexed(a)).toBeGreaterThan(0);
    const before = await indexed(b);

    await deleteProject(a);

    expect(await indexed(a)).toBe(0);
    expect(await indexed(b)).toBe(before);
  });
});
