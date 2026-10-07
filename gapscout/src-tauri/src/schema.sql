-- GapScout Database Schema
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
  suppliers TEXT, -- JSON array
  inputs TEXT, -- JSON array
  process TEXT,
  outputs TEXT, -- JSON array
  customers TEXT, -- JSON array
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
  tags TEXT, -- JSON array
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
  tags TEXT, -- JSON array
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
  related_steps TEXT, -- JSON array of step IDs
  tags TEXT, -- JSON array
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
  related_policies TEXT, -- JSON array of policy IDs
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
  related_milestones TEXT, -- JSON array of milestone IDs
  test_notes TEXT,
  tags TEXT, -- JSON array
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
  
  -- SIPOC elements (stored as JSON arrays)
  suppliers TEXT,
  inputs TEXT,
  outputs TEXT,
  customers TEXT,
  systems TEXT, -- JSON array of system IDs or names
  
  -- Process details
  trigger TEXT,
  result TEXT,
  kpi TEXT,
  
  -- Decision logic
  decision INTEGER DEFAULT 0, -- boolean: 0 = false, 1 = true
  branches TEXT, -- JSON array of StepBranch objects: [{ when, toStepId, label }]
  
  -- Metadata
  notes TEXT,
  comments TEXT, -- JSON array of Comment objects: [{ id, text, createdAt, author }]
  links TEXT, -- JSON array of Link objects: [{ id, url, label, type, note, createdAt }]
  gap_ids TEXT, -- JSON array of gap IDs for quick lookup
  
  -- Diagram position (optional, for manual overrides)
  diagram_position TEXT, -- JSON: { x, y }
  
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
  step_id TEXT NOT NULL,
  
  -- Gap details
  observed TEXT NOT NULL,
  expected TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('L', 'M', 'H')),
  priority INTEGER CHECK(priority BETWEEN 1 AND 5),
  root_cause TEXT NOT NULL CHECK(root_cause IN ('Config', 'Policy', 'Behavior', 'Data')),
  
  -- Assignment
  owner_team_id TEXT,
  fix_idea TEXT,
  time_to_fix TEXT CHECK(time_to_fix IN ('qwin', 'near', 'mid', 'long')),
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Review', 'Closed')),
  missing_field TEXT CHECK(missing_field IN ('supplier', 'input', 'output', 'customer')),
  
  -- Jira linkage (stored as JSON array of Link objects)
  links TEXT, -- [{ id, url, label, type: 'jira', note, createdAt }]
  
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES steps(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gaps_project ON gaps(project_id);
CREATE INDEX IF NOT EXISTS idx_gaps_step ON gaps(step_id);
CREATE INDEX IF NOT EXISTS idx_gaps_status ON gaps(status);
CREATE INDEX IF NOT EXISTS idx_gaps_severity ON gaps(severity);
CREATE INDEX IF NOT EXISTS idx_gaps_priority ON gaps(priority DESC);
CREATE INDEX IF NOT EXISTS idx_gaps_owner ON gaps(owner_team_id);

-- =====================================================
-- FULL-TEXT SEARCH
-- =====================================================

-- Virtual table for full-text search across all entities
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  entity_type UNINDEXED, -- "step", "gap", "team", "system", "glossary", "policy"
  entity_id UNINDEXED,
  project_id UNINDEXED,
  content, -- searchable text content
  tokenize = 'porter unicode61' -- Porter stemming + Unicode support
);

-- =====================================================
-- METADATA & CONFIGURATION
-- =====================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Insert initial version
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, strftime('%s', 'now') * 1000);

-- =====================================================
-- SAMPLE QUERIES FOR APPLICATION
-- =====================================================

-- Get all steps for a project with team and milestone info
-- SELECT s.*, t.name as team_name, t.color as team_color, m.name as milestone_name
-- FROM steps s
-- JOIN teams t ON s.team_id = t.id
-- JOIN milestones m ON s.milestone_id = m.id
-- WHERE s.project_id = ?
-- ORDER BY m."order", t."order", s."order";

-- Get gaps by severity for a project
-- SELECT g.*, s.label as step_label, t.name as owner_team_name
-- FROM gaps g
-- JOIN steps s ON g.step_id = s.id
-- LEFT JOIN teams t ON g.owner_team_id = t.id
-- WHERE g.project_id = ?
-- ORDER BY 
--   CASE g.severity 
--     WHEN 'H' THEN 1 
--     WHEN 'M' THEN 2 
--     WHEN 'L' THEN 3 
--   END,
--   g.priority DESC;

-- Search across all content
-- SELECT * FROM search_index WHERE content MATCH ? AND project_id = ? ORDER BY rank;

-- Get step with all gaps
-- SELECT s.*, 
--   (SELECT json_group_array(json_object(
--     'id', g.id,
--     'severity', g.severity,
--     'status', g.status,
--     'observed', g.observed
--   )) FROM gaps g WHERE g.step_id = s.id) as gaps_json
-- FROM steps s
-- WHERE s.id = ?;

-- =====================================================
-- VACUUM & OPTIMIZATION
-- =====================================================

-- Run periodically for performance
-- VACUUM;
-- ANALYZE;
