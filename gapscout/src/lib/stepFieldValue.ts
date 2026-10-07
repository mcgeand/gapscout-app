/**
 * Step field value parsing
 *
 * Shared by the Discovery grid's inline cell editor (StepRow) and the new-row
 * Save tray (EditableRowTable). Both have to turn the same raw editor string
 * into the same typed Step field, or a value typed into an open editor is
 * saved differently from one that was committed first.
 */

import type { Step } from '../data/types'

export type StepFieldValue = string | string[] | number

/** SIPOC fields stored as arrays and edited as a comma-separated string. */
const SIPOC_ARRAY_FIELDS = ['suppliers', 'inputs', 'outputs', 'customers']

export type ParsedStepField =
  | { ok: true; value: StepFieldValue }
  | { ok: false; error: string }

/**
 * Parse a raw editor string for `field` into its stored representation.
 * Returns an error instead of throwing so callers can surface it as a toast.
 */
export function parseStepFieldValue(field: string, rawValue: string): ParsedStepField {
  if (SIPOC_ARRAY_FIELDS.includes(field)) {
    return {
      ok: true,
      value: rawValue
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  }

  if (field === 'order') {
    const orderNum = parseInt(rawValue, 10)
    if (isNaN(orderNum) || orderNum < 1) {
      return { ok: false, error: 'Order must be a positive number' }
    }
    return { ok: true, value: orderNum }
  }

  return { ok: true, value: rawValue }
}

/** An inline cell editor that is open and holds a value the user has not committed. */
export interface PendingStepEdit {
  field: string
  value: string
}

/**
 * Apply an open editor's uncommitted value on top of `step`, so callers can
 * validate and save what the user sees rather than the last committed state.
 * An unparseable value is dropped; the caller re-parses to report the error.
 */
export function applyPendingStepEdit<T extends Partial<Step>>(
  step: T,
  pending: PendingStepEdit | undefined
): T {
  if (!pending) return step

  const parsed = parseStepFieldValue(pending.field, pending.value)
  if (!parsed.ok) return step

  return { ...step, [pending.field]: parsed.value }
}

/**
 * Do two parsed field values mean the same thing? Lets a caller drop a no-op
 * commit — an editor opened and closed without a change must not write, or it
 * would trip the save indicator, gap auto-sync and validation for nothing.
 */
export function stepFieldValuesEqual(a: StepFieldValue, b: StepFieldValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : []
    const right = Array.isArray(b) ? b : []
    return left.length === right.length && left.every((item, i) => item === right[i])
  }

  return a === b
}
