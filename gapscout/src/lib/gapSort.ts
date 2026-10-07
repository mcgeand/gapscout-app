/**
 * Sorting for the gap list table.
 *
 * Reference: PRD Section 4.7.3 - Gap List View ("Sort: click column headers,
 * default Priority DESC, then Severity").
 *
 * Ranks are natural per column, so a header's asc/desc arrow means what it
 * looks like: severity asc runs Low -> High, priority asc runs 1 -> 5. The
 * PRD's "Priority DESC" is about importance rather than numeric direction --
 * PRIORITY_LABELS makes 1 "Critical" and 5 "Trivial" -- so the default sort is
 * priority ascending, which puts Critical first.
 *
 * Ticket: #161
 */

import type { Gap, GapStatus, RootCauseType, SeverityLevel, TimeToFix } from '../data/types'

export type GapSortColumn =
  | 'id'
  | 'step'
  | 'severity'
  | 'status'
  | 'rootCause'
  | 'ownerTeam'
  | 'priority'
  | 'timeToFix'
  | 'links'

export type GapSortDirection = 'asc' | 'desc'

export interface GapSort {
  column: GapSortColumn
  direction: GapSortDirection
}

export const defaultGapSort: GapSort = { column: 'priority', direction: 'asc' }

const SORT_COLUMNS: readonly GapSortColumn[] = [
  'id',
  'step',
  'severity',
  'status',
  'rootCause',
  'ownerTeam',
  'priority',
  'timeToFix',
  'links',
]

/** Low -> High, so `asc` reads the way the arrow suggests. */
const SEVERITY_RANK: Record<SeverityLevel, number> = { L: 0, M: 1, H: 2 }

/** Workflow order rather than alphabetical. */
const STATUS_RANK: Record<GapStatus, number> = { Open: 0, Review: 1, Closed: 2 }

/** Declaration order from ROOT_CAUSE_LABELS, not alphabetical. */
const ROOT_CAUSE_RANK: Record<RootCauseType, number> = {
  Config: 0,
  Policy: 1,
  Behavior: 2,
  Data: 3,
}

/** Soonest -> longest, matching TIME_TO_FIX_SHORT. */
const TIME_TO_FIX_RANK: Record<TimeToFix, number> = { qwin: 0, near: 1, mid: 2, long: 3 }

/**
 * Cross-store lookups the comparator cannot derive from a Gap alone: step order
 * lives in stepsStore and team names live in teamsStore.
 */
export interface GapSortContext {
  /** Flow position: the owning step's order, or the process gap's own order. */
  stepOrderOf: (gap: Gap) => number | undefined
  /** Display name of the owning team, or undefined when unassigned. */
  teamNameOf: (gap: Gap) => string | undefined
}

type SortKey = number | string | undefined

function sortKey(gap: Gap, column: GapSortColumn, ctx: GapSortContext): SortKey {
  switch (column) {
    // Gap ids are nanoids, so ordering them is meaningless to a reader.
    // The ID column sorts by creation instead, which is what the numbering implies.
    case 'id':
      return gap.createdAt
    case 'step':
      return ctx.stepOrderOf(gap)
    case 'severity':
      return SEVERITY_RANK[gap.severity]
    case 'status':
      return STATUS_RANK[gap.status]
    case 'rootCause':
      return gap.rootCause ? ROOT_CAUSE_RANK[gap.rootCause] : undefined
    case 'ownerTeam':
      return ctx.teamNameOf(gap)?.toLowerCase()
    case 'priority':
      return gap.priority
    case 'timeToFix':
      return gap.timeToFix ? TIME_TO_FIX_RANK[gap.timeToFix] : undefined
    case 'links':
      return gap.links.length
  }
}

/**
 * Compare two keys, treating undefined as "no value".
 * Empty values always sort last, in both directions, so flipping a column never
 * buries the populated rows under a block of blanks.
 */
function compareKeys(a: SortKey, b: SortKey, direction: GapSortDirection): number {
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1

  let result: number
  if (typeof a === 'string' || typeof b === 'string') {
    result = String(a).localeCompare(String(b))
  } else {
    result = a - b
  }

  return direction === 'asc' ? result : -result
}

/**
 * Sort a filtered gap list. Returns a new array; the input is not mutated.
 *
 * Ties fall through to severity (High first) and then newest-first, so the
 * order is total and stable across re-renders even when the chosen column has
 * the same value on many rows.
 */
export function sortGaps(gaps: Gap[], sort: GapSort, ctx: GapSortContext): Gap[] {
  return [...gaps].sort((a, b) => {
    const primary = compareKeys(sortKey(a, sort.column, ctx), sortKey(b, sort.column, ctx), sort.direction)
    if (primary !== 0) return primary

    if (sort.column !== 'severity') {
      const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      if (bySeverity !== 0) return bySeverity
    }

    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
    return a.id.localeCompare(b.id)
  })
}

/**
 * Next sort state when a column header is clicked: a new column starts
 * ascending, the active column flips direction.
 */
export function nextGapSort(current: GapSort, column: GapSortColumn): GapSort {
  if (current.column !== column) return { column, direction: 'asc' }
  return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

/**
 * Validate a persisted sort. localStorage is user-writable and survives
 * releases that rename columns, so anything unrecognised falls back to default.
 */
export function parseGapSort(value: unknown): GapSort {
  if (!value || typeof value !== 'object') return defaultGapSort
  const { column, direction } = value as Partial<GapSort>
  if (!column || !SORT_COLUMNS.includes(column)) return defaultGapSort
  if (direction !== 'asc' && direction !== 'desc') return defaultGapSort
  return { column, direction }
}
