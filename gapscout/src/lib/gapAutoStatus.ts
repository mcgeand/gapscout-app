/**
 * Gap auto-status detection
 *
 * A gap raised against a missing SIPOC field should move from Open to Review as
 * soon as the user fills that field on the step. This module holds the pure half
 * of that rule — which fields a step update actually filled — so the store can
 * stay a thin caller and the rule can be tested without mocking the database.
 *
 * Reference: PRD Section 4.7.2 - Auto-Status Logic
 */

import type { MissingFieldType, Step } from '../data/types'
import { isArrayEmpty } from './sipocValidator'

/** A gap's `missingField` names one of the step's SIPOC arrays. */
const STEP_FIELD_BY_MISSING_FIELD: Record<
  MissingFieldType,
  'suppliers' | 'inputs' | 'outputs' | 'customers'
> = {
  supplier: 'suppliers',
  input: 'inputs',
  output: 'outputs',
  customer: 'customers',
}

/**
 * Which SIPOC fields this patch fills that were empty before.
 *
 * A field counts only on the empty → non-empty transition: adding a second
 * input to a step that already had one resolves no gap, and a key the patch
 * does not carry is untouched rather than cleared.
 */
export function detectFilledSipocFields(
  previous: Step,
  patch: Partial<Step>
): MissingFieldType[] {
  const missingFields = Object.keys(STEP_FIELD_BY_MISSING_FIELD) as MissingFieldType[]

  return missingFields.filter((missingField) => {
    const stepField = STEP_FIELD_BY_MISSING_FIELD[missingField]
    const next = patch[stepField]
    if (next === undefined) return false
    return isArrayEmpty(previous[stepField]) && !isArrayEmpty(next)
  })
}
