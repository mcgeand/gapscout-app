/**
 * Zod validation schemas for runtime type checking
 * Reference: PRD Section 3.1 - Data Model
 */

import { z } from "zod";
import { MAX_LENGTH } from "./constants";

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

export const SeverityLevelSchema = z.enum(["L", "M", "H"]);

export const GapStatusSchema = z.enum(["Open", "Review", "Closed"]);

export const RootCauseTypeSchema = z.enum(["Config", "Policy", "Behavior", "Data"]);

export const TimeToFixSchema = z.enum(["qwin", "near", "mid", "long"]);

export const SystemTypeSchema = z.enum(["ERP", "CRM", "WMS", "Custom", "Other"]);

export const LinkTypeSchema = z.enum(["jira", "gdrive", "coda", "confluence", "other"]);

export const MissingFieldTypeSchema = z.enum(["supplier", "input", "output", "customer"]);

// ============================================================================
// NESTED OBJECT SCHEMAS
// ============================================================================

/**
 * Comment schema
 * Note: id uses nanoid (21 chars alphanumeric) not UUID
 */
export const CommentSchema = z.object({
  id: z.string().min(1), // nanoid format, not UUID
  text: z.string().min(1).max(MAX_LENGTH.COMMENT_TEXT),
  createdAt: z.number().int().positive(),
  author: z.string().optional(),
});

/**
 * Link schema
 * Note: id uses nanoid (21 chars alphanumeric) not UUID
 */
export const LinkSchema = z.object({
  id: z.string().min(1), // nanoid format, not UUID
  url: z.string().url(),
  label: z.string().min(1).max(MAX_LENGTH.LINK_LABEL),
  type: LinkTypeSchema,
  note: z.string().optional(),
  createdAt: z.number().int().positive(),
});

/**
 * StepBranch schema (for decision points)
 * Note: toStepId uses nanoid format
 */
export const StepBranchSchema = z.object({
  when: z.string().min(1).max(200),
  toStepId: z.string().min(1), // nanoid format, not UUID
  label: z.string().max(100).optional(),
});

/**
 * Diagram position schema
 */
export const DiagramPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// ============================================================================
// ENTITY SCHEMAS
// ============================================================================

/**
 * Project schema
 * Note: All IDs use nanoid format (21 chars alphanumeric)
 */
export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_LENGTH.PROJECT_NAME),
  description: z.string().optional(),
  // Optional, not nullable-with-a-default: a project nobody has classified
  // carries no state and draws no tag (#263).
  state: z.enum(["current", "future"]).optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

/**
 * A project plus what it holds (#213).
 *
 * Extends rather than restates: `ProjectSchema.parse` strips unknown keys, so
 * validating a summary against the base schema would drop both counts on the
 * floor and the card would render "undefined steps" with no error anywhere.
 */
export const ProjectSummarySchema = ProjectSchema.extend({
  stepCount: z.number().int().min(0),
  openGapCount: z.number().int().min(0),
});

/**
 * Team schema
 */
export const TeamSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1).max(MAX_LENGTH.TEAM_NAME),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  description: z.string().optional(),
  order: z.number().int().min(0),
  tags: z.array(z.string()).default([]),
  createdAt: z.number().int().positive(),
});

/**
 * System schema
 */
export const SystemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1).max(MAX_LENGTH.SYSTEM_NAME),
  description: z.string().optional(),
  vendor: z.string().optional(),
  type: SystemTypeSchema.optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.number().int().positive(),
});

/**
 * Milestone schema
 */
export const MilestoneSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1).max(MAX_LENGTH.MILESTONE_NAME),
  order: z.number().int().min(0),
  description: z.string().optional(),
  relatedPolicies: z.array(z.string().min(1)).default([]),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

/**
 * Step schema
 */
export const StepSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  label: z.string().min(1).max(MAX_LENGTH.STEP_LABEL),
  teamId: z.string().min(1),
  milestoneId: z.string().min(1),
  order: z.number().int().min(0),

  // SIPOC elements
  suppliers: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  customers: z.array(z.string()).default([]),

  // Process details
  systems: z.array(z.string()).default([]),
  trigger: z.string().optional(),
  result: z.string().optional(),
  kpi: z.string().optional(),

  // Decision logic
  decision: z.boolean().optional(),
  branches: z.array(StepBranchSchema).optional(),

  // Metadata
  notes: z.string().optional(),
  comments: z.array(CommentSchema).default([]),
  links: z.array(LinkSchema).default([]),
  gapIds: z.array(z.string().min(1)).default([]),
  diagramPosition: DiagramPositionSchema.optional(),

  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

/**
 * Gap schema
 * Note: stepId is optional to support process-level gaps (not tied to a specific step)
 */
export const GapSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  stepId: z.string().min(1).optional(), // Optional for process-level gaps

  // Gap details
  observed: z.string().min(1).max(MAX_LENGTH.GAP_OBSERVED),
  expected: z.string().min(1).max(MAX_LENGTH.GAP_EXPECTED),
  severity: SeverityLevelSchema,
  priority: z.number().int().min(1).max(5).optional(),
  rootCause: RootCauseTypeSchema.optional(), // May not be known initially

  // Assignment
  ownerTeamId: z.string().min(1).optional(),
  fixIdea: z.string().optional(),
  timeToFix: TimeToFixSchema.optional(),

  // Status tracking
  status: GapStatusSchema,
  missingField: MissingFieldTypeSchema.optional(),

  // Process gap fields
  order: z.number().int().min(0).optional(),
  milestoneId: z.string().min(1).optional(),

  // Jira linkage
  links: z.array(LinkSchema).default([]),

  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  closedAt: z.number().int().positive().optional(),
});

/**
 * Policy schema
 */
export const PolicySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1).max(MAX_LENGTH.POLICY_TITLE),
  content: z.string().min(1),
  sourceDoc: z.string().optional(),
  relatedMilestones: z.array(z.string().min(1)).default([]),
  testNotes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

/**
 * GlossaryEntry schema
 */
export const GlossaryEntrySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  term: z.string().min(1).max(MAX_LENGTH.GLOSSARY_TERM),
  definition: z.string().min(1),
  acronym: z.string().optional(),
  relatedSteps: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string()).default([]),
  createdAt: z.number().int().positive(),
});

/**
 * SIPOC schema
 */
export const SIPOCSchema = z.object({
  projectId: z.string().min(1),
  suppliers: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  // Not `.min(1)`: the wizard's validation modal offers "Save Anyway", so an
  // empty process is a state the user can deliberately reach. Requiring it here
  // would make every read of that row log a schema warning it cannot act on.
  process: z.string(),
  outputs: z.array(z.string()).default([]),
  customers: z.array(z.string()).default([]),
});

// ============================================================================
// PARTIAL SCHEMAS (for updates)
// ============================================================================

/**
 * Partial schemas for PATCH operations
 * All fields optional except ID
 */
export const ProjectUpdateSchema = ProjectSchema.partial().required({ id: true });
export const TeamUpdateSchema = TeamSchema.partial().required({ id: true, projectId: true });
export const SystemUpdateSchema = SystemSchema.partial().required({ id: true, projectId: true });
export const MilestoneUpdateSchema = MilestoneSchema.partial().required({ id: true, projectId: true });
export const StepUpdateSchema = StepSchema.partial().required({ id: true, projectId: true });
export const GapUpdateSchema = GapSchema.partial().required({ id: true, projectId: true });
export const PolicyUpdateSchema = PolicySchema.partial().required({ id: true, projectId: true });
export const GlossaryEntryUpdateSchema = GlossaryEntrySchema.partial().required({ id: true, projectId: true });

// ============================================================================
// CREATE SCHEMAS (without IDs and timestamps)
// ============================================================================

/**
 * Schemas for creating new entities
 * Omit id, createdAt, updatedAt
 */
export const ProjectCreateSchema = ProjectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const TeamCreateSchema = TeamSchema.omit({
  id: true,
  createdAt: true,
});

export const SystemCreateSchema = SystemSchema.omit({
  id: true,
  createdAt: true,
});

export const MilestoneCreateSchema = MilestoneSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const StepCreateSchema = StepSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const GapCreateSchema = GapSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
});

export const PolicyCreateSchema = PolicySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const GlossaryEntryCreateSchema = GlossaryEntrySchema.omit({
  id: true,
  createdAt: true,
});

export const SIPOCCreateSchema = SIPOCSchema;

// ============================================================================
// VALIDATION HELPER FUNCTIONS
// ============================================================================

/**
 * Validate a project object
 * @throws ZodError if validation fails
 */
export function validateProject(data: unknown) {
  return ProjectSchema.parse(data);
}

/**
 * Validate a team object
 * @throws ZodError if validation fails
 */
export function validateTeam(data: unknown) {
  return TeamSchema.parse(data);
}

/**
 * Validate a system object
 * @throws ZodError if validation fails
 */
export function validateSystem(data: unknown) {
  return SystemSchema.parse(data);
}

/**
 * Validate a milestone object
 * @throws ZodError if validation fails
 */
export function validateMilestone(data: unknown) {
  return MilestoneSchema.parse(data);
}

/**
 * Validate a step object
 * @throws ZodError if validation fails
 */
export function validateStep(data: unknown) {
  return StepSchema.parse(data);
}

/**
 * Validate a gap object
 * @throws ZodError if validation fails
 */
export function validateGap(data: unknown) {
  return GapSchema.parse(data);
}

/**
 * Validate a policy object
 * @throws ZodError if validation fails
 */
export function validatePolicy(data: unknown) {
  return PolicySchema.parse(data);
}

/**
 * Validate a glossary entry object
 * @throws ZodError if validation fails
 */
export function validateGlossaryEntry(data: unknown) {
  return GlossaryEntrySchema.parse(data);
}

/**
 * Validate a SIPOC object
 * @throws ZodError if validation fails
 */
export function validateSIPOC(data: unknown) {
  return SIPOCSchema.parse(data);
}

// ============================================================================
// SAFE VALIDATION (returns success/error)
// ============================================================================

/**
 * Safely validate any schema
 * Returns { success: true, data } or { success: false, error }
 */
export function safeValidate<T>(schema: z.ZodSchema<T>, data: unknown) {
  return schema.safeParse(data);
}

/**
 * Type inference helpers
 */
export type ProjectInput = z.infer<typeof ProjectCreateSchema>;
export type TeamInput = z.infer<typeof TeamCreateSchema>;
export type SystemInput = z.infer<typeof SystemCreateSchema>;
export type MilestoneInput = z.infer<typeof MilestoneCreateSchema>;
export type StepInput = z.infer<typeof StepCreateSchema>;
export type GapInput = z.infer<typeof GapCreateSchema>;
export type PolicyInput = z.infer<typeof PolicyCreateSchema>;
export type GlossaryEntryInput = z.infer<typeof GlossaryEntryCreateSchema>;
export type SIPOCInput = z.infer<typeof SIPOCCreateSchema>;
