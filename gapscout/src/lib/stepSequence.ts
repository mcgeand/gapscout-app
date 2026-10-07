/**
 * Where a step sits in the process.
 *
 * `Step.order` is scoped to its milestone: it numbers the step within that
 * milestone, not within the project. Reading it alone therefore sorts a step in
 * a later milestone ahead of one in an earlier milestone, which is what #299
 * reported. Everything that puts steps in process order — the diagram, both
 * exports, the Discovery grid — ranks by the pair instead.
 *
 * Two steps at the same rank are parallel: they run at the same time, and the
 * grid draws them with `∥`. Nothing here breaks a tie, so a parallel pair keeps
 * one position rather than being forced into an arbitrary sequence.
 */

import type { Milestone } from '../data/types'

/** Sorts anything with no milestone (or an orphaned one) to the end. */
const UNRESOLVED_MILESTONE = Number.POSITIVE_INFINITY

/**
 * Anything that holds a position in the process. `Step` satisfies it; so does a
 * process gap, which reserves an order in the flow the same way a step does and
 * therefore has to rank alongside them rather than on a separate scale.
 */
export interface Sequenced {
  id: string
  milestoneId?: string
  order?: number
}

export type SequenceRank = readonly [milestoneOrder: number, stepOrder: number]

export function rankOf(step: Sequenced, milestoneById: Map<string, Milestone>): SequenceRank {
  const milestoneOrder =
    step.milestoneId === undefined
      ? UNRESOLVED_MILESTONE
      : milestoneById.get(step.milestoneId)?.order ?? UNRESOLVED_MILESTONE
  return [milestoneOrder, step.order ?? UNRESOLVED_MILESTONE]
}

export function compareRank(a: SequenceRank, b: SequenceRank): number {
  return a[0] - b[0] || a[1] - b[1]
}

/** Stable key for a rank, so equal ranks share a column and a Map entry. */
export const rankKey = (rank: SequenceRank) => `${rank[0]}:${rank[1]}`

/** Comparator for `Array.prototype.sort`, for callers holding steps not ranks. */
export function compareSteps(
  a: Sequenced,
  b: Sequenced,
  milestoneById: Map<string, Milestone>
): number {
  return compareRank(rankOf(a, milestoneById), rankOf(b, milestoneById))
}

export function milestonesById(milestones: Milestone[]): Map<string, Milestone> {
  return new Map(milestones.map((milestone) => [milestone.id, milestone]))
}

/**
 * The 1-based position each step holds in the whole process, by step id.
 *
 * Dense, not ordinal: parallel steps share a rank and so share a number, and the
 * number after a parallel pair is the next integer rather than skipping one.
 * This is what the grid's `#` column shows in the All Steps view, where the
 * stored per-milestone `order` restarts at 1 several times over.
 */
export function runningNumbers(
  steps: readonly Sequenced[],
  milestoneById: Map<string, Milestone>
): Map<string, number> {
  const ranks = new Map(steps.map((step) => [step.id, rankOf(step, milestoneById)]))

  const distinctRanks = [
    ...new Map([...ranks.values()].map((rank) => [rankKey(rank), rank])).values(),
  ].sort(compareRank)

  const positionByRank = new Map(
    distinctRanks.map((rank, index) => [rankKey(rank), index + 1])
  )

  return new Map([...ranks].map(([id, rank]) => [id, positionByRank.get(rankKey(rank))!]))
}

/**
 * A gap that reserves a position in the process flow, rather than annotating a
 * step that already occupies one.
 *
 * These sit in the sequence alongside steps — the Discovery grid interleaves
 * them, and the v5 migration ranks them together — so anything that counts the
 * positions a milestone holds has to count these too.
 */
export function isProcessGap(gap: {
  order?: number
  stepId?: string
  status?: string
}): boolean {
  return gap.order !== undefined && !gap.stepId && gap.status !== 'Closed'
}

/**
 * The 1-based process position of every row a user can be shown a number for:
 * the project's steps plus its open process gaps, keyed by id.
 *
 * This is the single accessor for any number that names a position on screen.
 * Reading `step.order` or `gap.order` for that instead prints a per-milestone
 * value that appears nowhere in the grid the moment a project has a second
 * milestone (#345) — which is why `eslint.config.js` bans the bare form.
 *
 * Gaps have to go in alongside steps rather than be numbered separately: a
 * process gap reserves a position in the flow, so leaving it out shifts every
 * number after the first one.
 *
 * Closed process gaps are numbered too, but measured against the flow rather
 * than placed in it, so resolving one does not renumber everything after it.
 *
 * A row absent from the returned map — a step created since the map was built, a
 * gap that annotates a step rather than holding a slot — has no position, so
 * callers fall back to the stored `order` with `?? row.order`.
 */
export function processPositions(
  steps: readonly Sequenced[],
  gaps: readonly (Sequenced & { stepId?: string; status?: string })[],
  milestones: Milestone[]
): Map<string, number> {
  const milestoneById = milestonesById(milestones)
  const flow = [...steps, ...gaps.filter(isProcessGap)]
  const positions = runningNumbers(flow, milestoneById)

  // A closed process gap has left the flow, but it is still a row in the gaps
  // table whenever the Closed filter is off, sitting among rows that do carry a
  // running position. Letting it fall back to its stored `order` there would put
  // a second, differently scaled number in the same column — the very defect
  // this function exists to remove, reintroduced for exactly the rows that
  // filter reveals.
  //
  // So it is measured against the flow rather than inserted into it: nothing
  // after it shifts, and a gap that a step has since filled shares that step's
  // number, which is the truthful answer to "where was this gap".
  const distinctRanks = [
    ...new Map(flow.map((row) => {
      const rank = rankOf(row, milestoneById)
      return [rankKey(rank), rank] as const
    })).values(),
  ].sort(compareRank)

  for (const gap of gaps) {
    if (positions.has(gap.id) || gap.order === undefined || gap.stepId) continue
    positions.set(gap.id, slotAmong(rankOf(gap, milestoneById), distinctRanks))
  }

  return positions
}

/**
 * The position a rank shows without occupying one: the position of the last row
 * at or before it.
 *
 * At-or-before, not after. A closed gap that a step has since filled ties that
 * step's rank and so takes its number, which is where the gap was. A gap nobody
 * filled sits between two rows and takes the earlier one's — "the gap that sat
 * after step 4" — rather than borrowing the number of a row it never stood
 * beside. A rank before every row, and one whose milestone no longer resolves
 * (ranked at infinity, so at-or-before is the last row), clamp to the ends.
 */
function slotAmong(rank: SequenceRank, distinctRanks: readonly SequenceRank[]): number {
  let atOrBefore = 0
  for (const other of distinctRanks) {
    if (compareRank(other, rank) > 0) break
    atOrBefore += 1
  }
  return Math.max(atOrBefore, 1)
}
