/**
 * TypeScript interfaces for GapScout data model
 * Reference: PRD Section 3.1 - Data Model
 */

// ============================================================================
// UTILITY TYPES & ENUMS
// ============================================================================

export type SeverityLevel = "L" | "M" | "H";
export type GapStatus = "Open" | "Review" | "Closed";
export type RootCauseType = "Config" | "Policy" | "Behavior" | "Data";
/** A project maps the process as it runs, or as it is meant to run (#263). */
export type ProjectState = "current" | "future";
export type TimeToFix = "qwin" | "near" | "mid" | "long";
export type SystemType = "ERP" | "CRM" | "WMS" | "Custom" | "Other";
export type LinkType = "jira" | "gdrive" | "coda" | "confluence" | "other";
export type MissingFieldType = "supplier" | "input" | "output" | "customer";
export type SearchEntityType = "step" | "gap" | "team" | "system" | "milestone" | "policy" | "glossary";

export interface SearchResult {
  entityType: SearchEntityType;
  entityId: string;
  projectId: string;
  content: string;
  rank: number;
}

/**
 * SIPOC validation result.
 *
 * Derived state: computed from the current step list wherever it is needed,
 * never stored on a Step. Moved here from sipocValidator.ts to avoid a
 * circular import.
 */
export interface ValidationResult {
  isValid: boolean;
  missingFields: string[];
  issues: string[];
}

// ============================================================================
// CORE ENTITY INTERFACES
// ============================================================================

/**
 * Top-level project container
 * Holds all teams, systems, milestones, steps, gaps, policies, and glossary entries
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  /**
   * Whether this map is the process as it runs (`current`) or the target
   * design (`future`). Optional on purpose: undefined means nobody has said,
   * and it draws no tag (#263).
   */
  state?: ProjectState;
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
}

/**
 * A project as the project list needs it: the record plus what it actually
 * holds.
 *
 * The counts are not on `Project` because they are not stored — they are
 * computed per read, and `getProject` (the board's path) has no use for them.
 * `listProjects` returns this shape so the list can show what a project
 * contains instead of the literal "Active" / "Ready for mapping" strings it
 * used to claim (#213).
 *
 * `openGapCount` counts gaps whose status is `Open`, matching the board
 * header — a card reading "3 gaps" beside a header reading "2 open gaps" for
 * the same project would be a disagreement with itself.
 */
export interface ProjectSummary extends Project {
  stepCount: number;
  openGapCount: number;
}

/**
 * The shape `updateProject` accepts.
 *
 * `state` widens to include `null` on the write path only (#318). On the read
 * path `undefined` is the whole story, but a write has to distinguish "leave it
 * alone" (`undefined`) from "return it to NULL" (`null`) — and NULL is
 * load-bearing in #263's design, because it is what draws no tag.
 */
export type ProjectChanges = Partial<Omit<Project, "id" | "createdAt" | "state">> & {
  state?: ProjectState | null;
};

/**
 * Team (swimlane in diagram)
 * Represents a role, department, or actor responsible for process steps
 */
export interface Team {
  id: string;
  projectId: string;
  name: string;
  color: string; // Hex color code (e.g., "#3B82F6")
  description?: string;
  order: number; // Lane position, 0-indexed
  tags: string[];
  createdAt: number;
}

/**
 * System (ERP, CRM, etc.)
 * External or internal software used in process steps
 */
export interface System {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  vendor?: string;
  type?: SystemType;
  tags: string[];
  createdAt: number;
}

/**
 * Milestone (phase in process)
 * Groups steps into logical phases (e.g., "Approval", "Fulfillment")
 */
export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  order: number; // Sequence in process, 0-indexed
  description?: string;
  relatedPolicies: string[]; // Policy IDs
  createdAt: number;
  updatedAt: number;
}

/**
 * Step (process activity)
 * Core unit of work with SIPOC elements, decision logic, and metadata
 */
export interface Step {
  id: string;
  projectId: string;
  label: string; // Action description (e.g., "Review purchase request")
  teamId: string;
  milestoneId: string;
  order: number; // Within milestone+team, for sequencing

  // SIPOC elements
  suppliers: string[]; // Who provides inputs
  inputs: string[]; // What's received
  outputs: string[]; // What's produced
  customers: string[]; // Who receives outputs

  // Process details
  systems: string[]; // System IDs or names
  trigger?: string; // What starts this step
  result?: string; // What happens after, including loops (e.g., "→ Step 2 if rejected")
  kpi?: string; // Success metric

  // Decision logic
  /** Whether this is a decision point (diamond in diagram) */
  decision?: boolean;
  /** Conditional branches for decision points */
  branches?: StepBranch[];

  // Metadata
  notes?: string; // Process notes
  comments: Comment[]; // Discussion thread
  links: Link[]; // Google Drive, Coda, etc.
  gapIds: string[]; // Back-reference for filtering
  
  /** Diagram position (x, y coordinates) for manual adjustments */
  diagramPosition?: { x: number; y: number };

  createdAt: number;
  updatedAt: number;
}

/**
 * StepBranch (conditional path from decision point)
 * Defines what happens based on a condition
 */
export interface StepBranch {
  when: string; // Condition (e.g., "Approved", "Budget < $10k")
  toStepId: string; // Target step ID
  label?: string; // Edge label for diagram
}

/**
 * Comment (discussion on a step)
 * Allows team collaboration and notes
 */
export interface Comment {
  id: string;
  text: string;
  createdAt: number;
  author?: string; // Optional for single-user mode
}

/**
 * Gap (process improvement opportunity)
 * Tracks what's broken, missing, or suboptimal in the process
 */
export interface Gap {
  id: string;
  projectId: string;
  stepId?: string; // Which step has the gap (optional for process gaps)

  // Gap details
  observed: string; // Current state (what we see)
  expected: string; // Desired state (what should be)
  severity: SeverityLevel; // L, M, H
  priority?: number; // Manual 1-5 scoring
  rootCause?: RootCauseType; // Config, Policy, Behavior, Data (may not be known initially)

  // Assignment
  ownerTeamId?: string; // Who should fix it
  fixIdea?: string; // Proposed solution
  timeToFix?: TimeToFix; // qwin, near, mid, long

  // Status tracking
  status: GapStatus; // Open, Review, Closed
  /** Auto-detected missing SIPOC field */
  missingField?: MissingFieldType;

  // Process gap fields (for gaps that reserve an order number in the flow)
  order?: number; // Order number in the process flow
  milestoneId?: string; // Milestone this gap belongs to

  // Jira linkage
  links: Link[]; // Jira-specific, display ticket number with URL

  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export type GapUpdate = Partial<Omit<
  Gap,
  | "id"
  | "projectId"
  | "createdAt"
  | "updatedAt"
  | "stepId"
  | "priority"
  | "rootCause"
  | "ownerTeamId"
  | "fixIdea"
  | "timeToFix"
  | "missingField"
  | "order"
  | "milestoneId"
  | "closedAt"
>> & {
  stepId?: string | null;
  priority?: number | null;
  rootCause?: RootCauseType | null;
  ownerTeamId?: string | null;
  fixIdea?: string | null;
  timeToFix?: TimeToFix | null;
  missingField?: MissingFieldType | null;
  order?: number | null;
  milestoneId?: string | null;
  closedAt?: number | null;
};

/**
 * Policy (business rule or compliance requirement)
 * Documents requirements that govern process steps
 */
export interface Policy {
  id: string;
  projectId: string;
  title: string;
  content: string; // The policy rule/requirement
  sourceDoc?: string; // URL or doc reference
  relatedMilestones: string[]; // Which milestones this governs
  testNotes?: string; // How to verify compliance
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * GlossaryEntry (term definition)
 * Clarifies jargon, acronyms, and domain-specific terms
 */
export interface GlossaryEntry {
  id: string;
  projectId: string;
  term: string;
  definition: string;
  acronym?: string;
  relatedSteps: string[]; // Step IDs for context
  tags: string[];
  createdAt: number;
}

/**
 * SIPOC (high-level process summary)
 * Captured in initial wizard, seeds the Discovery Grid
 */
export interface SIPOC {
  projectId: string;
  suppliers: string[];
  inputs: string[];
  process: string; // High-level summary paragraph
  outputs: string[];
  customers: string[];
}

/**
 * Link (external resource)
 * References to Jira, Google Drive, Coda, Confluence, etc.
 */
export interface Link {
  id: string;
  url: string;
  label: string;
  type: LinkType;
  note?: string;
  createdAt: number;
}

// ============================================================================
// DATABASE ROW TYPES (for SQLite storage)
// ============================================================================

/**
 * Database representation of Step
 * JSON arrays are stored as TEXT (serialized)
 */
export interface StepRow {
  id: string;
  project_id: string;
  label: string;
  team_id: string;
  milestone_id: string;
  order: number;

  // SIPOC elements (stored as JSON TEXT)
  suppliers: string; // JSON array
  inputs: string; // JSON array
  outputs: string; // JSON array
  customers: string; // JSON array

  // Process details
  systems: string; // JSON array
  trigger: string | null;
  result: string | null;
  kpi: string | null;

  // Decision logic
  decision: number; // 0 or 1 (SQLite boolean)
  branches: string | null; // JSON array of StepBranch

  // Metadata
  notes: string | null;
  comments: string; // JSON array of Comment
  links: string; // JSON array of Link
  gap_ids: string; // JSON array of string
  diagram_position: string | null; // JSON object {x, y}
  // Legacy column, no longer read or written: validation is derived from the
  // current step list at read time (#176). Kept so the row type still matches
  // the table, which migrations only ever add to.
  validation_status: string | null;

  created_at: number;
  updated_at: number;
}

/**
 * Database representation of Gap
 * Links array stored as JSON TEXT
 */
export interface GapRow {
  id: string;
  project_id: string;
  step_id: string | null;

  // Gap details
  observed: string;
  expected: string;
  severity: SeverityLevel;
  priority: number | null;
  root_cause: RootCauseType | null;

  // Assignment
  owner_team_id: string | null;
  fix_idea: string | null;
  time_to_fix: TimeToFix | null;

  // Status tracking
  status: GapStatus;
  missing_field: MissingFieldType | null;

  // Process gap fields
  order_num: number | null;
  milestone_id: string | null;

  // Jira linkage
  links: string; // JSON array of Link

  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

/**
 * Database representation of Team
 */
export interface TeamRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  description: string | null;
  order: number;
  tags: string; // JSON array
  created_at: number;
}

/**
 * Database representation of System
 */
export interface SystemRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  vendor: string | null;
  type: SystemType | null;
  tags: string; // JSON array
  created_at: number;
}

/**
 * Database representation of Milestone
 */
export interface MilestoneRow {
  id: string;
  project_id: string;
  name: string;
  order: number;
  description: string | null;
  related_policies: string; // JSON array
  created_at: number;
  updated_at: number;
}

/**
 * Database representation of Policy
 */
export interface PolicyRow {
  id: string;
  project_id: string;
  title: string;
  content: string;
  source_doc: string | null;
  related_milestones: string; // JSON array
  test_notes: string | null;
  tags: string; // JSON array
  created_at: number;
  updated_at: number;
}

/**
 * Database representation of GlossaryEntry
 */
export interface GlossaryEntryRow {
  id: string;
  project_id: string;
  term: string;
  definition: string;
  acronym: string | null;
  related_steps: string; // JSON array
  tags: string; // JSON array
  created_at: number;
}

/**
 * Database representation of SIPOC
 */
export interface SIPOCRow {
  project_id: string; // Primary key
  suppliers: string; // JSON array
  inputs: string; // JSON array
  process: string;
  outputs: string; // JSON array
  customers: string; // JSON array
}

/**
 * Database representation of Project
 * (No JSON fields, simple structure)
 */
export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  state: string | null;
  /**
   * The name migration v6 replaced, so the rename stays reversible. Row-only:
   * nothing in the app reads it. `updateProject` clears it when the user
   * renames the project (#265) — at that point they have made the name theirs
   * and the migration's original describes nothing.
   */
  legacy_name: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * A project row with the two counts `listProjects` computes alongside it.
 * Neither column exists in the schema — both come from a subquery, so they are
 * on the row type rather than in `schema.sql` (#213).
 */
export interface ProjectSummaryRow extends ProjectRow {
  step_count: number;
  open_gap_count: number;
}
