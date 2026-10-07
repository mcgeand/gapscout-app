/**
 * In-memory DatabaseAdapter for round-trip tests (ZIP-369).
 *
 * Stores rows in per-table Maps keyed by primary key. Parses the SQL shapes
 * db.ts emits for the policies, glossary and milestones CRUD
 * (INSERT/SELECT/UPDATE/DELETE with $1, $2, … placeholders), the
 * schema-version bookkeeping that runMigrations performs at initDB time, and
 * the tableHasColumn/tableExists guards individual migrations use before
 * touching a table.
 *
 * Why not the real SqlJsAdapter: SqlJsAdapter loads sql.js from a CDN and
 * doesn't run in vitest+jsdom — see migrations.test.ts:7. The npm sql.js
 * package would work but adds a ~1MB dependency; this adapter gives us
 * exactly the round-trip semantics ZIP-369 needs.
 *
 * Coverage: enough SQL grammar to support the CRUD functions exported from
 * db.ts for policies, glossary, milestones and sipoc (including the latter's
 * `ON CONFLICT … DO UPDATE` upsert, and milestones' `assertMilestoneOrderFree`
 * order pre-check). Adapter is intentionally narrow — if a future test needs
 * JOINs or aggregates, extend the regexes here.
 *
 * Unmatched SQL throws (#369). Both `execute()` and `select()` used to fall
 * through an unrecognised statement to `{ rowsAffected: 0 }` / `[]`, which are
 * also the truthful answers to a handful of *recognised* shapes (a delete
 * that hit no rows, a select against an empty table) — so a test could assert
 * "0 rows" or "[]" against a statement this adapter never parsed at all and
 * pass for the wrong reason. Extend the regexes here for any new shape a test
 * needs; do not widen this catch-all to swallow it.
 */

import type { DatabaseAdapter, QueryResult } from "../../services/db/dbInterface";

type Row = Record<string, unknown>;

/**
 * Shared by every fall-out below (a statement whose shape isn't modelled at
 * all, and a partially-matched statement whose parse can't be trusted) so
 * there is exactly one unsupported-SQL message to keep in sync with the
 * tests that assert against it.
 */
function unsupported(sql: string): never {
  throw new Error(
    `InMemoryAdapter: unsupported SQL (extend the regexes in inMemoryAdapter.ts): ${sql.trim().slice(0, 120)}`,
  );
}

/**
 * Tables whose primary key is not `id`. Everything else in the schema is keyed
 * by a nanoid `id` column; `sipoc` holds one summary per project instead.
 */
const PRIMARY_KEYS: Record<string, string> = { sipoc: "project_id" };

/**
 * Tables with no single-column key at all. `search_index` is an FTS5 table
 * keyed by nothing its inserts carry, so rows here get a synthetic key.
 * Without this they resolved to an empty key and were dropped on the floor, so
 * a test asserting the index had been cleared passed against an index that was
 * never written (#314, and the wider #369).
 *
 * The synthetic key is an insertion counter, not an identity: `reindexEntity`
 * models a real update as DELETE-then-INSERT on (entity_type, entity_id), so
 * that delete shape has to be parsed too or re-indexing an entity would leave
 * two rows here and one in SQLite.
 */
const KEYLESS_TABLES = new Set(["search_index"]);

export class InMemoryAdapter implements DatabaseAdapter {
  private tables = new Map<string, Map<string, Row>>();
  // Deliberately NOT bumped to the current MIGRATIONS top (v8, db.ts): kept at
  // the pre-#299 value so runMigrations actually walks v5-v8 at initDB. Each
  // of those migrations happens to exit clean through its own
  // tableHasColumn/tableExists guard (see the `pragma_table_info` and
  // `sqlite_master` branches in select() below), but the property this
  // adapter actually relies on is #369's: an unguarded future migration body
  // now throws loudly here instead of silently no-opping, so a migration that
  // forgets its guard fails the test suite rather than passing one that never
  // really ran. Bumping this to 8 would skip v5-v8 outright via the version
  // check and hide that failure mode; leave it at 4 even as new migrations
  // land.
  private schemaVersion = 4;
  private nextSyntheticKey = 0;

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const trimmed = sql.trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(trimmed)) {
      return { rowsAffected: 0 };
    }

    const versionInsert = trimmed.match(
      /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+schema_version[\s\S]*VALUES\s*\(\s*(\d+)/i,
    );
    if (versionInsert) {
      this.schemaVersion = Math.max(this.schemaVersion, Number(versionInsert[1]));
      return { rowsAffected: 1 };
    }

    if (
      /^(--|CREATE\s+TABLE|CREATE\s+INDEX|CREATE\s+VIRTUAL|CREATE\s+TRIGGER|DROP\s+TABLE|DROP\s+INDEX|ALTER\s+TABLE|PRAGMA)/i.test(
        trimmed,
      )
    ) {
      return { rowsAffected: 0 };
    }

    const insert = trimmed.match(
      /^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i,
    );
    if (insert) {
      const [, table, colsRaw, valuesRaw] = insert;
      const cols = colsRaw.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const placeholders = valuesRaw.split(",").map((v) => v.trim());

      if (placeholders.some((p) => !/^\$\d+$/.test(p))) {
        // A VALUES list mixing literals with placeholders (e.g. db.ts's
        // Unassigned-team backfill: `VALUES ($1, $2, 'Unassigned', $3, NULL,
        // $4, '[]', $5)`) is a shape this adapter doesn't model: `cols` and
        // `placeholders` are misaligned by index from here on, so returning
        // `rowsAffected: 0` would be indistinguishable from "0 rows matched"
        // and let a test pass against an insert that was never actually
        // parsed.
        unsupported(sql);
      }

      const row: Row = {};
      cols.forEach((col, i) => {
        const placeholder = placeholders[i];
        const idx = Number(placeholder.slice(1)) - 1;
        row[col] = params[idx];
      });

      let key: string;
      if (KEYLESS_TABLES.has(table)) {
        key = `row-${this.nextSyntheticKey++}`;
      } else {
        key = String(row[PRIMARY_KEYS[table] ?? "id"] ?? "");
        if (!key) unsupported(sql);
      }

      const tbl = this.tables.get(table) ?? new Map<string, Row>();
      // `ON CONFLICT … DO UPDATE SET col = excluded.col` for every non-key
      // column is a plain overwrite here, which is what upsertSipoc emits.
      // A conflicting insert without that clause is a constraint violation.
      if (tbl.has(key) && !/ON\s+CONFLICT[\s\S]*DO\s+UPDATE/i.test(trimmed)) {
        throw new Error(`UNIQUE constraint failed: ${table} primary key ${key}`);
      }
      tbl.set(key, row);
      this.tables.set(table, tbl);
      return { rowsAffected: 1 };
    }

    const update = trimmed.match(/^UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\$(\d+)/i);
    if (update) {
      const [, table, setClause, whereIdxStr] = update;
      const whereIdx = Number(whereIdxStr) - 1;
      const id = String(params[whereIdx]);
      const tbl = this.tables.get(table);
      const row = tbl?.get(id);
      if (!tbl || !row) return { rowsAffected: 0 };

      const setParts = setClause.split(",").map((s) => s.trim());
      for (const part of setParts) {
        const m = part.match(/^"?(\w+)"?\s*=\s*\$(\d+)/);
        if (m) {
          const [, col, idxStr] = m;
          row[col] = params[Number(idxStr) - 1];
        }
      }
      return { rowsAffected: 1 };
    }

    // `deleteProject` clears a project's rows table by table (#314). Without
    // this branch those statements fall through to the `rowsAffected: 0`
    // default below and the delete silently does nothing, so a test asserting
    // the rows are gone would pass having deleted none of them.
    // `reindexEntity` and `removeFromIndex` both emit this shape. Without it a
    // re-index adds a second row instead of replacing the first.
    const delByEntity = trimmed.match(
      /^DELETE\s+FROM\s+(\w+)\s+WHERE\s+entity_type\s*=\s*\$1\s+AND\s+entity_id\s*=\s*\$2\s*$/i,
    );
    if (delByEntity) {
      const [, table] = delByEntity;
      const tbl = this.tables.get(table);
      if (!tbl) return { rowsAffected: 0 };
      let rowsAffected = 0;
      for (const [key, row] of tbl) {
        if (row.entity_type === params[0] && row.entity_id === params[1]) {
          tbl.delete(key);
          rowsAffected += 1;
        }
      }
      return { rowsAffected };
    }

    // Anchored: an unmodelled shape such as `... WHERE project_id = $1 AND
    // milestone_id = $2` must fall through rather than delete the whole
    // project's rows and quietly overstate what the statement did.
    const delByProject = trimmed.match(
      /^DELETE\s+FROM\s+(\w+)\s+WHERE\s+project_id\s*=\s*\$1\s*$/i,
    );
    if (delByProject) {
      const [, table] = delByProject;
      const tbl = this.tables.get(table);
      if (!tbl) return { rowsAffected: 0 };
      let rowsAffected = 0;
      for (const [key, row] of tbl) {
        if (row.project_id === params[0]) {
          tbl.delete(key);
          rowsAffected += 1;
        }
      }
      return { rowsAffected };
    }

    const del = trimmed.match(/^DELETE\s+FROM\s+(\w+)\s+WHERE\s+id\s*=\s*\$1/i);
    if (del) {
      const [, table] = del;
      const id = String(params[0]);
      const tbl = this.tables.get(table);
      if (tbl?.has(id)) {
        tbl.delete(id);
        return { rowsAffected: 1 };
      }
      return { rowsAffected: 0 };
    }

    unsupported(sql);
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const trimmed = sql.trim();

    if (/SELECT\s+MAX\(version\)\s+AS\s+version\s+FROM\s+schema_version/i.test(trimmed)) {
      return [{ version: this.schemaVersion }] as T;
    }

    if (/pragma_table_info\('(\w+)'\)\s+WHERE\s+name\s*=\s*\$\d+/i.test(trimmed)) {
      return [{ count: 0 }] as T;
    }

    // `tableExists` probes `sqlite_master` to tell "table missing" from
    // "column missing" (db.ts:477-490), because pragma_table_info answers
    // zero rows for both. This adapter keeps no `sqlite_master` catalogue at
    // all — only per-table Maps created on first insert — so it has no real
    // answer to give a query against it in general; it only recognizes
    // `tableExists`'s exact probe shape and answers 0 for that one, which is
    // what makes `tableExists` treat every table as absent here.
    //
    // Anchored to that exact shape, not just the WHERE clause: unanchored, a
    // different query against the same table — e.g. `SELECT name FROM
    // sqlite_master WHERE type = 'table' AND name = $1` — would also match
    // and come back as `[{ count: 0 }]` (length 1, truthy), which is a worse
    // lie than falling through, so any other sqlite_master query must fall
    // through to the throw below instead.
    //
    // Empirically, `tableExists` wraps this call in its own try/catch that
    // already turns any adapter error into `false` (db.ts:481-489), so
    // removing this branch does not fail a test today — the throw would be
    // silently absorbed there before it ever surfaced. This branch is kept
    // anyway per #369's decision: an explicit, narrowly-scoped answer to the
    // one probe shape this adapter actually models, not a wildcard that
    // happens to also catch it.
    if (
      /^SELECT\s+COUNT\(\*\)\s+AS\s+count\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*\$1$/i.test(
        trimmed,
      )
    ) {
      return [{ count: 0 }] as T;
    }

    const byId = trimmed.match(/^SELECT\s+\*\s+FROM\s+(\w+)\s+WHERE\s+id\s*=\s*\$1/i);
    if (byId) {
      const [, table] = byId;
      const tbl = this.tables.get(table);
      if (!tbl) return [] as T;
      const row = tbl.get(String(params[0]));
      return (row ? [row] : []) as T;
    }

    const byProject = trimmed.match(
      /^SELECT\s+\*\s+FROM\s+(\w+)\s+WHERE\s+project_id\s*=\s*\$1(?:\s+ORDER\s+BY\s+(.+))?$/i,
    );
    if (byProject) {
      const [, table, orderRaw] = byProject;
      const tbl = this.tables.get(table);
      if (!tbl) return [] as T;
      const rows = Array.from(tbl.values()).filter((r) => r.project_id === params[0]);
      if (orderRaw) {
        const parts = orderRaw.trim().split(/\s+/);
        const col = parts[0];
        const dir = parts[1]?.toUpperCase() === "DESC" ? -1 : 1;
        rows.sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av == null && bv == null) return 0;
          if (av == null) return 1 * dir;
          if (bv == null) return -1 * dir;
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });
      }
      return rows as T;
    }

    // `assertMilestoneOrderFree` (db.ts, #131's unique-order guard): is any
    // *other* milestone in this project already sitting at `order`? Answered
    // truthfully rather than falling through, because a false "no conflict"
    // here would let createMilestone/updateMilestone write a duplicate this
    // adapter was built specifically to still catch.
    const orderConflict = trimmed.match(
      /^SELECT\s+id\s+FROM\s+(\w+)\s+WHERE\s+project_id\s*=\s*\$1\s+AND\s+"order"\s*=\s*\$2\s+AND\s+id\s*<>\s*\$3\s+LIMIT\s+1$/i,
    );
    if (orderConflict) {
      const [, table] = orderConflict;
      const tbl = this.tables.get(table);
      if (!tbl) return [] as T;
      const [projectId, order, exceptId] = params;
      const hit = Array.from(tbl.values()).find(
        (r) => r.project_id === projectId && r.order === order && r.id !== exceptId,
      );
      return (hit ? [{ id: hit.id }] : []) as T;
    }

    unsupported(sql);
  }
}
