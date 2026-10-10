/**
 * Database service layer with adapter pattern
 * Supports both Tauri SQL plugin (desktop) and sql.js (browser)
 */

import { nanoid } from "nanoid";
import type {
  Project,
  ProjectChanges,
  ProjectSummary,
  Team,
  System,
  Milestone,
  Step,
  Gap,
  GapUpdate,
  Link,
  Policy,
  GlossaryEntry,
  SIPOC,
  ProjectRow,
  ProjectSummaryRow,
  TeamRow,
  SystemRow,
  MilestoneRow,
  StepRow,
  GapRow,
  PolicyRow,
  GlossaryEntryRow,
  SIPOCRow,
} from "../data/types";
import { z } from "zod";
import {
  StepSchema,
  GapSchema,
  TeamSchema,
  SystemSchema,
  MilestoneSchema,
  PolicySchema,
  GlossaryEntrySchema,
  SIPOCSchema,
  ProjectSchema,
  ProjectSummarySchema,
} from "../data/schemas";
import { UNASSIGNED_TEAM_COLOR } from "../data/constants";
import { isProjectState, parseProjectName } from "../lib/projectState";
import { withJiraLabel } from "../lib/jiraKey";
import type { DatabaseAdapter } from "./db/dbInterface";
import { getDB, setDB } from "./db/connection";
import { logger } from "../lib/logger";
import {
  indexEntity,
  reindexEntity,
  removeFromIndex,
  clearProjectIndex,
  buildStepContent,
  buildGapContent,
  buildTeamContent,
  buildSystemContent,
  buildMilestoneContent,
  buildPolicyContent,
  buildGlossaryContent,
} from "./searchIndex";

/**
 * Check if we're running in a Tauri environment
 */
function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Database schema (embedded at build time)
export const SCHEMA_SQL = `-- GapScout Database Schema
-- SQLite 3.x
-- Location: ~/.gapscout/gapscout.db

-- =====================================================
-- PROJECTS & SIPOC
-- =====================================================

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  state TEXT, -- 'current' | 'future' | NULL, NULL meaning nobody has said
  legacy_name TEXT, -- pre-migration name, set only when v6 rewrote the name
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS sipoc (
  project_id TEXT PRIMARY KEY,
  suppliers TEXT,
  inputs TEXT,
  process TEXT,
  outputs TEXT,
  customers TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- =====================================================
-- REGISTRIES (Teams, Systems, Glossary)
-- =====================================================

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teams_project ON teams(project_id);
CREATE INDEX IF NOT EXISTS idx_teams_order ON teams(project_id, "order");

CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  vendor TEXT,
  type TEXT CHECK(type IN ('ERP', 'CRM', 'WMS', 'Custom', 'Other')),
  tags TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_systems_project ON systems(project_id);

CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  term TEXT NOT NULL,
  definition TEXT NOT NULL,
  acronym TEXT,
  related_steps TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_glossary_project ON glossary(project_id);
CREATE INDEX IF NOT EXISTS idx_glossary_term ON glossary(term);

-- =====================================================
-- PROCESS STRUCTURE (Milestones, Policies)
-- =====================================================

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  related_policies TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
-- The (project_id, "order") index is UNIQUE and is owned by migration v8, not
-- by this file (#131). It cannot live here: SCHEMA_SQL runs before the
-- migrations, so a CREATE UNIQUE INDEX at this point would throw on any
-- existing database that still carries a tie — before the migration that
-- dedupes it could run. On a fresh database v8 creates it in the same initDB.

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_doc TEXT,
  related_milestones TEXT,
  test_notes TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_policies_project ON policies(project_id);

-- =====================================================
-- CORE PROCESS DATA (Steps)
-- =====================================================

CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  team_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  suppliers TEXT,
  inputs TEXT,
  outputs TEXT,
  customers TEXT,
  systems TEXT,
  trigger TEXT,
  result TEXT,
  kpi TEXT,
  decision INTEGER DEFAULT 0,
  branches TEXT,
  notes TEXT,
  comments TEXT,
  links TEXT,
  gap_ids TEXT,
  diagram_position TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT,
  FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_steps_project ON steps(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_milestone ON steps(milestone_id);
CREATE INDEX IF NOT EXISTS idx_steps_team ON steps(team_id);
CREATE INDEX IF NOT EXISTS idx_steps_order ON steps(milestone_id, "order");
CREATE INDEX IF NOT EXISTS idx_steps_updated ON steps(updated_at DESC);

-- =====================================================
-- GAP ANALYSIS
-- =====================================================

CREATE TABLE IF NOT EXISTS gaps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  step_id TEXT,
  observed TEXT NOT NULL,
  expected TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('L', 'M', 'H')),
  priority INTEGER CHECK(priority BETWEEN 1 AND 5),
  root_cause TEXT CHECK(root_cause IN ('Config', 'Policy', 'Behavior', 'Data')),
  owner_team_id TEXT,
  fix_idea TEXT,
  time_to_fix TEXT CHECK(time_to_fix IN ('qwin', 'near', 'mid', 'long')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Review', 'Closed')),
  missing_field TEXT CHECK(missing_field IN ('supplier', 'input', 'output', 'customer')),
  links TEXT,
  order_num INTEGER,
  milestone_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES steps(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gaps_project ON gaps(project_id);
CREATE INDEX IF NOT EXISTS idx_gaps_step ON gaps(step_id);
CREATE INDEX IF NOT EXISTS idx_gaps_status ON gaps(status);
CREATE INDEX IF NOT EXISTS idx_gaps_severity ON gaps(severity);
CREATE INDEX IF NOT EXISTS idx_gaps_priority ON gaps(priority DESC);
CREATE INDEX IF NOT EXISTS idx_gaps_owner ON gaps(owner_team_id);
-- Note: idx_gaps_order is created by migration after order_num column is added

-- =====================================================
-- FULL-TEXT SEARCH
-- =====================================================

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  project_id UNINDEXED,
  content,
  tokenize = 'porter unicode61'
);

-- =====================================================
-- METADATA & CONFIGURATION
-- =====================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, strftime('%s', 'now') * 1000);
`;

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

let initializationPromise: Promise<void> | null = null;

/**
 * Initialize the database and run migrations
 * Should be called once when the app starts
 */
export function initDB(): Promise<void> {
  if (initializationPromise) return initializationPromise;

  const promise = (async () => {
    try {
      console.log("Starting database initialization...");

      // Detect environment and load appropriate adapter
      if (isTauriEnvironment()) {
        console.log("Detected Tauri environment, using TauriAdapter");
        const { TauriAdapter } = await import('./db/tauriAdapter');
        setDB(new TauriAdapter());
      } else {
        console.log("Detected browser environment, using SqlJsAdapter");
        const { SqlJsAdapter } = await import('./db/sqlJsAdapter');
        setDB(new SqlJsAdapter());
      }

      const db = getDB();
      await db.initialize();
      console.log("Database adapter initialized successfully");

      // Execute schema SQL (CREATE TABLE IF NOT EXISTS makes this idempotent)
      console.log("Initializing database schema...");
      await db.execute(SCHEMA_SQL);

      await runMigrations(db);
      // Best-effort hygiene: a corrupted FTS5 table (or a build without FTS5)
      // must not block startup. v9 still applies the same DELETE once for
      // upgrades that have never swept.
      try {
        await sweepOrphanedSearchIndexRows(db);
      } catch (error) {
        console.warn(
          "Orphaned search_index sweep failed; continuing startup",
          error,
        );
      }

      console.log("Database schema initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize database");
      console.error("Error type:", typeof error);
      console.error("Error:", error);

      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }

      throw error;
    }
  })();

  initializationPromise = promise;
  void promise.catch(() => {
    if (initializationPromise === promise) initializationPromise = null;
  });
  return promise;
}

// ============================================================================
// MIGRATIONS
// ============================================================================

interface Migration {
  version: number;
  name: string;
  up: (adapter: DatabaseAdapter) => Promise<void>;
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: 2, name: "add_validation_status_to_steps", up: addValidationStatusToSteps },
  { version: 3, name: "reshape_gaps_table", up: reshapeGapsTable },
  { version: 4, name: "create_and_backfill_search_index", up: createAndBackfillSearchIndex },
  { version: 5, name: "renumber_step_order_within_milestone", up: renumberStepOrderWithinMilestone },
  { version: 6, name: "add_state_to_projects", up: addStateToProjects },
  { version: 7, name: "backfill_empty_step_team_id", up: backfillEmptyStepTeamId },
  { version: 8, name: "enforce_unique_milestone_order", up: enforceUniqueMilestoneOrder },
  { version: 9, name: "sweep_orphaned_search_index_rows", up: sweepOrphanedSearchIndexRows },
  { version: 10, name: "backfill_step_comment_search_index", up: backfillStepCommentSearchIndex },
];

/**
 * Apply pending schema migrations.
 *
 * Reads MAX(version) from `schema_version` and applies any migration in
 * `MIGRATIONS` whose version exceeds the current, then writes that version row.
 *
 * ## What the BEGIN IMMEDIATE around each migration is worth
 *
 * Not atomicity. `BEGIN IMMEDIATE`, `COMMIT` and `ROLLBACK` go out as three
 * separate `adapter.execute` calls, and on the Tauri adapter
 * `@tauri-apps/plugin-sql` runs each through an sqlx pool — ten connections,
 * created lazily, handed out FIFO. While the pool holds one connection every
 * statement reuses it and the pair binds, which is why migrations have always
 * appeared transactional: they run at startup, before anything else issues a
 * query. Nothing guarantees that. One concurrent statement during `initDB`
 * opens a second connection, and from then on consecutive calls alternate.
 * This is the shape #236 deleted from `withTransaction`. Real atomicity needs
 * a Rust command running the batch inside `pool.begin()` — tracked as #399.
 *
 * A tear is therefore possible, and costs twice: the body's statements have
 * already autocommitted, and the orphaned `BEGIN IMMEDIATE` holds a write
 * transaction on its pooled connection. Both were observed under #236 on
 * 2026-09-02, where the second cost showed up as every later save in that
 * session failing `database is locked` (code 517) until the app restarted.
 *
 * ## The contract that actually holds
 *
 * The version row is written after the body, never before, so a failure leaves
 * the version behind rather than ahead. Recovery is the body's job: each `up`
 * must tolerate being rerun over its own partial output, not merely over a
 * clean database. That is what lets a stale `schema_version` self-heal, and it
 * is per-migration rather than blanket:
 *
 * - v2, v4, v6 — column-guarded, `IF NOT EXISTS`, `WHERE NOT EXISTS`, so each
 *   tolerates its own partial output. v4 does still assume the tables it reads
 *   exist, which is true through `initDB` but is not a guard of its own.
 * - v7 — rerunnable by its filter. It only ever reads steps whose `team_id` is
 *   `''`, and it resolves the sentinel team by name before creating one, so a
 *   rerun over its own partial output finds the team it already made and the
 *   rows it already repaired are no longer in the set it looks at.
 * - v3 — recovers each of its torn states; see `reshapeGapsTable`. Note that
 *   it keys on `gaps_new`, because `SCHEMA_SQL` runs first and hides the worst
 *   of those states from a probe on `gaps` itself.
 * - v8 — rerunnable by its filter and its DDL. It renumbers only projects that
 *   hold a tie or a parked order — the two shapes a tear can leave — and both
 *   index statements are `IF [NOT] EXISTS`; see `enforceUniqueMilestoneOrder`.
 * - v9 — idempotent DELETE keyed on missing `projects` rows; see
 *   `sweepOrphanedSearchIndexRows`. Also runs at the end of every `initDB`
 *   so a raw-SQL project delete cannot strand index rows between releases.
 * - v10 — rerunnable reindex: DELETE+INSERT per step via the live
 *   `buildStepContent`/`stepRowToStep` (not frozen copies — a reindex should
 *   track current indexing whenever those builders change); see
 *   `backfillStepCommentSearchIndex`.
 * - v5 — **not** rerun-safe after a tear. A tear between its two UPDATEs
 *   leaves steps renumbered and gaps raw, and re-ranking that mixed state
 *   moves a gap relative to the steps it sat between. Its own comment says so.
 *   Acceptable, and not a bug to file: every real database is past v5, and a
 *   fresh install runs it over an empty `steps` table where nothing can tear.
 *   It stays on this list only because a pre-v5 database from an old build
 *   could still exist somewhere; if one ever surfaces, #399 is the fix.
 *
 * Hard-crash recovery (process kill / OS panic) is a different case and is
 * delegated to SQLite's journal/WAL, which rolls back whatever the connection
 * had actually opened. No JS runs in that case.
 */
export async function runMigrations(adapter: DatabaseAdapter): Promise<void> {
  let current = 0;
  try {
    const rows = await adapter.select<Array<{ version: number | null }>>(
      "SELECT MAX(version) AS version FROM schema_version"
    );
    current = rows[0]?.version ?? 0;
  } catch {
    current = 0;
  }

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;

    console.log(`[migrations] applying v${m.version}: ${m.name}`);
    await adapter.execute("BEGIN IMMEDIATE");
    try {
      await m.up(adapter);
      await adapter.execute(
        `INSERT INTO schema_version (version, applied_at) VALUES (${m.version}, strftime('%s','now')*1000)`
      );
      await adapter.execute("COMMIT");
      console.log(`[migrations] v${m.version} applied`);
    } catch (err) {
      console.error(`[migrations] v${m.version} failed, rolling back:`, err);
      try {
        await adapter.execute("ROLLBACK");
      } catch (rollbackErr) {
        console.error("[migrations] rollback failed:", rollbackErr);
      }
      throw err;
    }
  }
}

// pragma_table_info() is a table-valued function whose argument can't be
// `?`-bound — SQLite parses the table name at compile time. The `column`
// value goes through a normal placeholder. Callers in this file pass static
// literals, but parameterizing `column` prevents future copy-paste hazards.
async function tableHasColumn(
  adapter: DatabaseAdapter,
  table: string,
  column: string
): Promise<boolean> {
  try {
    const rows = await adapter.select<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count FROM pragma_table_info('${table}') WHERE name = $1`,
      [column]
    );
    return (rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

// `pragma_table_info` cannot tell "table missing" from "column missing" — both
// return zero rows — so a migration recovering from a half-applied table copy
// has to ask `sqlite_master` whether the table is there at all.
async function tableExists(adapter: DatabaseAdapter, table: string): Promise<boolean> {
  try {
    const rows = await adapter.select<Array<{ count: number }>>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = $1",
      [table]
    );
    return (rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function tableIsEmpty(adapter: DatabaseAdapter, table: string): Promise<boolean> {
  const rows = await adapter.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM "${table}"`
  );
  return (rows[0]?.count ?? 0) === 0;
}

async function addValidationStatusToSteps(adapter: DatabaseAdapter): Promise<void> {
  if (!(await tableHasColumn(adapter, "steps", "validation_status"))) {
    await adapter.execute("ALTER TABLE steps ADD COLUMN validation_status TEXT");
  }
  // Always run — `IF NOT EXISTS` is idempotent, and this self-heals the
  // (rare) case of column-present-but-index-missing.
  await adapter.execute(
    "CREATE INDEX IF NOT EXISTS idx_steps_validation ON steps(validation_status)"
  );
}

/**
 * Renumber every milestone's steps (and the process gaps that sit among them)
 * to a dense 1..n, in their existing relative order.
 *
 * `steps."order"` numbers a step within its milestone — the diagram, both
 * exports, the validator and `idx_steps_order` all read it that way. Projects
 * seeded or edited before #299 hold a project-wide sequence instead, so a
 * milestone could start at 5 and the Discovery grid's inline editor, which
 * ranges the typed value against the milestone's step count, would refuse
 * every order the row already had.
 *
 * Dense rather than ordinal, so two rows deliberately sharing an order stay
 * parallel instead of being split into an arbitrary sequence. Idempotent: a
 * milestone already numbered 1..n dense-ranks to itself, which is what lets a
 * database that was already correct pass through untouched.
 */
async function renumberStepOrderWithinMilestone(adapter: DatabaseAdapter): Promise<void> {
  // Nothing to renumber if the sequence columns are not there yet. A database
  // coming from a pre-v2 schema reaches this before `steps` has grown its
  // milestone/order pair, and a migration that assumes a column it never
  // checked is how the whole chain fails on one old install.
  if (
    !(await tableHasColumn(adapter, "steps", "milestone_id")) ||
    !(await tableHasColumn(adapter, "steps", "order"))
  ) {
    return;
  }

  // Steps and ordered gaps share one sequence per milestone, so they have to be
  // ranked together — renumbering steps alone would leave a gap reserving a
  // position that no longer exists.
  //
  // The gaps half is conditional because `order_num` and `milestone_id` arrive
  // with v3. A database migrating straight from a pre-v3 schema runs this with
  // the legacy gaps table still in place, where neither column exists.
  const gapsAreSequenced =
    (await tableHasColumn(adapter, "gaps", "order_num")) &&
    (await tableHasColumn(adapter, "gaps", "milestone_id"));

  // Regular tables, not TEMP. plugin-sql pools connections and consecutive
  // statements can land on different ones (#236), and a TEMP table lives only
  // on the connection that made it — so a TEMP scratch table reads back as
  // "no such table" on a real Tauri database while passing every sql.js test.
  // v3's `gaps_new` sets the precedent. Dropped first so a rerun after a run
  // that died mid-migration is not blocked by a leftover scratch table — that
  // clears the table, not the data. Per #236 the caller's BEGIN IMMEDIATE does
  // not reliably bind on pooled connections, so a tear between the two UPDATEs
  // below leaves steps renumbered and gaps raw, and re-ranking that mixed state
  // moves a gap relative to the steps it sat between. Clean reruns are
  // idempotent; a torn one is not.
  await adapter.execute("DROP TABLE IF EXISTS renumbered_v5");
  await adapter.execute("DROP TABLE IF EXISTS sequence_v5");

  await adapter.execute(`
    CREATE TABLE sequence_v5 AS
    SELECT id, project_id, milestone_id, "order" AS ord FROM steps
    ${
      gapsAreSequenced
        ? `UNION ALL
    SELECT id, project_id, milestone_id, order_num AS ord FROM gaps
    WHERE order_num IS NOT NULL AND milestone_id IS NOT NULL`
        : ""
    }
  `);

  await adapter.execute(`
    CREATE TABLE renumbered_v5 AS
    SELECT
      id,
      DENSE_RANK() OVER (PARTITION BY project_id, milestone_id ORDER BY ord) AS new_order
    FROM sequence_v5
  `);

  await adapter.execute(`
    UPDATE steps
    SET "order" = (SELECT new_order FROM renumbered_v5 WHERE renumbered_v5.id = steps.id)
    WHERE EXISTS (SELECT 1 FROM renumbered_v5 WHERE renumbered_v5.id = steps.id)
  `);

  if (gapsAreSequenced) {
    await adapter.execute(`
      UPDATE gaps
      SET order_num = (SELECT new_order FROM renumbered_v5 WHERE renumbered_v5.id = gaps.id)
      WHERE EXISTS (SELECT 1 FROM renumbered_v5 WHERE renumbered_v5.id = gaps.id)
    `);
  }

  await adapter.execute("DROP TABLE renumbered_v5");
  await adapter.execute("DROP TABLE sequence_v5");
}

/**
 * Lift `current` / `future` out of `projects.name` and into a `state` column.
 *
 * Before #263 the only way to say which map you were looking at was to put the
 * word in the name — `P2P - Acme Corp Current State`. That made the name too
 * long for the header (#264) and left nothing to filter or pair on.
 *
 * The match is deliberately narrow and the miss path deliberately inert: a
 * name the regex does not recognise keeps its bytes, its NULL state and its
 * NULL `legacy_name`, because guessing at a user's project names is worse than
 * leaving them unclassified.
 *
 * Idempotent twice over — the `ALTER`s are column-guarded, and the backfill
 * only considers rows that have neither a state nor a `legacy_name`, so a
 * second pass over an already-migrated row finds nothing to strip.
 */
async function addStateToProjects(adapter: DatabaseAdapter): Promise<void> {
  // A database coming from an old enough schema reaches this before `projects`
  // exists at all, and a migration that assumes a table it never checked is
  // how the whole chain fails on one old install.
  if (!(await tableHasColumn(adapter, "projects", "name"))) return;

  if (!(await tableHasColumn(adapter, "projects", "state"))) {
    await adapter.execute("ALTER TABLE projects ADD COLUMN state TEXT");
  }
  if (!(await tableHasColumn(adapter, "projects", "legacy_name"))) {
    await adapter.execute("ALTER TABLE projects ADD COLUMN legacy_name TEXT");
  }

  const rows = await adapter.select<Array<{ id: string; name: string }>>(
    "SELECT id, name FROM projects WHERE state IS NULL AND legacy_name IS NULL"
  );

  for (const row of rows) {
    const parsed = parseProjectName(row.name);
    if (!parsed.state) continue;

    if (parsed.renamed) {
      // One statement, so the new name and the record of the old one can never
      // land separately. `legacy_name IS NULL` keeps a rerun from overwriting
      // an original with an already-stripped name.
      await adapter.execute(
        "UPDATE projects SET state = $1, legacy_name = $2, name = $3 WHERE id = $4 AND legacy_name IS NULL",
        [parsed.state, row.name, parsed.name, row.id]
      );
    } else {
      // The name was only the phrase, so stripping it would leave nothing.
      // Classify it and leave the name alone — there is no rename to reverse.
      await adapter.execute("UPDATE projects SET state = $1 WHERE id = $2", [
        parsed.state,
        row.id,
      ]);
    }
  }
}

/**
 * Give every step whose `team_id` is `''` the project's `Unassigned` team (#104).
 *
 * A SIPOC wizard run from before ZIP-381 could write a step with no owner as an
 * empty string rather than a team id. `StepSchema.teamId` is `z.string().min(1)`,
 * so every read of such a row logs `[db] step[...] schema validation failed`, and
 * the empty string points at no team the registry or the diagram can draw.
 *
 * The repair mirrors `ProcessBoard`'s sentinel resolution, deliberately: find the
 * team named `Unassigned` in that project, else create one, grey on purpose
 * (`UNASSIGNED_TEAM_COLOR`, shared with `ProcessBoard` so the two sites cannot
 * drift to different greys) because the sentinel is the absence of an owner and
 * a lane colour would give it a presence in the diagram it has not earned. Never
 * the first team in the project — that would file unowned steps under a team the
 * user did name.
 *
 * Idempotent by its filter rather than by a guard. `team_id = ''` is both the
 * set it reads and the set the UPDATE narrows to, so a repaired row leaves that
 * set for good, and a second pass selects nothing and writes nothing — no
 * `updated_at` is touched twice. Rerunning over its own partial output works the
 * same way: the name lookup finds a team an interrupted pass already created
 * instead of making a second one, and the index INSERT runs for the resolved
 * team whether this pass created it or found it, so a tear between the team
 * INSERT and the index INSERT still heals.
 *
 * It assumes nothing `SCHEMA_SQL` may have restored. `SCHEMA_SQL` runs before
 * the migrations and recreates missing tables empty (the lesson v3 pays for), so
 * the presence of `teams` or `search_index` says nothing about their contents —
 * every statement here keys on the rows themselves.
 *
 * The first SELECT also excludes any `''` step whose project row is gone: an
 * orphaned step would otherwise make the team INSERT below fail under the
 * `teams.project_id` foreign key and take migration startup down with it.
 */
async function backfillEmptyStepTeamId(adapter: DatabaseAdapter): Promise<void> {
  // A database coming from an old enough schema reaches this before `steps` or
  // `teams` exists, and a migration that assumes a table it never checked is how
  // the whole chain fails on one old install.
  if (!(await tableHasColumn(adapter, "steps", "team_id"))) return;
  if (!(await tableExists(adapter, "teams"))) return;

  const orphaned = await adapter.select<Array<{ project_id: string }>>(
    `SELECT DISTINCT project_id FROM steps WHERE team_id = ''
       AND EXISTS (SELECT 1 FROM projects p WHERE p.id = steps.project_id)`
  );
  if (orphaned.length === 0) return;

  // v4 owns `search_index`, so through the chain it is always there by now —
  // but this is the probe rather than the assumption, because an FTS5-less
  // build would otherwise take the whole migration down with it.
  const indexed = await tableExists(adapter, "search_index");
  const now = Date.now();

  for (const { project_id: projectId } of orphaned) {
    const existing = await adapter.select<Array<{ id: string }>>(
      `SELECT id FROM teams WHERE project_id = $1 AND name = 'Unassigned' ORDER BY "order", id LIMIT 1`,
      [projectId]
    );

    let teamId = existing[0]?.id;
    if (!teamId) {
      // `teamsStore.addTeam`'s convention: max of the existing orders, 0 when
      // there are none, plus one — so the sentinel lands after the teams the
      // user named rather than among them.
      const orders = await adapter.select<Array<{ max_order: number | null }>>(
        `SELECT MAX("order") AS max_order FROM teams WHERE project_id = $1`,
        [projectId]
      );
      teamId = nanoid();
      await adapter.execute(
        `INSERT INTO teams (id, project_id, name, color, description, "order", tags, created_at)
         VALUES ($1, $2, 'Unassigned', $3, NULL, $4, '[]', $5)`,
        [teamId, projectId, UNASSIGNED_TEAM_COLOR, (orders[0]?.max_order ?? 0) + 1, now]
      );
    }

    if (indexed) {
      // v4's team formula, run over the resolved team rather than a literal, so
      // a team this migration created on an earlier torn pass gets indexed on
      // the next one. `WHERE NOT EXISTS` keeps a second pass from duplicating
      // the row. `$1`/`$2` both bind `teamId`: SqlJsTestAdapter rewrites `$n`
      // placeholders positionally rather than by name, so binding it twice is
      // correct on both adapters.
      await adapter.execute(
        `INSERT INTO search_index (entity_type, entity_id, project_id, content)
         SELECT 'team', t.id, t.project_id,
             CASE WHEN t.name IS NOT NULL AND t.name <> '' THEN t.name ELSE '' END ||
             CASE WHEN t.description IS NOT NULL AND t.description <> '' THEN ' ' || t.description ELSE '' END
         FROM teams t
         WHERE t.id = $1
           AND NOT EXISTS (
             SELECT 1 FROM search_index i WHERE i.entity_type = 'team' AND i.entity_id = $2
           )`,
        [teamId, teamId]
      );
    }

    // The `team_id = ''` half of this filter is what makes the migration safe to
    // rerun and what keeps it off every step that already has an owner. A step's
    // searchable content does not include its team, so no step needs reindexing.
    await adapter.execute(
      "UPDATE steps SET team_id = $1, updated_at = $2 WHERE project_id = $3 AND team_id = ''",
      [teamId, now, projectId]
    );
  }
}

/**
 * Make `(project_id, "order")` unique on `milestones`, deduping first (#131).
 *
 * Two milestones sharing an order in one project is not parallel work the way
 * two steps sharing one inside a milestone is (see CLAUDE.md — that tie is
 * deliberate and load-bearing). Milestones are the phases the process runs
 * through, `listMilestones` sorts on `"order"` alone, and a tie therefore makes
 * the tab strip's left-to-right order depend on SQLite's row order. Two paths
 * computing `max(order) + 1` against the same stale snapshot is all it takes.
 *
 * **A unique index, not a rebuilt table.** SQLite has no `ALTER TABLE ADD
 * CONSTRAINT`, and the twelve-step table rebuild is not worth its risk here:
 * `milestones` is an FK parent (`steps.milestone_id` ON DELETE RESTRICT,
 * `gaps.milestone_id` ON DELETE SET NULL) and foreign keys are ON in the Tauri
 * build. A `CREATE UNIQUE INDEX` gives the same guarantee and touches no row.
 *
 * **The dedupe runs first, and only over projects this migration broke or
 * found broken: the ones holding a tie, and the ones holding a parked order.**
 * An untied project keeps its numbers, gaps included — a project numbered
 * 0, 5, 9 is sparse, not broken, and renumbering it would move milestones
 * nobody asked to move. A project it does pick up is renumbered densely 0..n-1
 * in `("order", created_at, rowid)` order, so the tabs keep the order they were
 * already drawn in, a tie is broken by age, and a parked row — which is by
 * construction above every unparked one — stays where the tear left it.
 *
 * ## Rerunning it, and what a tear leaves behind
 *
 * - **Clean rerun.** Neither arm of the sweep finds a project, so nothing is
 *   renumbered, and both index statements are `IF [NOT] EXISTS` no-ops.
 * - **Torn between the DROP and the CREATE.** One restart runs with neither
 *   index — correctness is unaffected, only the index seek behind
 *   `listMilestones`. The rerun creates it.
 * - **New index present, version row missing** (torn after the DDL, before
 *   `runMigrations` wrote the version). The index guarantees there is no tie
 *   left, so only the parked arm can match, and it renumbers under a live
 *   unique index. That is safe for the reason `parkAndPlaceMilestoneOrders`
 *   gives: its shift clears the project's current maximum, so no row it moves
 *   can land on a row it has not moved yet.
 * - **Torn mid-renumber.** `parkAndPlaceMilestoneOrders` documents the shape.
 *   If the remaining rows still tie, the rerun finds them and finishes. If they
 *   do not — 1, 1, 3 parked and then placed as 0, and a tear before the second
 *   — the leftovers sit at parked values, still sorting last where they were,
 *   and the index lands anyway because parked values are unique. That state is
 *   what the parked arm of the sweep exists for: without it the rerun would see
 *   a tie-free project, complete, and leave the milestones parked for good,
 *   because nothing else in the tree renumbers them.
 */
async function enforceUniqueMilestoneOrder(adapter: DatabaseAdapter): Promise<void> {
  // Never false in the app: `initDB` runs `SCHEMA_SQL` first, and that creates
  // `milestones` with its `order` column. No present caller needs it either —
  // the real-engine fixtures replay `SCHEMA_SQL` too, and `migrations.test.ts`'s
  // MockAdapter no-ops DDL it does not parse. It is here in step with v6's and
  // v7's guards, for the one case none of those cover: a real adapter reaching
  // v8 without the table, where `CREATE UNIQUE INDEX IF NOT EXISTS` throws and
  // takes the whole chain down instead of skipping one migration.
  if (!(await tableExists(adapter, "milestones"))) return;
  if (!(await tableHasColumn(adapter, "milestones", "order"))) return;

  // Two shapes, one sweep. The tie is what this migration was written for; the
  // parked order is what a tear in its own renumber (or in `reorderMilestones`)
  // leaves behind, and it is tie-free, so the first arm alone would walk past a
  // project stranded at 1000001 and call the migration done.
  const brokenRows = await adapter.select<Array<{ project_id: string }>>(
    `SELECT project_id FROM milestones GROUP BY project_id, "order" HAVING COUNT(*) > 1
     UNION
     SELECT project_id FROM milestones GROUP BY project_id HAVING MAX("order") >= $1`,
    [MILESTONE_ORDER_PARK]
  );
  // The tie arm returns one row per tied *order*, so a project with two
  // separate ties appears twice; so does a project that is both tied and parked.
  const brokenProjects = [...new Set(brokenRows.map((row) => row.project_id))];

  const now = Date.now();
  for (const projectId of brokenProjects) {
    const rows = await adapter.select<Array<{ id: string }>>(
      `SELECT id FROM milestones WHERE project_id = $1 ORDER BY "order", created_at, rowid`,
      [projectId]
    );
    await parkAndPlaceMilestoneOrders(
      adapter,
      projectId,
      rows.map((row) => row.id),
      now
    );
  }

  // The non-unique index this replaces. Dropped rather than left beside the new
  // one: they cover the same columns, so keeping it would only cost writes.
  await adapter.execute("DROP INDEX IF EXISTS idx_milestones_order");
  await adapter.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_project_order ON milestones(project_id, "order")`
  );
}

/**
 * Remove `search_index` rows whose `project_id` no longer exists (#374).
 *
 * FTS5 virtual tables carry no foreign keys, so a project removed outside
 * `deleteProject` — e.g. raw SQL from a shell whose `sqlite3` lacks FTS5 —
 * leaves orphaned index rows nothing in the app can reach. The DELETE is
 * idempotent: a second pass finds nothing to remove.
 */
async function sweepOrphanedSearchIndexRows(adapter: DatabaseAdapter): Promise<void> {
  if (!(await tableExists(adapter, "search_index"))) return;
  if (!(await tableExists(adapter, "projects"))) return;

  await adapter.execute(`
    DELETE FROM search_index
    WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = search_index.project_id)
  `);
}

/**
 * Rebuild every step's search row with the current `buildStepContent` (#378).
 *
 * Comments indexed in #366 only reach new saves; v4's backfill skips steps
 * already present. Walking all steps and reindexing repairs that gap without
 * requiring a touch save. DELETE then INSERT matches `reindexEntity` and keeps
 * one row per step even when the migration is replayed.
 */
async function backfillStepCommentSearchIndex(adapter: DatabaseAdapter): Promise<void> {
  if (!(await tableExists(adapter, "search_index"))) return;
  if (!(await tableExists(adapter, "steps"))) return;

  const rows = await adapter.select<StepRow[]>("SELECT * FROM steps");
  for (const row of rows) {
    const step = stepRowToStep(row);
    const content = buildStepContent(step);
    await adapter.execute(
      "DELETE FROM search_index WHERE entity_type = $1 AND entity_id = $2",
      ["step", step.id]
    );
    await adapter.execute(
      "INSERT INTO search_index (entity_type, entity_id, project_id, content) VALUES ($1, $2, $3, $4)",
      ["step", step.id, step.projectId, content]
    );
  }
}

/**
 * Reshape `gaps` to the v3 column set: a table copy, then the indexes.
 *
 * The copy is four statements — build `gaps_new`, fill it, drop `gaps`,
 * rename — and `runMigrations` cannot hold them together on the pooled Tauri
 * adapter (see that function's contract note, and #399). So this body has to
 * be able to run again over its own partial output.
 *
 * **The presence of `gaps_new` is the signal, not the shape of `gaps`.**
 * `initDB` runs `SCHEMA_SQL` before this, and its `CREATE TABLE IF NOT EXISTS
 * gaps` already carries `order_num`. So on the launch after a tear between
 * `DROP TABLE gaps` and the rename, an **empty** `gaps` is put back in the
 * modern shape before this code sees the database. An `order_num` probe on
 * `gaps` therefore reports "already reshaped" in precisely the torn state that
 * most needs recovering, and the user's gaps sit in `gaps_new` unreachable.
 * `gaps_new` is written by nothing else in the tree, so its existence means a
 * copy was interrupted, whatever `gaps` currently looks like.
 */
async function reshapeGapsTable(adapter: DatabaseAdapter): Promise<void> {
  const scratchPresent = await tableExists(adapter, "gaps_new");
  const gapsPresent = await tableExists(adapter, "gaps");
  const gapsReshaped = gapsPresent && (await tableHasColumn(adapter, "gaps", "order_num"));

  if (scratchPresent) {
    await recoverFromTornGapsCopy(adapter, gapsPresent, gapsReshaped);
  } else if (gapsPresent && !gapsReshaped) {
    await copyGapsIntoV3Shape(adapter);
  }

  // Re-probed rather than reusing the flag above, because the recovery arms
  // can create the table. `CREATE INDEX IF NOT EXISTS` still errors on a
  // missing table, so this must not assume SCHEMA_SQL ran first — even though
  // through `initDB` it always has.
  if (await tableExists(adapter, "gaps")) {
    await createGapsIndexes(adapter);
  }
}

/**
 * Finish or undo a `gaps` copy that was interrupted, given that `gaps_new`
 * exists. The tear points are `CREATE TABLE gaps_new`, the `INSERT`, the
 * `DROP TABLE gaps` and the rename, which leaves three distinguishable states.
 */
async function recoverFromTornGapsCopy(
  adapter: DatabaseAdapter,
  gapsPresent: boolean,
  gapsReshaped: boolean
): Promise<void> {
  if (!gapsPresent) {
    // Torn between the drop and the rename, with nothing having recreated
    // `gaps` since. `gaps_new` is the only copy of the user's gaps.
    await adapter.execute("ALTER TABLE gaps_new RENAME TO gaps");
    return;
  }

  if (!gapsReshaped) {
    // Torn before the drop: the pre-v3 `gaps` is still the authoritative copy,
    // so the half-built scratch table is the thing to discard.
    await adapter.execute("DROP TABLE IF EXISTS gaps_new");
    await copyGapsIntoV3Shape(adapter);
    return;
  }

  // `gaps` is present and already v3-shaped with `gaps_new` beside it: the
  // launch after a tear between the drop and the rename, where SCHEMA_SQL has
  // just put an empty `gaps` back. The rows are in `gaps_new`.
  if (await tableIsEmpty(adapter, "gaps")) {
    await adapter.execute("DROP TABLE gaps");
    await adapter.execute("ALTER TABLE gaps_new RENAME TO gaps");
    return;
  }

  // Both hold rows, which no tear in this migration produces. Dropping either
  // would destroy gaps a user can see, so leave the scratch table in place to
  // be recovered by hand rather than guess which one is authoritative.
  console.warn(
    "[migrations] v3: gaps and gaps_new both hold rows; leaving gaps_new for manual recovery"
  );
}

async function copyGapsIntoV3Shape(adapter: DatabaseAdapter): Promise<void> {
  // SQLite temp-table dance: copy data into a new table with the v3 shape,
  // drop the old, rename the new.
  await adapter.execute(`
    CREATE TABLE gaps_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      step_id TEXT,
      observed TEXT NOT NULL,
      expected TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('L', 'M', 'H')),
      priority INTEGER CHECK(priority BETWEEN 1 AND 5),
      root_cause TEXT CHECK(root_cause IN ('Config', 'Policy', 'Behavior', 'Data')),
      owner_team_id TEXT,
      fix_idea TEXT,
      time_to_fix TEXT CHECK(time_to_fix IN ('qwin', 'near', 'mid', 'long')),
      status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Review', 'Closed')),
      missing_field TEXT CHECK(missing_field IN ('supplier', 'input', 'output', 'customer')),
      links TEXT,
      order_num INTEGER,
      milestone_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES steps(id) ON DELETE CASCADE,
      FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL,
      FOREIGN KEY (owner_team_id) REFERENCES teams(id) ON DELETE SET NULL
    )
  `);
  await adapter.execute(`
    INSERT INTO gaps_new (
      id, project_id, step_id, observed, expected, severity, priority,
      root_cause, owner_team_id, fix_idea, time_to_fix, status,
      missing_field, links, created_at, updated_at, closed_at
    )
    SELECT
      id, project_id, step_id, observed, expected, severity, priority,
      root_cause, owner_team_id, fix_idea, time_to_fix, status,
      missing_field, links, created_at, updated_at, closed_at
    FROM gaps
  `);
  await adapter.execute("DROP TABLE gaps");
  await adapter.execute("ALTER TABLE gaps_new RENAME TO gaps");
}

async function createGapsIndexes(adapter: DatabaseAdapter): Promise<void> {
  await adapter.execute("CREATE INDEX IF NOT EXISTS idx_gaps_project ON gaps(project_id)");
  await adapter.execute("CREATE INDEX IF NOT EXISTS idx_gaps_step ON gaps(step_id)");
  await adapter.execute("CREATE INDEX IF NOT EXISTS idx_gaps_status ON gaps(status)");
  await adapter.execute("CREATE INDEX IF NOT EXISTS idx_gaps_severity ON gaps(severity)");
  await adapter.execute("CREATE INDEX IF NOT EXISTS idx_gaps_priority ON gaps(priority DESC)");
  await adapter.execute("CREATE INDEX IF NOT EXISTS idx_gaps_owner ON gaps(owner_team_id)");
  await adapter.execute("CREATE INDEX IF NOT EXISTS idx_gaps_order ON gaps(project_id, order_num)");
}

async function createAndBackfillSearchIndex(adapter: DatabaseAdapter): Promise<void> {
  await adapter.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      entity_type UNINDEXED,
      entity_id UNINDEXED,
      project_id UNINDEXED,
      content,
      tokenize = 'porter unicode61'
    )
  `);

  const backfillStatements = [
    `
      INSERT INTO search_index (entity_type, entity_id, project_id, content)
      SELECT 'step', s.id, s.project_id,
          CASE WHEN s.label IS NOT NULL AND s.label <> '' THEN s.label ELSE '' END ||
          CASE WHEN s.trigger IS NOT NULL AND s.trigger <> '' THEN ' ' || s.trigger ELSE '' END ||
          CASE WHEN s.result IS NOT NULL AND s.result <> '' THEN ' ' || s.result ELSE '' END ||
          CASE WHEN s.kpi IS NOT NULL AND s.kpi <> '' THEN ' ' || s.kpi ELSE '' END ||
          CASE WHEN s.notes IS NOT NULL AND s.notes <> '' THEN ' ' || s.notes ELSE '' END
      FROM steps s
      WHERE NOT EXISTS (
        SELECT 1 FROM search_index i WHERE i.entity_type = 'step' AND i.entity_id = s.id
      )
    `,
    `
      INSERT INTO search_index (entity_type, entity_id, project_id, content)
      SELECT 'gap', g.id, g.project_id,
          CASE WHEN g.observed IS NOT NULL AND g.observed <> '' THEN g.observed ELSE '' END ||
          CASE WHEN g.expected IS NOT NULL AND g.expected <> '' THEN ' ' || g.expected ELSE '' END ||
          CASE WHEN g.fix_idea IS NOT NULL AND g.fix_idea <> '' THEN ' ' || g.fix_idea ELSE '' END ||
          CASE WHEN g.root_cause IS NOT NULL AND g.root_cause <> '' THEN ' ' || g.root_cause ELSE '' END
      FROM gaps g
      WHERE NOT EXISTS (
        SELECT 1 FROM search_index i WHERE i.entity_type = 'gap' AND i.entity_id = g.id
      )
    `,
    `
      INSERT INTO search_index (entity_type, entity_id, project_id, content)
      SELECT 'team', t.id, t.project_id,
          CASE WHEN t.name IS NOT NULL AND t.name <> '' THEN t.name ELSE '' END ||
          CASE WHEN t.description IS NOT NULL AND t.description <> '' THEN ' ' || t.description ELSE '' END
      FROM teams t
      WHERE NOT EXISTS (
        SELECT 1 FROM search_index i WHERE i.entity_type = 'team' AND i.entity_id = t.id
      )
    `,
    `
      INSERT INTO search_index (entity_type, entity_id, project_id, content)
      SELECT 'system', s.id, s.project_id,
          CASE WHEN s.name IS NOT NULL AND s.name <> '' THEN s.name ELSE '' END ||
          CASE WHEN s.description IS NOT NULL AND s.description <> '' THEN ' ' || s.description ELSE '' END ||
          CASE WHEN s.vendor IS NOT NULL AND s.vendor <> '' THEN ' ' || s.vendor ELSE '' END
      FROM systems s
      WHERE NOT EXISTS (
        SELECT 1 FROM search_index i WHERE i.entity_type = 'system' AND i.entity_id = s.id
      )
    `,
    `
      INSERT INTO search_index (entity_type, entity_id, project_id, content)
      SELECT 'milestone', m.id, m.project_id,
          CASE WHEN m.name IS NOT NULL AND m.name <> '' THEN m.name ELSE '' END ||
          CASE WHEN m.description IS NOT NULL AND m.description <> '' THEN ' ' || m.description ELSE '' END
      FROM milestones m
      WHERE NOT EXISTS (
        SELECT 1 FROM search_index i WHERE i.entity_type = 'milestone' AND i.entity_id = m.id
      )
    `,
    `
      INSERT INTO search_index (entity_type, entity_id, project_id, content)
      SELECT 'policy', p.id, p.project_id,
          CASE WHEN p.title IS NOT NULL AND p.title <> '' THEN p.title ELSE '' END ||
          CASE WHEN p.content IS NOT NULL AND p.content <> '' THEN ' ' || p.content ELSE '' END ||
          CASE WHEN p.test_notes IS NOT NULL AND p.test_notes <> '' THEN ' ' || p.test_notes ELSE '' END
      FROM policies p
      WHERE NOT EXISTS (
        SELECT 1 FROM search_index i WHERE i.entity_type = 'policy' AND i.entity_id = p.id
      )
    `,
    `
      INSERT INTO search_index (entity_type, entity_id, project_id, content)
      SELECT 'glossary', g.id, g.project_id,
          CASE WHEN g.term IS NOT NULL AND g.term <> '' THEN g.term ELSE '' END ||
          CASE WHEN g.definition IS NOT NULL AND g.definition <> '' THEN ' ' || g.definition ELSE '' END ||
          CASE WHEN g.acronym IS NOT NULL AND g.acronym <> '' THEN ' ' || g.acronym ELSE '' END
      FROM glossary g
      WHERE NOT EXISTS (
        SELECT 1 FROM search_index i WHERE i.entity_type = 'glossary' AND i.entity_id = g.id
      )
    `,
  ];

  for (const statement of backfillStatements) {
    await adapter.execute(statement);
  }
}

// ============================================================================
// JSON SERIALIZATION HELPERS
// ============================================================================

/** Enable strict mode to throw on deserialization errors instead of returning defaults */
let strictDeserializationMode = false;

/**
 * Enable or disable strict deserialization mode.
 * When enabled, deserialization errors will throw instead of returning empty values.
 * Useful for debugging data corruption issues.
 */
export function setStrictDeserializationMode(enabled: boolean): void {
  strictDeserializationMode = enabled;
  console.log(`Strict deserialization mode: ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Serialize an array to JSON string for storage
 */
function serializeArray(arr: unknown[]): string {
  return JSON.stringify(arr);
}

/**
 * Deserialize a JSON string to array
 * Logs warnings on parse failures to help detect data corruption.
 *
 * @param json - JSON string to parse
 * @param context - Optional context for error logging (e.g., "step.suppliers")
 * @returns Parsed array or empty array on failure
 */
function deserializeArray<T>(json: string | null, context?: string): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      const msg = `JSON deserialization warning: Expected array but got ${typeof parsed}${context ? ` in ${context}` : ''}`;
      console.warn(msg);
      if (strictDeserializationMode) {
        throw new Error(msg);
      }
      return [];
    }
    return parsed as T[];
  } catch (error) {
    const msg = `JSON deserialization error${context ? ` in ${context}` : ''}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.warn(msg, { json: json.substring(0, 100) + (json.length > 100 ? '...' : '') });
    if (strictDeserializationMode) {
      throw new Error(msg);
    }
    return [];
  }
}

/**
 * Serialize an object to JSON string
 */
function serializeObject(obj: unknown): string {
  return JSON.stringify(obj);
}

/**
 * Deserialize a JSON string to object
 * Logs warnings on parse failures to help detect data corruption.
 *
 * @param json - JSON string to parse
 * @param context - Optional context for error logging (e.g., "step.diagramPosition")
 * @returns Parsed object or null on failure
 */
function deserializeObject<T>(json: string | null, context?: string): T | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const msg = `JSON deserialization warning: Expected object but got ${Array.isArray(parsed) ? 'array' : typeof parsed}${context ? ` in ${context}` : ''}`;
      console.warn(msg);
      if (strictDeserializationMode) {
        throw new Error(msg);
      }
      return null;
    }
    return parsed as T;
  } catch (error) {
    const msg = `JSON deserialization error${context ? ` in ${context}` : ''}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.warn(msg, { json: json.substring(0, 100) + (json.length > 100 ? '...' : '') });
    if (strictDeserializationMode) {
      throw new Error(msg);
    }
    return null;
  }
}

// ============================================================================
// ROW CONVERTERS (Database → Application Types)
// ============================================================================

/**
 * Validate an assembled domain object against its Zod schema.
 * On failure, logs a warning with the row id and issues, then returns the
 * object unchanged (graceful degradation — same policy as deserializeObject).
 */
function validateRow<T>(schema: z.ZodTypeAny, obj: T, context: string): T {
  const result = schema.safeParse(obj);
  if (!result.success) {
    const issues = result.error.issues
      .map((i: z.ZodIssue) => `${i.path.map(String).join('.')}: ${i.message}`)
      .join('; ');
    console.warn(`[db] ${context} schema validation failed: ${issues}`);
  }
  return obj;
}

/**
 * Convert StepRow to Step (deserialize JSON fields)
 */
function stepRowToStep(row: StepRow): Step {
  const ctx = `step[${row.id}]`;
  const step: Step = {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    teamId: row.team_id,
    milestoneId: row.milestone_id,
    order: row.order,
    suppliers: deserializeArray<string>(row.suppliers, `${ctx}.suppliers`),
    inputs: deserializeArray<string>(row.inputs, `${ctx}.inputs`),
    outputs: deserializeArray<string>(row.outputs, `${ctx}.outputs`),
    customers: deserializeArray<string>(row.customers, `${ctx}.customers`),
    systems: deserializeArray<string>(row.systems, `${ctx}.systems`),
    trigger: row.trigger || undefined,
    result: row.result || undefined,
    kpi: row.kpi || undefined,
    decision: row.decision === 1,
    branches: row.branches ? deserializeArray(row.branches, `${ctx}.branches`) : undefined,
    notes: row.notes || undefined,
    comments: deserializeArray(row.comments, `${ctx}.comments`),
    links: deserializeArray(row.links, `${ctx}.links`),
    gapIds: deserializeArray<string>(row.gap_ids, `${ctx}.gapIds`),
    diagramPosition: deserializeObject<{ x: number; y: number }>(row.diagram_position, `${ctx}.diagramPosition`) || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return validateRow(StepSchema, step, ctx);
}

/**
 * Convert GapRow to Gap (deserialize JSON fields)
 */
function gapRowToGap(row: GapRow): Gap {
  const gap: Gap = {
    id: row.id,
    projectId: row.project_id,
    stepId: row.step_id ?? undefined,
    observed: row.observed,
    expected: row.expected,
    severity: row.severity,
    priority: row.priority ?? undefined,
    rootCause: row.root_cause ?? undefined,
    ownerTeamId: row.owner_team_id ?? undefined,
    fixIdea: row.fix_idea ?? undefined,
    timeToFix: row.time_to_fix ?? undefined,
    status: row.status,
    missingField: row.missing_field ?? undefined,
    order: row.order_num ?? undefined,
    milestoneId: row.milestone_id ?? undefined,
    // Labels written before #280 dropped digits from the project key; the URL
    // still holds the real one.
    links: deserializeArray<Link>(row.links).map(withJiraLabel),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
  };
  return validateRow(GapSchema, gap, `gap[${row.id}]`);
}

/**
 * Convert TeamRow to Team
 */
function teamRowToTeam(row: TeamRow): Team {
  const team: Team = {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    description: row.description || undefined,
    order: row.order,
    tags: deserializeArray<string>(row.tags),
    createdAt: row.created_at,
  };
  return validateRow(TeamSchema, team, `team[${row.id}]`);
}

/**
 * Convert SystemRow to System
 */
function systemRowToSystem(row: SystemRow): System {
  const system: System = {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description || undefined,
    vendor: row.vendor || undefined,
    type: row.type || undefined,
    tags: deserializeArray<string>(row.tags),
    createdAt: row.created_at,
  };
  return validateRow(SystemSchema, system, `system[${row.id}]`);
}

/**
 * Convert MilestoneRow to Milestone
 */
function milestoneRowToMilestone(row: MilestoneRow): Milestone {
  const milestone: Milestone = {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    order: row.order,
    description: row.description || undefined,
    relatedPolicies: deserializeArray<string>(row.related_policies),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return validateRow(MilestoneSchema, milestone, `milestone[${row.id}]`);
}

/**
 * Convert PolicyRow to Policy
 */
function policyRowToPolicy(row: PolicyRow): Policy {
  const policy: Policy = {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    sourceDoc: row.source_doc || undefined,
    relatedMilestones: deserializeArray<string>(row.related_milestones),
    testNotes: row.test_notes || undefined,
    tags: deserializeArray<string>(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return validateRow(PolicySchema, policy, `policy[${row.id}]`);
}

/**
 * Convert GlossaryEntryRow to GlossaryEntry
 */
function glossaryRowToEntry(row: GlossaryEntryRow): GlossaryEntry {
  const entry: GlossaryEntry = {
    id: row.id,
    projectId: row.project_id,
    term: row.term,
    definition: row.definition,
    acronym: row.acronym || undefined,
    relatedSteps: deserializeArray<string>(row.related_steps),
    tags: deserializeArray<string>(row.tags),
    createdAt: row.created_at,
  };
  return validateRow(GlossaryEntrySchema, entry, `glossary[${row.id}]`);
}

/**
 * Convert SIPOCRow to SIPOC
 */
function sipocRowToSIPOC(row: SIPOCRow): SIPOC {
  const sipoc: SIPOC = {
    projectId: row.project_id,
    suppliers: deserializeArray<string>(row.suppliers),
    inputs: deserializeArray<string>(row.inputs),
    process: row.process,
    outputs: deserializeArray<string>(row.outputs),
    customers: deserializeArray<string>(row.customers),
  };
  return validateRow(SIPOCSchema, sipoc, `sipoc[${row.project_id}]`);
}

/**
 * Convert ProjectRow to Project
 */
function projectRowToProject(row: ProjectRow): Project {
  const project: Project = {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    // Guarded rather than cast: `validateRow` only warns, so an unexpected
    // column value would otherwise flow on as a bogus union member.
    state: isProjectState(row.state) ? row.state : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return validateRow(ProjectSchema, project, `project[${row.id}]`);
}

/**
 * Convert a ProjectSummaryRow to a ProjectSummary.
 *
 * Validated against `ProjectSummarySchema`, not `ProjectSchema`: the base
 * schema strips unknown keys, so it would drop both counts silently and the
 * card would render "undefined steps" with nothing to catch it.
 */
function projectSummaryRowToProjectSummary(row: ProjectSummaryRow): ProjectSummary {
  const summary: ProjectSummary = {
    ...projectRowToProject(row),
    stepCount: row.step_count,
    openGapCount: row.open_gap_count,
  };
  return validateRow(ProjectSummarySchema, summary, `projectSummary[${row.id}]`);
}

// ============================================================================
// PROJECT CRUD
// ============================================================================

/**
 * Create a new project
 */
export async function createProject(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const db = getDB();
  const id = nanoid();
  const now = Date.now();

  await db.execute(
    "INSERT INTO projects (id, name, description, state, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, data.name, data.description || null, data.state ?? null, now, now]
  );

  console.log(`Created project: ${id}`);
  return id;
}

/**
 * Get a project by ID
 */
export async function getProject(id: string): Promise<Project | null> {
  const db = getDB();
  const result = await db.select<ProjectRow[]>(
    "SELECT * FROM projects WHERE id = $1",
    [id]
  );

  if (result.length === 0) return null;
  return projectRowToProject(result[0]);
}

/**
 * Update a project
 */
export async function updateProject(id: string, changes: ProjectChanges): Promise<void> {
  const db = getDB();
  const now = Date.now();

  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (changes.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    // A rename retires the migration's original: the user has made the name
    // theirs and `legacy_name` no longer describes anything (#265). The CASE
    // reads the pre-update row, and it has to, because the edit form always
    // sends `name` — an unconditional clear would discard the original on a
    // description-only edit that resubmits the same name.
    //
    // The name is bound twice rather than reusing one placeholder. The sql.js
    // adapter rewrites every `$N` to a bare positional `?`
    // (`sqlJsAdapter.convertParams`), so a repeated `$1` would bind the wrong
    // value to its second occurrence there. Binding twice is correct under
    // that rewrite and under the Tauri adapter, which passes SQL through.
    updates.push(`legacy_name = CASE WHEN name = $${paramIndex++} THEN legacy_name ELSE NULL END`);
    params.push(changes.name, changes.name);
  }
  if (changes.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(changes.description);
  }
  // `undefined` means "leave it alone"; `null` means "return it to NULL", which
  // is the only way back to the unclassified state the design needs (#318).
  if (changes.state !== undefined) {
    updates.push(`state = $${paramIndex++}`);
    params.push(changes.state ?? null);
  }

  updates.push(`updated_at = $${paramIndex++}`);
  params.push(now);

  params.push(id);

  await db.execute(
    `UPDATE projects SET ${updates.join(", ")} WHERE id = $${paramIndex}`,
    params
  );

  console.log(`Updated project: ${id}`);
}

/**
 * Move a project's `updated_at` to `now`.
 *
 * The column only ever moved when `updateProject` wrote the project's own
 * name, description or state. `listProjects` orders by it, so a project whose
 * steps and gaps were edited all afternoon sorted below one that had been
 * renamed months ago and never opened since (#395).
 *
 * Every write function calls this for itself because there is no choke point
 * to hang it on: `upsertSipoc`, `setStepOrders`, `setGapOrders` and
 * `reorderMilestones` all write without going near the search index, so
 * indexing is not the seam it looks like. Where the entity carries a timestamp
 * of its own, the caller passes the same `now` it wrote, so a step's
 * `updated_at` and its project's agree to the millisecond; teams, systems,
 * glossary entries and every delete have no such column and read the clock
 * here.
 *
 * A failure here is swallowed, deliberately. The touch runs *after* the write
 * it reports, so by the time the statement could fail — a locked database, a
 * full disk — the entity write has already landed and there is nothing to undo
 * it with. Letting the rejection out would hand the caller a failure for a
 * write that succeeded: `applyChanges` in `lib/sequence` reacts to a rejected
 * `setGapOrders` by writing the steps back to their `from` orders, so a failed
 * touch there would rewind a landed renumber and leave a step on an order a gap
 * holds — the tie that draws as a parallel branch nobody asked for (#307,
 * #341). A stale sort key is cosmetic; the write it belongs to is not, and must
 * never be undone by this.
 *
 * `InMemoryAdapter` parses `UPDATE <table> SET … WHERE id = $n` and throws on
 * SQL it cannot parse (#369). Keep the statement in that shape anyway: it is
 * the plainest form of the write, and the suites that run on that adapter are
 * where a shape it cannot read would surface.
 *
 * `deleteProject` does not call this: there is no row left to touch.
 */
async function touchProject(adapter: DatabaseAdapter, projectId: string, now: number): Promise<void> {
  try {
    await writeProjectUpdatedAt(adapter, projectId, now);
  } catch (error) {
    logger.warn(`Could not move updated_at for project ${projectId}`, error);
  }
}

/**
 * The statement behind `touchProject`, and the one path that lets it throw.
 *
 * Split out because the two callers want opposite things from a failure:
 * `touchProject` follows a write that has already landed and must not undo it,
 * while `resetProjectUpdatedAt` runs *inside* project creation, where a caller
 * is still in a position to react.
 */
async function writeProjectUpdatedAt(
  adapter: DatabaseAdapter,
  projectId: string,
  at: number,
): Promise<void> {
  await adapter.execute("UPDATE projects SET updated_at = $1 WHERE id = $2", [at, projectId]);
}

/**
 * Put a project's `updated_at` back to its `created_at`.
 *
 * Creating a project is not editing it, but every create path seeds: the
 * wizard writes the teams, the systems and the "Main Flow" milestone straight
 * after `createProject`, and `applyTemplate` seeds a whole process the same
 * way. Each of those writes touches the project, so a brand-new project reaches
 * the grid with `updated_at` already ahead of `created_at` and the card would
 * say "Edited" about a project nobody has opened yet — which would retire the
 * word "Created" for every project ever made in the app.
 *
 * Called as the last act of a create, so the seed's touches are behind it. A
 * failure is raised rather than logged: creation is still in progress, the
 * caller is still on the screen that started it, and unlike `touchProject`
 * there is no landed write here that a rejection could unwind.
 *
 * @throws If the project is gone, or the write fails.
 */
export async function resetProjectUpdatedAt(id: string): Promise<void> {
  const db = getDB();
  const project = await getProject(id);
  if (!project) throw new Error(`Cannot reset updated_at: no project ${id}`);
  await writeProjectUpdatedAt(db, id, project.createdAt);
}

/**
 * Every table a project owns, in the order `deleteProject` clears them.
 *
 * Foreign keys **are** enforced here. `tauri-plugin-sql` opens the database
 * with `Pool::connect`, and `sqlx-sqlite`'s `SqliteConnectOptions` defaults
 * put `foreign_keys = ON` in the pragma list it replays on every connection it
 * opens — so being per-connection is what makes it reliable, not what breaks
 * it. `deleteStep` already leans on that cascade to remove a step's gaps, and
 * `getTeamUsageCount` exists to pre-empt the `RESTRICT` on `steps.team_id`.
 *
 * So this list is not what makes the delete work. It is kept for three
 * reasons:
 *
 * 1. It makes the delete's effect explicit and testable — a reader can see
 *    what goes without reconstructing the cascade from the schema.
 * 2. It does not depend on the adapter. `InMemoryAdapter` enforces nothing, so
 *    the round-trip test only became meaningful once the deletes were written
 *    out.
 * 3. Its order documents the `RESTRICT` that `steps` declares on `team_id` and
 *    `milestone_id`: gaps and steps must go before the milestones and teams
 *    they point at, or the delete fails outright.
 *
 * A new project-owned table must be added to this list. Missing one no longer
 * strands rows — the cascade still covers it — but the test stops describing
 * the delete, and on any non-enforcing adapter it does strand them.
 */
const PROJECT_OWNED_TABLES = [
  "gaps",
  "steps",
  "milestones",
  "teams",
  "systems",
  "policies",
  "glossary",
  "sipoc",
] as const;

/**
 * Delete a project and every row it owns.
 *
 * There is no transaction here on purpose. The Tauri adapter has no
 * multi-statement transaction primitive: plugin-sql pools connections, so a
 * BEGIN and its COMMIT issued as separate statements can land on different
 * ones, giving no atomicity, and a failed COMMIT locks the pool for the rest
 * of the session (#236).
 *
 * The order is the mitigation instead: children first, `projects` last. A tear
 * partway through leaves a project that is still listed and still deletable,
 * which the user can see and retry. Deleting the project row first would leave
 * the opposite — rows owned by a project that no longer appears anywhere, and
 * `search_index` orphans that the system `sqlite3` cannot even read, because
 * macOS ships it without FTS5.
 *
 * The index clear belongs at the end for the same reason, and it is the one
 * step a retry cannot repair. Nothing re-indexes an existing project —
 * `reindexAllEntities` has no callers and migration v4 never runs again — so a
 * tear after an early `clearProjectIndex` would leave a project the user still
 * has, permanently absent from search, with nothing to show that it happened.
 * Clearing last keeps that window to a single statement.
 *
 * `search_index` is the one table no cascade covers: it is an FTS5 virtual
 * table declaring no foreign key, so it has always had to be cleared by hand.
 */
export async function deleteProject(id: string): Promise<void> {
  const db = getDB();

  for (const table of PROJECT_OWNED_TABLES) {
    await db.execute(`DELETE FROM ${table} WHERE project_id = $1`, [id]);
  }

  await clearProjectIndex(id);
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
  console.log(`Deleted project: ${id}`);
}

/**
 * List all projects, each with what it actually holds (#213).
 *
 * The counts are computed here rather than by the page, because the page had
 * no way to get them: it renders every project at once, and loading each
 * one's steps and gaps to count them would be N+1 reads for two integers. Two
 * correlated subqueries do it in the read that was already happening.
 *
 * Open gaps only, matching the board header. The cards these feed replaced a
 * literal "Active" badge and a literal "Ready for mapping" — a status that is
 * always the same value is not a status.
 */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = getDB();
  const result = await db.select<ProjectSummaryRow[]>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM steps s WHERE s.project_id = p.id) AS step_count,
       (SELECT COUNT(*) FROM gaps g WHERE g.project_id = p.id AND g.status = 'Open')
         AS open_gap_count
     FROM projects p
     ORDER BY p.updated_at DESC`
  );

  return result.map(projectSummaryRowToProjectSummary);
}

// ============================================================================
// SIPOC CRUD
// ============================================================================

/**
 * Get a project's SIPOC summary, or null when the wizard has never been run.
 */
export async function getSipoc(projectId: string): Promise<SIPOC | null> {
  const db = getDB();
  const rows = await db.select<SIPOCRow[]>(
    "SELECT * FROM sipoc WHERE project_id = $1",
    [projectId]
  );
  return rows.length > 0 ? sipocRowToSIPOC(rows[0]) : null;
}

/**
 * Create or replace a project's SIPOC summary.
 *
 * `sipoc.project_id` is the primary key — one summary per project — so a
 * re-run of the wizard overwrites in place rather than accumulating rows.
 */
export async function upsertSipoc(sipoc: SIPOC): Promise<void> {
  const db = getDB();
  await db.execute(
    `INSERT INTO sipoc (project_id, suppliers, inputs, process, outputs, customers)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(project_id) DO UPDATE SET
       suppliers = excluded.suppliers,
       inputs = excluded.inputs,
       process = excluded.process,
       outputs = excluded.outputs,
       customers = excluded.customers`,
    [
      sipoc.projectId,
      serializeArray(sipoc.suppliers),
      serializeArray(sipoc.inputs),
      sipoc.process,
      serializeArray(sipoc.outputs),
      serializeArray(sipoc.customers),
    ]
  );

  await touchProject(db, sipoc.projectId, Date.now());
}

// ============================================================================
// TEAM CRUD
// ============================================================================

/**
 * Create a new team
 *
 * `id` is a parameter rather than always minted here because a template resolves
 * its cross-references before it writes anything — a step names its team, and
 * p2p's rejection branch names a step that appears earlier in the file, so there
 * is no insert order that lets the ids be discovered as it goes. Every `create*`
 * below takes it for the same reason; see `templateService.materializeTemplate`.
 */
export async function createTeam(data: Omit<Team, "id" | "createdAt">, id: string = nanoid()): Promise<string> {
  const db = getDB();
  const now = Date.now();

  await db.execute(
    `INSERT INTO teams (id, project_id, name, color, description, "order", tags, created_at) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      data.projectId,
      data.name,
      data.color,
      data.description || null,
      data.order,
      serializeArray(data.tags),
      now,
    ]
  );

  await indexEntity("team", id, data.projectId, buildTeamContent({ id, createdAt: now, ...data }));
  await touchProject(db, data.projectId, now);
  return id;
}

/**
 * List teams for a project
 */
export async function listTeams(projectId: string): Promise<Team[]> {
  const db = getDB();
  const result = await db.select<TeamRow[]>(
    `SELECT * FROM teams WHERE project_id = $1 ORDER BY "order"`,
    [projectId]
  );

  return result.map(teamRowToTeam);
}

export async function getTeam(id: string, projectId?: string): Promise<Team | null> {
  const db = getDB();
  const rows: TeamRow[] = await db.select(
    projectId === undefined ? "SELECT * FROM teams WHERE id = $1" : "SELECT * FROM teams WHERE id = $1 AND project_id = $2",
    projectId === undefined ? [id] : [id, projectId]
  );
  if (rows.length === 0) return null;
  return teamRowToTeam(rows[0]);
}

/**
 * Update a team
 */
export async function updateTeam(id: string, changes: Partial<Omit<Team, "id" | "projectId" | "createdAt">>, projectId: string): Promise<void> {
  const db = getDB();

  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (changes.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(changes.name);
  }
  if (changes.color !== undefined) {
    updates.push(`color = $${paramIndex++}`);
    params.push(changes.color);
  }
  if (changes.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(changes.description);
  }
  if (changes.order !== undefined) {
    updates.push(`"order" = $${paramIndex++}`);
    params.push(changes.order);
  }
  if (changes.tags !== undefined) {
    updates.push(`tags = $${paramIndex++}`);
    params.push(serializeArray(changes.tags));
  }

  if (updates.length === 0) return;

  params.push(id, projectId);

  await db.execute(
    `UPDATE teams SET ${updates.join(", ")} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}`,
    params
  );

  const updated = await getTeam(id, projectId);
  // No row, no edit: an id that matches nothing is a silent no-op in SQLite, so
  // neither the index nor the project's `updated_at` has anything to say about
  // it. The delete paths already return early on the same test (#395).
  if (updated) {
    await reindexEntity("team", id, updated.projectId, buildTeamContent(updated));
    await touchProject(db, projectId, Date.now());
  }
}

/**
 * Delete a team
 *
 * The index row goes after the DELETE, here and in every other delete*: a step
 * still referencing the team makes ON DELETE RESTRICT reject the DELETE, and the
 * surviving row must stay searchable (#426).
 */
export async function deleteTeam(id: string, projectId: string): Promise<void> {
  const db = getDB();
  if (!await getTeam(id, projectId)) return;
  await db.execute("DELETE FROM teams WHERE id = $1 AND project_id = $2", [id, projectId]);
  await removeFromIndex("team", id);
  await touchProject(db, projectId, Date.now());
}

/**
 * Get usage count for a team (how many steps in a project reference it).
 *
 * Single SQL round-trip against the FK column `steps.team_id`. Stores call this
 * before `deleteTeam` to turn what would be a raw `FOREIGN KEY constraint failed`
 * into a friendly "X used by N steps" error.
 */
export async function getTeamUsageCount(
  teamId: string,
  projectId: string
): Promise<number> {
  const db = getDB();

  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM steps
     WHERE project_id = $1 AND team_id = $2`,
    [projectId, teamId]
  );

  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error("getTeamUsageCount: COUNT(*) returned no row");
  }
  return count;
}

/**
 * Count the steps that merely *name* a team in their SIPOC suppliers or
 * customers (#173).
 *
 * This is a different question from `getTeamUsageCount`, which counts owners
 * via the FK column `steps.team_id`. Supplier and customer entries are free
 * text that store a team NAME — `StepRow` resolves a chip to a team with
 * `teams.find(t => t.name === entityName)` — so deleting a team leaves those
 * names behind, pointing at nothing. Nothing here blocks or rewrites them; the
 * count exists so the delete confirmation and the success toast can say what
 * will be left over.
 *
 * `instr(column, '"' || name || '"')` rather than the `LIKE '%"' || $2 || '"%'`
 * of `getSystemUsageCount`. Both look for the name as a whole JSON array
 * element, so "Budget" does not match `["Budget Owner"]`, but `LIKE` is
 * case-insensitive for ASCII and treats `%` and `_` in the name as wildcards.
 * `getSystemUsageCount` matches nanoid ids, where neither can bite; a team name
 * is user prose, and the name match has to be exact and case-sensitive to agree
 * with `StepRow`. The name is bound twice ($2 and $3) rather than reused,
 * because the test adapter rewrites `$N` to positional `?`.
 *
 * Shared limitation with the systems function: a name containing a double quote
 * is stored JSON-escaped (`\"`), so the unescaped needle can never match it and
 * such a team counts 0. The same is true of a name containing a backslash — it
 * is stored as `\\`, which the unescaped needle also never matches. A name
 * containing `","` can match across two adjacent array elements instead of
 * inside one (e.g. `["A","B"]` against a needle `A","B`), which is absurd
 * input a UI would never produce; the count only feeds copy, so it is left
 * uncorrected rather than parsed properly.
 *
 * Team names are not unique per project (no constraint enforces it), so this
 * count is name-keyed, not identity-keyed: after the delete, the steps it
 * counted may resolve to a same-named twin team rather than to nothing.
 */
export async function getTeamReferenceCount(
  teamName: string,
  projectId: string
): Promise<number> {
  const db = getDB();

  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM steps
     WHERE project_id = $1
       AND (instr(suppliers, '"' || $2 || '"') > 0
         OR instr(customers, '"' || $3 || '"') > 0)`,
    [projectId, teamName, teamName]
  );

  // SELECT COUNT(*) always returns exactly one row; missing => adapter bug.
  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error("getTeamReferenceCount: COUNT(*) returned no row");
  }
  return count;
}

// ============================================================================
// SYSTEMS (ERP, CRM, etc.)
// ============================================================================

/**
 * Create a new system
 */
export async function createSystem(data: Omit<System, "id" | "createdAt">, id: string = nanoid()): Promise<string> {
  const db = getDB();
  const now = Date.now();

  await db.execute(
    `INSERT INTO systems (id, project_id, name, description, vendor, type, tags, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      data.projectId,
      data.name,
      data.description || null,
      data.vendor || null,
      data.type || null,
      serializeArray(data.tags),
      now,
    ]
  );

  await indexEntity("system", id, data.projectId, buildSystemContent({ id, createdAt: now, ...data }));
  await touchProject(db, data.projectId, now);
  return id;
}

/**
 * List all systems for a project
 */
export async function listSystems(projectId: string): Promise<System[]> {
  const db = getDB();
  const rows: SystemRow[] = await db.select(
    "SELECT * FROM systems WHERE project_id = $1 ORDER BY name ASC",
    [projectId]
  );
  return rows.map(systemRowToSystem);
}

export async function getSystem(id: string, projectId?: string): Promise<System | null> {
  const db = getDB();
  const rows: SystemRow[] = await db.select(
    projectId === undefined ? "SELECT * FROM systems WHERE id = $1" : "SELECT * FROM systems WHERE id = $1 AND project_id = $2",
    projectId === undefined ? [id] : [id, projectId]
  );
  if (rows.length === 0) return null;
  return systemRowToSystem(rows[0]);
}

/**
 * Update a system
 */
export async function updateSystem(id: string, changes: Partial<Omit<System, "id" | "projectId" | "createdAt">>, projectId: string): Promise<void> {
  const db = getDB();
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (changes.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(changes.name);
  }
  if (changes.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(changes.description || null);
  }
  if (changes.vendor !== undefined) {
    updates.push(`vendor = $${paramIndex++}`);
    values.push(changes.vendor || null);
  }
  if (changes.type !== undefined) {
    updates.push(`type = $${paramIndex++}`);
    values.push(changes.type || null);
  }
  if (changes.tags !== undefined) {
    updates.push(`tags = $${paramIndex++}`);
    values.push(serializeArray(changes.tags));
  }

  if (updates.length === 0) return;

  values.push(id, projectId);
  await db.execute(
    `UPDATE systems SET ${updates.join(", ")} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}`,
    values
  );

  const updated = await getSystem(id, projectId);
  // No row, no edit: an id that matches nothing is a silent no-op in SQLite, so
  // neither the index nor the project's `updated_at` has anything to say about
  // it. The delete paths already return early on the same test (#395).
  if (updated) {
    await reindexEntity("system", id, updated.projectId, buildSystemContent(updated));
    await touchProject(db, projectId, Date.now());
  }
}

/**
 * Delete a system
 * Note: Will fail if any steps reference this system (foreign key constraint)
 */
export async function deleteSystem(id: string, projectId: string): Promise<void> {
  const db = getDB();
  if (!await getSystem(id, projectId)) return;
  await db.execute("DELETE FROM systems WHERE id = $1 AND project_id = $2", [id, projectId]);
  await removeFromIndex("system", id);
  await touchProject(db, projectId, Date.now());
}

/**
 * Get usage count for a system (how many steps in a project use it).
 *
 * Single SQL round-trip. The LIKE pattern wraps the system id in literal
 * quotes (`"<id>"`) so it only matches a JSON-array element, never a
 * substring of another id.
 */
export async function getSystemUsageCount(
  systemId: string,
  projectId: string
): Promise<number> {
  const db = getDB();

  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM steps
     WHERE project_id = $1 AND systems LIKE '%"' || $2 || '"%'`,
    [projectId, systemId]
  );

  // SELECT COUNT(*) always returns exactly one row; missing => adapter bug.
  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error("getSystemUsageCount: COUNT(*) returned no row");
  }
  return count;
}

// ============================================================================
// MILESTONES (Process phases)
// ============================================================================

/**
 * The order every one of a project's milestones is moved to before a reorder
 * writes the new numbers.
 *
 * `idx_milestones_project_order` is UNIQUE and SQLite checks it row by row, not
 * at the end of the statement. Empirically (sqlite 3.50) that means even a
 * single statement whose finished result would be unique fails halfway:
 * `UPDATE milestones SET "order" = CASE id WHEN a THEN 1 WHEN b THEN 0 END`
 * raises "UNIQUE constraint failed" as it writes the first row, and so does the
 * shift form `SET "order" = "order" + 1`. Every reorder must therefore park
 * first, out of the range the final numbers occupy.
 *
 * A million rather than something derived from `n`: the parked values have to
 * clear the finals with room that no UI path can reach, and a milestone order
 * this large means only that a write was interrupted.
 *
 * It is the *floor* of the shift, not the shift itself. A uniform `+ PARK`
 * collides with exactly the wreckage this function exists to clean up: a row a
 * torn reorder left at `PARK + k` is hit head-on the moment the row holding `k`
 * is shifted onto it, and SQLite's row-by-row UNIQUE check fails the statement.
 * `parkAndPlaceMilestoneOrders` therefore shifts by whichever is larger, `PARK`
 * or one past the project's current maximum.
 */
const MILESTONE_ORDER_PARK = 1_000_000;

/**
 * Move a project's milestones to `orderedIds`' sequence, 0..n-1.
 *
 * Two phases, because there is no transaction to hold them together — the
 * `BEGIN IMMEDIATE` in `runMigrations` does not reliably bind on the pooled
 * Tauri adapter and `withTransaction` was deleted for the same reason (#236,
 * #399). Phase one shifts every row of the project out of the way in one
 * statement; phase two places each id at its index, in index order.
 *
 * **The shift clears the project's current maximum, and `MILESTONE_ORDER_PARK`
 * is only its floor.** SQLite checks UNIQUE row by row, so a uniform shift
 * fails the instant a row lands on one that has not moved yet — which is
 * exactly what a fixed `+ PARK` does to a project already carrying a row a
 * torn reorder left parked at `PARK + k`. Shifting past the maximum instead
 * puts every new value above every value still to be visited, whatever order
 * the engine walks the rows in, so the statement cannot collide with itself.
 *
 * **What a tear leaves behind.** The park is a single UPDATE, so SQLite's
 * statement atomicity means it cannot half-apply: either every row of the
 * project is parked or none is. A tear during phase two therefore leaves the
 * first k ids correctly placed at 0..k-1 and the rest sitting at parked values
 * — above every final, in their previous relative order. Nothing is lost and
 * nothing is out of sequence; the project simply reads 0, 1, 1000004, 1000007
 * until a later park-and-place puts it back in range. Placing in index order is
 * what makes that prefix the right one.
 *
 * **A row created after the caller validated its id set does the same.** The
 * new milestone is not in `orderedIds`, so the park never moves it, and the
 * place loop walks onto its order and fails the UNIQUE index — leaving the tail
 * of the sequence parked exactly as a crash would. Unreachable today: nothing
 * but migration v8 calls this, and it reads and writes in one pass. The shape
 * it leaves is the one v8's parked-order sweep repairs, and v8 reruns only on a
 * database whose v8 version row is missing — so a torn `reorderMilestones` in a
 * finished database stays parked until a caller exists to repair it (follow-up).
 *
 * Callers pass the adapter rather than reaching for `getDB()` so migration v8
 * can use the same two phases against the adapter it was handed.
 *
 * No FTS write: `buildMilestoneContent` is name and description, so an order
 * change cannot alter a milestone's indexed content.
 */
async function parkAndPlaceMilestoneOrders(
  adapter: DatabaseAdapter,
  projectId: string,
  orderedIds: readonly string[],
  now: number
): Promise<void> {
  const maxRows = await adapter.select<Array<{ max_order: number | null }>>(
    `SELECT MAX("order") AS max_order FROM milestones WHERE project_id = $1`,
    [projectId]
  );
  const offset = Math.max(MILESTONE_ORDER_PARK, (maxRows[0]?.max_order ?? 0) + 1);

  await adapter.execute(
    `UPDATE milestones SET "order" = "order" + $1 WHERE project_id = $2`,
    [offset, projectId]
  );

  for (const [index, id] of orderedIds.entries()) {
    await adapter.execute(
      `UPDATE milestones SET "order" = $1, updated_at = $2 WHERE id = $3 AND project_id = $4`,
      [index, now, id, projectId]
    );
  }
}

/**
 * The order a caller asked for is already taken by another milestone in that
 * project (#131).
 *
 * Thrown before any write, so a caller that catches it knows nothing moved. The
 * message is written for the user because `stepsStore` shows it verbatim, and
 * the fields carry what a caller would otherwise have to re-query.
 *
 * `name` is set explicitly: several suites mock `../services/db` wholesale, so
 * consumers test the name rather than `instanceof` against a class the mock
 * does not export.
 */
export class MilestoneOrderConflictError extends Error {
  readonly projectId: string;
  readonly order: number;
  readonly conflictingId: string;

  constructor(projectId: string, order: number, conflictingId: string) {
    super(`Milestone order ${order} is already used in this project`);
    this.name = "MilestoneOrderConflictError";
    this.projectId = projectId;
    this.order = order;
    this.conflictingId = conflictingId;
  }
}

/**
 * Refuse an order another milestone in the project already holds.
 *
 * This is the readable failure, not the guarantee: two writers can both pass
 * this check and only one can land, which is what the UNIQUE index is for. It
 * closes the case the index reports as a bare SQLite error — a user typing an
 * order that is plainly taken — and leaves the index as the backstop for the
 * race it cannot see.
 */
async function assertMilestoneOrderFree(
  adapter: DatabaseAdapter,
  projectId: string,
  order: number,
  exceptId: string
): Promise<void> {
  const rows = await adapter.select<Array<{ id: string }>>(
    `SELECT id FROM milestones WHERE project_id = $1 AND "order" = $2 AND id <> $3 LIMIT 1`,
    [projectId, order, exceptId]
  );
  const conflictingId = rows[0]?.id;
  if (conflictingId !== undefined) {
    throw new MilestoneOrderConflictError(projectId, order, conflictingId);
  }
}

/**
 * Renumber a project's milestones to `orderedIds`' sequence, 0..n-1.
 *
 * The only supported way to move a milestone past another one: a plain
 * `updateMilestone` to an order a sibling already holds is refused, first by
 * `assertMilestoneOrderFree` and then by the UNIQUE index, because a swap
 * cannot be expressed as one row's write.
 *
 * `orderedIds` must name every milestone of the project exactly once. A subset
 * would leave rows parked above the finals, and an id from another project
 * would silently do nothing — so both are refused, before the first write, with
 * nothing changed.
 */
export async function reorderMilestones(projectId: string, orderedIds: string[]): Promise<void> {
  const db = getDB();

  const rows = await db.select<Array<{ id: string }>>(
    "SELECT id FROM milestones WHERE project_id = $1",
    [projectId]
  );
  const existing = new Set(rows.map((row) => row.id));
  const wanted = new Set(orderedIds);

  if (wanted.size !== orderedIds.length) {
    throw new Error("reorderMilestones: orderedIds names the same milestone twice");
  }
  if (wanted.size !== existing.size || orderedIds.some((id) => !existing.has(id))) {
    throw new Error(
      `reorderMilestones: orderedIds must name each of project ${projectId}'s ${existing.size} milestones exactly once`
    );
  }

  const now = Date.now();
  await parkAndPlaceMilestoneOrders(db, projectId, orderedIds, now);
  await touchProject(db, projectId, now);
}

/**
 * Create a new milestone
 */
export async function createMilestone(data: Omit<Milestone, "id" | "createdAt" | "updatedAt">, id: string = nanoid()): Promise<string> {
  const db = getDB();
  const now = Date.now();

  await assertMilestoneOrderFree(db, data.projectId, data.order, id);

  await db.execute(
    `INSERT INTO milestones (id, project_id, name, "order", description, related_policies, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      data.projectId,
      data.name,
      data.order,
      data.description || null,
      serializeArray(data.relatedPolicies),
      now,
      now,
    ]
  );

  await indexEntity("milestone", id, data.projectId, buildMilestoneContent({ id, createdAt: now, updatedAt: now, ...data }));
  await touchProject(db, data.projectId, now);
  return id;
}

/**
 * List all milestones for a project
 */
export async function listMilestones(projectId: string): Promise<Milestone[]> {
  const db = getDB();
  const rows: MilestoneRow[] = await db.select(
    'SELECT * FROM milestones WHERE project_id = $1 ORDER BY "order" ASC',
    [projectId]
  );
  return rows.map(milestoneRowToMilestone);
}

/**
 * Get a milestone by ID
 */
export async function getMilestone(id: string, projectId?: string): Promise<Milestone | null> {
  const db = getDB();
  const rows: MilestoneRow[] = await db.select(
    projectId === undefined ? "SELECT * FROM milestones WHERE id = $1" : "SELECT * FROM milestones WHERE id = $1 AND project_id = $2",
    projectId === undefined ? [id] : [id, projectId]
  );
  if (rows.length === 0) return null;
  return milestoneRowToMilestone(rows[0]);
}

/**
 * Update a milestone
 */
export async function updateMilestone(id: string, changes: Partial<Omit<Milestone, "id" | "projectId" | "createdAt" | "updatedAt">>, projectId: string): Promise<void> {
  const db = getDB();

  // Before the UPDATE is built, so a refused order leaves the row exactly as it
  // was — including the other fields the same call would have written.
  if (changes.order !== undefined) {
    await assertMilestoneOrderFree(db, projectId, changes.order, id);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (changes.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(changes.name);
  }
  if (changes.order !== undefined) {
    updates.push(`"order" = $${paramIndex++}`);
    values.push(changes.order);
  }
  if (changes.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(changes.description || null);
  }
  if (changes.relatedPolicies !== undefined) {
    updates.push(`related_policies = $${paramIndex++}`);
    values.push(serializeArray(changes.relatedPolicies));
  }

  if (updates.length === 0) return;

  const now = Date.now();
  updates.push(`updated_at = $${paramIndex++}`);
  values.push(now);

  values.push(id, projectId);
  await db.execute(
    `UPDATE milestones SET ${updates.join(", ")} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}`,
    values
  );

  const updated = await getMilestone(id, projectId);
  // No row, no edit: an id that matches nothing is a silent no-op in SQLite, so
  // neither the index nor the project's `updated_at` has anything to say about
  // it. The delete paths already return early on the same test (#395).
  if (updated) {
    await reindexEntity("milestone", id, updated.projectId, buildMilestoneContent(updated));
    await touchProject(db, projectId, now);
  }
}

/**
 * Delete a milestone
 */
export async function deleteMilestone(id: string, projectId: string): Promise<void> {
  const db = getDB();
  if (!await getMilestone(id, projectId)) return;
  await db.execute("DELETE FROM milestones WHERE id = $1 AND project_id = $2", [id, projectId]);
  await removeFromIndex("milestone", id);
  await touchProject(db, projectId, Date.now());
}

/** What still references a milestone; see `getMilestoneUsageCount`. */
export interface MilestoneUsage {
  steps: number;
  processGaps: number;
}

/**
 * Get usage for a milestone: the steps that reference it (FK RESTRICT) and
 * the process gaps placed in it (`gaps.order_num IS NOT NULL`, FK SET NULL —
 * a delete would silently strand them, so the guard must count them too).
 * Gaps without `order_num` ride on their step and are not counted twice.
 *
 * Single SQL round-trip. Replaces the in-memory `.filter(...).length` check
 * that was previously in `stepsStore.deleteMilestone`, which depended on
 * `get().steps` being loaded and current.
 */
export async function getMilestoneUsageCount(
  milestoneId: string,
  projectId: string
): Promise<MilestoneUsage> {
  const db = getDB();

  const rows = await db.select<{ steps: number; process_gaps: number }[]>(
    `SELECT
       (SELECT COUNT(*) FROM steps
         WHERE project_id = $1 AND milestone_id = $2) AS steps,
       (SELECT COUNT(*) FROM gaps
         WHERE project_id = $3 AND milestone_id = $4
           AND order_num IS NOT NULL) AS process_gaps`,
    // Each placeholder appears once: the sql.js adapter rewrites `` to a bare
    // `?` and binds positionally, so a repeated `` would bind nothing.
    [projectId, milestoneId, projectId, milestoneId]
  );

  const row = rows[0];
  if (row === undefined || row.steps === undefined || row.process_gaps === undefined) {
    throw new Error("getMilestoneUsageCount: COUNT(*) returned no row");
  }
  return { steps: row.steps, processGaps: row.process_gaps };
}

// ============================================================================
// STEPS (Process activities)
// ============================================================================

/**
 * Create a new step
 */
export async function createStep(data: Omit<Step, "id">, id: string = nanoid()): Promise<string> {
  const db = getDB();
  const now = Date.now();

  await db.execute(
    `INSERT INTO steps (
      id, project_id, label, team_id, milestone_id, "order",
      suppliers, inputs, outputs, customers,
      systems, trigger, result, kpi,
      decision, branches, notes, comments, links, gap_ids, diagram_position,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $21,
      $22, $23
    )`,
    [
      id,
      data.projectId,
      data.label,
      data.teamId,
      data.milestoneId,
      data.order,
      // SIPOC elements
      serializeArray(data.suppliers),
      serializeArray(data.inputs),
      serializeArray(data.outputs),
      serializeArray(data.customers),
      // Process details
      serializeArray(data.systems),
      data.trigger || null,
      data.result || null,
      data.kpi || null,
      // Decision logic
      data.decision ? 1 : 0,
      data.branches ? serializeArray(data.branches) : null,
      // Metadata
      data.notes || null,
      serializeArray(data.comments),
      serializeArray(data.links),
      serializeArray(data.gapIds),
      data.diagramPosition ? serializeObject(data.diagramPosition) : null,
      // Timestamps
      now,
      now,
    ]
  );

  await indexEntity("step", id, data.projectId, buildStepContent({ id, ...data }));
  await touchProject(db, data.projectId, now);
  return id;
}

/**
 * List all steps for a project
 */
export async function listSteps(projectId: string): Promise<Step[]> {
  const db = getDB();
  const rows: StepRow[] = await db.select(
    'SELECT * FROM steps WHERE project_id = $1 ORDER BY milestone_id, "order" ASC',
    [projectId]
  );
  return rows.map(stepRowToStep);
}

/**
 * Get a step by ID
 */
export async function getStep(id: string, projectId?: string): Promise<Step | null> {
  const db = getDB();
  const rows: StepRow[] = await db.select(
    projectId === undefined ? "SELECT * FROM steps WHERE id = $1" : "SELECT * FROM steps WHERE id = $1 AND project_id = $2",
    projectId === undefined ? [id] : [id, projectId]
  );
  if (rows.length === 0) return null;
  return stepRowToStep(rows[0]);
}

/** One row's new position, as `setStepOrders` / `setGapOrders` take it. */
export interface OrderAssignment {
  id: string;
  order: number;
}

/**
 * Build the `CASE id WHEN … END` body for an order write, plus its parameters.
 *
 * Placeholders are numbered from `$1` and the parameters come back in the same
 * textual order the SQL reads them, because that is the only ordering both
 * adapters agree on: the Tauri plugin honours `$N`, while a positional binder
 * takes each `?` in the order it appears. Anything that assembles a statement
 * from these fragments has to keep appending in textual order for the same
 * reason.
 */
function orderCaseClause(assignments: readonly OrderAssignment[]): {
  caseSql: string;
  caseParams: unknown[];
} {
  const caseParams: unknown[] = [];
  const branches = assignments.map(({ id, order }, index) => {
    caseParams.push(id, order);
    return `WHEN $${index * 2 + 1} THEN $${index * 2 + 2}`;
  });
  return { caseSql: branches.join(" "), caseParams };
}

/**
 * The whole statement, shared by the two writers so they cannot drift apart.
 *
 * The `IN` list is not redundant beside the `CASE`: without it every other row
 * in the project would match and take the `CASE`'s implicit `NULL`, wiping the
 * milestone rather than renumbering part of it.
 */
function orderUpdateSql(
  table: "steps" | "gaps",
  column: string,
  assignments: readonly OrderAssignment[],
): { sql: string; tail: (updatedAt: number, projectId: string) => unknown[] } {
  const { caseSql, caseParams } = orderCaseClause(assignments);
  const base = caseParams.length;
  const inSql = assignments.map((_, index) => `$${base + 3 + index}`).join(", ");
  return {
    sql: `UPDATE ${table}
     SET ${column} = CASE id ${caseSql} END, updated_at = $${base + 1}
     WHERE project_id = $${base + 2} AND id IN (${inSql})`,
    tail: (updatedAt, projectId) => [
      ...caseParams,
      updatedAt,
      projectId,
      ...assignments.map(({ id }) => id),
    ],
  };
}

/**
 * Write new orders for a set of steps in one statement.
 *
 * One statement for the orders, deliberately. The Tauri adapter has no
 * multi-statement transaction primitive (#236) — plugin-sql pools connections,
 * so BEGIN and COMMIT can land apart and a failed COMMIT poisons the pool for
 * the session — so a renumber built from a per-row loop is a torn sequence
 * waiting to happen (#343, #350). Nothing but that one statement can leave a
 * milestone half renumbered.
 *
 * The call is two statements, not one: the orders, then `touchProject`. The
 * touch cannot fail the call — it swallows its own errors precisely so a
 * cosmetic sort key can never reach `applyChanges`, which answers a rejection
 * here by writing the steps back to their old orders.
 *
 * Callers come from `lib/sequence`, which computes the assignments by diffing a
 * plan against the milestone's live rows and passes only the rows that actually
 * move. Nothing else should call this: an order written without that plan is
 * how the sequence tore in the first place.
 */
export async function setStepOrders(
  projectId: string,
  assignments: readonly OrderAssignment[],
): Promise<void> {
  if (assignments.length === 0) return;
  const db = getDB();
  const { sql, tail } = orderUpdateSql("steps", '"order"', assignments);
  const now = Date.now();
  await db.execute(sql, tail(now, projectId));
  await touchProject(db, projectId, now);
}

/**
 * Write new orders for a set of process gaps in one statement, then a touch
 * that cannot fail the call — the same two statements as `setStepOrders`, for
 * the same reasons.
 *
 * The gap half of `setStepOrders`, and it exists for the same reason the
 * threshold shift it replaced did: a process gap reserves a position in the
 * milestone's sequence exactly as a step does, so renumbering only the steps
 * leaves a gap on an order a step has come down onto (#307, #312, #341).
 *
 * No `isProcessGap` predicate here, unlike the shift it replaces. The caller
 * has already applied it when building the plan — a closed or step-attached gap
 * never appears in the sequence and therefore never appears in an assignment —
 * and repeating the filter in SQL would silently drop a row the plan expects to
 * have moved, turning a bug in the caller into a torn write here.
 */
export async function setGapOrders(
  projectId: string,
  assignments: readonly OrderAssignment[],
): Promise<void> {
  if (assignments.length === 0) return;
  const db = getDB();
  const { sql, tail } = orderUpdateSql("gaps", "order_num", assignments);
  const now = Date.now();
  await db.execute(sql, tail(now, projectId));
  await touchProject(db, projectId, now);
}

/**
 * Update a step
 */
export async function updateStep(id: string, changes: Partial<Omit<Step, "id" | "projectId">>, projectId: string): Promise<void> {
  const db = getDB();
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (changes.label !== undefined) {
    updates.push(`label = $${paramIndex++}`);
    values.push(changes.label);
  }
  if (changes.teamId !== undefined) {
    updates.push(`team_id = $${paramIndex++}`);
    values.push(changes.teamId);
  }
  if (changes.milestoneId !== undefined) {
    updates.push(`milestone_id = $${paramIndex++}`);
    values.push(changes.milestoneId);
  }
  if (changes.order !== undefined) {
    updates.push(`"order" = $${paramIndex++}`);
    values.push(changes.order);
  }
  if (changes.suppliers !== undefined) {
    updates.push(`suppliers = $${paramIndex++}`);
    values.push(serializeArray(changes.suppliers));
  }
  if (changes.inputs !== undefined) {
    updates.push(`inputs = $${paramIndex++}`);
    values.push(serializeArray(changes.inputs));
  }
  if (changes.outputs !== undefined) {
    updates.push(`outputs = $${paramIndex++}`);
    values.push(serializeArray(changes.outputs));
  }
  if (changes.customers !== undefined) {
    updates.push(`customers = $${paramIndex++}`);
    values.push(serializeArray(changes.customers));
  }
  if (changes.systems !== undefined) {
    updates.push(`systems = $${paramIndex++}`);
    values.push(serializeArray(changes.systems));
  }
  if (changes.trigger !== undefined) {
    updates.push(`trigger = $${paramIndex++}`);
    values.push(changes.trigger || null);
  }
  if (changes.result !== undefined) {
    updates.push(`result = $${paramIndex++}`);
    values.push(changes.result || null);
  }
  if (changes.kpi !== undefined) {
    updates.push(`kpi = $${paramIndex++}`);
    values.push(changes.kpi || null);
  }
  if (changes.decision !== undefined) {
    updates.push(`decision = $${paramIndex++}`);
    values.push(changes.decision ? 1 : 0);
  }
  if (changes.branches !== undefined) {
    updates.push(`branches = $${paramIndex++}`);
    values.push(changes.branches ? serializeArray(changes.branches) : null);
  }
  if (changes.notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    values.push(changes.notes || null);
  }
  if (changes.comments !== undefined) {
    updates.push(`comments = $${paramIndex++}`);
    values.push(serializeArray(changes.comments));
  }
  if (changes.links !== undefined) {
    updates.push(`links = $${paramIndex++}`);
    values.push(serializeArray(changes.links));
  }
  if (changes.gapIds !== undefined) {
    updates.push(`gap_ids = $${paramIndex++}`);
    values.push(serializeArray(changes.gapIds));
  }
  if (changes.diagramPosition !== undefined) {
    updates.push(`diagram_position = $${paramIndex++}`);
    values.push(changes.diagramPosition ? serializeObject(changes.diagramPosition) : null);
  }

  if (updates.length === 0) return;

  // Always update the updated_at timestamp
  const now = Date.now();
  updates.push(`updated_at = $${paramIndex++}`);
  values.push(now);

  values.push(id, projectId);
  await db.execute(
    `UPDATE steps SET ${updates.join(", ")} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}`,
    values
  );

  const updatedStep = await getStep(id, projectId);
  // No row, no edit: an id that matches nothing is a silent no-op in SQLite, so
  // neither the index nor the project's `updated_at` has anything to say about
  // it. The delete paths already return early on the same test (#395).
  if (updatedStep) {
    await reindexEntity("step", id, updatedStep.projectId, buildStepContent(updatedStep));
    await touchProject(db, projectId, now);
  }
}

/**
 * Delete a step
 */
export async function deleteStep(id: string, projectId: string): Promise<void> {
  const db = getDB();
  const ownedRows = await db.select<{ id: string }[]>(
    "SELECT id FROM steps WHERE id = $1 AND project_id = $2",
    [id, projectId]
  );
  if (ownedRows.length === 0) return;
  // The FK cascade deletes child gaps with the step, so read their ids first;
  // the index rows go after the DELETE so a failed delete leaves them searchable (#426).
  const childGaps = await db.select<{ id: string }[]>(
    "SELECT id FROM gaps WHERE step_id = $1",
    [id]
  );
  await db.execute("DELETE FROM steps WHERE id = $1 AND project_id = $2", [id, projectId]);
  await removeFromIndex("step", id);
  for (const gap of childGaps) {
    await removeFromIndex("gap", gap.id);
  }
  await touchProject(db, projectId, Date.now());
}

// ============================================================================
// GAPS (Process improvement opportunities)
// ============================================================================

const GAP_ENUM_PICK = { severity: true, status: true, rootCause: true, timeToFix: true, missingField: true } as const;

/**
 * Create a new gap
 */
export async function createGap(data: Omit<Gap, "id" | "createdAt" | "updatedAt">, id: string = nanoid()): Promise<string> {
  const constraintResult = GapSchema.pick(GAP_ENUM_PICK).safeParse({
    severity: data.severity,
    status: data.status,
    rootCause: data.rootCause,
    timeToFix: data.timeToFix,
    missingField: data.missingField,
  });
  if (!constraintResult.success) {
    const issues = constraintResult.error.issues.map((i: z.ZodIssue) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');
    throw new Error(`Gap validation failed: ${issues}`);
  }

  const db = getDB();
  const now = Date.now();

  await db.execute(
    `INSERT INTO gaps (
      id, project_id, step_id, observed, expected, severity, priority,
      root_cause, owner_team_id, fix_idea, time_to_fix, status,
      missing_field, links, order_num, milestone_id, created_at, updated_at, closed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      id,
      data.projectId,
      data.stepId ?? null,
      data.observed,
      data.expected,
      data.severity,
      data.priority ?? null,
      data.rootCause ?? null,
      data.ownerTeamId ?? null,
      data.fixIdea ?? null,
      data.timeToFix ?? null,
      data.status ?? 'Open',
      data.missingField ?? null,
      serializeArray(data.links),
      data.order ?? null,
      data.milestoneId ?? null,
      now,
      now,
      data.closedAt ?? null,
    ]
  );

  await indexEntity("gap", id, data.projectId, buildGapContent({ id, createdAt: now, updatedAt: now, ...data }));
  await touchProject(db, data.projectId, now);
  return id;
}

/**
 * List all gaps for a project
 */
export async function listGaps(projectId: string): Promise<Gap[]> {
  const db = getDB();
  const result = await db.select<GapRow[]>(
    "SELECT * FROM gaps WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId]
  );

  return result.map(gapRowToGap);
}

/**
 * Get a single gap by ID
 */
export async function getGap(id: string, projectId?: string): Promise<Gap | null> {
  const db = getDB();
  const result = await db.select<GapRow[]>(
    projectId === undefined ? "SELECT * FROM gaps WHERE id = $1" : "SELECT * FROM gaps WHERE id = $1 AND project_id = $2",
    projectId === undefined ? [id] : [id, projectId]
  );

  return result.length > 0 ? gapRowToGap(result[0]) : null;
}

/**
 * Get all gaps for a specific step
 */
export async function listGapsByStep(stepId: string, projectId: string): Promise<Gap[]> {
  const db = getDB();
  const result = await db.select<GapRow[]>(
    "SELECT * FROM gaps WHERE step_id = $1 AND project_id = $2 ORDER BY created_at DESC",
    [stepId, projectId]
  );

  return result.map(gapRowToGap);
}

/**
 * Update a gap
 */
export async function updateGap(id: string, data: GapUpdate, projectId: string): Promise<Gap | null> {
  const existingGap = await getGap(id, projectId);
  if (!existingGap) return null;

  const enumFields: Partial<Pick<Gap, 'severity' | 'status' | 'rootCause' | 'timeToFix' | 'missingField'>> = {};
  if (data.severity !== undefined) enumFields.severity = data.severity;
  if (data.status !== undefined) enumFields.status = data.status;
  if (data.rootCause !== undefined && data.rootCause !== null) enumFields.rootCause = data.rootCause;
  if (data.timeToFix !== undefined && data.timeToFix !== null) enumFields.timeToFix = data.timeToFix;
  if (data.missingField !== undefined && data.missingField !== null) enumFields.missingField = data.missingField;

  if (Object.keys(enumFields).length > 0) {
    const constraintResult = GapSchema.pick(GAP_ENUM_PICK).partial().safeParse(enumFields);
    if (!constraintResult.success) {
      const issues = constraintResult.error.issues.map((i: z.ZodIssue) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');
      throw new Error(`Gap validation failed: ${issues}`);
    }
  }

  const db = getDB();
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.stepId !== undefined) {
    updates.push(`step_id = $${paramIndex++}`);
    values.push(data.stepId);
  }
  if (data.observed !== undefined) {
    updates.push(`observed = $${paramIndex++}`);
    values.push(data.observed);
  }
  if (data.expected !== undefined) {
    updates.push(`expected = $${paramIndex++}`);
    values.push(data.expected);
  }
  if (data.severity !== undefined) {
    updates.push(`severity = $${paramIndex++}`);
    values.push(data.severity);
  }
  if (data.priority !== undefined) {
    updates.push(`priority = $${paramIndex++}`);
    values.push(data.priority);
  }
  if (data.rootCause !== undefined) {
    updates.push(`root_cause = $${paramIndex++}`);
    values.push(data.rootCause);
  }
  if (data.ownerTeamId !== undefined) {
    updates.push(`owner_team_id = $${paramIndex++}`);
    values.push(data.ownerTeamId);
  }
  if (data.fixIdea !== undefined) {
    updates.push(`fix_idea = $${paramIndex++}`);
    values.push(data.fixIdea);
  }
  if (data.timeToFix !== undefined) {
    updates.push(`time_to_fix = $${paramIndex++}`);
    values.push(data.timeToFix);
  }
  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(data.status);
  }
  if (data.missingField !== undefined) {
    updates.push(`missing_field = $${paramIndex++}`);
    values.push(data.missingField);
  }
  if (data.order !== undefined) {
    updates.push(`order_num = $${paramIndex++}`);
    values.push(data.order);
  }
  if (data.milestoneId !== undefined) {
    updates.push(`milestone_id = $${paramIndex++}`);
    values.push(data.milestoneId);
  }
  if (data.links !== undefined) {
    updates.push(`links = $${paramIndex++}`);
    values.push(serializeArray(data.links));
  }
  if (data.closedAt !== undefined) {
    updates.push(`closed_at = $${paramIndex++}`);
    values.push(data.closedAt);
  }

  const now = Date.now();
  const wrote = updates.length > 0;

  if (wrote) {
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);

    values.push(id, projectId);
    await db.execute(
      `UPDATE gaps SET ${updates.join(", ")} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}`,
      values
    );
  }

  const updatedGap = await getGap(id, projectId);
  if (updatedGap) await reindexEntity("gap", id, updatedGap.projectId, buildGapContent(updatedGap));
  // A call that carried no changes, or that named a gap this project does not
  // hold, wrote nothing, so it is not an edit to the project either (#395).
  if (wrote && updatedGap) await touchProject(db, projectId, now);
  return updatedGap;
}

/**
 * Close a gap (sets status to Closed and closedAt timestamp)
 */
export async function closeGap(id: string, projectId: string): Promise<void> {
  const db = getDB();
  if (!await getGap(id, projectId)) return;
  const now = Date.now();

  await db.execute(
    `UPDATE gaps SET status = 'Closed', closed_at = $1, updated_at = $2 WHERE id = $3 AND project_id = $4`,
    [now, now, id, projectId]
  );

  const closedGap = await getGap(id, projectId);
  if (closedGap) {
    await reindexEntity("gap", id, closedGap.projectId, buildGapContent(closedGap));
    await touchProject(db, projectId, now);
  }
}

/**
 * Delete a gap
 */
export async function deleteGap(id: string, projectId: string): Promise<void> {
  const db = getDB();
  if (!await getGap(id, projectId)) return;
  await db.execute("DELETE FROM gaps WHERE id = $1 AND project_id = $2", [id, projectId]);
  await removeFromIndex("gap", id);
  await touchProject(db, projectId, Date.now());
}

// ============================================================================
// POLICIES (Governance rules linked to milestones)
// ============================================================================

export async function createPolicy(data: Omit<Policy, "id" | "createdAt" | "updatedAt">, id: string = nanoid()): Promise<string> {
  const db = getDB();
  const now = Date.now();
  await db.execute(
    `INSERT INTO policies (id, project_id, title, content, source_doc, related_milestones, test_notes, tags, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, data.projectId, data.title, data.content, data.sourceDoc || null, serializeArray(data.relatedMilestones), data.testNotes || null, serializeArray(data.tags), now, now]
  );
  await indexEntity("policy", id, data.projectId, buildPolicyContent({ id, createdAt: now, updatedAt: now, ...data }));
  await touchProject(db, data.projectId, now);
  return id;
}

export async function getPolicy(id: string, projectId?: string): Promise<Policy | null> {
  const db = getDB();
  const rows = await db.select<PolicyRow[]>(
    projectId === undefined ? "SELECT * FROM policies WHERE id = $1" : "SELECT * FROM policies WHERE id = $1 AND project_id = $2",
    projectId === undefined ? [id] : [id, projectId]
  );
  if (rows.length === 0) return null;
  return policyRowToPolicy(rows[0]);
}

export async function listPolicies(projectId: string): Promise<Policy[]> {
  const db = getDB();
  const rows = await db.select<PolicyRow[]>(
    "SELECT * FROM policies WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId]
  );
  return rows.map(policyRowToPolicy);
}

export async function updatePolicy(
  id: string,
  changes: Partial<Omit<Policy, "id" | "projectId" | "createdAt" | "updatedAt">>,
  projectId: string,
): Promise<void> {
  const db = getDB();
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (changes.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    values.push(changes.title);
  }
  if (changes.content !== undefined) {
    updates.push(`content = $${paramIndex++}`);
    values.push(changes.content);
  }
  if (changes.sourceDoc !== undefined) {
    updates.push(`source_doc = $${paramIndex++}`);
    values.push(changes.sourceDoc || null);
  }
  if (changes.relatedMilestones !== undefined) {
    updates.push(`related_milestones = $${paramIndex++}`);
    values.push(serializeArray(changes.relatedMilestones));
  }
  if (changes.testNotes !== undefined) {
    updates.push(`test_notes = $${paramIndex++}`);
    values.push(changes.testNotes || null);
  }
  if (changes.tags !== undefined) {
    updates.push(`tags = $${paramIndex++}`);
    values.push(serializeArray(changes.tags));
  }

  if (updates.length === 0) return;

  const now = Date.now();
  updates.push(`updated_at = $${paramIndex++}`);
  values.push(now);

  values.push(id, projectId);
  await db.execute(
    `UPDATE policies SET ${updates.join(", ")} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}`,
    values
  );

  const updatedPolicy = await getPolicy(id, projectId);
  // No row, no edit: an id that matches nothing is a silent no-op in SQLite, so
  // neither the index nor the project's `updated_at` has anything to say about
  // it. The delete paths already return early on the same test (#395).
  if (updatedPolicy) {
    await reindexEntity("policy", id, updatedPolicy.projectId, buildPolicyContent(updatedPolicy));
    await touchProject(db, projectId, now);
  }
}

export async function deletePolicy(id: string, projectId: string): Promise<void> {
  const db = getDB();
  if (!await getPolicy(id, projectId)) return;
  await db.execute("DELETE FROM policies WHERE id = $1 AND project_id = $2", [id, projectId]);
  await removeFromIndex("policy", id);
  await touchProject(db, projectId, Date.now());
}

// ============================================================================
// GLOSSARY (Term definitions)
// ============================================================================

export async function createGlossaryEntry(data: Omit<GlossaryEntry, "id" | "createdAt">, id: string = nanoid()): Promise<string> {
  const db = getDB();
  const now = Date.now();
  await db.execute(
    `INSERT INTO glossary (id, project_id, term, definition, acronym, related_steps, tags, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, data.projectId, data.term, data.definition, data.acronym || null, serializeArray(data.relatedSteps), serializeArray(data.tags), now]
  );
  await indexEntity("glossary", id, data.projectId, buildGlossaryContent({ id, createdAt: now, ...data }));
  await touchProject(db, data.projectId, now);
  return id;
}

export async function getGlossaryEntry(id: string, projectId?: string): Promise<GlossaryEntry | null> {
  const db = getDB();
  const rows = await db.select<GlossaryEntryRow[]>(
    projectId === undefined ? "SELECT * FROM glossary WHERE id = $1" : "SELECT * FROM glossary WHERE id = $1 AND project_id = $2",
    projectId === undefined ? [id] : [id, projectId]
  );
  if (rows.length === 0) return null;
  return glossaryRowToEntry(rows[0]);
}

export async function listGlossaryEntries(projectId: string): Promise<GlossaryEntry[]> {
  const db = getDB();
  const rows = await db.select<GlossaryEntryRow[]>(
    "SELECT * FROM glossary WHERE project_id = $1 ORDER BY term ASC",
    [projectId]
  );
  return rows.map(glossaryRowToEntry);
}

export async function updateGlossaryEntry(
  id: string,
  changes: Partial<Omit<GlossaryEntry, "id" | "projectId" | "createdAt">>,
  projectId: string,
): Promise<void> {
  const db = getDB();
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (changes.term !== undefined) {
    updates.push(`term = $${paramIndex++}`);
    values.push(changes.term);
  }
  if (changes.definition !== undefined) {
    updates.push(`definition = $${paramIndex++}`);
    values.push(changes.definition);
  }
  if (changes.acronym !== undefined) {
    updates.push(`acronym = $${paramIndex++}`);
    values.push(changes.acronym || null);
  }
  if (changes.relatedSteps !== undefined) {
    updates.push(`related_steps = $${paramIndex++}`);
    values.push(serializeArray(changes.relatedSteps));
  }
  if (changes.tags !== undefined) {
    updates.push(`tags = $${paramIndex++}`);
    values.push(serializeArray(changes.tags));
  }

  if (updates.length === 0) return;

  values.push(id, projectId);
  await db.execute(
    `UPDATE glossary SET ${updates.join(", ")} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1}`,
    values
  );

  const updatedEntry = await getGlossaryEntry(id, projectId);
  // No row, no edit: an id that matches nothing is a silent no-op in SQLite, so
  // neither the index nor the project's `updated_at` has anything to say about
  // it. The delete paths already return early on the same test (#395).
  if (updatedEntry) {
    await reindexEntity("glossary", id, updatedEntry.projectId, buildGlossaryContent(updatedEntry));
    await touchProject(db, projectId, Date.now());
  }
}

export async function deleteGlossaryEntry(id: string, projectId: string): Promise<void> {
  const db = getDB();
  if (!await getGlossaryEntry(id, projectId)) return;
  await db.execute("DELETE FROM glossary WHERE id = $1 AND project_id = $2", [id, projectId]);
  await removeFromIndex("glossary", id);
  await touchProject(db, projectId, Date.now());
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Converters (useful for testing/debugging)
  stepRowToStep,
  gapRowToGap,
  teamRowToTeam,
  systemRowToSystem,
  milestoneRowToMilestone,
  policyRowToPolicy,
  glossaryRowToEntry,
  sipocRowToSIPOC,
  projectRowToProject,
  // Serialization helpers
  serializeArray,
  deserializeArray,
  serializeObject,
  deserializeObject,
};
