import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeGap,
  createGap,
  deleteGap,
  getGap,
  listGaps,
  runMigrations,
  SCHEMA_SQL,
  setGapOrders,
  updateGap,
} from "../services/db";
import { setDB } from "../services/db/connection";
import type { GapUpdate, Link } from "../data/types";
import { buildGapsCsv } from "../services/exportCSV";
import { search } from "../services/searchService";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

const PROJECT_ID = "project-1";

async function createAdapter(): Promise<SqlJsTestAdapter> {
  const adapter = new SqlJsTestAdapter();
  await adapter.initialize();
  await adapter.execute(SCHEMA_SQL);
  await runMigrations(adapter);
  setDB(adapter);
  return adapter;
}

describe("gap CRUD on the real SQL.js FTS5 engine", () => {
  let adapter: SqlJsTestAdapter;

  beforeEach(async () => {
    adapter = await createAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("round-trips order zero, updates structural fields together, and keeps FTS current", async () => {
    const gapId = await createGap({
      projectId: PROJECT_ID,
      stepId: "step-1",
      observed: "Observed state",
      expected: "Expected state",
      severity: "H",
      priority: 2,
      rootCause: "Config",
      ownerTeamId: "team-1",
      fixIdea: "Before fix idea",
      timeToFix: "near",
      status: "Review",
      missingField: "supplier",
      order: 0,
      milestoneId: "milestone-1",
      links: [],
    });

    const created = await getGap(gapId);
    expect(created).toMatchObject({
      order: 0,
      stepId: "step-1",
      milestoneId: "milestone-1",
    });
    expect(await search("before", PROJECT_ID)).toHaveLength(1);

    const structuralUpdate: GapUpdate = {
      stepId: "step-2",
      order: 0,
      milestoneId: "milestone-2",
      fixIdea: "After fix idea",
      rootCause: null,
    };
    const updated = await updateGap(gapId, structuralUpdate, PROJECT_ID);

    expect(updated).toMatchObject({
      order: 0,
      stepId: "step-2",
      milestoneId: "milestone-2",
      fixIdea: "After fix idea",
      rootCause: undefined,
    });
    expect(await search("before", PROJECT_ID)).toHaveLength(0);
    expect(await search("after", PROJECT_ID)).toHaveLength(1);
  });

  it("does not update, close, or delete an entity through the wrong project scope", async () => {
    const gapId = await createGap({
      projectId: PROJECT_ID,
      observed: "Original observed state",
      expected: "Expected state",
      severity: "M",
      status: "Open",
      links: [],
    });

    expect(await updateGap(gapId, { observed: "Wrong project" }, "project-2")).toBeNull();
    await closeGap(gapId, "project-2");
    await deleteGap(gapId, "project-2");

    expect(await getGap(gapId)).toMatchObject({
      projectId: PROJECT_ID,
      observed: "Original observed state",
      status: "Open",
    });
    expect(await listGaps(PROJECT_ID)).toHaveLength(1);
  });

  it("omits undefined patch fields and preserves their stored values", async () => {
    const gapId = await createGap({
      projectId: PROJECT_ID,
      observed: "Observed state",
      expected: "Expected state",
      severity: "M",
      rootCause: "Config",
      fixIdea: "Keep this fix idea",
      status: "Open",
      order: 0,
      links: [],
    });

    const updated = await updateGap(gapId, {
      observed: "Updated observed state",
      rootCause: undefined,
      fixIdea: undefined,
      order: undefined,
    }, PROJECT_ID);

    expect(updated).toMatchObject({
      observed: "Updated observed state",
      rootCause: "Config",
      fixIdea: "Keep this fix idea",
      order: 0,
    });
  });

  it("persists explicit clears as null and returns the cleared canonical gap after reload", async () => {
    const gapId = await createGap({
      projectId: PROJECT_ID,
      observed: "Observed state",
      expected: "Expected state",
      severity: "M",
      priority: 3,
      rootCause: "Policy",
      ownerTeamId: "team-1",
      fixIdea: "Clear this fix idea",
      timeToFix: "long",
      status: "Closed",
      missingField: "output",
      order: 0,
      milestoneId: "milestone-1",
      closedAt: Date.now(),
      links: [],
    });

    const clearUpdate: GapUpdate = {
      stepId: null,
      priority: null,
      rootCause: null,
      ownerTeamId: null,
      fixIdea: null,
      timeToFix: null,
      missingField: null,
      order: null,
      milestoneId: null,
      closedAt: null,
    };
    const cleared = await updateGap(gapId, clearUpdate, PROJECT_ID);

    expect(cleared).toMatchObject({
      stepId: undefined,
      priority: undefined,
      rootCause: undefined,
      ownerTeamId: undefined,
      fixIdea: undefined,
      timeToFix: undefined,
      missingField: undefined,
      order: undefined,
      milestoneId: undefined,
      closedAt: undefined,
    });

    const reloaded = await getGap(gapId);
    expect(reloaded).toEqual(cleared);
    expect(await search("policy", PROJECT_ID)).toHaveLength(0);
  });

  /**
   * `setGapOrders` writes exactly the rows it is handed and nothing else.
   *
   * It replaced a threshold shift that carried the `isProcessGap` predicate in
   * SQL. The predicate now lives in `lib/sequence`, which applies it when it
   * builds the plan, so a closed or step-attached gap simply never appears in
   * an assignment. Repeating the filter here would silently drop a row the plan
   * expects to have moved — turning a caller's bug into a torn write.
   *
   * What this has to guarantee instead is the `WHERE` clause: same order, same
   * milestone, different project or simply absent from the list, nothing moves.
   */
  it("writes only the rows named in the assignment list", async () => {
    const MILESTONE = "milestone-1";
    const base = {
      projectId: PROJECT_ID,
      observed: "Observed state",
      expected: "Expected state",
      severity: "H" as const,
      links: [],
      milestoneId: MILESTONE,
    };

    const moved = await createGap({ ...base, status: "Open", order: 5 });
    const alsoMoved = await createGap({ ...base, status: "Open", order: 4 });
    const listedButUnchanged = await createGap({ ...base, status: "Open", order: 2 });
    const notListed = await createGap({ ...base, status: "Open", order: 3 });
    const otherProject = await createGap({ ...base, projectId: "project-2", status: "Open", order: 5 });

    await setGapOrders(PROJECT_ID, [
      { id: moved, order: 9 },
      { id: alsoMoved, order: 8 },
      { id: listedButUnchanged, order: 2 },
      // A row from another project, named on purpose: the project guard in the
      // WHERE clause is what stops one project's reseal reaching into another.
      { id: otherProject, order: 1 },
    ]);

    expect((await getGap(moved))?.order).toBe(9);
    expect((await getGap(alsoMoved))?.order).toBe(8);
    expect((await getGap(listedButUnchanged))?.order).toBe(2);
    expect((await getGap(notListed))?.order).toBe(3);
    expect((await getGap(otherProject))?.order).toBe(5);
  });

  /**
   * Closed and step-attached gaps are not exempt at this layer.
   *
   * Stated as a test because it is a deliberate reversal of what the shift did,
   * and the reason it is safe is entirely upstream: `toSequenceRows` filters on
   * `isProcessGap`, so neither kind reaches an assignment. If that ever breaks,
   * this is where the change in behaviour becomes visible rather than silent.
   */
  it("moves a closed or attached gap when one is named, rather than skipping it", async () => {
    const base = {
      projectId: PROJECT_ID,
      observed: "Observed state",
      expected: "Expected state",
      severity: "H" as const,
      links: [],
      milestoneId: "milestone-3",
    };

    const closed = await createGap({ ...base, status: "Closed", order: 3 });
    const attached = await createGap({ ...base, status: "Open", order: 3, stepId: "step-1" });

    await setGapOrders(PROJECT_ID, [
      { id: closed, order: 7 },
      { id: attached, order: 8 },
    ]);

    expect((await getGap(closed))?.order).toBe(7);
    expect((await getGap(attached))?.order).toBe(8);
  });
  /**
   * #280: keys with a digit after the first letter (`P2P`, `ABC1`) used to lose
   * everything before the digit. A row the old parser wrote still carries the
   * truncated label, so the read path recomputes it from the URL, which kept
   * the whole key all along.
   */
  it("reads Jira labels back from the URL, repairing ones the old parser truncated", async () => {
    const jira = (id: string, url: string, label: string): Link => ({
      id,
      url,
      label,
      type: "jira",
      createdAt: 1,
    });
    const gapId = await createGap({
      projectId: PROJECT_ID,
      observed: "Observed state",
      expected: "Expected state",
      severity: "M",
      status: "Open",
      links: [
        jira("l1", "https://acme.atlassian.net/browse/P2P-42", "P-42"),
        jira("l2", "https://acme.atlassian.net/browse/ABC1-7", "ABC1-7"),
        jira("l3", "https://acme.atlassian.net/browse/PROJ-123", "PROJ-123"),
        { id: "l4", url: "https://docs.example/ABC-1", label: "Spec", type: "gdrive", createdAt: 1 },
      ],
    });

    const labels = (await getGap(gapId))?.links.map((link) => link.label);
    expect(labels).toEqual(["P2P-42", "ABC1-7", "PROJ-123", "Spec"]);

    const listed = await listGaps(PROJECT_ID);
    expect(listed[0]?.links.map((link) => link.label)).toEqual(labels);
    expect(buildGapsCsv({ gaps: listed, steps: [], teams: [] }).split("\r\n")[1]).toContain(
      "P2P-42; ABC1-7; PROJ-123"
    );
  });
});
