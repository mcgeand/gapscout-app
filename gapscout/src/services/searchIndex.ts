import { getDB } from "./db/connection";
import type {
  SearchEntityType,
  Step,
  Gap,
  Team,
  System,
  Milestone,
  Policy,
  GlossaryEntry,
} from "../data/types";

// ============================================================================
// CONTENT BUILDERS
// Each function concatenates the human-readable fields most useful for search.
// Keep them in sync with any field renames in types.ts.
// ============================================================================

export function buildStepContent(step: Step): string {
  // Comment text is part of the step's searchable content (#366). The thread
  // lives as a JSON array on the step row, and every add/edit/delete writes it
  // back through `stepsStore.updateStep`, which reindexes — so no separate
  // index hook is needed *for writes made from here on*.
  //
  // It does not reach backwards. A comment already sitting in a `comments`
  // column was indexed under the old formula, and nothing re-runs this builder
  // over it: `reindexAllEntities` has no callers, and migration v4's backfill
  // inserts `WHERE NOT EXISTS`, so it skips a step that is already indexed.
  // Such a comment stays unsearchable until its step is next saved. Comments
  // shipped in #157 and the app has never been released, so the rows this
  // strands are only in development databases — migration v10 reindexes every
  // step with this builder so pre-#366 comments become searchable without a save.
  //
  // Only the text is indexed; ids, authors and timestamps are not content a
  // search over the process should match on.
  const commentText = (step.comments ?? []).map((c) => c.text);
  return [step.label, step.trigger, step.result, step.kpi, step.notes, ...commentText]
    .filter(Boolean)
    .join(" ");
}

export function buildGapContent(gap: Gap): string {
  return [gap.observed, gap.expected, gap.fixIdea, gap.rootCause].filter(Boolean).join(" ");
}

export function buildTeamContent(team: Team): string {
  return [team.name, team.description].filter(Boolean).join(" ");
}

export function buildSystemContent(system: System): string {
  return [system.name, system.description, system.vendor].filter(Boolean).join(" ");
}

export function buildMilestoneContent(milestone: Milestone): string {
  return [milestone.name, milestone.description].filter(Boolean).join(" ");
}

export function buildPolicyContent(policy: Policy): string {
  return [policy.title, policy.content, policy.testNotes].filter(Boolean).join(" ");
}

export function buildGlossaryContent(entry: GlossaryEntry): string {
  return [entry.term, entry.definition, entry.acronym].filter(Boolean).join(" ");
}

// ============================================================================
// INDEX OPERATIONS
// FTS5 has no UPDATE — reindexEntity does DELETE then INSERT.
// ============================================================================

export async function indexEntity(
  type: SearchEntityType,
  id: string,
  projectId: string,
  content: string
): Promise<void> {
  const db = getDB();
  await db.execute(
    "INSERT INTO search_index (entity_type, entity_id, project_id, content) VALUES ($1, $2, $3, $4)",
    [type, id, projectId, content]
  );
}

export async function reindexEntity(
  type: SearchEntityType,
  id: string,
  projectId: string,
  content: string
): Promise<void> {
  const db = getDB();
  await db.execute(
    "DELETE FROM search_index WHERE entity_type = $1 AND entity_id = $2",
    [type, id]
  );
  await db.execute(
    "INSERT INTO search_index (entity_type, entity_id, project_id, content) VALUES ($1, $2, $3, $4)",
    [type, id, projectId, content]
  );
}

export async function removeFromIndex(
  type: SearchEntityType,
  id: string
): Promise<void> {
  const db = getDB();
  await db.execute(
    "DELETE FROM search_index WHERE entity_type = $1 AND entity_id = $2",
    [type, id]
  );
}

export async function clearProjectIndex(projectId: string): Promise<void> {
  const db = getDB();
  await db.execute("DELETE FROM search_index WHERE project_id = $1", [projectId]);
}
