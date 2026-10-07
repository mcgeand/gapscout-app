import { describe, expect, it } from 'vitest'
import type { Milestone, Step } from '../data/types'
import {
  compareSteps,
  milestonesById,
  processPositions,
  rankOf,
  runningNumbers,
} from '../lib/stepSequence'

const milestone = (id: string, order: number): Milestone => ({
  id,
  projectId: 'p1',
  name: id,
  order,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
})

const step = (id: string, milestoneId: string, order: number): Step => ({
  id,
  projectId: 'p1',
  label: id,
  teamId: 'team-1',
  milestoneId,
  order,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
})

// The fixture from #299: four milestones, each numbering its own steps from 1.
const MILESTONES = [
  milestone('requisition', 0),
  milestone('approval', 1),
  milestone('purchase-order', 2),
  milestone('payment', 3),
]

const STEPS = [
  step('pay-invoice', 'payment', 1),
  step('create-requisition', 'requisition', 1),
  step('submit-budget-check', 'requisition', 2),
  step('validate-budget', 'approval', 1),
  step('senior-approval', 'approval', 2),
  step('create-po', 'purchase-order', 1),
]

describe('stepSequence', () => {
  const byId = milestonesById(MILESTONES)

  it('orders the process by milestone first, then by order within it', () => {
    const sorted = [...STEPS].sort((a, b) => compareSteps(a, b, byId)).map((s) => s.id)

    expect(sorted).toEqual([
      'create-requisition',
      'submit-budget-check',
      'validate-budget',
      'senior-approval',
      'create-po',
      'pay-invoice',
    ])
  })

  it('does not let a low order in a late milestone sort first', () => {
    // The reported symptom: Pay Invoice is order 1 in the last milestone, and a
    // flat `order` sort put it at the head of the whole process.
    const flat = [...STEPS].sort((a, b) => a.order - b.order)
    expect(flat[0].id).toBe('pay-invoice')

    const ranked = [...STEPS].sort((a, b) => compareSteps(a, b, byId))
    expect(ranked[ranked.length - 1].id).toBe('pay-invoice')
  })

  it('numbers the whole process 1..n regardless of the stored order', () => {
    const numbers = runningNumbers(STEPS, byId)

    expect(numbers.get('create-requisition')).toBe(1)
    expect(numbers.get('submit-budget-check')).toBe(2)
    expect(numbers.get('validate-budget')).toBe(3)
    expect(numbers.get('senior-approval')).toBe(4)
    expect(numbers.get('create-po')).toBe(5)
    expect(numbers.get('pay-invoice')).toBe(6)
  })

  it('gives parallel steps one number and does not skip the next one', () => {
    // Two steps sharing a rank run at the same time — the grid draws them with
    // `∥`. Ordinal numbering would split them and leave a hole after.
    const parallel = [
      step('a', 'requisition', 1),
      step('b', 'requisition', 2),
      step('c', 'requisition', 2),
      step('d', 'requisition', 3),
    ]
    const numbers = runningNumbers(parallel, byId)

    expect(numbers.get('a')).toBe(1)
    expect(numbers.get('b')).toBe(2)
    expect(numbers.get('c')).toBe(2)
    expect(numbers.get('d')).toBe(3)
  })

  it('sorts a step whose milestone does not resolve to the end', () => {
    const orphan = step('orphan', 'deleted-milestone', 1)
    const sorted = [...STEPS, orphan]
      .sort((a, b) => compareSteps(a, b, byId))
      .map((s) => s.id)

    expect(sorted[sorted.length - 1]).toBe('orphan')
  })

  describe('processPositions', () => {
    // The accessor every user-facing number goes through (#345). The cases that
    // matter are the ones a caller gets wrong by hand: gaps left out of the
    // sequence, and a stored order that names a different row in each milestone.
    const openGap = { id: 'gap-open', milestoneId: 'requisition', order: 0, status: 'Open' }
    const closedGap = {
      id: 'gap-closed',
      milestoneId: 'approval',
      order: 1,
      status: 'Closed',
    }
    const stepGap = { id: 'gap-on-step', stepId: 'create-po', order: 1, status: 'Open' }

    it('numbers steps and open process gaps on one running scale', () => {
      const positions = processPositions(STEPS, [openGap], MILESTONES)

      expect(positions.get('gap-open')).toBe(1)
      expect(positions.get('create-requisition')).toBe(2)
      expect(positions.get('submit-budget-check')).toBe(3)
      expect(positions.get('validate-budget')).toBe(4)
      expect(positions.get('senior-approval')).toBe(5)
      expect(positions.get('create-po')).toBe(6)
      expect(positions.get('pay-invoice')).toBe(7)
    })

    it('gives four steps stored as order 1 four different positions', () => {
      // The defect the sweep fixes: `order` restarts at 1 in every milestone, so
      // four rows print the same number and none of them matches the grid.
      const positions = processPositions(STEPS, [], MILESTONES)
      const firstInEachMilestone = [
        'create-requisition',
        'validate-budget',
        'create-po',
        'pay-invoice',
      ]

      expect(firstInEachMilestone.map((id) => positions.get(id))).toEqual([1, 3, 5, 6])
    })

    it('numbers a closed gap without letting it renumber the flow', () => {
      const positions = processPositions(STEPS, [closedGap, stepGap], MILESTONES)

      // The gaps table shows closed gaps whenever the Closed filter is off, so a
      // closed gap needs a number on the same scale as the rows around it — but
      // it has left the flow, so it must not push anything down. It shares the
      // number of the step now standing at its rank.
      expect(positions.get('gap-closed')).toBe(3)
      expect(positions.get('validate-budget')).toBe(3)
      expect(positions.get('senior-approval')).toBe(4)
      expect(positions.get('pay-invoice')).toBe(6)

      // A step gap annotates a step rather than holding a slot, so it has no
      // position of its own; the panel names it by its step's.
      expect(positions.has('gap-on-step')).toBe(false)
    })

    it('numbers a closed gap nothing filled by the row it sat after', () => {
      // Dismissed rather than resolved: no step stands at its rank, so it falls
      // back to the last row before it rather than borrowing the number of the
      // next one, which it never sat beside.
      const dismissed = {
        id: 'gap-dismissed',
        milestoneId: 'approval',
        order: 5,
        status: 'Closed',
      }
      const positions = processPositions(STEPS, [dismissed], MILESTONES)

      expect(positions.get('senior-approval')).toBe(4)
      expect(positions.get('gap-dismissed')).toBe(4)
      expect(positions.get('create-po')).toBe(5)
      expect(positions.get('pay-invoice')).toBe(6)
    })

    it('clamps a closed gap that sits before every row, or in no milestone', () => {
      const first = { id: 'gap-first', milestoneId: 'requisition', order: 0, status: 'Closed' }
      const orphan = { id: 'gap-orphan', milestoneId: 'deleted', order: 2, status: 'Closed' }
      const positions = processPositions(STEPS, [first, orphan], MILESTONES)

      expect(positions.get('gap-first')).toBe(1)
      // An unresolved milestone ranks at infinity, so at-or-before is the last row.
      expect(positions.get('gap-orphan')).toBe(6)
    })
  })

  it('ranks a process gap on the same tuple as a step', () => {
    // A gap reserves a position in the flow, so it has to rank alongside steps
    // rather than on a scale of its own.
    const gap = { id: 'gap-1', milestoneId: 'approval', order: 1 }
    expect(rankOf(gap, byId)).toEqual([1, 1])
    expect(rankOf(step('validate-budget', 'approval', 1), byId)).toEqual([1, 1])
  })
})
