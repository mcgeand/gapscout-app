/**
 * Unit tests for InMemoryAdapter's unsupported-SQL guard (#369).
 *
 * Before this issue, `execute()` and `select()` fell through any statement
 * their regexes didn't recognize to `{ rowsAffected: 0 }` / `[]` — values
 * that are also the truthful answer to several *recognized* shapes (a delete
 * that hit no rows, a select against an empty table). That let a test assert
 * "0 rows affected" or "[]" against a statement the adapter never parsed at
 * all, and pass for the wrong reason. Both now throw instead.
 */

import { describe, it, expect } from "vitest";
import { InMemoryAdapter } from "./helpers/inMemoryAdapter";

describe("InMemoryAdapter — unsupported SQL", () => {
  it("select() rejects a SELECT shape its regexes don't recognize", async () => {
    const adapter = new InMemoryAdapter();
    await expect(
      adapter.select("SELECT * FROM steps WHERE team_id = $1", ["team-1"]),
    ).rejects.toThrow(/unsupported SQL/);
  });

  it("execute() rejects an UPDATE shape its regexes don't recognize", async () => {
    const adapter = new InMemoryAdapter();
    await expect(
      adapter.execute('UPDATE milestones SET "order" = $1 WHERE project_id = $2', [1, "p1"]),
    ).rejects.toThrow(/unsupported SQL/);
  });

  it("execute() rejects a DELETE shape its regexes don't recognize", async () => {
    const adapter = new InMemoryAdapter();
    // Anchored deliberately in inMemoryAdapter.ts: a two-column WHERE like
    // this must not fall through to the single-column `delByProject` branch,
    // which would delete the whole project's rows and overstate what a more
    // targeted delete actually did.
    await expect(
      adapter.execute("DELETE FROM steps WHERE project_id = $1 AND milestone_id = $2", [
        "p1",
        "m1",
      ]),
    ).rejects.toThrow(/unsupported SQL/);
  });

  it("a recognized statement still round-trips normally", async () => {
    const adapter = new InMemoryAdapter();
    const insertResult = await adapter.execute(
      'INSERT INTO policies (id, project_id) VALUES ($1, $2)',
      ["pol-1", "proj-1"],
    );
    expect(insertResult).toEqual({ rowsAffected: 1 });

    const rows = await adapter.select<Array<{ id: string; project_id: string }>>(
      "SELECT * FROM policies WHERE id = $1",
      ["pol-1"],
    );
    expect(rows).toEqual([{ id: "pol-1", project_id: "proj-1" }]);
  });

  // The `sqlite_master` branch is anchored to `tableExists`'s exact probe
  // shape (db.ts ~480-490). Unanchored, this query — same table, different
  // select list — would also have matched and come back as `[{ count: 0 }]`
  // (length 1, truthy): a worse lie than the old catch-all, since it looks
  // like a real answer instead of an empty one.
  it("select() rejects a sqlite_master query that isn't tableExists's exact probe", async () => {
    const adapter = new InMemoryAdapter();
    await expect(
      adapter.select("SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1", [
        "steps",
      ]),
    ).rejects.toThrow(/unsupported SQL/);
  });

  // db.ts's Unassigned-team backfill (~728) mixes a literal into the VALUES
  // list: `VALUES ($1, $2, 'Unassigned', $3, NULL, $4, '[]', $5)`. Before this
  // fix that half-parsed insert returned `{ rowsAffected: 0 }` silently.
  it("execute() rejects an INSERT whose VALUES list contains a literal", async () => {
    const adapter = new InMemoryAdapter();
    await expect(
      adapter.execute(
        `INSERT INTO teams (id, project_id, name, color, description, "order", tags, created_at)
         VALUES ($1, $2, 'Unassigned', $3, NULL, $4, '[]', $5)`,
        ["team-1", "proj-1", "#ffffff", 1, Date.now()],
      ),
    ).rejects.toThrow(/unsupported SQL/);
  });

  // The SET-clause regex used to require a bare column name, so `"order" =
  // $n` never matched and `updateMilestone`'s UPDATE returned `rowsAffected:
  // 1` having written nothing.
  it("execute() applies an UPDATE that sets a quoted column", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.execute(
      'INSERT INTO milestones (id, project_id, name, "order") VALUES ($1, $2, $3, $4)',
      ["m1", "proj-1", "Intake", 0],
    );

    const updateResult = await adapter.execute(
      'UPDATE milestones SET "order" = $1 WHERE id = $2 AND project_id = $3',
      [5, "m1", "proj-1"],
    );
    expect(updateResult).toEqual({ rowsAffected: 1 });

    const rows = await adapter.select<Array<{ id: string; order: number }>>(
      "SELECT * FROM milestones WHERE id = $1",
      ["m1"],
    );
    expect(rows).toEqual([{ id: "m1", project_id: "proj-1", name: "Intake", order: 5 }]);
  });
});
