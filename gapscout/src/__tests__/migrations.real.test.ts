/**
 * The migration runner's real contract, on the real SQLite engine (#398).
 *
 * ## What this file can and cannot prove
 *
 * sql.js is one in-process database with one connection, so `BEGIN IMMEDIATE`
 * and `COMMIT` always bind here. The Tauri adapter is a pooled sqlx connection
 * and they may not. **Nothing in this file proves atomicity**, and a green run
 * is not evidence that a migration is transactional in the app — the fix for
 * that is a Rust batch command, tracked as #399.
 *
 * What it does prove is the contract `runMigrations` actually delivers: the
 * version row lands after the body rather than before, and a body can be rerun
 * over its own partial output. The torn states below are therefore constructed
 * by hand — dropping a table, leaving a scratch table behind — rather than by
 * trying to interrupt a transaction, which this engine would not let happen.
 *
 * ## Every torn-state test goes through `launch()`
 *
 * `initDB` runs `SCHEMA_SQL` and only then `runMigrations`, and that ordering
 * is load-bearing: `CREATE TABLE IF NOT EXISTS gaps` puts an empty modern
 * `gaps` back before the migration sees a database torn mid-copy. Calling
 * `runMigrations` directly hides that, and an earlier draft of this file did
 * exactly that — the recovery it was asserting could never have run in the
 * app. `launch()` mirrors the real order so the fixture matches a real start.
 *
 * `migrations.test.ts` covers the runner's control flow against a mock. This
 * covers what a rerun finds on disk.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, SCHEMA_SQL } from "../services/db";
import { setDB } from "../services/db/connection";
import type { DatabaseAdapter, QueryResult } from "../services/db/dbInterface";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

const PROJECT_ID = "project-1";

/** The `gaps` shape as it stood before v3: no `order_num`, no `milestone_id`. */
const LEGACY_GAPS_SQL = `
  CREATE TABLE gaps (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    step_id TEXT,
    observed TEXT NOT NULL,
    expected TEXT NOT NULL,
    severity TEXT NOT NULL,
    priority INTEGER,
    root_cause TEXT,
    owner_team_id TEXT,
    fix_idea TEXT,
    time_to_fix TEXT,
    status TEXT NOT NULL DEFAULT 'Open',
    missing_field TEXT,
    links TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER
  )
`;

let adapter: SqlJsTestAdapter;

async function setVersion(version: number): Promise<void> {
  await adapter.execute("DELETE FROM schema_version");
  await adapter.execute(
    `INSERT INTO schema_version (version, applied_at) VALUES (${version}, 0)`
  );
}

/** What `initDB` does, in its order: schema first, then the migrations. */
async function launch(): Promise<void> {
  await adapter.execute(SCHEMA_SQL);
  await runMigrations(adapter);
}

async function currentVersion(): Promise<number> {
  const rows = await adapter.select<Array<{ version: number | null }>>(
    "SELECT MAX(version) AS version FROM schema_version"
  );
  return rows[0]?.version ?? 0;
}

/** Replace the current-shape `gaps` with the pre-v3 one, holding two rows. */
async function seedLegacyGaps(): Promise<void> {
  await adapter.execute("DROP TABLE IF EXISTS gaps");
  await adapter.execute(LEGACY_GAPS_SQL);
  await adapter.execute(`
    INSERT INTO gaps (id, project_id, observed, expected, severity, status, created_at, updated_at)
    VALUES
      ('g1', '${PROJECT_ID}', 'Invoices keyed twice', 'Keyed once', 'H', 'Open', 10, 10),
      ('g2', '${PROJECT_ID}', 'No approval record', 'Approval logged', 'M', 'Open', 20, 20)
  `);
}

/**
 * Leave the database as a v3 copy that was interrupted, then rewind the
 * version so the next launch retries it. `dropOriginal` picks the tear point:
 * false is "torn before DROP TABLE gaps", true is "torn between the drop and
 * the rename".
 */
async function seedTornCopy({ dropOriginal }: { dropOriginal: boolean }): Promise<void> {
  await seedLegacyGaps();
  await setVersion(2);
  await launch();
  // The reshaped table is what the interrupted copy had built in `gaps_new`.
  await adapter.execute("ALTER TABLE gaps RENAME TO gaps_new");
  if (!dropOriginal) {
    await seedLegacyGaps();
  }
  await setVersion(2);
}

async function tableNames(): Promise<string[]> {
  const rows = await adapter.select<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  return rows.map((r) => r.name);
}

async function gapIndexNames(): Promise<string[]> {
  const rows = await adapter.select<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'gaps' AND name LIKE 'idx_%' ORDER BY name"
  );
  return rows.map((r) => r.name);
}

async function gapIds(): Promise<string[]> {
  const rows = await adapter.select<Array<{ id: string }>>(
    "SELECT id FROM gaps ORDER BY id"
  );
  return rows.map((r) => r.id);
}

async function projectsColumnCount(column: string): Promise<number> {
  const rows = await adapter.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM pragma_table_info('projects') WHERE name = $1`,
    [column]
  );
  return rows[0]?.count ?? 0;
}

async function gapsHasColumn(column: string): Promise<boolean> {
  const rows = await adapter.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM pragma_table_info('gaps') WHERE name = $1`,
    [column]
  );
  return (rows[0]?.count ?? 0) > 0;
}

/** Wraps the real adapter so one statement can be made to fail. */
class FailingAdapter implements DatabaseAdapter {
  private readonly inner: DatabaseAdapter;
  private readonly failOn: RegExp;

  constructor(inner: DatabaseAdapter, failOn: RegExp) {
    this.inner = inner;
    this.failOn = failOn;
  }

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    return this.inner.select<T>(sql, params);
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (this.failOn.test(sql.trim())) {
      throw new Error("simulated migration failure");
    }
    return this.inner.execute(sql, params);
  }
}

describe("runMigrations against the real SQLite engine", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    await adapter.execute(SCHEMA_SQL);
    await adapter.execute(
      `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('${PROJECT_ID}', 'P2P', 0, 0)`
    );
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe("the version row", () => {
    it("reaches 10 when every pending migration applies", async () => {
      await setVersion(1);

      await expect(runMigrations(adapter)).resolves.toBeUndefined();

      expect(await currentVersion()).toBe(10);
    });

    it("stays behind, never ahead, when a body throws", async () => {
      // v5 builds a scratch table before it renumbers anything, so failing
      // that statement fails the body with v4 as the high water mark. The
      // assertion is deliberately only about the version: on this engine the
      // surrounding transaction really does roll the body back, and on the
      // pooled Tauri adapter it may not, so "the body was undone" is not a
      // claim this file is entitled to make.
      await setVersion(4);
      const failing = new FailingAdapter(adapter, /CREATE\s+TABLE\s+sequence_v5/i);

      await expect(runMigrations(failing)).rejects.toThrow(/simulated migration failure/);

      expect(await currentVersion()).toBe(4);
    });

    it("catches up when a body was applied but its version row never landed", async () => {
      // The torn shape the runner is actually built to survive: the schema is
      // already current, `schema_version` is stale. Every body must no-op and
      // only the version rows get recorded.
      await adapter.execute("ALTER TABLE projects ADD COLUMN extra_marker TEXT");
      await setVersion(1);

      await expect(runMigrations(adapter)).resolves.toBeUndefined();

      expect(await currentVersion()).toBe(10);
      expect(await gapsHasColumn("order_num")).toBe(true);
      // v6's column is present exactly once — the guarded ALTER did not re-add
      // it — and a column no migration knows about was left alone.
      expect(await projectsColumnCount("state")).toBe(1);
      expect(await projectsColumnCount("extra_marker")).toBe(1);
    });
  });

  describe("v3 reshapes gaps and recovers its torn states", () => {
    it("reshapes a clean pre-v3 table and keeps the rows", async () => {
      await seedLegacyGaps();
      await setVersion(2);

      await expect(launch()).resolves.toBeUndefined();

      expect(await gapsHasColumn("order_num")).toBe(true);
      expect(await gapsHasColumn("milestone_id")).toBe(true);
      expect(await gapIds()).toEqual(["g1", "g2"]);
      expect(await tableNames()).not.toContain("gaps_new");
      expect(await gapIndexNames()).toContain("idx_gaps_order");
    });

    it("recovers a tear before the drop, where the pre-v3 gaps survived", async () => {
      // Torn after CREATE TABLE gaps_new. SCHEMA_SQL's IF NOT EXISTS no-ops
      // over the surviving legacy table, so `gaps` is still the authoritative
      // copy and the half-built scratch table is the thing to discard.
      await seedTornCopy({ dropOriginal: false });

      expect(await tableNames()).toEqual(expect.arrayContaining(["gaps", "gaps_new"]));
      expect(await gapsHasColumn("order_num")).toBe(false);

      // Before #398 this threw "table gaps_new already exists".
      await expect(launch()).resolves.toBeUndefined();

      expect(await gapsHasColumn("order_num")).toBe(true);
      expect(await gapIds()).toEqual(["g1", "g2"]);
      expect(await tableNames()).not.toContain("gaps_new");
    });

    it("recovers a tear between the drop and the rename, where gaps_new holds the only copy", async () => {
      // The state that silently emptied the register. SCHEMA_SQL recreates an
      // empty modern `gaps` before the migration runs, so a probe on `gaps`
      // reports "already reshaped" and any recovery keyed on that never fires.
      await seedTornCopy({ dropOriginal: true });

      expect(await tableNames()).not.toContain("gaps");
      expect(await tableNames()).toContain("gaps_new");

      await expect(launch()).resolves.toBeUndefined();

      expect(await gapsHasColumn("order_num")).toBe(true);
      // The rows survived. They were never anywhere but `gaps_new`.
      expect(await gapIds()).toEqual(["g1", "g2"]);
      expect(await tableNames()).not.toContain("gaps_new");
      // The rename drops `gaps` and its indexes go with it, so this arm has to
      // fall through to the index block like every other.
      expect(await gapIndexNames()).toContain("idx_gaps_order");
    });

    it("recovers a tear after the rename, where idx_gaps_order was never created", async () => {
      await seedLegacyGaps();
      await setVersion(2);
      await launch();
      for (const name of await gapIndexNames()) {
        await adapter.execute(`DROP INDEX ${name}`);
      }
      await setVersion(2);

      expect(await gapIndexNames()).toEqual([]);

      await expect(launch()).resolves.toBeUndefined();

      // SCHEMA_SQL restores the other six on its own, but it deliberately does
      // not declare idx_gaps_order, so only v3 can put that one back. This is
      // why the index block has to sit outside the reshape guard.
      expect(await gapIndexNames()).toContain("idx_gaps_order");
      expect(await gapIds()).toEqual(["g1", "g2"]);
    });

    it("refuses to choose when both gaps and gaps_new hold rows", async () => {
      // Not a state this migration can produce. The point is that it destroys
      // nothing rather than guessing which table is authoritative.
      await seedLegacyGaps();
      await setVersion(2);
      await launch();
      await adapter.execute("CREATE TABLE gaps_new AS SELECT * FROM gaps");
      await adapter.execute("DELETE FROM gaps WHERE id = 'g2'");
      await setVersion(2);

      await expect(launch()).resolves.toBeUndefined();

      expect(await gapIds()).toEqual(["g1"]);
      expect(await tableNames()).toContain("gaps_new");
    });
  });
});
