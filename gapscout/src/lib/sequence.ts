/**
 * One owner for a milestone's step-and-gap sequence.
 *
 * The invariant, stated once so no call site has to restate it:
 *
 * > After any mutation, a milestone's steps and ordered process gaps form one
 * > dense sequence `1..N` over `(milestone_id, "order")` — except that rows
 * > deliberately sharing an order are parallel and stay so.
 *
 * Order is scoped to the milestone (#299). A process gap occupies a position
 * exactly as a step does (#307, #312), and "process gap" means `isProcessGap`
 * and nothing else: a closed or step-attached gap holds no position, so handing
 * one an order would put a row in the sequence the grid never draws.
 *
 * Twenty-two issues in two days came from every insert, delete, cancel, reorder
 * and gap-delete implementing its own shift, its own read of "current state"
 * and its own failure handling (#353). Each fix corrected one site and exposed
 * the next. This module is the single place that arithmetic lives.
 *
 * ## Two shapes of operation
 *
 * A dense re-rank preserves ties by the #304 decision, so it can close a hole
 * but it cannot open a slot. Insert-at-N, a typed reorder to N and GapForm's
 * "Place Before" all *start* by needing room at N. So there are openers and
 * closers, and every site is one or the other:
 *
 * - **Openers** call `openSlot` (or `nextPosition` to append), write their row,
 *   then `resealMilestone`.
 * - **Closers** do their delete or status change, then `resealMilestone`.
 * - A typed move is both at once, which is why `moveWithinMilestone` exists
 *   rather than being composed at the call site: `openSlot` then reseal moves a
 *   downward drag one short, because the reseal closes the hole the row left
 *   behind and drags the row down with it.
 *
 * ## Why it reads the database
 *
 * Every operation here reads the milestone's live rows from SQLite rather than
 * accepting an array from the caller. A list captured before the mutation
 * describes a layout that no longer exists — that is #339, #336, #261 and #352,
 * four issues with one cause. Reading here also keeps this module free of any
 * `state/` import, so the stores can depend on it without a cycle; the store
 * reload and the gap re-sync that follow a write live in `state/sequenceOps`.
 *
 * ## Why it computes in TypeScript and diffs
 *
 * The write primitives stamp `updated_at` unconditionally, so a blind
 * `UPDATE … CASE` over a milestone that is already dense would rewrite every
 * row and bump every timestamp. Planning in TypeScript and writing only the
 * rows whose order actually changes makes "reseal an already-correct milestone"
 * a genuine no-op — nothing reaches the adapter at all.
 *
 * It also makes compensation exact. The Tauri adapter has no transaction
 * primitive (#236), so a two-table write can tear. Because the plan carries
 * each row's old order as well as its new one, a failed second write is undone
 * by re-issuing the first table's *old* values, rather than by guessing a
 * counter-shift the way a threshold-based undo has to.
 *
 * The pure half lives here and is exported so the ranking can be tested without
 * a database; the effectful half is at the bottom of the file.
 */

import type { Gap, Step } from '../data/types'
import { listGaps, listSteps, setGapOrders, setStepOrders } from '../services/db'
import { logger } from './logger'
import { isProcessGap } from './stepSequence'

/** Which table a row lives in, so a plan can be split into two writes. */
export type SequenceKind = 'step' | 'gap'

/** A row that holds a position in one milestone's sequence. */
export interface SequenceRow {
  id: string
  kind: SequenceKind
  order: number
}

/** One row's move, carrying the old order so the write can be undone exactly. */
export interface OrderChange {
  id: string
  kind: SequenceKind
  from: number
  to: number
}

export interface ResealResult {
  /** Every row whose order the reseal moved. Empty when it was already dense. */
  changes: OrderChange[]
}

/**
 * Rows in sequence order, ties kept adjacent and in a stable order.
 *
 * Sorting on `order` alone leaves the relative order of a tied pair up to the
 * sort's stability across two different input lists (steps and gaps arrive
 * separately). Breaking the tie on `kind` then `id` makes the rank a pure
 * function of its input, which is what lets the "already dense" check be an
 * equality test rather than a heuristic.
 */
function inSequenceOrder(rows: readonly SequenceRow[]): SequenceRow[] {
  return [...rows].sort(
    (a, b) => a.order - b.order || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
  )
}

/** The changes needed to turn `rows` into the orders `target` assigns them. */
function diff(rows: readonly SequenceRow[], target: ReadonlyMap<string, number>): OrderChange[] {
  const changes: OrderChange[] = []
  for (const row of rows) {
    const to = target.get(row.id)
    if (to === undefined || to === row.order) continue
    changes.push({ id: row.id, kind: row.kind, from: row.order, to })
  }
  return changes
}

/**
 * The dense 1..N position each row lands on, by id.
 *
 * Dense, not ordinal, and that distinction is the whole of #304 and #351: two
 * rows sharing an order run in parallel and keep one position between them, and
 * the row after a parallel pair takes the next integer rather than skipping
 * one. So deleting one of a pair leaves the survivor exactly where it was and
 * moves nothing above it, while deleting both closes the hole.
 */
function denseRank(rows: readonly SequenceRow[]): Map<string, number> {
  const positions = new Map<string, number>()

  let position = 0
  let previousOrder: number | undefined
  for (const row of inSequenceOrder(rows)) {
    if (row.order !== previousOrder) {
      position += 1
      previousOrder = row.order
    }
    positions.set(row.id, position)
  }

  return positions
}

/** Close every hole in `rows`, keeping ties. */
export function planReseal(rows: readonly SequenceRow[]): OrderChange[] {
  return diff(rows, denseRank(rows))
}

/**
 * Dense-rank `rows` while leaving position `at` empty for a row about to be
 * written there.
 *
 * The slot is opened against the *resealed* sequence, not the stored one: a
 * milestone that already has a hole would otherwise open a second, and the
 * caller's `at` is a position the user is reading off a dense grid.
 *
 * A row already sitting at `at` moves up, which is what makes an insert an
 * insert. Its parallel twin, if it has one, moves with it — they share a
 * position, so they stay sharing one.
 */
export function planOpenSlot(rows: readonly SequenceRow[], at: number): OrderChange[] {
  const ranked = denseRank(rows)
  const target = new Map(
    [...ranked].map(([id, position]) => [id, position >= at ? position + 1 : position])
  )
  return diff(rows, target)
}

/**
 * Move one row to position `to`, sliding the rows it displaces the other way.
 *
 * Moving one half of a parallel pair can leave the row it displaces tied to the
 * surviving twin. That is the reorder twin of #351's deletion case and is
 * unchanged from the band shift this replaces, which produced the same layout —
 * what a move out of a parallel pair should mean is a product decision no issue
 * has made.
 *
 * The band arithmetic is the one `reorderSteps` already used and users already
 * know: moving up pushes `[to, from - 1]` down a slot, moving down pulls
 * `[from + 1, to]` up one. What changes is that the band now covers process
 * gaps as well as steps, which is #307 at the reorder site.
 *
 * **It is computed in positions, not stored orders**, and the two are only the
 * same on a dense milestone. `to` is a position — it is what the user typed
 * against the numbers the grid shows, and `countPositions` is what bounds it —
 * so measuring the band it displaces in stored orders mixes two scales. On
 * `{A:1, B:3, C:5}` that put a move of A to 3 at position 2 instead of last:
 * the row landed one short of the number the user typed, which is the #299
 * complaint from a third direction. Holed milestones are real — pre-existing
 * databases carry them, and #169's wizard ties make more.
 *
 * A `to` beyond the last position lands on the last position rather than
 * opening a hole past the end. Callers still range-check `to` first, because
 * silently clamping a typed number is what #299 opened on — this is the floor
 * under that check, not a replacement.
 */
export function planMove(rows: readonly SequenceRow[], id: string, to: number): OrderChange[] {
  const ranked = denseRank(rows)
  const from = ranked.get(id)
  if (from === undefined) return []
  if (from === to) return planReseal(rows)

  const movingUp = to < from
  const low = movingUp ? to : from + 1
  const high = movingUp ? from - 1 : to
  const delta = movingUp ? 1 : -1

  const target = new Map<string, number>()
  for (const [rowId, position] of ranked) {
    if (rowId === id) target.set(rowId, to)
    else if (position >= low && position <= high) target.set(rowId, position + delta)
    else target.set(rowId, position)
  }

  // Reported against the ORIGINAL orders: the positions above are the scale the
  // plan is computed in, but what the caller writes has to be measured against
  // what the database currently holds.
  return diff(rows, target)
}

/**
 * The order a row appended to the end of `rows` should take.
 *
 * One past the highest order actually stored, not one past the number of
 * positions. The two agree only on a dense milestone, and a holed one is
 * exactly where the difference bites: `{1, 3}` holds two positions, so counting
 * them appends at 3 — straight on top of the row already there, and the reseal
 * then preserves that tie as parallel work by design (#304). Counting rows
 * instead would skip a slot after a parallel pair, so neither count works;
 * the stored maximum does.
 */
export function planAppend(rows: readonly SequenceRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.order), 0) + 1
}

/**
 * How many positions the milestone holds — the ceiling for a typed order.
 *
 * Positions, not rows: a parallel pair holds one between them, so `1, 2, 2` is
 * a milestone of two and typing 3 into it is out of range. This is the number
 * `reorderSteps` refuses an edit against (#299), and it is deliberately not
 * `planAppend() - 1`: on a holed milestone the two disagree, and the range
 * check is about what the grid is showing rather than what is stored.
 */
export function countPositions(rows: readonly SequenceRow[]): number {
  return new Set(rows.map(row => row.order)).size
}

// ============================================================================
// SERIALISATION
// ============================================================================

/**
 * One in-flight sequence operation per milestone at a time.
 *
 * The lock this restores (`insertionLocks`, deleted with the shift it guarded)
 * did something narrower than its name suggested: it was released before the
 * caller's row write, and its effect was to make a second concurrent insert
 * *fail loudly* rather than interleave. Dropping it looked safe because two
 * `openSlot` calls for the same position plan the same thing — but that is the
 * one case that cannot fail, and the others do:
 *
 * - Two opens at DIFFERENT positions. The second dense-ranks before it opens,
 *   so it closes the first one's hole; the first caller's row then lands on an
 *   occupied order.
 * - A closer's reseal landing between an `openSlot` and its row write. Same
 *   outcome, from the other side.
 * - An `openSlot` racing a reseal on a milestone that merely *has* a hole, with
 *   nothing inserted at all: two absolute writes from one snapshot disagree.
 *
 * The mechanism is worth naming, because it is what changed. The old primitive
 * was a RELATIVE shift (`"order" = "order" + 1`), and two interleaved relative
 * shifts compose — they over-shift and leave a hole, which a reseal closes. The
 * plan-and-diff writes ABSOLUTE values computed from a snapshot, so a stale read
 * no longer double-shifts, it overwrites. That turns the old benign hole into a
 * tie — and a tie is preserved by design (#304), so nothing downstream ever
 * heals it. The grid draws parallel work nobody asked for.
 *
 * Keys are acquired for every milestone at once and in sorted order, so two
 * cross-milestone moves in opposite directions cannot deadlock: there is no
 * partial acquisition to hold.
 *
 * All three effectful writers are covered — the reseal and the open through
 * `state/sequenceOps`, the mover at its two call sites, which take the lock
 * themselves because `GapForm`'s spans a move and the write that re-asserts it.
 *
 * The map is never evicted: one settled promise per `project:milestone` for the
 * life of the process. That is a handful of entries on a local desktop app with
 * one project open, so a reaper would cost more than it saves.
 *
 * **Not re-entrant.** Calling this again for the same key from inside `fn` —
 * directly, or via `openSlotForInsert` / `resealAfterMutation` — waits on
 * `held`, which only resolves when the outer `fn` returns. That hang is silent
 * and permanent for the rest of the process (#484).
 */
const milestoneChains = new Map<string, Promise<unknown>>()

/**
 * Run `fn` with exclusive access to the named milestones' sequence locks.
 *
 * See the `milestoneChains` comment above: the lock is not re-entrant. Nesting
 * another acquisition for the same milestone from inside `fn` hangs forever.
 */
export function withMilestoneSequence<T>(
  projectId: string,
  milestoneIds: readonly (string | undefined)[],
  fn: () => Promise<T>
): Promise<T> {
  const keys = [...new Set(milestoneIds.filter((id): id is string => !!id))]
    .map(milestoneId => `${projectId}:${milestoneId}`)
    .sort()
  if (keys.length === 0) return fn()

  // Read the tails and install the new one in one synchronous block, so a
  // second caller entering later cannot miss this operation.
  const priors = keys.map(key => milestoneChains.get(key) ?? Promise.resolve())
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  for (const key of keys) milestoneChains.set(key, held)

  // A nested acquisition on the same key waits here forever. Surface that in
  // dev so a stuck dialog becomes a console line (#484).
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  if (import.meta.env.DEV) {
    stallTimer = setTimeout(() => {
      console.error(
        `[sequence] withMilestoneSequence still waiting on ${keys.join(', ')} after 5s — nested lock on the same milestone?`
      )
    }, 5000)
  }

  const run = Promise.allSettled(priors).then(() => {
    if (stallTimer !== undefined) clearTimeout(stallTimer)
    return fn()
  })
  // Released either way: a failed operation must not wedge the milestone, and
  // the chain stores `held` rather than `run` so a rejection cannot poison it.
  void run.then(release, release)
  return run
}

// ============================================================================
// EFFECTFUL OPERATIONS
// ============================================================================

/** The milestone's live rows, read from the database rather than from a store. */
async function readMilestoneRows(
  projectId: string,
  milestoneId: string
): Promise<SequenceRow[]> {
  const [steps, gaps] = await Promise.all([listSteps(projectId), listGaps(projectId)])
  return toSequenceRows(steps, gaps, milestoneId)
}

/**
 * The rows of one milestone that hold a position, from full project lists.
 *
 * Exported so a caller that has already read the project (and the tests) can
 * build the same view without a second round trip, and so the `isProcessGap`
 * predicate is applied in exactly one place.
 */
export function toSequenceRows(
  steps: readonly Step[],
  gaps: readonly Gap[],
  milestoneId: string
): SequenceRow[] {
  const rows: SequenceRow[] = []

  for (const step of steps) {
    if (step.milestoneId !== milestoneId) continue
    rows.push({ id: step.id, kind: 'step', order: step.order })
  }

  for (const gap of gaps) {
    // `isProcessGap` and nothing else. The v5 migration ranks on
    // `order_num IS NOT NULL`, which counts closed and step-attached gaps; a
    // reseal that did the same would hand one of those a position and leave a
    // visible hole in the grid where the row is never drawn.
    if (gap.milestoneId !== milestoneId || !isProcessGap(gap)) continue
    rows.push({ id: gap.id, kind: 'gap', order: gap.order! })
  }

  return rows
}

/**
 * Persist a plan: at most one statement per table, steps first.
 *
 * **The write order is a choice, and the second write is compensated.** Neither
 * order is safe on its own — a gap sitting above a step in the moved range
 * strands on a step's order if gaps go first, and a step above a gap does the
 * same the other way round (#348). Steps go first because a torn step-only
 * write leaves the sequence with a hole, while a torn gap-only write leaves a
 * tie, and a hole is the failure nothing misreads: a tie is drawn as a parallel
 * branch nobody asked for.
 *
 * The compensation is exact rather than a counter-shift. Every change carries
 * its `from`, so undoing the step write means writing those `from` values back
 * — no arithmetic, and correct even on a milestone that was not dense when the
 * operation began.
 */
async function applyChanges(projectId: string, changes: readonly OrderChange[]): Promise<void> {
  const stepChanges = changes.filter(change => change.kind === 'step')
  const gapChanges = changes.filter(change => change.kind === 'gap')

  if (stepChanges.length > 0) {
    await setStepOrders(
      projectId,
      stepChanges.map(change => ({ id: change.id, order: change.to }))
    )
  }

  if (gapChanges.length === 0) return

  try {
    await setGapOrders(
      projectId,
      gapChanges.map(change => ({ id: change.id, order: change.to }))
    )
  } catch (gapError) {
    if (stepChanges.length > 0) {
      try {
        await setStepOrders(
          projectId,
          stepChanges.map(change => ({ id: change.id, order: change.from }))
        )
      } catch (undoError) {
        // Logged, never rethrown. Letting it out would replace `gapError` and
        // the caller would report the undo rather than the write that failed —
        // and every call site's message ("Failed to insert step", "Failed to
        // reorder steps") would then name the wrong cause.
        logger.error('Failed to undo the step write after the gap write failed', undoError)
      }
    }
    throw gapError
  }
}

/**
 * Close the holes in one milestone, keeping ties, writing only what changed.
 *
 * Every closer calls this and nothing else: delete, multi-delete, gap delete,
 * cancel-new-row, close-a-gap, attach-a-gap-to-a-step, and the source side of a
 * cross-milestone move. Throws on a failed write rather than reporting through
 * a toast — the caller has to know, because painting a clean sequence over a
 * torn one would hide it (#295).
 */
export async function resealMilestone(
  projectId: string,
  milestoneId: string
): Promise<ResealResult> {
  const rows = await readMilestoneRows(projectId, milestoneId)
  const changes = planReseal(rows)
  if (changes.length === 0) return { changes: [] }
  await applyChanges(projectId, changes)
  return { changes }
}

/**
 * Make room at position `at` for a row about to be written there.
 *
 * Openers call this, write their row at `at`, then reseal. The reseal after the
 * write is not redundant: the opener may have failed between the two, and on a
 * milestone that was already dense the reseal costs nothing at all.
 */
export async function openSlot(
  projectId: string,
  milestoneId: string,
  at: number
): Promise<ResealResult> {
  const rows = await readMilestoneRows(projectId, milestoneId)
  const changes = planOpenSlot(rows, at)
  if (changes.length === 0) return { changes: [] }
  await applyChanges(projectId, changes)
  return { changes }
}

/**
 * Move an existing row to position `to` within its milestone.
 *
 * Both an opener and a closer at once — it opens the slot the row is going to
 * and closes the one it came from — which is why it is a single operation
 * rather than a composition the call sites assemble.
 */
export async function moveWithinMilestone(
  projectId: string,
  milestoneId: string,
  rowId: string,
  to: number
): Promise<ResealResult> {
  const rows = await readMilestoneRows(projectId, milestoneId)
  const changes = planMove(rows, rowId, to)
  if (changes.length === 0) return { changes: [] }
  await applyChanges(projectId, changes)
  return { changes }
}

/** The order an appended row should take in this milestone. */
export async function nextPosition(projectId: string, milestoneId: string): Promise<number> {
  return planAppend(await readMilestoneRows(projectId, milestoneId))
}

/** How many positions the milestone holds — the ceiling for a typed order. */
export async function positionCount(projectId: string, milestoneId: string): Promise<number> {
  return countPositions(await readMilestoneRows(projectId, milestoneId))
}
