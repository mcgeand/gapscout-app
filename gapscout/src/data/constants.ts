/**
 * Application constants, default values, and enums.
 *
 * Colour lives in src/styles/globals.css and nowhere else. The one exception is
 * DEFAULT_COLORS below: team colour is user data, not chrome.
 */

// ============================================================================
// COLOR PALETTE
// ============================================================================

/**
 * Default colour palette offered when creating a team.
 *
 * These are real colours on purpose. A team colour is user data: the user picks
 * it, and it has to survive into diagram swimlanes and the registry swatch, so
 * it cannot become a token or a weight class. Twelve values, spaced far enough
 * apart to stay distinguishable side by side in a diagram.
 */
export const DEFAULT_COLORS = [
  "#F59E0B", // Amber
  "#10B981", // Green
  "#3B82F6", // Blue
  "#8B5CF6", // Purple
  "#EF4444", // Red
  "#EC4899", // Pink
  "#14B8A6", // Teal
  "#6366F1", // Indigo
  "#EAB308", // Yellow
  "#06B6D4", // Cyan
  "#84CC16", // Lime
  "#6B7280", // Gray
] as const;

// Grey — the sentinel is the absence of an owner, and a lane colour would give it a presence in the diagram it has not earned.
export const UNASSIGNED_TEAM_COLOR = DEFAULT_COLORS[11];

// ============================================================================
// DEFAULT TEAMS
// ============================================================================

/**
 * Starter teams for new projects
 * Common roles in most business processes
 */
export const DEFAULT_TEAMS = [
  {
    name: "Requestor",
    color: DEFAULT_COLORS[0], // Amber
    description: "Initiates the process or request",
    order: 0,
  },
  {
    name: "Approver",
    color: DEFAULT_COLORS[3], // Purple
    description: "Reviews and approves requests",
    order: 1,
  },
  {
    name: "Operations",
    color: DEFAULT_COLORS[1], // Green
    description: "Executes the process activities",
    order: 2,
  },
  {
    name: "System",
    color: DEFAULT_COLORS[11], // Gray
    description: "Automated system actions",
    order: 3,
  },
] as const;

// ============================================================================
// GAP SEVERITY LABELS
// ============================================================================

/**
 * Human-readable labels for gap severity levels
 */
export const SEVERITY_LABELS = {
  L: "Low",
  M: "Medium",
  H: "High",
} as const;

// ============================================================================
// ROOT CAUSE LABELS
// ============================================================================

/**
 * Human-readable labels for root cause types
 */
export const ROOT_CAUSE_LABELS = {
  Config: "Configuration Issue",
  Policy: "Policy Gap",
  Behavior: "Behavioral/Training",
  Data: "Data Quality",
} as const;

/**
 * Descriptions for each root cause type
 */
export const ROOT_CAUSE_DESCRIPTIONS = {
  Config: "System settings or configuration are incorrect",
  Policy: "Missing or unclear business rule/policy",
  Behavior: "People not following process correctly (training needed)",
  Data: "Incorrect, incomplete, or stale data",
} as const;

// ============================================================================
// TIME TO FIX LABELS
// ============================================================================

/**
 * Human-readable labels for time-to-fix estimates
 */
export const TIME_TO_FIX_LABELS = {
  qwin: "Quick Win (< 1 week)",
  near: "Near-term (1-4 weeks)",
  mid: "Mid-term (1-3 months)",
  long: "Long-term (3+ months)",
} as const;

/**
 * Abbreviated labels for compact display
 */
export const TIME_TO_FIX_SHORT = {
  qwin: "< 1w",
  near: "1-4w",
  mid: "1-3m",
  long: "3m+",
} as const;

// ============================================================================
// GAP STATUS LABELS
// ============================================================================

/**
 * Human-readable labels for gap status
 */
export const GAP_STATUS_LABELS = {
  Open: "Open",
  Review: "In Review",
  Closed: "Closed",
} as const;

// ============================================================================
// SYSTEM TYPE LABELS
// ============================================================================

/**
 * Human-readable labels for system types
 */
export const SYSTEM_TYPE_LABELS = {
  ERP: "ERP (Enterprise Resource Planning)",
  CRM: "CRM (Customer Relationship Management)",
  WMS: "WMS (Warehouse Management System)",
  Custom: "Custom Application",
  Other: "Other",
} as const;

// ============================================================================
// LINK TYPE LABELS
// ============================================================================

/**
 * Human-readable labels for link types
 */
export const LINK_TYPE_LABELS = {
  jira: "Jira",
  gdrive: "Google Drive",
  coda: "Coda",
  confluence: "Confluence",
  other: "Other",
} as const;

// ============================================================================
// PRIORITY LABELS
// ============================================================================

/**
 * Human-readable labels for manual priority scoring (1-5)
 */
export const PRIORITY_LABELS = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
  5: "Trivial",
} as const;

// ============================================================================
// UI CONSTANTS
// ============================================================================

/**
 * Maximum lengths for text fields (for validation)
 */
export const MAX_LENGTH = {
  PROJECT_NAME: 100,
  TEAM_NAME: 50,
  SYSTEM_NAME: 100,
  MILESTONE_NAME: 100,
  STEP_LABEL: 200,
  GAP_OBSERVED: 500,
  GAP_EXPECTED: 500,
  POLICY_TITLE: 200,
  GLOSSARY_TERM: 100,
  COMMENT_TEXT: 1000,
  LINK_LABEL: 100,
} as const;

/**
 * Diagram layout constants
 */
export const DIAGRAM_CONSTANTS = {
  NODE_WIDTH: 180,
  NODE_HEIGHT: 80,
  DECISION_SIZE: 120,
  LANE_HEIGHT: 150,
  LANE_HEADER_WIDTH: 200,
  HORIZONTAL_SPACING: 100,
  VERTICAL_SPACING: 80,
} as const;

/**
 * Auto-save debounce delay (milliseconds)
 */
export const AUTO_SAVE_DELAY = 500;

/**
 * Default window size for Tauri
 */
export const DEFAULT_WINDOW_SIZE = {
  WIDTH: 1400,
  HEIGHT: 900,
  MIN_WIDTH: 1024,
  MIN_HEIGHT: 768,
} as const;

