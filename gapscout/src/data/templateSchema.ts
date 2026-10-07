/**
 * The on-disk shape of a process template (`public/templates/*.json`).
 *
 * This is a wire format, not the data model. `schemas.ts` describes entities
 * that already exist in SQLite and carry nanoid ids; a template describes
 * entities that do not exist yet, so every cross-reference is a local `key`
 * the loader resolves to the row it just created. Keys are file-scoped and
 * never persisted.
 *
 * `templateService.ts` is the loader (#146): it parses a file against this
 * schema, resolves every key, and writes the result through `db.ts`.
 *
 * Reference: PRD Section 4.1 (template selection), Appendix D (P2P structure).
 */

import { z } from "zod";
import { MAX_LENGTH } from "./constants";
import {
  GapStatusSchema,
  RootCauseTypeSchema,
  SeverityLevelSchema,
  SystemTypeSchema,
  TimeToFixSchema,
} from "./schemas";

/**
 * A local reference key. Lowercase kebab so a reference reads as a reference
 * rather than as something that might be an id.
 */
const TemplateKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Must be lowercase kebab-case");

export const TemplateTeamSchema = z.strictObject({
  key: TemplateKeySchema,
  name: z.string().min(1).max(MAX_LENGTH.TEAM_NAME),
  // Team colour is user data rather than chrome, so a template ships literal
  // hex exactly as `TeamSchema` stores it. See the DEFAULT_COLORS note in
  // constants.ts.
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  description: z.string().optional(),
  order: z.number().int().min(0),
  tags: z.array(z.string()).default([]),
});

export const TemplateSystemSchema = z.strictObject({
  key: TemplateKeySchema,
  name: z.string().min(1).max(MAX_LENGTH.SYSTEM_NAME),
  description: z.string().optional(),
  vendor: z.string().optional(),
  type: SystemTypeSchema.optional(),
  tags: z.array(z.string()).default([]),
});

export const TemplateMilestoneSchema = z.strictObject({
  key: TemplateKeySchema,
  name: z.string().min(1).max(MAX_LENGTH.MILESTONE_NAME),
  order: z.number().int().min(0),
  description: z.string().optional(),
  relatedPolicyKeys: z.array(TemplateKeySchema).default([]),
});

export const TemplateStepBranchSchema = z.strictObject({
  when: z.string().min(1).max(200),
  toStepKey: TemplateKeySchema,
  label: z.string().max(100).optional(),
});

export const TemplateStepSchema = z.strictObject({
  key: TemplateKeySchema,
  label: z.string().min(1).max(MAX_LENGTH.STEP_LABEL),
  teamKey: TemplateKeySchema,
  milestoneKey: TemplateKeySchema,
  /**
   * Scoped to the milestone, not the process (#299), and dense `1..N` within it
   * — the invariant `sequence.ts` owns, and what `stepsStore.reorderStep`
   * enforces when it rejects an order below 1. A 0-based template looks right
   * until the first insert, when `resealMilestone` renumbers every row.
   *
   * Two steps sharing `(milestoneKey, order)` run in parallel — deliberate where
   * it is authored, a bug where it is not, so `p2pTemplate.test.ts` asserts the
   * P2P file has no ties.
   */
  order: z.number().int().min(1),

  // SIPOC elements. Party names in `customers` are matched literally against
  // the next steps' `suppliers`, both by sipocValidator's chain rule and by
  // graphBuilder's edge builder — a template that spells a hand-off two ways
  // draws no edge and raises a validation warning.
  //
  // One constraint follows from that, and a new template file has to honour it:
  // `validateStep` checks `customers[i]` against the `suppliers` of the next
  // three steps *in the same milestone*. The second-to-last step of a milestone
  // therefore has only the last step to match against, so it must hand to a
  // party that step names as its supplier. Easiest when the last two steps of
  // each milestone belong to the same team, which is how p2p.json is sequenced.
  // A milestone's last step is not chain-checked at all.
  //
  // Bare team names ("Procurement") are safe for the diagram: `createSipocEdges`
  // hands a customer only to the nearest later step naming it (#363).
  suppliers: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  customers: z.array(z.string()).default([]),

  /** System *names*, matching what the Discovery grid writes, not system keys. */
  systems: z.array(z.string()).default([]),
  trigger: z.string().optional(),
  result: z.string().optional(),
  kpi: z.string().optional(),

  decision: z.boolean().optional(),
  branches: z.array(TemplateStepBranchSchema).optional(),

  notes: z.string().optional(),
});

export const TemplatePolicySchema = z.strictObject({
  key: TemplateKeySchema,
  title: z.string().min(1).max(MAX_LENGTH.POLICY_TITLE),
  content: z.string().min(1),
  sourceDoc: z.string().optional(),
  relatedMilestoneKeys: z.array(TemplateKeySchema).default([]),
  testNotes: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const TemplateGapSchema = z.strictObject({
  key: TemplateKeySchema,
  /** Omitted for a process-level gap, exactly as `Gap.stepId` is. */
  stepKey: TemplateKeySchema.optional(),
  observed: z.string().min(1).max(MAX_LENGTH.GAP_OBSERVED),
  expected: z.string().min(1).max(MAX_LENGTH.GAP_EXPECTED),
  severity: SeverityLevelSchema,
  priority: z.number().int().min(1).max(5).optional(),
  rootCause: RootCauseTypeSchema.optional(),
  ownerTeamKey: TemplateKeySchema.optional(),
  fixIdea: z.string().optional(),
  timeToFix: TimeToFixSchema.optional(),
  status: GapStatusSchema,
});

export const TemplateGlossaryEntrySchema = z.strictObject({
  key: TemplateKeySchema,
  term: z.string().min(1).max(MAX_LENGTH.GLOSSARY_TERM),
  definition: z.string().min(1),
  acronym: z.string().optional(),
  relatedStepKeys: z.array(TemplateKeySchema).default([]),
  tags: z.array(z.string()).default([]),
});

export const TemplateSipocSchema = z.strictObject({
  suppliers: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  process: z.string(),
  outputs: z.array(z.string()).default([]),
  customers: z.array(z.string()).default([]),
});

export const ProcessTemplateSchema = z.strictObject({
  /** Matches the filename stem, so `templates/p2p.json` has id `p2p`. */
  id: TemplateKeySchema,
  name: z.string().min(1).max(MAX_LENGTH.PROJECT_NAME),
  description: z.string().min(1),
  /**
   * Bumped when the shape changes in a way a loader has to branch on. Content
   * edits do not bump it.
   */
  version: z.literal(1),

  sipoc: TemplateSipocSchema.optional(),
  teams: z.array(TemplateTeamSchema).min(1),
  systems: z.array(TemplateSystemSchema).default([]),
  milestones: z.array(TemplateMilestoneSchema).min(1),
  steps: z.array(TemplateStepSchema).min(1),
  policies: z.array(TemplatePolicySchema).default([]),
  gaps: z.array(TemplateGapSchema).default([]),
  glossary: z.array(TemplateGlossaryEntrySchema).default([]),
});

export type TemplateTeam = z.infer<typeof TemplateTeamSchema>;
export type TemplateSystem = z.infer<typeof TemplateSystemSchema>;
export type TemplateMilestone = z.infer<typeof TemplateMilestoneSchema>;
export type TemplateStepBranch = z.infer<typeof TemplateStepBranchSchema>;
export type TemplateStep = z.infer<typeof TemplateStepSchema>;
export type TemplatePolicy = z.infer<typeof TemplatePolicySchema>;
export type TemplateGap = z.infer<typeof TemplateGapSchema>;
export type TemplateGlossaryEntry = z.infer<typeof TemplateGlossaryEntrySchema>;
export type TemplateSipoc = z.infer<typeof TemplateSipocSchema>;
export type ProcessTemplate = z.infer<typeof ProcessTemplateSchema>;

/**
 * Every way a template can be internally inconsistent while still matching the
 * schema: a key that points at nothing, a duplicate key, a step order that
 * collides or skips.
 *
 * Zod cannot express these — they are relationships between arrays — so they
 * live here rather than in a `.superRefine`, where they would be unreachable
 * to a caller that wants to report them all at once.
 *
 * @returns One message per problem; empty means the template is coherent.
 */
export function findTemplateReferenceErrors(template: ProcessTemplate): string[] {
  const errors: string[] = [];

  const duplicates = (label: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) errors.push(`Duplicate ${label}: ${key}`);
      seen.add(key);
    }
    return new Set(keys);
  };

  const teamKeys = duplicates("team key", template.teams.map((t) => t.key));
  duplicates("system key", template.systems.map((s) => s.key));
  // Steps reference systems by *name* (see `TemplateStep.systems`), so two
  // systems sharing a name make the reference ambiguous even with distinct keys.
  duplicates("system name", template.systems.map((s) => s.name));
  const milestoneKeys = duplicates("milestone key", template.milestones.map((m) => m.key));
  const stepKeys = duplicates("step key", template.steps.map((s) => s.key));
  const policyKeys = duplicates("policy key", template.policies.map((p) => p.key));
  duplicates("gap key", template.gaps.map((g) => g.key));
  duplicates("glossary key", template.glossary.map((g) => g.key));

  const require = (present: boolean, message: string) => {
    if (!present) errors.push(message);
  };

  const systemNames = new Set(template.systems.map((s) => s.name));

  for (const step of template.steps) {
    require(teamKeys.has(step.teamKey), `Step "${step.key}" names unknown team "${step.teamKey}"`);
    require(
      milestoneKeys.has(step.milestoneKey),
      `Step "${step.key}" names unknown milestone "${step.milestoneKey}"`,
    );
    for (const branch of step.branches ?? []) {
      require(
        stepKeys.has(branch.toStepKey),
        `Step "${step.key}" branches to unknown step "${branch.toStepKey}"`,
      );
    }
    // `Step.systems` carries names because that is what the grid writes, so a
    // typo here is invisible everywhere except this check.
    for (const name of step.systems) {
      require(systemNames.has(name), `Step "${step.key}" names unknown system "${name}"`);
    }
    // Both directions: a decision with no branches has nothing to route, and
    // branches without `decision` still draw their dashed edges in
    // `createSipocEdges` while `createNodes` renders a plain step — arrows out
    // of a node that is not a diamond.
    require(
      !step.decision || (step.branches?.length ?? 0) > 0,
      `Step "${step.key}" is a decision point with no branches`,
    );
    require(
      (step.branches?.length ?? 0) === 0 || step.decision === true,
      `Step "${step.key}" has branches but is not marked as a decision point`,
    );
  }

  // The policy↔milestone association is stored on both entities independently,
  // so nothing but a check in each direction keeps them from disagreeing — a
  // half-link shows on one screen and not the other.
  for (const milestone of template.milestones) {
    for (const key of milestone.relatedPolicyKeys) {
      require(
        policyKeys.has(key),
        `Milestone "${milestone.key}" names unknown policy "${key}"`,
      );
      require(
        template.policies
          .find((p) => p.key === key)
          ?.relatedMilestoneKeys.includes(milestone.key) ?? false,
        `Milestone "${milestone.key}" claims policy "${key}", which does not claim it back`,
      );
    }
  }

  for (const policy of template.policies) {
    for (const key of policy.relatedMilestoneKeys) {
      require(
        milestoneKeys.has(key),
        `Policy "${policy.key}" names unknown milestone "${key}"`,
      );
      require(
        template.milestones
          .find((m) => m.key === key)
          ?.relatedPolicyKeys.includes(policy.key) ?? false,
        `Policy "${policy.key}" claims milestone "${key}", which does not claim it back`,
      );
    }
  }

  for (const gap of template.gaps) {
    if (gap.stepKey !== undefined) {
      require(stepKeys.has(gap.stepKey), `Gap "${gap.key}" names unknown step "${gap.stepKey}"`);
    }
    if (gap.ownerTeamKey !== undefined) {
      require(
        teamKeys.has(gap.ownerTeamKey),
        `Gap "${gap.key}" names unknown owner team "${gap.ownerTeamKey}"`,
      );
    }
  }

  for (const entry of template.glossary) {
    for (const key of entry.relatedStepKeys) {
      require(stepKeys.has(key), `Glossary entry "${entry.key}" names unknown step "${key}"`);
    }
  }

  errors.push(...findOrderErrors(template));

  return errors;
}

/**
 * Both axes of `(milestone.order, step.order)`.
 *
 * Step order is milestone-scoped and dense `1..N`; a tie means parallel work, so
 * a template that ties by accident declares sequential prose to be parallel —
 * the SIPOC wizard bug (#169, #216) shipped as data.
 *
 * Milestone order is project-scoped and 0-based, which is what `MilestoneManager`
 * writes and what #131's `UNIQUE (project_id, "order")` requires. A duplicate
 * there ties two milestones' ranks, and `graphBuilder.assignColumns` then folds
 * their steps into shared columns.
 */
function findOrderErrors(template: ProcessTemplate): string[] {
  const errors: string[] = [];

  const milestoneOrders = template.milestones.map((m) => m.order).sort((a, b) => a - b);
  if (milestoneOrders.some((order, index) => order !== index)) {
    errors.push(
      `Milestone orders are not 0..n-1 without gaps or ties: [${milestoneOrders.join(", ")}]`,
    );
  }

  for (const milestone of template.milestones) {
    const orders = template.steps
      .filter((step) => step.milestoneKey === milestone.key)
      .map((step) => step.order)
      .sort((a, b) => a - b);

    if (orders.length === 0) {
      errors.push(`Milestone "${milestone.key}" has no steps`);
      continue;
    }

    if (orders.some((order, index) => order !== index + 1)) {
      errors.push(
        `Milestone "${milestone.key}" step orders are not 1..N without gaps or ties: ` +
          `[${orders.join(", ")}]`,
      );
    }
  }

  return errors;
}
