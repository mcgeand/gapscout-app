/**
 * Migration v6 — `projects.state` — on the real SQL.js engine (#263).
 *
 * A mock adapter cannot check this. The migration rewrites the user's project
 * names, and the thing that decides whether that is safe is the interaction
 * between the column guards, the `state IS NULL AND legacy_name IS NULL`
 * filter and real SQLite NULL semantics. Getting it wrong renames maps nobody
 * asked to rename.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations, SCHEMA_SQL } from "../services/db";
import { setDB } from "../services/db/connection";
import { SqlJsTestAdapter } from "./helpers/sqlJsTestAdapter";

/**
 * The `projects` table as it stood before this migration, derived from the
 * live schema rather than copied, so the fixture cannot drift away from it.
 */
const LEGACY_SCHEMA_SQL = SCHEMA_SQL.split("\n")
  .filter((line) => !/^\s*(state|legacy_name) TEXT,/.test(line))
  .join("\n");

interface ProjectRowShape {
  id: string;
  name: string;
  state: string | null;
  legacy_name: string | null;
}

let adapter: SqlJsTestAdapter;

async function columnsOf(a: SqlJsTestAdapter, table: string): Promise<string[]> {
  const rows = await a.select<Array<{ name: string }>>(
    `SELECT name FROM pragma_table_info('${table}') ORDER BY name`
  );
  return rows.map((r) => r.name);
}

async function projects(): Promise<ProjectRowShape[]> {
  return adapter.select<ProjectRowShape[]>(
    "SELECT id, name, state, legacy_name FROM projects ORDER BY id"
  );
}

async function seed(rows: Array<[string, string]>): Promise<void> {
  for (const [id, name] of rows) {
    await adapter.execute(
      "INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, 0, 0)",
      [id, name]
    );
  }
}

describe("v6 project state migration on the real SQL.js engine", () => {
  beforeEach(async () => {
    adapter = new SqlJsTestAdapter();
    await adapter.initialize();
    setDB(adapter);
    // A database at v5: the pre-#263 shape, with the chain below v6 recorded
    // as already applied so only the migration under test runs.
    await adapter.execute(LEGACY_SCHEMA_SQL);
    await adapter.execute("INSERT INTO schema_version (version, applied_at) VALUES (5, 0)");
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("builds a legacy fixture that really lacks the two columns", async () => {
    // Guards the derivation above: if the filter ever stops matching, every
    // other test here would pass against an already-migrated table.
    const before = await columnsOf(adapter, "projects");
    expect(before).not.toContain("state");
    expect(before).not.toContain("legacy_name");
  });

  it("reaches the same table shape a fresh install has", async () => {
    await runMigrations(adapter);

    const fresh = new SqlJsTestAdapter();
    await fresh.initialize();
    await fresh.execute(SCHEMA_SQL);
    try {
      expect(await columnsOf(adapter, "projects")).toEqual(await columnsOf(fresh, "projects"));
    } finally {
      await fresh.close();
    }
  });

  it("lifts the phrase out of the name and keeps the original in legacy_name", async () => {
    await seed([
      ["p1", "P2P - Acme Corp Current State"],
      ["p2", "Order to Cash — future state"],
    ]);

    await runMigrations(adapter);

    expect(await projects()).toEqual([
      {
        id: "p1",
        name: "P2P - Acme Corp",
        state: "current",
        legacy_name: "P2P - Acme Corp Current State",
      },
      {
        id: "p2",
        name: "Order to Cash",
        state: "future",
        legacy_name: "Order to Cash — future state",
      },
    ]);
  });

  it("leaves an unrecognised name byte-identical, with no state and no legacy_name", async () => {
    await seed([
      ["p1", "my process"],
      ["p2", "Real Estate Onboarding"],
    ]);

    await runMigrations(adapter);

    expect(await projects()).toEqual([
      { id: "p1", name: "my process", state: null, legacy_name: null },
      { id: "p2", name: "Real Estate Onboarding", state: null, legacy_name: null },
    ]);
  });

  it("classifies a name that is only the phrase without blanking it", async () => {
    await seed([["p1", "Current State"]]);

    await runMigrations(adapter);

    expect(await projects()).toEqual([
      { id: "p1", name: "Current State", state: "current", legacy_name: null },
    ]);
  });

  it("is a no-op when applied a second time", async () => {
    await seed([
      ["p1", "P2P - Acme Corp Current State"],
      ["p2", "my process"],
      ["p3", "Current State"],
    ]);

    await runMigrations(adapter);
    const afterFirst = await projects();

    // The runner short-circuits on MAX(version), so replay it the way a
    // database with a stale version row would: drop the v6 marker and rerun.
    // That also exercises the runner's documented self-heal path.
    await adapter.execute("DELETE FROM schema_version WHERE version = 6");
    await runMigrations(adapter);

    expect(await projects()).toEqual(afterFirst);
  });

  it("never overwrites a legacy_name that is already set", async () => {
    await runMigrations(adapter);
    await adapter.execute(
      "INSERT INTO projects (id, name, state, legacy_name, created_at, updated_at) VALUES ('p1', 'Renamed Current State', 'future', 'The Original', 0, 0)"
    );

    await adapter.execute("DELETE FROM schema_version WHERE version = 6");
    await runMigrations(adapter);

    expect(await projects()).toEqual([
      {
        id: "p1",
        name: "Renamed Current State",
        state: "future",
        legacy_name: "The Original",
      },
    ]);
  });
});
