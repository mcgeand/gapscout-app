/**
 * A one-table stand-in for SQLite, for the jsdom tests around sequence writes.
 *
 * `lib/sequence` reads the milestone's live rows from the database rather than
 * from a store (#353) — a list captured before the mutation describes a layout
 * that no longer exists, which is #339, #336, #261 and #352 with one cause. So
 * a component test that seeds only the Zustand stores gives the reseal an empty
 * milestone and asserts nothing.
 *
 * This wires the `db` mocks a component test already has into a mutable pair of
 * arrays, so a delete really removes a row and an order write really moves one,
 * and the next read sees it. What the assertions then check is the sequence the
 * component actually produced, not the arguments it happened to pass.
 */

import type { Mock } from 'vitest'
import type { Gap, Step } from '../../data/types'

export interface SequenceDb {
  /** The steps as they now stand, in insertion order. */
  steps: () => Step[]
  /** The gaps as they now stand, in insertion order. */
  gaps: () => Gap[]
  /** Replace the contents, e.g. between cases in one file. */
  reset: (steps: Step[], gaps: Gap[]) => void
}

export interface SequenceDbMocks {
  listSteps: Mock
  listGaps: Mock
  setStepOrders?: Mock
  setGapOrders?: Mock
  deleteStep?: Mock
  deleteGap?: Mock
}

type Assignment = { id: string; order: number }

/**
 * Point `mocks` at a mutable pair of arrays seeded with `steps` and `gaps`.
 *
 * Only the handful of operations a sequence write touches are modelled. Reads
 * hand back copies, so a component holding a returned row cannot mutate the
 * store behind the test's back — the same guarantee the real adapter gives.
 */
export function wireSequenceDb(
  mocks: SequenceDbMocks,
  steps: Step[] = [],
  gaps: Gap[] = []
): SequenceDb {
  let stepRows: Step[] = steps.map(step => ({ ...step }))
  let gapRows: Gap[] = gaps.map(gap => ({ ...gap }))

  mocks.listSteps.mockImplementation(async () => stepRows.map(step => ({ ...step })))
  mocks.listGaps.mockImplementation(async () => gapRows.map(gap => ({ ...gap })))

  mocks.setStepOrders?.mockImplementation(async (_projectId: string, assignments: Assignment[]) => {
    const byId = new Map(assignments.map(a => [a.id, a.order]))
    stepRows = stepRows.map(step =>
      byId.has(step.id) ? { ...step, order: byId.get(step.id)! } : step
    )
  })

  mocks.setGapOrders?.mockImplementation(async (_projectId: string, assignments: Assignment[]) => {
    const byId = new Map(assignments.map(a => [a.id, a.order]))
    gapRows = gapRows.map(gap => (byId.has(gap.id) ? { ...gap, order: byId.get(gap.id)! } : gap))
  })

  mocks.deleteStep?.mockImplementation(async (id: string) => {
    stepRows = stepRows.filter(step => step.id !== id)
  })

  mocks.deleteGap?.mockImplementation(async (id: string) => {
    gapRows = gapRows.filter(gap => gap.id !== id)
  })

  return {
    steps: () => stepRows.map(step => ({ ...step })),
    gaps: () => gapRows.map(gap => ({ ...gap })),
    reset: (nextSteps, nextGaps) => {
      stepRows = nextSteps.map(step => ({ ...step }))
      gapRows = nextGaps.map(gap => ({ ...gap }))
    },
  }
}

/**
 * The milestone's sequence as `(order, label)` pairs, sorted, for an assertion
 * that reads like the grid does.
 */
export function sequenceOf(db: SequenceDb, milestoneId: string): Array<[number, string]> {
  return [
    ...db.steps().filter(s => s.milestoneId === milestoneId).map((s): [number, string] => [s.order, s.label]),
    ...db
      .gaps()
      .filter(g => g.milestoneId === milestoneId && !g.stepId && g.status !== 'Closed' && g.order !== undefined)
      .map((g): [number, string] => [g.order!, g.observed]),
  ].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
}
