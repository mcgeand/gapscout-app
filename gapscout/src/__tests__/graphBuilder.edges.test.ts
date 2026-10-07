/**
 * SIPOC edges point forward, say what actually flows, and follow the material
 * when no team names the hand-off.
 *
 * Regression cover for #174. The fixture is the 2026-08-31 QA project the issue
 * was raised from: a six-step purchase requisition where three separate wrongs
 * were visible at once — a backward edge labelled with the wrong output, a
 * fan-out whose second edge claimed a document the target never receives, and a
 * real output→input hand-off that drew nothing at all.
 */

import { describe, expect, it } from 'vitest'
import { stepsToNodesEdges } from '../lib/graphBuilder'
import type { Node } from 'reactflow'
import type { Edge } from 'reactflow'
import type { Milestone, Step, Team } from '../data/types'

const PROCUREMENT: Team = {
  id: 'team-proc',
  projectId: 'project-1',
  name: 'Procurement',
  color: '#F59E0B',
  order: 0,
  tags: [],
  createdAt: 0,
}

const milestone = (id: string, order: number): Milestone => ({
  id,
  projectId: 'project-1',
  name: id,
  order,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
})

const REQUISITION = milestone('milestone-1', 0)

const step = (overrides: Partial<Step> & Pick<Step, 'id' | 'order'>): Step => ({
  projectId: 'project-1',
  label: overrides.id,
  teamId: PROCUREMENT.id,
  milestoneId: REQUISITION.id,
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
  ...overrides,
})

/** The QA project, verbatim: the shape all three wrongs were seen on. */
const requisitionSteps = (): Step[] => [
  step({ id: 'draft-pr', order: 1, outputs: ['Draft PR'], customers: ['Procurement'] }),
  step({
    id: 'submit-for-budget-check',
    order: 2,
    suppliers: ['Procurement'],
    inputs: ['Draft PR'],
    outputs: ['Budget request'],
  }),
  step({ id: 'validate-budget', order: 3, outputs: ['Validated PR'], customers: ['Procurement'] }),
  step({
    id: 'approve-pr',
    order: 4,
    suppliers: ['Procurement'],
    inputs: ['Validated PR'],
  }),
  step({ id: 'create-po', order: 5, outputs: ['PO sent to vendor'] }),
  step({ id: 'pay-invoice', order: 6, inputs: ['PO sent to vendor'] }),
]

const build = (steps: Step[], milestones: Milestone[] = [REQUISITION]) =>
  stepsToNodesEdges(steps, milestones, [PROCUREMENT], [], []).edges

const pairs = (edges: Edge[]) => edges.map(edge => `${edge.source}->${edge.target}`)

const find = (edges: Edge[], source: string, target: string) =>
  edges.find(edge => edge.source === source && edge.target === target)

describe('createSipocEdges — direction (#174)', () => {
  it('never draws a hand-off back up the chain', () => {
    const edges = build(requisitionSteps())

    // "Validate Budget" (3) named Procurement as a customer, and "Submit for
    // Budget Check" (2) names it as a supplier — which used to draw 3→2, a
    // rework loop nobody authored, labelled with step 3's "Validated PR".
    expect(pairs(edges)).not.toContain('validate-budget->submit-for-budget-check')

    for (const edge of edges) {
      const source = requisitionSteps().find(s => s.id === edge.source)!
      const target = requisitionSteps().find(s => s.id === edge.target)!
      expect(target.order).toBeGreaterThan(source.order)
    }
  })

  it('ranks across milestones, not on raw order', () => {
    const later = milestone('milestone-2', 1)
    const steps = [
      // Order 9 in the *first* milestone still comes before order 1 in the second.
      step({ id: 'late-in-first', order: 9, outputs: ['Packet'], customers: ['Procurement'] }),
      step({
        id: 'early-in-second',
        order: 1,
        milestoneId: later.id,
        suppliers: ['Procurement'],
        inputs: ['Packet'],
      }),
    ]

    expect(pairs(build(steps, [REQUISITION, later]))).toEqual(['late-in-first->early-in-second'])
  })

  it('does not chain parallel steps to each other', () => {
    // Same milestone, same order is what detectParallelSteps calls parallel, and
    // concurrent steps do not feed each other.
    const steps = [
      step({ id: 'branch-a', order: 1, outputs: ['Form'], customers: ['Procurement'] }),
      step({ id: 'branch-b', order: 1, suppliers: ['Procurement'], inputs: ['Form'] }),
    ]

    const edges = build(steps)
    expect(pairs(edges)).not.toContain('branch-a->branch-b')
    expect(pairs(edges)).not.toContain('branch-b->branch-a')

    // The hand-off is still shown, as a terminus: branch-a says its customer is
    // Procurement and no *later* step picks that up, so the flow leaves the map
    // here. Hiding it would be the "flow is simply missing" bug in another guise.
    expect(pairs(edges)).toEqual(['branch-a->end-Procurement'])
  })
})

describe('createSipocEdges — labels (#174)', () => {
  it('labels an edge with what the target actually receives', () => {
    const edges = build(requisitionSteps())

    expect(find(edges, 'draft-pr', 'submit-for-budget-check')?.label).toBe('Draft PR')
    expect(find(edges, 'validate-budget', 'approve-pr')?.label).toBe('Validated PR')
  })

  it('leaves a hand-off bare when nothing named flows along it', () => {
    // Both steps deal with Procurement, so the hand-off is real, but the target
    // takes a Validated PR, never the source's Draft PR. Edges like this used to
    // borrow "Draft PR" from the source and claim a document that never moves.
    const steps = [
      step({ id: 'draft-pr', order: 1, outputs: ['Draft PR'], customers: ['Procurement'] }),
      step({ id: 'approve-pr', order: 2, suppliers: ['Procurement'], inputs: ['Validated PR'] }),
    ]

    const handOff = find(build(steps), 'draft-pr', 'approve-pr')
    expect(handOff).toBeDefined()
    expect(handOff?.label).toBeUndefined()
  })

  it('labels with the intersection when a step outputs several things', () => {
    const steps = [
      step({
        id: 'assemble',
        order: 1,
        outputs: ['Draft PR', 'Cover note', 'Budget request'],
        customers: ['Procurement'],
      }),
      step({
        id: 'review',
        order: 2,
        suppliers: ['Procurement'],
        inputs: ['Budget request', 'Draft PR'],
      }),
    ]

    // Source order is kept, and the un-received "Cover note" is left out.
    expect(find(build(steps), 'assemble', 'review')?.label).toBe('Draft PR, Budget request')
  })
})

describe('createSipocEdges — output→input fallback (#174)', () => {
  it('draws a chain that no team names', () => {
    const edges = build(requisitionSteps())

    // Neither step sets a customer or a supplier, so team matching is silent and
    // this hand-off drew nothing at all — the flow was simply missing.
    expect(find(edges, 'create-po', 'pay-invoice')?.label).toBe('PO sent to vendor')
  })

  it('only reaches the earliest consumer of each output', () => {
    const steps = [
      step({ id: 'issue-invoice', order: 1, outputs: ['Invoice'] }),
      step({ id: 'log-invoice', order: 2, inputs: ['Invoice'] }),
      step({ id: 'archive-invoice', order: 3, inputs: ['Invoice'] }),
    ]

    // Matching every later step that happens to take the same input would
    // re-invent exactly the fan-out this issue is about.
    expect(pairs(build(steps))).toEqual(['issue-invoice->log-invoice'])
  })

  it('stays out of the way when a team already named the hand-off', () => {
    const steps = [
      step({
        id: 'raise',
        order: 1,
        outputs: ['Order'],
        customers: ['Procurement'],
      }),
      step({ id: 'fulfil', order: 2, suppliers: ['Procurement'], inputs: ['Order'] }),
      step({ id: 'audit', order: 3, inputs: ['Order'] }),
    ]

    expect(pairs(build(steps))).toEqual(['raise->fulfil'])
  })
})

describe('createSipocEdges — nearest customer match (#363)', () => {
  it('hands off to the first later step naming the party, not every one', () => {
    // A party named by team recurs across the process. Matching every later
    // supplier drew 1→2, 1→4 and 1→6, which is how the P2P template reached a
    // span-16 arc before its parties were renamed.
    const steps = [
      step({ id: 'raise', order: 1, customers: ['Procurement'] }),
      step({ id: 'source', order: 2, suppliers: ['Procurement'] }),
      step({ id: 'unrelated', order: 3 }),
      step({ id: 'negotiate', order: 4, suppliers: ['Procurement'] }),
      step({ id: 'unrelated-2', order: 5 }),
      step({ id: 'contract', order: 6, suppliers: ['Procurement'] }),
    ]

    expect(pairs(build(steps))).toEqual(['raise->source'])
  })

  it('does not fan the requisition fixture out to a second Procurement step', () => {
    // Step 1's customer is Procurement, which steps 2 and 4 both supply. Only
    // step 2 is the hand-off.
    const edges = build(requisitionSteps())

    expect(pairs(edges)).toContain('draft-pr->submit-for-budget-check')
    expect(pairs(edges)).not.toContain('draft-pr->approve-pr')
  })

  it('reaches every parallel step at the nearest rank', () => {
    // Two steps at order 2 run in parallel (detectParallelSteps), so a hand-off
    // into order 2 lands on both. Order 3 is past the nearest rank.
    const steps = [
      step({ id: 'raise', order: 1, customers: ['Procurement'] }),
      step({ id: 'branch-a', order: 2, suppliers: ['Procurement'] }),
      step({ id: 'branch-b', order: 2, suppliers: ['Procurement'] }),
      step({ id: 'join', order: 3, suppliers: ['Procurement'] }),
    ]

    expect(pairs(build(steps)).sort()).toEqual(['raise->branch-a', 'raise->branch-b'])
  })

  it('finds the nearest match across milestones by rank', () => {
    const later = milestone('milestone-2', 1)
    const steps = [
      step({ id: 'raise', order: 1, customers: ['Procurement'] }),
      // Order 1 of the second milestone is later than order 9 of the first,
      // so it is not the nearest despite the lower number.
      step({ id: 'far', order: 1, milestoneId: later.id, suppliers: ['Procurement'] }),
      step({ id: 'near', order: 9, suppliers: ['Procurement'] }),
    ]

    expect(pairs(build(steps, [REQUISITION, later]))).toEqual(['raise->near'])
  })

  it('still draws a long hand-off when the material goes there', () => {
    // The nearest Procurement step takes nothing from this one; the Budget goes
    // to a step four ranks on. Rule 3 carries it, so cutting the team fan-out
    // does not lose a hand-off the SIPOC actually describes.
    const steps = [
      step({ id: 'plan', order: 1, outputs: ['Budget'], customers: ['Procurement'] }),
      step({ id: 'source', order: 2, suppliers: ['Procurement'], inputs: ['Shortlist'] }),
      step({ id: 'unrelated', order: 3 }),
      step({ id: 'unrelated-2', order: 4 }),
      step({ id: 'commit', order: 5, suppliers: ['Procurement'], inputs: ['Budget'] }),
    ]

    const edges = build(steps)
    expect(pairs(edges)).toEqual(['plan->source', 'plan->commit'])
    expect(find(edges, 'plan', 'source')?.label).toBeUndefined()
    expect(find(edges, 'plan', 'commit')?.label).toBe('Budget')
  })
})

describe('createSipocEdges — authored branches (#174)', () => {
  it('still draws a loop back up the chain', () => {
    // "→ Step 1 if rejected" is authored routing (PRD §4.4), so the forward rule
    // above must not touch it — a rework loop points backward by definition.
    const steps = [
      step({ id: 'draft', order: 1 }),
      step({
        id: 'review',
        order: 2,
        decision: true,
        branches: [{ when: 'rejected', toStepId: 'draft', label: 'Rejected' }],
      }),
    ]

    const loop = find(build(steps), 'review', 'draft')
    expect(loop?.label).toBe('Rejected')
    expect(loop?.style?.strokeDasharray).toBe('5,5')
  })
})

describe('createSipocEdges — regressions the forward rule could have caused', () => {
  const graph = (steps: Step[]) => stepsToNodesEdges(steps, [REQUISITION], [PROCUREMENT], [], [])

  it('still draws a terminus when the customer only supplies an earlier step', () => {
    // Finance supplies step 1, so it is "somebody's supplier" — but nothing
    // *later* than step 3 picks it up. Judging terminal customers globally while
    // judging edges forward-only made this hand-off vanish twice over: no edge,
    // because Finance supplies nothing later; and no Process End, because Finance
    // was a supplier somewhere.
    const steps = [
      step({ id: 'open-file', order: 1, suppliers: ['Finance'] }),
      step({ id: 'do-work', order: 2 }),
      step({ id: 'sign-off', order: 3, outputs: ['Signed report'], customers: ['Finance'] }),
    ]

    const { nodes, edges } = graph(steps)

    const terminus = nodes.find((n: Node) => n.type === 'processEnd')
    expect(terminus?.data.entityName).toBe('Finance')
    expect(find(edges, 'sign-off', 'end-Finance')?.label).toBe('Signed report')
  })

  it('does not label a terminus with the placeholder word "Output"', () => {
    const steps = [
      step({ id: 'notify', order: 1, customers: ['Acme Supplies'] }),
    ]

    const endEdge = find(graph(steps).edges, 'notify', 'end-Acme Supplies')
    expect(endEdge).toBeDefined()
    expect(endEdge?.label).toBeUndefined()
  })

  it('follows an output the team edge does not carry', () => {
    // The team edge to Legal carries nothing this step outputs, so gating the
    // fallback on "did any team edge draw?" dropped the real Contract hand-off.
    const steps = [
      step({ id: 'pick-vendor', order: 1, outputs: ['Contract'], customers: ['Legal'] }),
      step({ id: 'legal-review', order: 2, suppliers: ['Legal'], inputs: ['Redlines'] }),
      step({ id: 'sign-contract', order: 3, inputs: ['Contract'] }),
    ]

    const edges = build(steps)
    expect(pairs(edges)).toEqual(['pick-vendor->legal-review', 'pick-vendor->sign-contract'])
    expect(find(edges, 'pick-vendor', 'legal-review')?.label).toBeUndefined()
    expect(find(edges, 'pick-vendor', 'sign-contract')?.label).toBe('Contract')
  })

  it('keeps an authored branch when a SIPOC rule wants the same pair', () => {
    // The fallback now draws review→publish on its own, and the branch pass ran
    // second and bailed on the duplicate id — so the branch silently lost its
    // "Approved" label and its dashed stroke to a solid "Doc v2" edge.
    const steps = [
      step({ id: 'draft', order: 1, outputs: ['Doc'] }),
      step({
        id: 'review',
        order: 2,
        inputs: ['Doc'],
        outputs: ['Doc v2'],
        decision: true,
        branches: [{ when: 'approved', toStepId: 'publish', label: 'Approved' }],
      }),
      step({ id: 'publish', order: 3, inputs: ['Doc v2'] }),
    ]

    const branch = find(build(steps), 'review', 'publish')
    expect(branch?.label).toBe('Approved')
    expect(branch?.style?.strokeDasharray).toBe('5,5')
  })
})
