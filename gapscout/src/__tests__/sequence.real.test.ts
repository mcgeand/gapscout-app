/**
 * The sequence module against real SQL.
 *
 * Twenty-two issues in two days came from every mutation implementing its own
 * shift, its own read of "current state" and its own failure handling (#353).
 * These cases are the contract that replaces them, and they run against sql.js
 * rather than a mock because the failures they describe — a gap left on a
 * step's order, a second deletion measured against a stale array, a torn
 * two-table write — are all about what is actually in the database afterwards.
 *
 * The adapter's `execute` is spied on where a criterion is about what reaches
 * SQLite rather than what the store ends up holding.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGap,
  createStep,
  deleteGap,
  deleteStep,
  getGap,
  getStep,
  listGaps,
  listSteps,
  runMigrations,
  SCHEMA_SQL,
} from '../services/db'
import { setDB } from '../services/db/connection'
import {
  countPositions,
  moveWithinMilestone,
  nextPosition,
  openSlot,
  planAppend,
  planMove,
  planOpenSlot,
  planReseal,
  resealMilestone,
  toSequenceRows,
  withMilestoneSequence,
  type SequenceRow,
} from '../lib/sequence'
import { SqlJsTestAdapter } from './helpers/sqlJsTestAdapter'

const PROJECT = 'project-1'
const MILESTONE = 'milestone-1'
const OTHER_MILESTONE = 'milestone-2'

async function createAdapter(): Promise<SqlJsTestAdapter> {
  const adapter = new SqlJsTestAdapter()
  await adapter.initialize()
  await adapter.execute(SCHEMA_SQL)
  await runMigrations(adapter)
  setDB(adapter)
  return adapter
}

const stepBase = {
  projectId: PROJECT,
  teamId: 'team-1',
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  decision: false,
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
}

const gapBase = {
  projectId: PROJECT,
  observed: 'Observed state',
  expected: 'Expected state',
  severity: 'H' as const,
  links: [],
}

function makeStep(label: string, order: number, milestoneId = MILESTONE) {
  return createStep({ ...stepBase, label, order, milestoneId })
}

function makeProcessGap(order: number, milestoneId = MILESTONE) {
  return createGap({ ...gapBase, status: 'Open', order, milestoneId })
}

/** Every position the milestone holds, as `id → order`, read back from SQLite. */
async function readSequence(milestoneId = MILESTONE): Promise<Record<string, number>> {
  const rows = toSequenceRows(await listSteps(PROJECT), await listGaps(PROJECT), milestoneId)
  return Object.fromEntries(rows.map(row => [row.id, row.order]))
}

describe('lib/sequence — the plans', () => {
  const rows = (...pairs: [string, number][]): SequenceRow[] =>
    pairs.map(([id, order]) => ({ id, kind: id.startsWith('g') ? 'gap' : 'step', order }))

  it('closes a hole and reports only the rows that move', () => {
    expect(planReseal(rows(['s1', 1], ['s2', 3], ['s3', 4]))).toEqual([
      { id: 's2', kind: 'step', from: 3, to: 2 },
      { id: 's3', kind: 'step', from: 4, to: 3 },
    ])
  })

  it('writes nothing for a milestone that is already dense', () => {
    expect(planReseal(rows(['s1', 1], ['g1', 2], ['s2', 3]))).toEqual([])
  })

  /**
   * #304 and #351. A tie is parallel work, and a dense rank keeps it: the pair
   * holds one position between them and the row after takes the next integer.
   */
  it('keeps a parallel pair sharing one position, and does not skip the next', () => {
    expect(planReseal(rows(['s1', 1], ['s2', 2], ['s3', 2], ['s4', 3]))).toEqual([])
    expect(planReseal(rows(['s1', 1], ['s2', 2], ['s3', 2], ['s4', 4]))).toEqual([
      { id: 's4', kind: 'step', from: 4, to: 3 },
    ])
  })

  it('opens a slot by pushing the position at `at` and everything above it up', () => {
    expect(planOpenSlot(rows(['s1', 1], ['s2', 2], ['s3', 3]), 2)).toEqual([
      { id: 's2', kind: 'step', from: 2, to: 3 },
      { id: 's3', kind: 'step', from: 3, to: 4 },
    ])
  })

  it('opens a slot against the resealed sequence, not the stored one', () => {
    // Stored 1, 4, 5 is really positions 1, 2, 3. Opening at 2 must give
    // 1, 3, 4 — one hole, at 2 — rather than compounding the existing one.
    expect(planOpenSlot(rows(['s1', 1], ['s2', 4], ['s3', 5]), 2)).toEqual([
      { id: 's2', kind: 'step', from: 4, to: 3 },
      { id: 's3', kind: 'step', from: 5, to: 4 },
    ])
  })

  it('moves a parallel pair together when the slot opens beneath them', () => {
    expect(planOpenSlot(rows(['s1', 1], ['s2', 2], ['s3', 2]), 2)).toEqual([
      { id: 's2', kind: 'step', from: 2, to: 3 },
      { id: 's3', kind: 'step', from: 2, to: 3 },
    ])
  })

  it('moves a row down to the position the user typed, not one short', () => {
    // The reason `moveWithinMilestone` exists rather than openSlot + reseal:
    // opening at 5 leaves the row's own hole at 2 for the reseal to close,
    // which drags the row down to 4.
    const moved = planMove(rows(['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4], ['s5', 5]), 's2', 5)
    expect(moved).toEqual([
      { id: 's2', kind: 'step', from: 2, to: 5 },
      { id: 's3', kind: 'step', from: 3, to: 2 },
      { id: 's4', kind: 'step', from: 4, to: 3 },
      { id: 's5', kind: 'step', from: 5, to: 4 },
    ])
  })

  it('moves a row up and slides the band it displaces down', () => {
    expect(planMove(rows(['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4]), 's4', 2)).toEqual([
      { id: 's2', kind: 'step', from: 2, to: 3 },
      { id: 's3', kind: 'step', from: 3, to: 4 },
      { id: 's4', kind: 'step', from: 4, to: 2 },
    ])
  })

  /**
   * The band is measured in POSITIONS, not stored orders, and holed milestones
   * are where the two part company. `{A:1, B:3, C:5}` holds three positions, so
   * `countPositions` lets the user type 3 — and computing the displaced band
   * against the stored orders landed A at position 2 instead of last, one short
   * of the number they typed. Pre-existing databases carry holes, and #169's
   * wizard ties make more.
   */
  it('lands a move on the position typed even when the milestone has holes', () => {
    const holed = rows(['s1', 1], ['s2', 3], ['s3', 5])
    expect(planMove(holed, 's1', 3)).toEqual([
      { id: 's1', kind: 'step', from: 1, to: 3 },
      { id: 's2', kind: 'step', from: 3, to: 1 },
      { id: 's3', kind: 'step', from: 5, to: 2 },
    ])
    // And moving up out of a hole is the same story from the other side. `s2`
    // is absent because its stored 3 already equals its target position — the
    // compute-then-diff rule, so it is not written.
    expect(planMove(holed, 's3', 1)).toEqual([
      { id: 's1', kind: 'step', from: 1, to: 2 },
      { id: 's3', kind: 'step', from: 5, to: 1 },
    ])
  })

  /** #307 at the reorder site: the band covers gaps as well as steps. */
  it('carries the process gaps in the displaced band', () => {
    expect(planMove(rows(['s1', 1], ['g1', 2], ['s2', 3]), 's2', 1)).toEqual([
      { id: 's1', kind: 'step', from: 1, to: 2 },
      { id: 'g1', kind: 'gap', from: 2, to: 3 },
      { id: 's2', kind: 'step', from: 3, to: 1 },
    ])
  })

  it('appends past the highest stored order, not past the position count', () => {
    // A parallel pair holds one position between them, so counting rows would
    // skip a slot: 1, 2, 2 appends at 3.
    expect(planAppend(rows(['s1', 1], ['s2', 2], ['s3', 2]))).toBe(3)
    expect(planAppend([])).toBe(1)
    // And a milestone with a hole holds two positions but reaches order 3, so
    // counting POSITIONS would append straight on top of the row already at 3
    // — a tie the reseal then preserves as parallel work by design (#304).
    expect(planAppend(rows(['s1', 1], ['s2', 3]))).toBe(4)
  })

  it('counts the positions a milestone holds, for the typed-order ceiling', () => {
    // The other half of the pair above: the ceiling is what the grid shows, so
    // a parallel pair counts once and a hole does not inflate the range (#299).
    expect(countPositions(rows(['s1', 1], ['s2', 2], ['s3', 2]))).toBe(2)
    expect(countPositions(rows(['s1', 1], ['s2', 3]))).toBe(2)
    expect(countPositions([])).toBe(0)
  })
})

describe('lib/sequence — against real SQL', () => {
  let adapter: SqlJsTestAdapter

  beforeEach(async () => {
    adapter = await createAdapter()
  })

  afterEach(async () => {
    await adapter.close()
  })

  /**
   * The compute-then-diff criterion, asserted on the adapter rather than on
   * state. The write primitives stamp `updated_at` unconditionally, so a blind
   * `UPDATE … CASE` would rewrite every row of a correct milestone.
   */
  it('issues no UPDATE when the milestone is already dense', async () => {
    await makeStep('One', 1)
    await makeProcessGap(2)
    await makeStep('Three', 3)

    const execute = vi.spyOn(adapter, 'execute')
    const result = await resealMilestone(PROJECT, MILESTONE)

    expect(result.changes).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  /**
   * The predicate is `isProcessGap` and nothing else. Migration v5 ranks on
   * `order_num IS NOT NULL`, which counts these two; a reseal that did the same
   * would hand one a position and leave a hole where the grid draws nothing.
   */
  it('never gives a closed or step-attached gap a position', async () => {
    const step = await makeStep('One', 1)
    const attachedStep = await makeStep('Two', 4)
    const closed = await createGap({ ...gapBase, status: 'Closed', order: 2, milestoneId: MILESTONE })
    const attached = await createGap({
      ...gapBase,
      status: 'Open',
      order: 3,
      milestoneId: MILESTONE,
      stepId: attachedStep,
    })

    await resealMilestone(PROJECT, MILESTONE)

    // Two steps at 1 and 4 are positions 1 and 2; the two invisible gaps take
    // part in neither the ranking nor the write.
    expect((await getStep(step))?.order).toBe(1)
    expect((await getStep(attachedStep))?.order).toBe(2)
    expect((await getGap(closed))?.order).toBe(2)
    expect((await getGap(attached))?.order).toBe(3)
  })

  /** #341: deleting a step above a process gap moves the gap with everything else. */
  it('moves a process gap down when the step below it is deleted', async () => {
    const first = await makeStep('One', 1)
    const doomed = await makeStep('Two', 2)
    const gap = await makeProcessGap(3)
    const last = await makeStep('Four', 4)

    await deleteStep(doomed, PROJECT)
    await resealMilestone(PROJECT, MILESTONE)

    expect(await readSequence()).toEqual({ [first]: 1, [gap]: 2, [last]: 3 })
  })

  /** #312: the gap-deletion mirror — the steps above a deleted gap come down. */
  it('moves the steps down when the process gap below them is deleted', async () => {
    const first = await makeStep('One', 1)
    const gap = await makeProcessGap(2)
    const third = await makeStep('Three', 3)

    await deleteGap(gap, PROJECT)
    await resealMilestone(PROJECT, MILESTONE)

    expect(await readSequence()).toEqual({ [first]: 1, [third]: 2 })
  })

  /**
   * #339: two deletions in one milestone. The second is measured against the
   * live sequence the first one left, which is exactly what a caller holding a
   * pre-deletion array could not do.
   */
  it('lands the second of two deletions correctly', async () => {
    const keep1 = await makeStep('One', 1)
    const doomed1 = await makeStep('Two', 2)
    const keep2 = await makeStep('Three', 3)
    const doomed2 = await makeStep('Four', 4)
    const keep3 = await makeStep('Five', 5)

    await deleteStep(doomed1, PROJECT)
    await resealMilestone(PROJECT, MILESTONE)
    await deleteStep(doomed2, PROJECT)
    await resealMilestone(PROJECT, MILESTONE)

    expect(await readSequence()).toEqual({ [keep1]: 1, [keep2]: 2, [keep3]: 3 })
  })

  /**
   * #351. Deleting one of a parallel pair must not move the survivor or
   * anything above it — the pair held one position and the survivor still does.
   * Deleting both is the case that closes the hole.
   */
  it('leaves the survivor of a parallel pair, and everything above it, alone', async () => {
    const first = await makeStep('One', 1)
    const twinA = await makeStep('Two A', 2)
    const twinB = await makeStep('Two B', 2)
    const third = await makeStep('Three', 3)

    await deleteStep(twinA, PROJECT)
    await resealMilestone(PROJECT, MILESTONE)

    expect(await readSequence()).toEqual({ [first]: 1, [twinB]: 2, [third]: 3 })

    await deleteStep(twinB, PROJECT)
    await resealMilestone(PROJECT, MILESTONE)

    expect(await readSequence()).toEqual({ [first]: 1, [third]: 2 })
  })

  it('reseals one milestone without touching another', async () => {
    const here = await makeStep('Here', 3)
    const there = await makeStep('There', 3, OTHER_MILESTONE)
    const thereToo = await makeStep('There too', 7, OTHER_MILESTONE)

    await resealMilestone(PROJECT, MILESTONE)

    expect((await getStep(here))?.order).toBe(1)
    expect((await getStep(there))?.order).toBe(3)
    expect((await getStep(thereToo))?.order).toBe(7)
  })

  it('opens a slot for an insert and leaves the sequence dense around it', async () => {
    const first = await makeStep('One', 1)
    const second = await makeStep('Two', 2)
    const gap = await makeProcessGap(3)

    await openSlot(PROJECT, MILESTONE, 2)
    const inserted = await makeStep('Inserted', 2)
    await resealMilestone(PROJECT, MILESTONE)

    expect(await readSequence()).toEqual({
      [first]: 1,
      [inserted]: 2,
      [second]: 3,
      [gap]: 4,
    })
  })

  it('moves a step down to the order the user typed, carrying the gap it passes', async () => {
    const first = await makeStep('One', 1)
    const moving = await makeStep('Two', 2)
    const gap = await makeProcessGap(3)
    const fourth = await makeStep('Four', 4)

    await moveWithinMilestone(PROJECT, MILESTONE, moving, 4)

    expect(await readSequence()).toEqual({
      [first]: 1,
      [gap]: 2,
      [fourth]: 3,
      [moving]: 4,
    })
  })

  it('reorders to the typed position on a milestone that already has holes', async () => {
    const first = await makeStep('One', 1)
    const second = await makeStep('Three', 3)
    const third = await makeStep('Five', 5)

    // Three positions, so 3 is in range; the move must put "One" last.
    await moveWithinMilestone(PROJECT, MILESTONE, first, 3)

    expect(await readSequence()).toEqual({ [second]: 1, [third]: 2, [first]: 3 })
  })

  it('appends after the last position a milestone holds, counting gaps', async () => {
    await makeStep('One', 1)
    await makeProcessGap(2)
    expect(await nextPosition(PROJECT, MILESTONE)).toBe(3)
    expect(await nextPosition(PROJECT, OTHER_MILESTONE)).toBe(1)
  })

  /**
   * An append onto a milestone that already has a hole must not land on a row
   * that is already there. Counting positions rather than the stored maximum
   * put the new step on the occupied order, and because the reseal preserves
   * ties by design (#304) the pair then read as a parallel branch nobody asked
   * for — the module producing the exact corruption it exists to prevent.
   */
  it('does not append onto an occupied order when the milestone has a hole', async () => {
    const first = await makeStep('One', 1)
    const third = await makeStep('Three', 3)

    const appended = await makeStep('Appended', await nextPosition(PROJECT, MILESTONE))
    await resealMilestone(PROJECT, MILESTONE)

    expect(await readSequence()).toEqual({ [first]: 1, [third]: 2, [appended]: 3 })
  })

  /**
   * The compensation path. The Tauri adapter has no transaction primitive
   * (#236), so the two writes can tear; because the plan carries each
   * row's old order, the undo is an exact restore rather than a counter-shift.
   */
  it('restores the step write exactly when the gap write throws', async () => {
    const first = await makeStep('One', 1)
    const second = await makeStep('Two', 4)
    const gap = await makeProcessGap(6)

    const before = await readSequence()

    const execute = vi.spyOn(adapter, 'execute')
    let seenGapWrite = false
    execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('UPDATE gaps') && !seenGapWrite) {
        seenGapWrite = true
        throw new Error('gap write failed')
      }
      return adapter.constructor.prototype.execute.call(adapter, sql, params)
    })

    await expect(resealMilestone(PROJECT, MILESTONE)).rejects.toThrow('gap write failed')
    execute.mockRestore()

    expect(await readSequence()).toEqual(before)
    expect((await getStep(first))?.order).toBe(1)
    expect((await getStep(second))?.order).toBe(4)
    expect((await getGap(gap))?.order).toBe(6)
  })

  /**
   * Two opens for the SAME position is the one race that cannot fail: both
   * plans are identical, so the second write is a no-op. Kept as the contrast
   * that shows the cases below are not passing vacuously.
   */
  it('opens one slot, not two, when two inserts race for the same position', async () => {
    const first = await makeStep('One', 1)
    const second = await makeStep('Two', 2)
    const third = await makeStep('Three', 3)

    await Promise.all([openSlot(PROJECT, MILESTONE, 2), openSlot(PROJECT, MILESTONE, 2)])

    expect(await readSequence()).toEqual({ [first]: 1, [second]: 3, [third]: 4 })
  })

  /**
   * The races the lock exists for. All three end in a TIE without it, and a tie
   * is preserved by design (#304) — so nothing downstream ever heals it and the
   * grid draws parallel work nobody asked for.
   *
   * The mechanism is the change from a RELATIVE shift to an ABSOLUTE one. Two
   * interleaved `"order" = "order" + 1` writes compose: they over-shift and
   * leave a hole, which a reseal closes. Two absolute writes computed from one
   * snapshot are a lost update — the second overwrites rather than composing.
   */
  describe('serialised against each other', () => {
    /** Each caller opens its slot and fills it, as `openSlotForInsert` does. */
    const insertAt = (at: number, label: string) =>
      withMilestoneSequence(PROJECT, [MILESTONE], async () => {
        await openSlot(PROJECT, MILESTONE, at)
        await makeStep(label, at)
      })

    it('keeps two inserts at different positions off each other', async () => {
      await makeStep('One', 1)
      await makeStep('Two', 2)
      await makeStep('Three', 3)
      await makeStep('Four', 4)

      // Unserialised, the second open dense-ranks first and closes the first
      // one's hole, so the first caller's row lands on an occupied order.
      await Promise.all([insertAt(2, 'New at two'), insertAt(4, 'New at four')])

      const orders = Object.values(await readSequence()).sort((a, b) => a - b)
      expect(orders).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('keeps a closer out of the window between an open and its write', async () => {
      await makeStep('One', 1)
      await makeStep('Two', 2)
      await makeStep('Three', 3)

      // The window between an open and its write is where a closer's reseal
      // does the damage, so the test holds it open rather than hoping the
      // scheduler lands there. Note this case asserts the ORDERING the lock
      // imposes rather than discriminating on its own: releasing the gate
      // before awaiting the closer is what avoids a deadlock when the lock is
      // present, and that same release lets the unlocked run finish first by
      // luck. The two cases either side of it are the ones that fail without
      // the lock.
      let fillTheSlot!: () => void
      const windowOpen = new Promise<void>(resolve => {
        fillTheSlot = resolve
      })
      const insert = withMilestoneSequence(PROJECT, [MILESTONE], async () => {
        await openSlot(PROJECT, MILESTONE, 2)
        await windowOpen
        await makeStep('Inserted', 2)
      })
      // Queued behind the insert by the lock.
      const closer = withMilestoneSequence(PROJECT, [MILESTONE], () =>
        resealMilestone(PROJECT, MILESTONE)
      )
      fillTheSlot()
      await Promise.all([insert, closer])

      const orders = Object.values(await readSequence()).sort((a, b) => a - b)
      expect(orders).toEqual([1, 2, 3, 4])
    })

    /**
     * An open racing a reseal on a milestone that merely HAS a hole, with
     * nothing inserted at all. Two operations each provably correct alone, and
     * two absolute writes from one snapshot that disagree about order 3.
     */
    it('keeps an open and a reseal off each other on a holed milestone', async () => {
      const first = await makeStep('One', 1)
      const second = await makeStep('Two', 2)
      const third = await makeStep('Four', 4)

      await Promise.all([
        withMilestoneSequence(PROJECT, [MILESTONE], () => openSlot(PROJECT, MILESTONE, 2)),
        withMilestoneSequence(PROJECT, [MILESTONE], () => resealMilestone(PROJECT, MILESTONE)),
      ])

      const sequence = await readSequence()
      const orders = Object.values(sequence).sort((a, b) => a - b)
      // Whichever ran second decides the layout, but no two rows may share a
      // position: unserialised this lands `Two` and `Four` both on 3.
      expect(new Set(orders).size).toBe(3)
      expect(sequence[first]).toBeLessThan(sequence[second])
      expect(sequence[second]).toBeLessThan(sequence[third])
    })

    /**
     * The mover is the third absolute writer beside the reseal and the open,
     * and it plans from a snapshot the same way — so a typed reorder racing a
     * reseal is the same lost update, and both its call sites take the lock.
     */
    it('keeps a typed reorder and a reseal off each other on a holed milestone', async () => {
      const first = await makeStep('One', 1)
      const second = await makeStep('Two', 2)
      const third = await makeStep('Four', 4)

      await Promise.all([
        withMilestoneSequence(PROJECT, [MILESTONE], () =>
          moveWithinMilestone(PROJECT, MILESTONE, third, 1)
        ),
        withMilestoneSequence(PROJECT, [MILESTONE], () => resealMilestone(PROJECT, MILESTONE)),
      ])

      const sequence = await readSequence()
      const orders = Object.values(sequence).sort((a, b) => a - b)
      expect(new Set(orders).size).toBe(3)
      expect(orders).toEqual([1, 2, 3])
      // Whichever ran second decides, but the move must not be undone by a
      // reseal writing stale positions over it.
      expect(sequence[third]).toBeLessThan(sequence[first])
      expect(sequence[first]).toBeLessThan(sequence[second])
    })

    /**
     * Deadlock-freedom, which is the property a two-key lock has to earn: both
     * callers name the same pair in opposite orders, and the keys are acquired
     * together in sorted order, so neither can hold half of what the other
     * needs. Without that this test hangs rather than failing.
     */
    it('serialises two cross-milestone moves in opposite directions', async () => {
      await makeStep('A1', 1)
      await makeStep('B1', 1, OTHER_MILESTONE)

      await Promise.all([
        withMilestoneSequence(PROJECT, [MILESTONE, OTHER_MILESTONE], async () => {
          await openSlot(PROJECT, OTHER_MILESTONE, 1)
          await makeStep('A moved', 1, OTHER_MILESTONE)
        }),
        withMilestoneSequence(PROJECT, [OTHER_MILESTONE, MILESTONE], async () => {
          await openSlot(PROJECT, MILESTONE, 1)
          await makeStep('B moved', 1)
        }),
      ])

      for (const milestone of [MILESTONE, OTHER_MILESTONE]) {
        const orders = Object.values(await readSequence(milestone)).sort((a, b) => a - b)
        expect(new Set(orders).size).toBe(orders.length)
      }
    })
  })

  /** Clause 6: a failed write surfaces rather than being reported and swallowed. */
  it('throws rather than reporting a failure and returning normally', async () => {
    await makeStep('One', 1)
    await makeStep('Three', 3)

    const execute = vi.spyOn(adapter, 'execute').mockRejectedValue(new Error('disk full'))
    // Reseal has a hole to close and openSlot has two rows to push, so both
    // reach the adapter — a plan with no changes would pass this vacuously.
    await expect(resealMilestone(PROJECT, MILESTONE)).rejects.toThrow('disk full')
    await expect(openSlot(PROJECT, MILESTONE, 1)).rejects.toThrow('disk full')
    execute.mockRestore()
  })
})
