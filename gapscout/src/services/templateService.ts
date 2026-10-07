/**
 * Loading a process template from `public/templates/*.json` and seeding a
 * project from it (#146).
 *
 * Three stages, kept apart so each is reachable on its own:
 *
 * - `parseTemplate` turns unknown JSON into a `ProcessTemplate` or throws. No
 *   I/O, so a caller can check a template it already has in hand.
 * - `materializeTemplate` mints an id per keyed entity and rewrites every
 *   `*Key` reference to the id it minted. Pure, and the app's entity schemas
 *   accept the result — `p2pTemplate.test.ts` is what holds it to that.
 * - `applyTemplate` writes the result through `db.ts`, so `search_index` is
 *   maintained by the same code every other create path uses.
 *
 * Reference: PRD Section 4.1 (Project Setup Screen — Template Selection).
 */

import { nanoid } from "nanoid";

import {
  ProcessTemplateSchema,
  findTemplateReferenceErrors,
  type ProcessTemplate,
} from "../data/templateSchema";
import type {
  Gap,
  GlossaryEntry,
  Milestone,
  Policy,
  ProjectState,
  SIPOC,
  Step,
  System,
  Team,
} from "../data/types";
import {
  createGap,
  createGlossaryEntry,
  createMilestone,
  createPolicy,
  createProject,
  createStep,
  createSystem,
  createTeam,
  deleteProject,
  resetProjectUpdatedAt,
  upsertSipoc,
} from "./db";
import { logger } from "../lib/logger";

/**
 * What the project-setup dropdown needs to offer a template *before* fetching it.
 *
 * Just the two fields: the description shown once a template is chosen comes from
 * the file itself, so repeating it here would be a second copy to keep in step.
 */
export interface TemplateSummary {
  id: string;
  name: string;
}

/**
 * The templates the app offers.
 *
 * Held here rather than derived by listing `public/` because the bundled
 * frontend has no directory listing to read. `templateService.test.ts` asserts
 * every entry has a file whose `id` and `name` match, so the two cannot drift;
 * #147 and #148 each add one entry alongside their JSON.
 */
export const TEMPLATE_CATALOG: readonly TemplateSummary[] = [{ id: "p2p", name: "Procure-to-Pay" }];

/**
 * Parse and check a template read from disk or the network.
 *
 * `ProcessTemplateSchema` covers each entity on its own; the cross-array
 * relationships — dangling keys, duplicates, order density — are what
 * `findTemplateReferenceErrors` carries, and both have to pass before anything
 * is written.
 *
 * @throws If the JSON does not match the schema or is internally inconsistent.
 */
export function parseTemplate(raw: unknown): ProcessTemplate {
  const template = ProcessTemplateSchema.parse(raw);

  const errors = findTemplateReferenceErrors(template);
  if (errors.length > 0) {
    throw new Error(`Template "${template.id}" is inconsistent: ${errors.join("; ")}`);
  }

  return template;
}

/**
 * Fetch a catalogued template from the app's static assets.
 *
 * The id is looked up in `TEMPLATE_CATALOG` first, so the fetched path is always
 * one this build ships rather than anything a caller supplies.
 */
export async function loadTemplate(id: string): Promise<ProcessTemplate> {
  if (!TEMPLATE_CATALOG.some((entry) => entry.id === id)) {
    throw new Error(`Unknown template "${id}"`);
  }

  const response = await fetch(`/templates/${id}.json`);
  if (!response.ok) {
    throw new Error(`Could not load template "${id}": ${response.status} ${response.statusText}`);
  }

  return parseTemplate(await response.json());
}

/** A template with every key resolved to the id it will be stored under. */
export interface MaterializedTemplate {
  projectId: string;
  teams: Team[];
  systems: System[];
  milestones: Milestone[];
  steps: Step[];
  policies: Policy[];
  gaps: Gap[];
  glossary: GlossaryEntry[];
  sipoc?: SIPOC;
  stepIdByKey: Map<string, string>;
}

/**
 * Key → id, exactly once per entity, then every reference rewritten.
 *
 * Step ids are minted before any step is built, because a decision branch can
 * point at a step that appears later in the file (or earlier, for a rework loop).
 */
export function materializeTemplate(
  template: ProcessTemplate,
  projectId: string,
): MaterializedTemplate {
  const now = Date.now();

  const teamIdByKey = new Map(template.teams.map((team) => [team.key, nanoid()]));
  const milestoneIdByKey = new Map(template.milestones.map((m) => [m.key, nanoid()]));
  const policyIdByKey = new Map(template.policies.map((p) => [p.key, nanoid()]));
  const stepIdByKey = new Map(template.steps.map((step) => [step.key, nanoid()]));

  const teams: Team[] = template.teams.map((team) => ({
    id: teamIdByKey.get(team.key)!,
    projectId,
    name: team.name,
    color: team.color,
    description: team.description,
    order: team.order,
    tags: team.tags,
    createdAt: now,
  }));

  const systems: System[] = template.systems.map((system) => ({
    id: nanoid(),
    projectId,
    name: system.name,
    description: system.description,
    vendor: system.vendor,
    type: system.type,
    tags: system.tags,
    createdAt: now,
  }));

  const milestones: Milestone[] = template.milestones.map((milestone) => ({
    id: milestoneIdByKey.get(milestone.key)!,
    projectId,
    name: milestone.name,
    order: milestone.order,
    description: milestone.description,
    relatedPolicies: milestone.relatedPolicyKeys.map((key) => policyIdByKey.get(key)!),
    createdAt: now,
    updatedAt: now,
  }));

  const steps: Step[] = template.steps.map((step) => ({
    id: stepIdByKey.get(step.key)!,
    projectId,
    label: step.label,
    teamId: teamIdByKey.get(step.teamKey)!,
    milestoneId: milestoneIdByKey.get(step.milestoneKey)!,
    order: step.order,
    suppliers: step.suppliers,
    inputs: step.inputs,
    outputs: step.outputs,
    customers: step.customers,
    systems: step.systems,
    trigger: step.trigger,
    result: step.result,
    kpi: step.kpi,
    decision: step.decision,
    branches: step.branches?.map((branch) => ({
      when: branch.when,
      toStepId: stepIdByKey.get(branch.toStepKey)!,
      label: branch.label,
    })),
    notes: step.notes,
    comments: [],
    links: [],
    gapIds: [],
    createdAt: now,
    updatedAt: now,
  }));

  const policies: Policy[] = template.policies.map((policy) => ({
    id: policyIdByKey.get(policy.key)!,
    projectId,
    title: policy.title,
    content: policy.content,
    sourceDoc: policy.sourceDoc,
    relatedMilestones: policy.relatedMilestoneKeys.map((key) => milestoneIdByKey.get(key)!),
    testNotes: policy.testNotes,
    tags: policy.tags,
    createdAt: now,
    updatedAt: now,
  }));

  const gaps: Gap[] = template.gaps.map((gap) => ({
    id: nanoid(),
    projectId,
    stepId: gap.stepKey === undefined ? undefined : stepIdByKey.get(gap.stepKey)!,
    observed: gap.observed,
    expected: gap.expected,
    severity: gap.severity,
    priority: gap.priority,
    rootCause: gap.rootCause,
    ownerTeamId: gap.ownerTeamKey === undefined ? undefined : teamIdByKey.get(gap.ownerTeamKey)!,
    fixIdea: gap.fixIdea,
    timeToFix: gap.timeToFix,
    status: gap.status,
    links: [],
    createdAt: now,
    updatedAt: now,
  }));

  const glossary: GlossaryEntry[] = template.glossary.map((entry) => ({
    id: nanoid(),
    projectId,
    term: entry.term,
    definition: entry.definition,
    acronym: entry.acronym,
    relatedSteps: entry.relatedStepKeys.map((key) => stepIdByKey.get(key)!),
    tags: entry.tags,
    createdAt: now,
  }));

  const sipoc: SIPOC | undefined = template.sipoc && { projectId, ...template.sipoc };

  return {
    projectId,
    teams,
    systems,
    milestones,
    steps,
    policies,
    gaps,
    glossary,
    sipoc,
    stepIdByKey,
  };
}

/** The project fields the caller owns; the template supplies everything else. */
export interface TemplateProjectDetails {
  name: string;
  description?: string;
  state?: ProjectState;
}

/**
 * Create a project and seed it from a template.
 *
 * Writes run in foreign-key order — teams and milestones before the steps that
 * name them, steps before the gaps hung off them — and go through `db.ts` so
 * every row lands in `search_index` the same way a hand-created one does.
 *
 * Deliberately **not** wrapped in a transaction: on the desktop build
 * `@tauri-apps/plugin-sql` pools connections, so `BEGIN` and `COMMIT` can land
 * on different ones — the writes autocommit anyway and the orphaned `BEGIN`
 * locks the pool for the rest of the session (#236). A failure here deletes the
 * project instead, which `ON DELETE CASCADE` turns into a clean removal of
 * whatever had already landed.
 *
 * Each `create*` call is handed the materialized entity and its id separately.
 * The entity also carries `createdAt`/`updatedAt`, which `db.ts` ignores in
 * favour of its own `Date.now()` — so the stored timestamps are the write time,
 * not the materialize time, and the two differ by however long the seed took.
 *
 * @returns The new project's id.
 */
export async function applyTemplate(
  template: ProcessTemplate,
  project: TemplateProjectDetails,
): Promise<string> {
  // Trimmed here rather than left to the caller, because this path does not go
  // through `projectStore.createProject`, which is where every other create
  // trims — and `updateProject` now treats a whitespace-only difference as a
  // rename that clears `legacy_name` (#265).
  const name = project.name.trim();
  if (name.length === 0) throw new Error("Project name is required");

  const projectId = await createProject({
    name,
    description: project.description?.trim(),
    state: project.state,
  });

  try {
    const seeded = materializeTemplate(template, projectId);

    for (const team of seeded.teams) await createTeam(team, team.id);
    for (const system of seeded.systems) await createSystem(system, system.id);
    for (const milestone of seeded.milestones) await createMilestone(milestone, milestone.id);
    for (const policy of seeded.policies) await createPolicy(policy, policy.id);
    for (const step of seeded.steps) await createStep(step, step.id);
    for (const gap of seeded.gaps) await createGap(gap, gap.id);
    for (const entry of seeded.glossary) await createGlossaryEntry(entry, entry.id);
    if (seeded.sipoc) await upsertSipoc(seeded.sipoc);

    // Seeding a template is not editing the project. Every create above moved
    // its `updated_at` (#395), so without this the card calls a project
    // "Edited" before anyone has opened it. Inside the try on purpose: a reset
    // that fails leaves the project misreporting itself, and the cleanup below
    // is the same answer this path already gives a seed that half landed.
    await resetProjectUpdatedAt(projectId);

    return projectId;
  } catch (error) {
    // Best effort: report the original failure whatever the cleanup does, or the
    // user is told about a delete that failed rather than the seed that did.
    try {
      await deleteProject(projectId);
    } catch (cleanupError) {
      logger.error("Failed to remove a partially seeded project", cleanupError);
    }
    throw error;
  }
}
