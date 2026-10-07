import { describe, expect, it } from 'vitest'
import type { Gap, Step } from '../data/types'
import { planGapResync } from '../lib/gapSync'
import { milestonesById } from '../lib/stepSequence'

/** One milestone, so ranking reduces to `order` and these cases read as before. */
const MILESTONES = milestonesById([
  { id: 'm1', projectId: 'p1', name: 'M1', order: 1, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
])

const step = (over: Partial<Step>): Step => ({
  id: 'x', projectId: 'p1', milestoneId: 'm1', teamId: 't1', label: 'X', order: 1,
  suppliers: ['S'], inputs: ['I'], outputs: ['O'], customers: ['C'],
  systems: [], comments: [], links: [], gapIds: [], createdAt: 0, updatedAt: 0,
  ...over,
})

const gap = (over: Partial<Gap>): Gap => ({
  id: 'g1', projectId: 'p1', stepId: 'x', observed: 'stale',
  expected: 'All SIPOC fields should be complete',
  severity: 'M', status: 'Open', missingField: 'supplier', links: [],
  createdAt: 0, updatedAt: 0,
  ...over,
})

describe('planGapResync', () => {
  it('rewrites an open gap whose text no longer matches its step', () => {
    const a = step({ id: 'a', order: 1 })
    const b = step({ id: 'b', order: 2, outputs: [], customers: [], suppliers: ['C'], inputs: ['O'] })
    const plans = planGapResync([b], [a, b, step({ id: 'c', order: 3 })], [gap({ stepId: 'b' })], MILESTONES)

    expect(plans).toEqual([
      {
        gapId: 'g1',
        missingField: 'output',
        observed: 'Missing output, customer',
        expected: 'All SIPOC fields should be complete',
      },
    ])
  })

  it('writes nothing when the gap already says what the step is missing', () => {
    const b = step({ id: 'b', order: 2, outputs: [], customers: [], suppliers: ['C'], inputs: ['O'] })
    const alreadyCorrect = gap({
      stepId: 'b', missingField: 'output', observed: 'Missing output, customer',
    })

    expect(planGapResync([b], [b, step({ id: 'c', order: 3 })], [alreadyCorrect], MILESTONES)).toEqual([])
  })

  it('never raises a gap on a step that has none', () => {
    const b = step({ id: 'b', order: 2, label: '' })

    expect(planGapResync([b], [b, step({ id: 'c', order: 3 })], [], MILESTONES)).toEqual([])
  })

  it('leaves a gap that is no longer Open alone', () => {
    const b = step({ id: 'b', order: 2, label: '' })
    const promoted = gap({ stepId: 'b', status: 'Review' })

    expect(planGapResync([b], [b, step({ id: 'c', order: 3 })], [promoted], MILESTONES)).toEqual([])
  })

  it('still rewrites a gap the same write promoted to Review', () => {
    // #279: `updateStep` promotes a gap whose missing field the patch fills
    // before any caller can re-plan, so status alone would hide the one edit
    // most likely to have changed the wording. The caller names it in `wasOpen`.
    const b = step({ id: 'b', order: 2, outputs: [], customers: [], suppliers: ['C'], inputs: ['O'] })
    const justPromoted = gap({ stepId: 'b', status: 'Review' })

    expect(
      planGapResync([b], [b, step({ id: 'c', order: 3 })], [justPromoted], MILESTONES, new Set(['g1']))
    ).toEqual([
      {
        gapId: 'g1',
        missingField: 'output',
        observed: 'Missing output, customer',
        expected: 'All SIPOC fields should be complete',
      },
    ])
  })

  it('leaves a gap that was already in Review before the write alone', () => {
    // The other side of the same rule: a reviewer's gap is not rewritten under
    // them just because some later edit touched the step.
    const b = step({ id: 'b', order: 2, outputs: [], customers: [], suppliers: ['C'], inputs: ['O'] })
    const underReview = gap({ stepId: 'b', status: 'Review' })

    expect(
      planGapResync([b], [b, step({ id: 'c', order: 3 })], [underReview], MILESTONES, new Set(['some-other-gap']))
    ).toEqual([])
  })

  it('leaves a valid step\'s gap for the caller to surface rather than rewriting it', () => {
    const a = step({ id: 'a', order: 1 })
    const b = step({ id: 'b', order: 2, suppliers: ['C'], inputs: ['O'], outputs: [], customers: [] })

    expect(planGapResync([a], [a, b], [gap({ stepId: 'a' })], MILESTONES)).toEqual([])
  })
  it('leaves a hand-authored gap alone, even when its step is invalid', () => {
    const b = step({ id: 'b', order: 2, outputs: [], customers: [], suppliers: ['C'], inputs: ['O'] })
    const handWritten = gap({ stepId: 'b', expected: 'The PO reaches Finance the same day' })

    expect(planGapResync([b], [b, step({ id: 'c', order: 3 })], [handWritten], MILESTONES)).toEqual([])
  })
})
