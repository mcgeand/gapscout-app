/**
 * The store-layer sequence operations against the real SQL engine.
 *
 * The jsdom tests around them assert which statement runs with which arguments.
 * This one runs the statements, so the write path and the read path have to
 * agree: what the sequence looks like afterwards is read back out of SQLite,
 * not out of the store's optimistic copy.
 *
 * Covers the deletion defects together — the milestone stays a gap-free 1..n
 * sequence across two deletions (#339), its process gaps come down with its
 * steps (#341), the rows move in one statement per table rather than one write
 * per row (#343), and a failed second write is undone exactly (#348) — plus the
 * two contracts #353 added on top: a failed delete signals rather than letting
 * its caller reseal a hole that was never opened (#349), and the reseal finishes
 * even when the user has navigated away (#348, deliberately).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import {
  SCHEMA_SQL,
  createGap,
  createStep,
  deleteStep,
  listGaps,
  listSteps,
  runMigrations,
} from "../services/db";
import { setDB } from "../services/db/connection";
import type { DatabaseAdapter, QueryResult } from "../services/db/dbInterface";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";
import { useStepsStore } from "../state/stepsStore";
import { useGapsStore } from "../state/gapsStore";
import { openSlotForInsert, resealAfterMutation } from "../state/sequenceOps";
import { beginProjectScope, clearProjectScope } from "../state/workspaceScope";

/** Logs the SQL that reaches the engine, so "one statement" can be asserted. */
class CountingAdapter implements DatabaseAdapter {
  readonly executed: string[] = [];
  /** Fails the next bulk step write, to exercise the compensation path. */
  failNextStepShift = false;
  /** Fails the next bulk gap write, so the step half has to be put back. */
  failNextGapShift = false;
  /** Fails the next step delete, to exercise the #349 signalling contract. */
  failNextDelete = false;
  /** The gap half of the same contract — a separate statement, so a separate hook. */
  failNextGapDelete = false;
  private readonly delegate: SqlJsTestAdapter;
  constructor(delegate: SqlJsTestAdapter) {
    this.delegate = delegate;
  }
  initialize(): Promise<void> {
    return this.delegate.initialize();
  }
  execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.executed.push(sql);
    if (this.failNextStepShift && /^\s*UPDATE\s+steps/i.test(sql)) {
      this.failNextStepShift = false;
      return Promise.reject(new Error("step shift failed"));
    }
    if (this.failNextGapShift && /^\s*UPDATE\s+gaps/i.test(sql)) {
      this.failNextGapShift = false;
      return Promise.reject(new Error("gap write failed"));
    }
    if (this.failNextDelete && /^\s*DELETE\s+FROM\s+steps/i.test(sql)) {
      this.failNextDelete = false;
      return Promise.reject(new Error("delete failed"));
    }
    if (this.failNextGapDelete && /^\s*DELETE\s+FROM\s+gaps/i.test(sql)) {
      this.failNextGapDelete = false;
      return Promise.reject(new Error("gap delete failed"));
    }
    return this.delegate.execute(sql, params);
  }
  select<T>(sql: string, params: unknown[] = []): Promise<T> {
    return this.delegate.select<T>(sql, params);
  }
  close(): Promise<void> {
    return this.delegate.close();
  }
}

const PROJECT_ID = "project-deletion-shift";
const MILESTONE_ID = "milestone-a";
const OTHER_MILESTONE_ID = "milestone-b";

const makeStep = (label: string, milestoneId: string, order: number) =>
  createStep({
    projectId: PROJECT_ID,
    label,
    teamId: "team-1",
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
    createdAt: 0,
    updatedAt: 0,
  });

const makeProcessGap = (observed: string, milestoneId: string, order: number) =>
  createGap({
    projectId: PROJECT_ID,
    observed,
    expected: "Step exists",
    severity: "M",
    status: "Open",
    order,
    milestoneId,
    links: [],
  });

/** The milestone's sequence as `(order, label)`, read back out of SQLite. */
async function sequence(milestoneId: string): Promise<Array<[number, string]>> {
  const steps = (await listSteps(PROJECT_ID)).filter((s) => s.milestoneId === milestoneId);
  const gaps = (await listGaps(PROJECT_ID)).filter((g) => g.milestoneId === milestoneId);
  return [
    ...steps.map((s): [number, string] => [s.order, s.label]),
    ...gaps.map((g): [number, string] => [g.order!, g.observed]),
  ].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
}

describe("sequence operations on the real SQL engine", () => {
  let adapter: CountingAdapter;

  beforeEach(async () => {
    adapter = new CountingAdapter(new SqlJsTestAdapter());
    await adapter.initialize();
    await adapter.execute(SCHEMA_SQL);
    await runMigrations(adapter);
    setDB(adapter);
    beginProjectScope(PROJECT_ID);
    useStepsStore.setState({ steps: [], currentProjectId: PROJECT_ID });
    useGapsStore.setState({ gaps: [], currentProjectId: PROJECT_ID });
  });

  afterEach(async () => {
    clearProjectScope();
    await adapter.close();
  });

  it("keeps the milestone a gap-free sequence across two deletions", async () => {
    const first = await makeStep("Raise request", MILESTONE_ID, 1);
    await makeStep("Check budget", MILESTONE_ID, 2);
    const third = await makeStep("Approve", MILESTONE_ID, 3);
    await makeStep("Issue PO", MILESTONE_ID, 4);
    await makeStep("Receive goods", OTHER_MILESTONE_ID, 1);

    await useStepsStore.getState().loadSteps(PROJECT_ID);

    // Through the store's own `deleteStep`, reload and all: this is the path the
    // grid's delete loop runs, and what the second iteration is measured against
    // comes out of the database, not out of a captured array.
    await useStepsStore.getState().deleteStep(first, PROJECT_ID);
    await resealAfterMutation({ projectId: PROJECT_ID, milestoneIds: [MILESTONE_ID] });

    // The step that started at 3 now sits at 2 — in the database and in the
    // store alike. Measuring the second deletion against the pre-deletion orders
    // would start its shift at 4 and leave the sequence 1, 3 (#339).
    expect((await listSteps(PROJECT_ID)).find((s) => s.id === third)?.order).toBe(2);
    expect(useStepsStore.getState().steps.find((s) => s.id === third)?.order).toBe(2);

    await useStepsStore.getState().deleteStep(third, PROJECT_ID);
    await resealAfterMutation({ projectId: PROJECT_ID, milestoneIds: [MILESTONE_ID] });

    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Check budget"],
      [2, "Issue PO"],
    ]);
    // A sibling milestone numbers itself and is nobody else's business (#331).
    expect(await sequence(OTHER_MILESTONE_ID)).toEqual([[1, "Receive goods"]]);
  });

  it("brings the process gaps down with the steps, so no two rows tie", async () => {
    const first = await makeStep("Raise request", MILESTONE_ID, 1);
    await makeStep("Check budget", MILESTONE_ID, 2);
    await makeProcessGap("Missing sign-off", MILESTONE_ID, 3);
    await makeStep("Issue PO", MILESTONE_ID, 4);
    await makeProcessGap("Missing handover", OTHER_MILESTONE_ID, 2);

    await deleteStep(first, PROJECT_ID);
    await resealAfterMutation({ projectId: PROJECT_ID, milestoneIds: [MILESTONE_ID] });

    // Without the gap half, "Issue PO" arrives at 3 while the gap is still
    // there, and the tie reads as a parallel branch nobody asked for (#341).
    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Check budget"],
      [2, "Missing sign-off"],
      [3, "Issue PO"],
    ]);
    // A sibling milestone is not resealed just because this one was — and the
    // gap sitting alone at 2 there is left alone rather than pulled to 1.
    expect(await sequence(OTHER_MILESTONE_ID)).toEqual([[2, "Missing handover"]]);
  });

  /**
   * Two statements can tear, and neither order is safe on its own. With a gap
   * sitting above a step in the moved range, writing the gaps and then failing
   * on the steps strands the gap on an order the step still holds — the very
   * tie the reseal exists to prevent. Steps go first and the gap failure puts
   * the step half back, using the old orders the plan carries, so the undo is
   * exact rather than a counter-shift (#348, #353 clause 5).
   */
  it("puts the steps back exactly when the gap write fails", async () => {
    await makeStep("Raise request", MILESTONE_ID, 1);
    const second = await makeStep("Check budget", MILESTONE_ID, 2);
    await makeStep("Approve", MILESTONE_ID, 3);
    await makeProcessGap("Missing sign-off", MILESTONE_ID, 4);

    await deleteStep(second, PROJECT_ID);
    await useGapsStore.getState().loadGaps(PROJECT_ID);
    adapter.failNextGapShift = true;
    const before = adapter.executed.length;

    await expect(
      resealAfterMutation({ projectId: PROJECT_ID, milestoneIds: [MILESTONE_ID] })
    ).rejects.toThrow("gap write failed");

    // Twice, not never: the steps really moved and were really put back, so the
    // assertion below cannot pass by the step half having been skipped.
    expect(
      adapter.executed.slice(before).filter((sql) => /^\s*UPDATE\s+steps/i.test(sql))
    ).toHaveLength(2);

    // Nothing moved. "Approve" is back at 3 rather than stranded on 2 with the
    // gap still at 4, which is the layout the reseal was mid-way through.
    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Raise request"],
      [3, "Approve"],
      [4, "Missing sign-off"],
    ]);
  });

  /**
   * #349. `deleteStep` used to catch, toast and return normally, so its caller
   * resealed a milestone nothing had left — pulling the sequence one short and
   * re-creating the tie from the other direction. The contract is now that a
   * failed delete throws, and the caller's `await` is what stops the reseal.
   */
  it("signals a failed delete rather than letting the caller reseal", async () => {
    await makeStep("Raise request", MILESTONE_ID, 1);
    const second = await makeStep("Check budget", MILESTONE_ID, 2);
    await makeStep("Approve", MILESTONE_ID, 3);
    await useStepsStore.getState().loadSteps(PROJECT_ID);

    const before = adapter.executed.length;
    const storeBefore = useStepsStore.getState().steps;

    adapter.failNextDelete = true;
    await expect(useStepsStore.getState().deleteStep(second, PROJECT_ID)).rejects.toThrow(
      "delete failed"
    );

    // The caller never reaches its reseal, so the sequence is untouched — and
    // in particular "Approve" has not come down onto the order the step that
    // did not get deleted is still holding.
    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Raise request"],
      [2, "Check budget"],
      [3, "Approve"],
    ]);
    // No shift, and no reload either: a failed delete must not send the caller
    // back to the database for a list that has not changed, and must not
    // repaint over it (#295, #349). Nothing at all reached the adapter after
    // the rejected DELETE.
    expect(adapter.executed.slice(before).filter((sql) => /^\s*UPDATE/i.test(sql))).toEqual([]);
    expect(useStepsStore.getState().steps).toBe(storeBefore);
  });

  /**
   * The gap half of #349, and it needs its own case: `deleteGap` is a different
   * statement and a different store action, and the hook above matches
   * `DELETE FROM steps` only, so the step test says nothing about it.
   */
  it("signals a failed gap delete, leaving the sequence and the store alone", async () => {
    await makeStep("Raise request", MILESTONE_ID, 1);
    const gap = await makeProcessGap("Missing sign-off", MILESTONE_ID, 2);
    await makeStep("Approve", MILESTONE_ID, 3);
    await useStepsStore.getState().loadSteps(PROJECT_ID);
    await useGapsStore.getState().loadGaps(PROJECT_ID);

    const before = adapter.executed.length;
    const stepsBefore = useStepsStore.getState().steps;
    const gapsBefore = useGapsStore.getState().gaps;

    adapter.failNextGapDelete = true;
    await expect(useGapsStore.getState().deleteGap(gap, PROJECT_ID)).rejects.toThrow(
      "gap delete failed"
    );

    // "Approve" has not come down onto 2, which is the order the gap that did
    // not get deleted is still holding — the tie the reseal exists to prevent,
    // arrived at from the other direction.
    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Raise request"],
      [2, "Missing sign-off"],
      [3, "Approve"],
    ]);
    expect(adapter.executed.slice(before).filter((sql) => /^\s*UPDATE/i.test(sql))).toEqual([]);
    // Neither list was reloaded, and neither was repainted: the gap is still in
    // the store, where a caller that removed it optimistically would have lost it.
    expect(useStepsStore.getState().steps).toBe(stepsBefore);
    expect(useGapsStore.getState().gaps).toBe(gapsBefore);
    expect(useGapsStore.getState().gaps.some((g) => g.id === gap)).toBe(true);
  });

  /**
   * #348, kept deliberately. The row is already gone by the time the reseal
   * runs, so finishing the sequence is right even if the user has navigated
   * away; only the store reload is skipped, because that list now belongs to
   * another project.
   */
  it("finishes the sequence even when the project scope has changed", async () => {
    const first = await makeStep("Raise request", MILESTONE_ID, 1);
    await makeStep("Check budget", MILESTONE_ID, 2);
    await makeStep("Approve", MILESTONE_ID, 3);
    await useStepsStore.getState().loadSteps(PROJECT_ID);

    const scope = { projectId: PROJECT_ID, generation: -1 };
    await deleteStep(first, PROJECT_ID);
    await resealAfterMutation({ projectId: PROJECT_ID, milestoneIds: [MILESTONE_ID], scope });

    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Check budget"],
      [2, "Approve"],
    ]);
  });

  /**
   * The opener half. `openSlotForInsert` makes room for a row the caller is
   * about to write, moving steps and process gaps together so the new row
   * cannot land on an order a gap still holds (#307).
   */
  it("opens a slot across steps and process gaps alike", async () => {
    await makeStep("Raise request", MILESTONE_ID, 1);
    await makeStep("Check budget", MILESTONE_ID, 2);
    await makeProcessGap("Missing sign-off", MILESTONE_ID, 3);
    await useStepsStore.getState().loadSteps(PROJECT_ID);
    await useGapsStore.getState().loadGaps(PROJECT_ID);

    await openSlotForInsert({ projectId: PROJECT_ID, milestoneId: MILESTONE_ID, at: 2 });

    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Raise request"],
      [3, "Check budget"],
      [4, "Missing sign-off"],
    ]);
    // The store carries the new orders, so the caller can paint its temp row
    // beside them rather than over a stale copy.
    expect(useStepsStore.getState().steps.find((s) => s.label === "Check budget")?.order).toBe(3);
  });

  /**
   * A slot opened for a row that is never written is a hole nothing else
   * closes, so a scope change closes it again — the reseal is the exact inverse
   * and needs nothing remembered to run.
   */
  it("closes a slot again when the project changes before the row is written", async () => {
    await makeStep("Raise request", MILESTONE_ID, 1);
    await makeStep("Check budget", MILESTONE_ID, 2);

    const scope = { projectId: PROJECT_ID, generation: -1 };
    await openSlotForInsert({ projectId: PROJECT_ID, milestoneId: MILESTONE_ID, at: 2, scope });

    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Raise request"],
      [2, "Check budget"],
    ]);
  });

  it("moves every displaced step in one statement", async () => {
    const first = await makeStep("Raise request", MILESTONE_ID, 1);
    await makeStep("Check budget", MILESTONE_ID, 2);
    await makeStep("Approve", MILESTONE_ID, 3);
    await makeStep("Issue PO", MILESTONE_ID, 4);

    await deleteStep(first, PROJECT_ID);
    const before = adapter.executed.length;
    await resealAfterMutation({ projectId: PROJECT_ID, milestoneIds: [MILESTONE_ID] });

    // Three steps move, and a per-row loop is what tore the sequence on a
    // partial failure (#343, #350). One UPDATE per half of the sequence is the
    // fix, and no transaction primitive can make a loop safe on Tauri (#236).
    const writes = adapter.executed
      .slice(before)
      .filter((sql) => /^\s*UPDATE\s+steps/i.test(sql));
    expect(writes).toHaveLength(1);

    expect(await sequence(MILESTONE_ID)).toEqual([
      [1, "Check budget"],
      [2, "Approve"],
      [3, "Issue PO"],
    ]);
  });
});
