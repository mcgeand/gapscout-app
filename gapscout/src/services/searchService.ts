import { getDB } from "./db/connection";
import type { SearchResult, SearchEntityType } from "../data/types";
import {
  indexEntity,
  clearProjectIndex,
  buildStepContent,
  buildGapContent,
  buildTeamContent,
  buildSystemContent,
  buildMilestoneContent,
  buildPolicyContent,
  buildGlossaryContent,
} from "./searchIndex";
import {
  listSteps,
  listGaps,
  listTeams,
  listSystems,
  listMilestones,
  listPolicies,
  listGlossaryEntries,
} from "./db";

interface SearchIndexRow {
  entity_type: string;
  entity_id: string;
  project_id: string;
  content: string;
  rank: number;
}

/**
 * Full-text search across all indexed entities in a project.
 * Returns results ordered by FTS5 rank (most relevant first).
 * Supports partial matches and porter-stemmed terms via the FTS5 MATCH operator.
 */
export async function search(
  query: string,
  projectId: string
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const db = getDB();
  try {
    const rows = await db.select<SearchIndexRow[]>(
      "SELECT entity_type, entity_id, project_id, content, rank FROM search_index WHERE content MATCH $1 AND project_id = $2 ORDER BY rank",
      [query, projectId]
    );
    return rows.map((row) => ({
      entityType: row.entity_type as SearchEntityType,
      entityId: row.entity_id,
      projectId: row.project_id,
      content: row.content,
      rank: row.rank,
    }));
  } catch (err) {
    console.warn("search: FTS5 query failed (likely malformed input):", err);
    return [];
  }
}

/**
 * Rebuild the search index for an entire project from scratch.
 * Clears existing index entries then re-inserts every entity.
 * Call this once per project on first launch to backfill existing databases.
 */
export async function reindexAllEntities(projectId: string): Promise<void> {
  await clearProjectIndex(projectId);

  const [steps, gaps, teams, systems, milestones, policies, glossary] =
    await Promise.all([
      listSteps(projectId),
      listGaps(projectId),
      listTeams(projectId),
      listSystems(projectId),
      listMilestones(projectId),
      listPolicies(projectId),
      listGlossaryEntries(projectId),
    ]);

  await Promise.all([
    ...steps.map((s) => indexEntity("step", s.id, projectId, buildStepContent(s))),
    ...gaps.map((g) => indexEntity("gap", g.id, projectId, buildGapContent(g))),
    ...teams.map((t) => indexEntity("team", t.id, projectId, buildTeamContent(t))),
    ...systems.map((s) =>
      indexEntity("system", s.id, projectId, buildSystemContent(s))
    ),
    ...milestones.map((m) =>
      indexEntity("milestone", m.id, projectId, buildMilestoneContent(m))
    ),
    ...policies.map((p) =>
      indexEntity("policy", p.id, projectId, buildPolicyContent(p))
    ),
    ...glossary.map((g) =>
      indexEntity("glossary", g.id, projectId, buildGlossaryContent(g))
    ),
  ]);
}
