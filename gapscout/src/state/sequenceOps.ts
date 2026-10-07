/**
 * The store-facing half of `lib/sequence`.
 *
 * `lib/sequence` owns the arithmetic and reads the database directly, which is
 * what keeps it free of any `state/` import and therefore free of a cycle with
 * the stores that call it. What it deliberately does not do is the three things
 * that have to happen around every sequence write and that live up here:
 *
 * 1. **Reload.** The module writes to SQLite without touching the stores, so a
 *    caller that skipped the reload would repaint the pre-mutation orders over
 *    the new ones. Reload rather than an optimistic patch, for the reason #295
 *    settled: painting a clean sequence over a torn write would hide it.
 * 2. **Re-sync the gaps.** An order change re-decides "is first", "is last" and
 *    every chain check for the whole milestone (#291, #344), so
 *    `resyncGapsAfterStepWrite` runs once per resealed milestone — once, not
 *    per row, which is what #107 opened on.
 * 3. **Say which milestones.** A cross-milestone move is two milestones, and
 *    the origin has to be captured before the write because afterwards the step
 *    only knows its destination (#335).
 *
 * Every mutation site in the app calls one of the two functions here and
 * computes no shift of its own. That is the whole of #353: the twenty-two
 * order-corruption issues before it each fixed one site's arithmetic and
 * exposed the next site's.
 */

import { openSlot, resealMilestone, withMilestoneSequence } from '../lib/sequence'
import { logger } from '../lib/logger'
import { resyncGapsAfterStepWrite } from './gapResync'
import { useGapsStore } from './gapsStore'
import { useStepsStore } from './stepsStore'
import { isProjectScopeCurrent, type ProjectScopeToken } from './workspaceScope'

interface SequenceOpOptions {
  projectId: string
  /**
   * Which milestones the mutation touched. Duplicates and empty ids are
   * dropped, so a caller can pass `[origin, destination]` without checking
   * whether the move actually crossed a boundary.
   */
  milestoneIds: readonly (string | undefined)[]
  /** The scope captured before the mutation, so a project switch aborts the UI half. */
  scope?: ProjectScopeToken
  /**
   * Whether to re-run gap validation wording for the resealed milestones.
   *
   * On by default, and deliberately not conditional on the reseal having moved
   * anything: deleting the last step of a milestone moves no orders at all, yet
   * the step below it has just become "last" and its validation flips (#344).
   *
   * Off where the caller already re-syncs the step it edited and a milestone-
   * wide pass would only duplicate it — `StepEditModal` on a save that stays in
   * one milestone.
   */
  resync?: boolean
}

export interface SequenceOpResult {
  /** Gaps whose wording the re-sync rewrote, across every resealed milestone. */
  syncedCount: number
}

const distinctMilestones = (ids: readonly (string | undefined)[]): string[] =>
  [...new Set(ids.filter((id): id is string => !!id))]

/**
 * Reload the stores and bring every affected milestone's gap wording up to date.
 *
 * Deliberately after the reload, and deliberately not gated on the write having
 * changed anything: a delete changes what its siblings are missing even when it
 * moved no orders at all.
 */
async function reloadAndResync({
  projectId,
  milestoneIds,
  scope,
  resync = true,
}: SequenceOpOptions): Promise<SequenceOpResult> {
  let syncedCount = 0

  await useStepsStore.getState().loadSteps(projectId)
  if (scope && !isProjectScopeCurrent(scope)) return { syncedCount }
  await useGapsStore.getState().loadGaps(projectId)
  if (scope && !isProjectScopeCurrent(scope)) return { syncedCount }
  if (!resync) return { syncedCount }

  for (const milestoneId of distinctMilestones(milestoneIds)) {
    // Never throws by contract, and must not: by the time it runs the sequence
    // write has committed, so failing the caller here would report a mutation
    // that actually succeeded.
    const result = await resyncGapsAfterStepWrite({
      stepId: '',
      projectId,
      milestoneWide: true,
      fallbackMilestoneId: milestoneId,
    })
    syncedCount += result.syncedCount
    if (scope && !isProjectScopeCurrent(scope)) return { syncedCount }
  }

  return { syncedCount }
}

/**
 * Close the holes a completed mutation left, then reload and re-sync.
 *
 * Every closer calls this and nothing else: delete, multi-delete, gap delete,
 * cancel-new-row, closing or attaching a gap, and the source side of a
 * cross-milestone move.
 *
 * The reseal itself is **not** gated on the project still being open. The row
 * this closes up after is already gone, so finishing the sequence is right even
 * if the user has navigated away; only the reload and the re-sync are skipped,
 * because those lists now belong to another project (#348).
 *
 * Throws on a failed write. The caller has to know — reporting a torn sequence
 * through a toast and returning normally is how #349 happened one layer down.
 *
 * **A two-milestone reseal is not compensated across the pair.** Each milestone
 * is resealed in turn, so if the origin's write lands and the destination's
 * throws, the origin stays rewritten and the caller sees a failure. That is
 * deliberate rather than overlooked: the Tauri adapter has no transaction
 * primitive (#236), so a cross-milestone undo would be a third
 * uncompensated write rather than a rollback. The two milestones are
 * independent sequences — neither is made wrong by the other being resealed —
 * so the failure leaves one correct milestone and one untouched, and the caller
 * reloads from the database rather than repainting (#295). The compensation
 * that does exist is inside a single milestone's write, where a torn pair of
 * tables would leave a tie.
 */
export async function resealAfterMutation(
  options: SequenceOpOptions
): Promise<SequenceOpResult> {
  const milestoneIds = distinctMilestones(options.milestoneIds)

  // Serialised against every other sequence operation on these milestones. A
  // reseal landing between an opener's `openSlot` and its row write closes the
  // slot the opener is about to use, and the row then lands on an occupied
  // order — a tie, which is preserved by design and never healed.
  await withMilestoneSequence(options.projectId, milestoneIds, async () => {
    for (const milestoneId of milestoneIds) {
      await resealMilestone(options.projectId, milestoneId)
    }
  })

  if (options.scope && !isProjectScopeCurrent(options.scope)) return { syncedCount: 0 }
  return reloadAndResync(options)
}

/**
 * Make room at `at` in one milestone for a row about to be written there.
 *
 * Openers call this, write their row at `at`, then `resealAfterMutation`. The
 * reload here is what lets the caller read the shifted orders back before it
 * writes; the gap re-sync is deferred to the reseal that follows, because the
 * sequence is deliberately holed between the two and re-syncing against a hole
 * would word every gap in the milestone against a layout that lasts one await.
 *
 * On failure the slot is not opened and nothing has been written, so the caller
 * can abandon its insert cleanly — unlike the compensated multi-write it
 * replaces, which could leave the milestone half shifted.
 */
export async function openSlotForInsert({
  projectId,
  milestoneId,
  at,
  scope,
  write,
  alsoLock,
}: {
  projectId: string
  milestoneId: string
  at: number
  scope?: ProjectScopeToken
  /**
   * The row write this slot is being opened for, run **inside the lock**.
   *
   * The window between opening a slot and filling it is the one a concurrent
   * operation corrupts: another opener dense-ranks first and closes the hole, a
   * closer's reseal does the same, and the row then lands on an occupied order.
   * Passing the write here is what makes open-and-fill one operation.
   *
   * `write` must not call `resealAfterMutation`, `openSlotForInsert`, or
   * `withMilestoneSequence` on the same milestone: the lock is not re-entrant
   * and will hang forever (#484). Keep the write a bare create/update.
   *
   * Omitted only by the Discovery grid's insert tray, whose row is not written
   * until the user saves — a window no lock can span. Correctness there comes
   * from Save re-opening the slot under this lock before it writes.
   */
  write?: () => Promise<void>
  /** A second milestone the write also touches — the origin of a move. */
  alsoLock?: string
}): Promise<void> {
  await withMilestoneSequence(projectId, [milestoneId, alsoLock], async () => {
    await openSlot(projectId, milestoneId, at)
    if (scope && !isProjectScopeCurrent(scope)) {
      // The slot was opened for a row that is never going to be written. Close
      // it again rather than leaving a hole in a project the user has left: the
      // reseal is the exact inverse and needs nothing remembered to run.
      try {
        await resealMilestone(projectId, milestoneId)
      } catch (error) {
        logger.error('Failed to close a slot opened for an abandoned insert', error)
      }
      return
    }
    if (write) await write()
  })

  if (scope && !isProjectScopeCurrent(scope)) return
  await reloadAndResync({ projectId, milestoneIds: [milestoneId], scope, resync: false })
}
