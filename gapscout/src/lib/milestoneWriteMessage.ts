/**
 * The message to show when a milestone write fails (#131).
 *
 * `MilestoneOrderConflictError` carries a sentence written for the user — the
 * order it refused and why — so it is shown verbatim rather than swallowed by
 * the generic line. Everything else keeps the line the caller has always shown.
 *
 * It lives here rather than in `stepsStore` because the store is not the only
 * caller: `MilestoneManager` creates a milestone through `db` directly, and its
 * modal's catch is the one place a user can actually hit the conflict today,
 * since that path computes `max(order) + 1` from a React prop that can be a
 * stale snapshot.
 *
 * Matched on `name` rather than with `instanceof`: a dozen suites mock
 * `../services/db` with a partial factory, where the class is `undefined` and
 * `instanceof` throws inside the catch block that was handling the failure.
 */
export function milestoneWriteMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.name === 'MilestoneOrderConflictError'
    ? error.message
    : fallback
}
