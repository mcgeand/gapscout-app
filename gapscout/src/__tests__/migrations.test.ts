/**
 * Regression tests for the schema-version migration runner (ZIP-320).
 *
 * The tests use a hand-rolled MockAdapter that interprets just the SQL the
 * runner emits (BEGIN/COMMIT/ROLLBACK, SELECT MAX(version), pragma_table_info,
 * sqlite_master, INSERT INTO schema_version, ALTER TABLE ADD COLUMN).
 *
 * The mock no-ops BEGIN/COMMIT/ROLLBACK, so it can only check the runner's
 * control flow — which statements go out, in what order, and what the version
 * row ends up as. It cannot say anything about what a torn migration leaves on
 * disk. `migrations.real.test.ts` covers that against the real SQLite engine.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { runMigrations } from "../services/db";
import type { DatabaseAdapter, QueryResult } from "../services/db/dbInterface";

interface RecordedCall {
  type: "execute" | "select";
  sql: string;
  params?: unknown[];
}

class MockAdapter implements DatabaseAdapter {
  schemaVersion = 0;
  tableColumns = new Map<string, Set<string>>();
  inTransaction = false;
  failOnExecuteMatching: RegExp | null = null;
  failOnSelectMatching: RegExp | null = null;
  calls: RecordedCall[] = [];

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    this.calls.push({ type: "select", sql, params });
    const trimmed = sql.trim();

    if (this.failOnSelectMatching && this.failOnSelectMatching.test(trimmed)) {
      throw new Error(`MockAdapter: simulated select failure on: ${trimmed.slice(0, 60)}`);
    }

    if (/SELECT\s+MAX\(version\)\s+AS\s+version\s+FROM\s+schema_version/i.test(trimmed)) {
      return [{ version: this.schemaVersion === 0 ? null : this.schemaVersion }] as T;
    }

    // `tableColumns` doubles as the set of tables that exist, so the
    // table-exists probe and the column probe cannot disagree.
    if (/FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*\$\d+/i.test(trimmed)) {
      const table = params?.[0];
      if (typeof table !== "string") {
        return [{ count: 0 }] as T;
      }
      return [{ count: this.tableColumns.has(table) ? 1 : 0 }] as T;
    }

    const pragmaMatch = trimmed.match(
      /pragma_table_info\('(\w+)'\)\s+WHERE\s+name\s*=\s*\$\d+/i
    );
    if (pragmaMatch) {
      const [, table] = pragmaMatch;
      const column = params?.[0];
      if (typeof column !== "string") {
        return [{ count: 0 }] as T;
      }
      const has = this.tableColumns.get(table)?.has(column) ?? false;
      return [{ count: has ? 1 : 0 }] as T;
    }

    return [] as T;
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.calls.push({ type: "execute", sql, params });
    const trimmed = sql.trim();

    if (this.failOnExecuteMatching && this.failOnExecuteMatching.test(trimmed)) {
      throw new Error(`MockAdapter: simulated failure on: ${trimmed.slice(0, 60)}`);
    }

    if (/^BEGIN\s+IMMEDIATE/i.test(trimmed)) {
      this.inTransaction = true;
      return { rowsAffected: 0 };
    }
    if (/^COMMIT\b/i.test(trimmed)) {
      this.inTransaction = false;
      return { rowsAffected: 0 };
    }
    if (/^ROLLBACK\b/i.test(trimmed)) {
      this.inTransaction = false;
      return { rowsAffected: 0 };
    }

    const insertVersionMatch = trimmed.match(
      /INSERT\s+INTO\s+schema_version\s*\(\s*version\s*,\s*applied_at\s*\)\s*VALUES\s*\(\s*(\d+)/i
    );
    if (insertVersionMatch) {
      const v = Number(insertVersionMatch[1]);
      this.schemaVersion = Math.max(this.schemaVersion, v);
      return { rowsAffected: 1 };
    }

    const alterAddMatch = trimmed.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i);
    if (alterAddMatch) {
      const [, table, column] = alterAddMatch;
      const cols = this.tableColumns.get(table) ?? new Set<string>();
      cols.add(column);
      this.tableColumns.set(table, cols);
      return { rowsAffected: 0 };
    }

    return { rowsAffected: 0 };
  }

  countExecutes(pattern: RegExp): number {
    return this.calls.filter((c) => c.type === "execute" && pattern.test(c.sql.trim())).length;
  }
}

describe("runMigrations", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter();
  });

  it("applies pending migrations on a fresh database (schema_version starts inert at 1)", async () => {
    // Simulates: SCHEMA_SQL has just run; schema_version was seeded at 1; no
    // validation_status column on steps; no order_num column on gaps. v5 finds
    // no milestone_id/order pair either, v6 finds no `projects` table, v7
    // finds no `steps.team_id`, and v8 finds no `milestones` table, so those
    // bodies no-op and only their version rows are written — which is exactly
    // the self-healing contract.
    mock.schemaVersion = 1;
    mock.tableColumns.set("steps", new Set());
    mock.tableColumns.set("gaps", new Set());

    await runMigrations(mock);

    expect(mock.schemaVersion).toBe(10);
    expect(mock.tableColumns.get("steps")?.has("validation_status")).toBe(true);
    // v6 must not reach for `projects` when the table is not there.
    expect(mock.countExecutes(/ALTER\s+TABLE\s+projects/i)).toBe(0);
    expect(mock.calls.some((c) => /FROM\s+projects/i.test(c.sql))).toBe(false);
    // v7 must not reach for `steps` before the column it repairs exists.
    expect(mock.calls.some((c) => /FROM\s+steps\s+WHERE\s+team_id/i.test(c.sql))).toBe(false);
    expect(mock.countExecutes(/UPDATE\s+steps\s+SET\s+team_id/i)).toBe(0);
    expect(mock.countExecutes(/^BEGIN\s+IMMEDIATE/i)).toBe(9);
    expect(mock.countExecutes(/^COMMIT\b/i)).toBe(9);
    expect(mock.countExecutes(/^ROLLBACK\b/i)).toBe(0);
    expect(mock.inTransaction).toBe(false);
  });

  it("is a no-op when already at the target version (running twice = same state)", async () => {
    mock.schemaVersion = 1;
    mock.tableColumns.set("steps", new Set());
    mock.tableColumns.set("gaps", new Set());

    await runMigrations(mock);
    expect(mock.schemaVersion).toBe(10);

    const callCountAfterFirst = mock.calls.length;
    await runMigrations(mock);

    expect(mock.schemaVersion).toBe(10);
    // Second call should only emit the version-check SELECT, nothing else.
    expect(mock.calls.length - callCountAfterFirst).toBe(1);
    const lastCall = mock.calls[mock.calls.length - 1];
    expect(lastCall.type).toBe("select");
    expect(lastCall.sql).toMatch(/MAX\(version\)/i);
  });

  it("self-heals when schema is already at v3 but schema_version is stuck at v1", async () => {
    // Simulates the live-installed-app scenario: the old ad-hoc migrations
    // applied the schema changes but never touched schema_version.
    mock.schemaVersion = 1;
    mock.tableColumns.set("steps", new Set(["validation_status"]));
    mock.tableColumns.set("gaps", new Set(["order_num"]));

    await runMigrations(mock);

    expect(mock.schemaVersion).toBe(10);
    // Migration bodies must NOT have re-run: no ALTER TABLE, no DROP, no rename.
    expect(mock.countExecutes(/ALTER\s+TABLE\s+steps\s+ADD\s+COLUMN/i)).toBe(0);
    expect(mock.countExecutes(/DROP\s+TABLE\s+gaps\b/i)).toBe(0);
    expect(mock.countExecutes(/CREATE\s+TABLE\s+gaps_new/i)).toBe(0);
    // The index block sits outside the reshape guard (#398), so it still runs
    // on a database v3 has already reshaped. idx_gaps_order is the one
    // SCHEMA_SQL does not declare, so v3 is its only source.
    expect(mock.countExecutes(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_gaps_order/i)).toBe(1);
    // But transactions did wrap the version-row inserts.
    expect(mock.countExecutes(/^BEGIN\s+IMMEDIATE/i)).toBe(9);
    expect(mock.countExecutes(/^COMMIT\b/i)).toBe(9);
  });

  it("rolls back and leaves schema_version unchanged when a migration body throws", async () => {
    mock.schemaVersion = 1;
    mock.tableColumns.set("steps", new Set());
    mock.tableColumns.set("gaps", new Set());
    // Make the v2 ALTER throw — must trigger ROLLBACK before any version row.
    mock.failOnExecuteMatching = /ALTER\s+TABLE\s+steps\s+ADD\s+COLUMN/i;

    await expect(runMigrations(mock)).rejects.toThrow(/simulated failure/);

    expect(mock.schemaVersion).toBe(1);
    expect(mock.countExecutes(/^ROLLBACK\b/i)).toBe(1);
    expect(mock.countExecutes(/^COMMIT\b/i)).toBe(0);
    expect(mock.inTransaction).toBe(false);
  });

  it("treats a missing schema_version table as version 0 and applies all migrations", async () => {
    // Simulates a DB where SCHEMA_SQL hasn't run (or the table got dropped).
    // The runner's MAX(version) SELECT will throw or return null — runner
    // falls back to current=0 and applies everything.
    const throwingMock = new MockAdapter();
    throwingMock.schemaVersion = 0;
    throwingMock.tableColumns.set("steps", new Set());
    throwingMock.tableColumns.set("gaps", new Set());

    await runMigrations(throwingMock);

    expect(throwingMock.schemaVersion).toBe(10);
    expect(throwingMock.countExecutes(/^BEGIN\s+IMMEDIATE/i)).toBe(9);
  });

  it("recovers when the schema_version SELECT itself throws (catch-arm fallback to 0)", async () => {
    // Distinct from the test above: this exercises the runner's `try { … }
    // catch { current = 0 }` path explicitly. Simulates a SELECT that fails
    // hard (e.g. schema_version table doesn't exist yet, or driver error).
    mock.schemaVersion = 0;
    mock.tableColumns.set("steps", new Set());
    mock.tableColumns.set("gaps", new Set());
    mock.failOnSelectMatching = /SELECT\s+MAX\(version\)/i;

    await runMigrations(mock);

    expect(mock.schemaVersion).toBe(10);
    expect(mock.countExecutes(/^BEGIN\s+IMMEDIATE/i)).toBe(9);
    expect(mock.countExecutes(/^COMMIT\b/i)).toBe(9);
    // The throwing SELECT was attempted exactly once (the runner shouldn't
    // retry it).
    const versionSelects = mock.calls.filter(
      (c) => c.type === "select" && /MAX\(version\)/i.test(c.sql)
    );
    expect(versionSelects.length).toBe(1);
  });
});
