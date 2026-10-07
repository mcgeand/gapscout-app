/**
 * Tests for SIPOC Validator
 *
 * Tests the validation logic for process steps and SIPOC completeness.
 */

import { describe, it, expect } from 'vitest'
import {
  validateStep,
  validateSteps,
} from '../lib/sipocValidator'
import type { Milestone, Step } from '../data/types'
import { milestonesById } from '../lib/stepSequence'

/**
 * One milestone, so a rank reduces to `order` and every case below reads the way
 * it did before #344. The multi-milestone cases build their own map.
 */
const MILESTONES = milestonesById([
  { id: 'milestone-1', projectId: 'project-1', name: 'Milestone 1', order: 1, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
])

// Helper to create a valid step with overrides
function createStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    projectId: 'project-1',
    label: 'Test Step',
    teamId: 'team-1',
    milestoneId: 'milestone-1',
    order: 2, // Not first or last by default
    suppliers: ['Supplier A'],
    inputs: ['Input A'],
    outputs: ['Output A'],
    customers: ['Customer A'],
    systems: [],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// Helper to create multiple steps in a milestone
function createStepsInMilestone(count: number, milestoneId = 'milestone-1'): Step[] {
  return Array.from({ length: count }, (_, i) => createStep({
    id: `step-${i + 1}`,
    milestoneId,
    order: i + 1,
    label: `Step ${i + 1}`,
    suppliers: i === 0 ? [] : [`Supplier ${i + 1}`], // First step has no suppliers
    inputs: i === 0 ? [] : [`Input ${i + 1}`], // First step has no inputs
    outputs: i === count - 1 ? [] : [`Output ${i + 1}`], // Last step has no outputs
    customers: i === count - 1 ? [] : [`Customer ${i + 1}`], // Last step has no customers
  }))
}

describe('validateStep', () => {
  describe('first step rules', () => {
    it('should not require supplier for first step', () => {
      const step = createStep({ order: 1, suppliers: [] })
      const result = validateStep(step, [step], MILESTONES)
      expect(result.missingFields).not.toContain('supplier')
    })

    it('should not require input for first step', () => {
      const step = createStep({ order: 1, inputs: [] })
      const result = validateStep(step, [step], MILESTONES)
      expect(result.missingFields).not.toContain('input')
    })
  })

  describe('last step rules', () => {
    it('should not require output for last step', () => {
      const steps = createStepsInMilestone(3)
      const lastStep = steps[2] // order = 3
      const result = validateStep(lastStep, steps, MILESTONES)
      expect(result.missingFields).not.toContain('output')
    })

    it('should not require customer for last step', () => {
      const steps = createStepsInMilestone(3)
      const lastStep = steps[2] // order = 3
      const result = validateStep(lastStep, steps, MILESTONES)
      expect(result.missingFields).not.toContain('customer')
    })
  })

  describe('middle step requirements', () => {
    it('should require supplier for middle step', () => {
      const step = createStep({ order: 2, suppliers: [] })
      const allSteps = [
        createStep({ id: 'step-1', order: 1 }),
        step,
        createStep({ id: 'step-3', order: 3 }),
      ]
      const result = validateStep(step, allSteps, MILESTONES)
      expect(result.missingFields).toContain('supplier')
      expect(result.issues).toContain('Supplier is required (who provides the inputs)')
    })

    it('should require input for middle step', () => {
      const step = createStep({ order: 2, inputs: [] })
      const allSteps = [
        createStep({ id: 'step-1', order: 1 }),
        step,
        createStep({ id: 'step-3', order: 3 }),
      ]
      const result = validateStep(step, allSteps, MILESTONES)
      expect(result.missingFields).toContain('input')
      expect(result.issues).toContain('Input is required (what is received)')
    })

    it('should require output for middle step', () => {
      const step = createStep({ order: 2, outputs: [] })
      const allSteps = [
        createStep({ id: 'step-1', order: 1 }),
        step,
        createStep({ id: 'step-3', order: 3 }),
      ]
      const result = validateStep(step, allSteps, MILESTONES)
      expect(result.missingFields).toContain('output')
      expect(result.issues).toContain('Output is required (what is produced)')
    })

    it('should require customer for middle step', () => {
      const step = createStep({ order: 2, customers: [] })
      const allSteps = [
        createStep({ id: 'step-1', order: 1 }),
        step,
        createStep({ id: 'step-3', order: 3 }),
      ]
      const result = validateStep(step, allSteps, MILESTONES)
      expect(result.missingFields).toContain('customer')
      expect(result.issues).toContain('Customer is required (who receives the output)')
    })
  })

  describe('process label requirement', () => {
    it('should always require a label', () => {
      const step = createStep({ label: '' })
      const result = validateStep(step, [step], MILESTONES)
      expect(result.missingFields).toContain('process')
      expect(result.issues).toContain('Process description is required')
    })

    it('should reject whitespace-only labels', () => {
      const step = createStep({ label: '   ' })
      const result = validateStep(step, [step], MILESTONES)
      expect(result.missingFields).toContain('process')
    })
  })

  describe('empty array handling', () => {
    it('should treat arrays with only empty strings as empty', () => {
      const step = createStep({
        order: 2,
        suppliers: ['', '  ', '\t'],
        inputs: [''],
      })
      const allSteps = [
        createStep({ id: 'step-1', order: 1 }),
        step,
        createStep({ id: 'step-3', order: 3 }),
      ]
      const result = validateStep(step, allSteps, MILESTONES)
      expect(result.missingFields).toContain('supplier')
      expect(result.missingFields).toContain('input')
    })
  })

  describe('valid step', () => {
    it('should return valid for a complete middle step with matching chain', () => {
      // Create steps where customers/outputs chain properly
      const step1 = createStep({
        id: 'step-1',
        order: 1,
        suppliers: [],
        inputs: [],
        outputs: ['Report'],
        customers: ['Team B'],
      })
      const step2 = createStep({
        id: 'step-2',
        order: 2,
        suppliers: ['Team B'], // matches step1's customer
        inputs: ['Report'],    // matches step1's output
        outputs: ['Final Doc'],
        customers: ['Team C'],
      })
      const step3 = createStep({
        id: 'step-3',
        order: 3,
        suppliers: ['Team C'], // matches step2's customer
        inputs: ['Final Doc'], // matches step2's output
        outputs: [],
        customers: [],
      })
      const allSteps = [step1, step2, step3]

      const result = validateStep(step2, allSteps, MILESTONES)
      expect(result.isValid).toBe(true)
      expect(result.missingFields).toHaveLength(0)
      expect(result.issues).toHaveLength(0)
    })

    it('should return valid for a complete first step without S/I', () => {
      const step = createStep({
        order: 1,
        suppliers: [],
        inputs: [],
      })
      const result = validateStep(step, [step], MILESTONES)
      expect(result.isValid).toBe(true)
    })
  })
})

describe('validateSteps', () => {
  it('should validate all steps and return a map', () => {
    const steps = createStepsInMilestone(3)
    const results = validateSteps(steps, MILESTONES)

    expect(results.size).toBe(3)
    expect(results.has('step-1')).toBe(true)
    expect(results.has('step-2')).toBe(true)
    expect(results.has('step-3')).toBe(true)
  })

  it('should validate each step correctly with proper chain', () => {
    // Create steps with proper SIPOC chain
    const steps = [
      createStep({
        id: 'step-1',
        order: 1,
        suppliers: [],
        inputs: [],
        outputs: ['Output 1'],
        customers: ['Team 2'],
      }),
      createStep({
        id: 'step-2',
        order: 2,
        suppliers: ['Team 2'],  // matches step 1's customer
        inputs: ['Output 1'],   // matches step 1's output
        outputs: ['Output 2'],
        customers: ['Team 3'],
      }),
      createStep({
        id: 'step-3',
        order: 3,
        suppliers: ['Team 3'],  // matches step 2's customer
        inputs: ['Output 2'],   // matches step 2's output
        outputs: [],
        customers: [],
      }),
    ]
    const results = validateSteps(steps, MILESTONES)

    // First step should be valid (no S/I required)
    expect(results.get('step-1')?.isValid).toBe(true)

    // Middle step should be valid (has all fields with proper chain)
    expect(results.get('step-2')?.isValid).toBe(true)

    // Last step should be valid (no O/C required)
    expect(results.get('step-3')?.isValid).toBe(true)
  })
})

/**
 * #344: the exemption fired once per MILESTONE, not once per process.
 *
 * `P2P - Acme Corp` as measured on `main` @ 377fd2b — four milestones, six
 * steps. Three of the six drew a green tick while missing required SIPOC
 * fields, and the two single-step milestones were exempt from everything
 * because they were both "first" and "last" in their own milestone.
 *
 * A single-milestone project cannot reproduce any of this, which is why the
 * bug survived a QA pass.
 */
describe('first/last exemption is process-wide, not per milestone (#344)', () => {
  const P2P_MILESTONES = milestonesById([
    { id: 'ms-req', projectId: 'p2p', name: 'Requisition', order: 1, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
    { id: 'ms-app', projectId: 'p2p', name: 'Approval', order: 2, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
    { id: 'ms-po', projectId: 'p2p', name: 'Purchase Order', order: 3, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
    { id: 'ms-pay', projectId: 'p2p', name: 'Payment', order: 4, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
  ])

  // The six rows from the issue's table, with the empty fields it recorded.
  const p2pSteps: Step[] = [
    createStep({
      id: 'create-req', milestoneId: 'ms-req', order: 1, label: 'Create Purchase Requisition',
      suppliers: [], inputs: [], outputs: ['Requisition'], customers: ['Budget Owner'],
    }),
    createStep({
      id: 'submit-budget', milestoneId: 'ms-req', order: 2, label: 'Submit for Budget Check',
      suppliers: ['Budget Owner'], inputs: ['Requisition'], outputs: ['Budget Request'], customers: ['Finance'],
    }),
    createStep({
      id: 'validate-budget', milestoneId: 'ms-app', order: 1, label: 'Validate Budget',
      suppliers: ['Finance'], inputs: ['Budget Request'], outputs: ['Validated Budget'], customers: ['Senior Manager'],
    }),
    createStep({
      id: 'senior-approval', milestoneId: 'ms-app', order: 2, label: 'Senior Manager Approval',
      suppliers: ['Senior Manager'], inputs: ['Validated Budget'], outputs: [], customers: [],
    }),
    createStep({
      id: 'create-po', milestoneId: 'ms-po', order: 1, label: 'Create PO',
      suppliers: [], inputs: [], outputs: ['Purchase Order'], customers: [],
    }),
    createStep({
      id: 'pay-invoice', milestoneId: 'ms-pay', order: 1, label: 'Pay Invoice',
      suppliers: [], inputs: ['Invoice'], outputs: ['Payment'], customers: [],
    }),
  ]

  const validate = (id: string) =>
    validateStep(p2pSteps.find(s => s.id === id)!, p2pSteps, P2P_MILESTONES)

  it('exempts only the step that opens the process from supplier and input', () => {
    expect(validate('create-req').missingFields).not.toContain('supplier')
    expect(validate('create-req').missingFields).not.toContain('input')

    // Open their own milestone, but not the process, and their supplier is
    // genuinely empty — so the exemption is what used to hide it.
    for (const id of ['create-po', 'pay-invoice']) {
      expect(validate(id).missingFields, id).toContain('supplier')
    }
    expect(validate('create-po').missingFields).toContain('input')

    // `Validate Budget` opens milestone 2 with its supplier filled, so nothing
    // is missing either way. Emptying it proves the exemption does not reach it.
    const withoutSupplier = p2pSteps.map(step =>
      step.id === 'validate-budget' ? { ...step, suppliers: [], inputs: [] } : step
    )
    const result = validateStep(withoutSupplier[2], withoutSupplier, P2P_MILESTONES)
    expect(result.missingFields).toContain('supplier')
    expect(result.missingFields).toContain('input')
  })

  it('exempts only the step that ends the process from output and customer', () => {
    expect(validate('pay-invoice').missingFields).not.toContain('output')
    expect(validate('pay-invoice').missingFields).not.toContain('customer')

    // Ends its own milestone, but not the process.
    expect(validate('senior-approval').missingFields).toContain('output')
    expect(validate('senior-approval').missingFields).toContain('customer')
    expect(validate('create-po').missingFields).toContain('customer')
  })

  it('exempts a mid-process single-step milestone from nothing', () => {
    // `Create PO` is alone in its milestone, so it used to be both first and
    // last and every SIPOC field was waived. It sits in the middle of the
    // process, so it is neither.
    expect(validate('create-po').missingFields).toEqual(
      expect.arrayContaining(['supplier', 'input', 'customer'])
    )
  })

  it('renders a warning, not a tick, for the three rows the issue measured', () => {
    for (const id of ['senior-approval', 'create-po', 'pay-invoice']) {
      expect(validate(id).isValid, id).toBe(false)
    }
  })

  it('leaves the three complete rows valid', () => {
    for (const id of ['create-req', 'submit-budget', 'validate-budget']) {
      expect(validate(id).isValid, id).toBe(true)
    }
  })

  it('exempts both branches of a parallel pair that opens the process', () => {
    // Parallel steps share a rank (CLAUDE.md: two steps at the same
    // (milestone_id, order) run at the same time), and neither has a
    // predecessor to receive from, so both are exempt.
    const parallel = [
      createStep({ id: 'a', milestoneId: 'ms-req', order: 1, suppliers: [], inputs: [], outputs: ['X'], customers: ['T'] }),
      createStep({ id: 'b', milestoneId: 'ms-req', order: 1, suppliers: [], inputs: [], outputs: ['Y'], customers: ['T'] }),
      createStep({ id: 'c', milestoneId: 'ms-req', order: 2, suppliers: ['T'], inputs: ['X'], outputs: [], customers: [] }),
    ]
    for (const id of ['a', 'b']) {
      const result = validateStep(parallel.find(s => s.id === id)!, parallel, P2P_MILESTONES)
      expect(result.missingFields, id).not.toContain('supplier')
      expect(result.missingFields, id).not.toContain('input')
    }
  })

  it('falls back to project-wide `order` when no milestones are loaded', () => {
    // Not the #344 bug: with an empty map every step ranks on `order` alone, so
    // the exemption degrades to the pre-#299 project-wide-by-`order` reading
    // rather than to the per-milestone one. It is still a degradation — a
    // project whose milestones each hold one step at order 1 ties every rank —
    // which is why the map is required rather than optional.
    const empty = new Map<string, Milestone>()
    expect(validateStep(p2pSteps[0], p2pSteps, empty).missingFields).not.toContain('supplier')
    // order 2 is the highest in the project, so `Senior Manager Approval` is
    // the fallback's "last" — and `Submit for Budget Check` ties with it.
    expect(validateStep(p2pSteps[3], p2pSteps, empty).missingFields).not.toContain('output')
    // order 1 ties with the process opener, so these are exempt too under the
    // fallback. This is the pre-#299 reading, and why the map is required.
    expect(validateStep(p2pSteps[4], p2pSteps, empty).missingFields).not.toContain('supplier')
  })
})
