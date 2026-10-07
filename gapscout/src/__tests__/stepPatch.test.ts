import { describe, expect, it } from 'vitest'
import { splitStepPatch } from '../lib/stepPatch'

describe('splitStepPatch', () => {
  it('separates the order from the field writes', () => {
    const { fieldUpdates, nextOrder } = splitStepPatch(
      { suppliers: [], label: 'Pay Invoice', order: 3 },
      1
    )
    expect(fieldUpdates).toEqual({ suppliers: [], label: 'Pay Invoice' })
    expect(nextOrder).toBe(3)
  })

  it('reports no move when the patch carries no order', () => {
    const { fieldUpdates, nextOrder } = splitStepPatch({ suppliers: [] }, 1)
    expect(fieldUpdates).toEqual({ suppliers: [] })
    expect(nextOrder).toBeNull()
  })

  it('reports no move when the order is the one the step already holds', () => {
    expect(splitStepPatch({ order: 2 }, 2).nextOrder).toBeNull()
  })

  it('keeps an order-only patch out of the field write', () => {
    // An empty `fieldUpdates` is how callers know to skip `updateStep`
    // entirely rather than issuing a write that changes nothing.
    const { fieldUpdates, nextOrder } = splitStepPatch({ order: 2 }, 1)
    expect(Object.keys(fieldUpdates)).toHaveLength(0)
    expect(nextOrder).toBe(2)
  })

  it('compares against the order passed in, not the one inside the patch', () => {
    // The validation modal is opened with the MERGED step, whose `order` is
    // already the edited value. Callers must pass the STORED order, or every
    // move reads as a no-op — the defect this helper exists to make one-sited.
    expect(splitStepPatch({ order: 2 }, 1).nextOrder).toBe(2)
    expect(splitStepPatch({ order: 2 }, 2).nextOrder).toBeNull()
  })
})
