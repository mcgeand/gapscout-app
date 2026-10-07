/**
 * Swimlane bands are placed by us, not by ELK's root pass.
 *
 * Regression cover for #278: the root graph is `layered`, which assigns children
 * with no edge between them to the same layer — one row under `DOWN` — so lanes
 * that nothing connects landed on the same `y` and were spread sideways instead.
 * Before #175 lanes keyed on `suppliers[0]`, which guaranteed an output→input
 * edge between consecutive lanes; owner-team lanes carry no such guarantee, and
 * a process whose steps declare no customers has no step→step edge to supply one
 * (#174). That is the 2026-09-03 QA project, where every lane but one collapsed.
 *
 * Also covers #243 (lane order follows Teams.order) and the geometry half of
 * #244 (two teams sharing a name are two bands).
 *
 * The QA shape is the fixture: five steps owned by one team, one by another, and
 * a hand-off to a third that has no steps of its own.
 */

import { describe, expect, it } from 'vitest'
import { stepsToNodesEdges } from '../lib/graphBuilder'
import { layoutGraph, MIN_SWIMLANE_WIDTH, type SwimlaneLayout } from '../lib/layout'
import type { Milestone, Step, Team } from '../data/types'

const NODE_HEIGHT = { step: 60, decision: 80, processEnd: 80 } as const
const NODE_WIDTH = { step: 180, decision: 80, processEnd: 200 } as const

const team = (id: string, name: string, order: number, color = '#10B981'): Team => ({
  id,
  projectId: 'project-1',
  name,
  color,
  order,
  tags: [],
  createdAt: 0,
})

const milestone: Milestone = {
  id: 'milestone-1',
  projectId: 'project-1',
  name: 'Requisition',
  order: 0,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
}

const step = (overrides: Partial<Step> & Pick<Step, 'id' | 'teamId'>): Step => ({
  projectId: 'project-1',
  label: overrides.id,
  milestoneId: 'milestone-1',
  order: 1,
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

const REQUESTOR = team('team-req', 'Requestor', 0, '#F59E0B')
const BUDGET_OWNER = team('team-budget', 'Budget Owner', 1, '#3B82F6')
const ACCOUNTS_PAYABLE = team('team-ap', 'Accounts Payable', 2, '#10B981')

/** Five steps one team, one step another, one hand-off to a third. */
const qaSteps = (): Step[] => [
  step({ id: 'raise-request', teamId: REQUESTOR.id, order: 1 }),
  step({ id: 'create-po', teamId: REQUESTOR.id, order: 2 }),
  step({ id: 'receive-goods', teamId: REQUESTOR.id, order: 3 }),
  step({ id: 'check-invoice', teamId: REQUESTOR.id, order: 4 }),
  step({
    id: 'pay-invoice',
    teamId: REQUESTOR.id,
    order: 5,
    outputs: ['Remittance'],
    customers: ['Accounts Payable'],
  }),
  step({ id: 'approve-budget', teamId: BUDGET_OWNER.id, order: 6 }),
]

async function layout(steps: Step[], teams: Team[]) {
  const graph = stepsToNodesEdges(steps, [milestone], teams, [], [])
  const result = await layoutGraph(graph, {
    direction: 'RIGHT',
    nodeSpacingX: 100,
    nodeSpacingY: 80,
    swimlaneSpacing: 140,
  })
  const laneById = new Map(result.swimlanes.map(lane => [lane.id, lane]))
  return { ...result, laneById }
}

const laneNames = (swimlanes: SwimlaneLayout[]) => swimlanes.map(lane => lane.name)

describe('layoutGraph — swimlane placement', () => {
  it('gives every owner team its own band even with no edge between lanes', async () => {
    const { swimlanes } = await layout(qaSteps(), [REQUESTOR, BUDGET_OWNER, ACCOUNTS_PAYABLE])

    expect(laneNames(swimlanes)).toEqual(['Requestor', 'Budget Owner', 'Accounts Payable'])

    // Bands must not overlap: each starts below the one before it.
    for (let i = 1; i < swimlanes.length; i++) {
      const above = swimlanes[i - 1]
      expect(swimlanes[i].y).toBeGreaterThanOrEqual(above.y + above.height)
    }
  })

  it('keeps every node inside its own team band', async () => {
    const { nodes, laneById } = await layout(qaSteps(), [
      REQUESTOR,
      BUDGET_OWNER,
      ACCOUNTS_PAYABLE,
    ])

    expect(nodes).toHaveLength(7) // 6 steps + 1 hand-off

    for (const node of nodes) {
      const lane = laneById.get(`swimlane-${node.data.laneId}`)
      expect(lane, `no band for ${node.id}`).toBeDefined()

      const height = NODE_HEIGHT[(node.type ?? 'step') as keyof typeof NODE_HEIGHT]
      expect(node.position.y).toBeGreaterThanOrEqual(lane!.y)
      expect(node.position.y + height).toBeLessThanOrEqual(lane!.y + lane!.height)
      expect(node.position.x).toBeGreaterThanOrEqual(lane!.x)
      expect(node.position.x + NODE_WIDTH[(node.type ?? 'step') as keyof typeof NODE_WIDTH])
        .toBeLessThanOrEqual(lane!.x + lane!.width)
    }
  })

  it('puts a Process End node in its customer team band', async () => {
    const { nodes, laneById } = await layout(qaSteps(), [
      REQUESTOR,
      BUDGET_OWNER,
      ACCOUNTS_PAYABLE,
    ])

    const endNode = nodes.find(n => n.type === 'processEnd')
    expect(endNode).toBeDefined()

    const lane = laneById.get(`swimlane-team:${ACCOUNTS_PAYABLE.id}`)
    expect(lane?.name).toBe('Accounts Payable')
    expect(endNode!.position.y).toBeGreaterThanOrEqual(lane!.y)
    expect(endNode!.position.y + NODE_HEIGHT.processEnd).toBeLessThanOrEqual(lane!.y + lane!.height)
  })

  it('sizes every band to the widest lane so no lane is cut short', async () => {
    const { nodes, swimlanes } = await layout(qaSteps(), [
      REQUESTOR,
      BUDGET_OWNER,
      ACCOUNTS_PAYABLE,
    ])

    const widths = new Set(swimlanes.map(lane => lane.width))
    expect(widths.size).toBe(1)

    const rightmost = Math.max(...nodes.map(n => n.position.x + 200))
    expect(swimlanes[0].width).toBeGreaterThanOrEqual(rightmost)

    // The fixture's widest lane runs past the floor, so this asserts the width
    // is derived rather than merely defaulted.
    expect(swimlanes[0].width).toBeGreaterThan(MIN_SWIMLANE_WIDTH)
  })
})

describe('layoutGraph — lane order (#243)', () => {
  it('orders lanes by teams.order, not by step order', async () => {
    // Steps are authored Budget Owner first; the registry says Requestor first.
    const steps = [
      step({ id: 'approve-budget', teamId: BUDGET_OWNER.id, order: 1 }),
      step({ id: 'raise-request', teamId: REQUESTOR.id, order: 2 }),
    ]

    const { swimlanes } = await layout(steps, [REQUESTOR, BUDGET_OWNER])
    expect(laneNames(swimlanes)).toEqual(['Requestor', 'Budget Owner'])
  })

  it('reorders lanes when the registry is reordered', async () => {
    const reordered = [
      { ...REQUESTOR, order: 1 },
      { ...BUDGET_OWNER, order: 0 },
      { ...ACCOUNTS_PAYABLE, order: 2 },
    ]

    const { swimlanes } = await layout(qaSteps(), reordered)
    expect(laneNames(swimlanes)).toEqual(['Budget Owner', 'Requestor', 'Accounts Payable'])
  })

  it('does not reshuffle lanes when a step is added', async () => {
    const teams = [REQUESTOR, BUDGET_OWNER, ACCOUNTS_PAYABLE]
    const before = await layout(qaSteps(), teams)

    // The new step comes first in the array, so lane order keyed on insertion
    // would put Budget Owner at the top. The registry still says Requestor.
    const after = await layout(
      [step({ id: 'chase-approval', teamId: BUDGET_OWNER.id, order: 0 }), ...qaSteps()],
      teams
    )

    expect(laneNames(after.swimlanes)).toEqual(laneNames(before.swimlanes))
  })

  it('sorts lanes with no owning team to the bottom, by name', async () => {
    // A dangling team_id (Unassigned) and a hand-off to an external party both
    // land outside the registry, so neither has an order to sort on.
    const steps = [
      step({ id: 'raise-request', teamId: REQUESTOR.id, order: 1 }),
      step({ id: 'orphan-step', teamId: 'team-deleted', order: 2 }),
      step({
        id: 'notify-vendor',
        teamId: REQUESTOR.id,
        order: 3,
        outputs: ['Notice'],
        customers: ['Acme Supplies'],
      }),
    ]

    const { swimlanes } = await layout(steps, [REQUESTOR])
    expect(laneNames(swimlanes)).toEqual(['Requestor', 'Acme Supplies', 'Unassigned'])
  })
})

describe('layoutGraph — duplicate team names (#244)', () => {
  it('draws two bands for two teams that share a name', async () => {
    const opsA = team('team-ops-a', 'Ops', 0, '#F59E0B')
    const opsB = team('team-ops-b', 'Ops', 1, '#3B82F6')

    const steps = [
      step({ id: 'step-a', teamId: opsA.id, order: 1 }),
      step({ id: 'step-b', teamId: opsB.id, order: 2 }),
    ]

    const { swimlanes } = await layout(steps, [opsA, opsB])

    expect(swimlanes).toHaveLength(2)
    expect(swimlanes.map(lane => lane.color)).toEqual(['#F59E0B', '#3B82F6'])
    expect(swimlanes[0].y).toBeLessThan(swimlanes[1].y)
  })
})

describe('layoutGraph — chained steps in one lane (#286)', () => {
  /** A same-team chain, linked output→input — the shape #174 makes drawable. */
  const chain = (length: number): Step[] =>
    Array.from({ length }, (_, i) =>
      step({
        id: `link-${String(i).padStart(2, '0')}`,
        teamId: REQUESTOR.id,
        order: i + 1,
        inputs: i === 0 ? [] : [`Doc ${i - 1}`],
        outputs: i === length - 1 ? [] : [`Doc ${i}`],
      })
    )

  it('runs a chain across its band, not down it', async () => {
    const steps = chain(12)
    const { nodes, swimlanes } = await layout(steps, [REQUESTOR])

    const chained = steps.map(s => nodes.find(n => n.id === s.id)!)

    // Every step used to land on the same x and a new row, because the root ELK
    // pass read the chain's edges as layers and laid layers out downward. The
    // measured band was 1660 tall and 380 wide; it should be the other way round.
    const xs = chained.map(n => n.position.x)
    expect(new Set(xs).size).toBe(12)
    expect([...xs]).toEqual([...xs].sort((a, b) => a - b))

    // One row: a chain does not need a second.
    expect(new Set(chained.map(n => n.position.y)).size).toBe(1)

    const band = swimlanes[0]
    expect(band.height).toBeLessThan(200)
    expect(band.width).toBeGreaterThan(band.height)
  })

  it('lays a chain out exactly as it lays unchained steps out', async () => {
    // Whether a hand-off happens to be drawable must not move the steps around.
    const chained = await layout(chain(6), [REQUESTOR])
    const unchained = await layout(
      Array.from({ length: 6 }, (_, i) =>
        step({ id: `link-${String(i).padStart(2, '0')}`, teamId: REQUESTOR.id, order: i + 1 })
      ),
      [REQUESTOR]
    )

    const positionsOf = (result: Awaited<ReturnType<typeof layout>>) =>
      result.nodes.map(n => [n.id, n.position.x, n.position.y])

    expect(positionsOf(chained)).toEqual(positionsOf(unchained))
  })

  it('orders steps along the lane by Step.order', async () => {
    // ELK returned in-layer siblings in whatever order crossing minimisation
    // liked, so step 2 rendered left of step 1.
    const { nodes } = await layout(qaSteps(), [REQUESTOR, BUDGET_OWNER, ACCOUNTS_PAYABLE])

    const byOrder = ['raise-request', 'create-po', 'receive-goods', 'check-invoice', 'pay-invoice']
    const xs = byOrder.map(id => nodes.find(n => n.id === id)!.position.x)

    expect([...xs]).toEqual([...xs].sort((a, b) => a - b))
    expect(new Set(xs).size).toBe(byOrder.length)
  })

  it('stacks parallel steps in one lane instead of overlapping them', async () => {
    // Same milestone, same order: one column, so they need separate rows.
    const steps = [
      step({ id: 'review-a', teamId: REQUESTOR.id, order: 1 }),
      step({ id: 'review-b', teamId: REQUESTOR.id, order: 1 }),
      step({ id: 'combine', teamId: REQUESTOR.id, order: 2 }),
    ]

    const { nodes, swimlanes } = await layout(steps, [REQUESTOR])
    const at = (id: string) => nodes.find(n => n.id === id)!.position

    expect(at('review-a').x).toBe(at('review-b').x)
    expect(at('review-a').y).not.toBe(at('review-b').y)
    expect(at('combine').x).toBeGreaterThan(at('review-a').x)

    // Both rows stay inside the band.
    for (const id of ['review-a', 'review-b', 'combine']) {
      expect(at(id).y).toBeGreaterThanOrEqual(swimlanes[0].y)
      expect(at(id).y + NODE_HEIGHT.step).toBeLessThanOrEqual(swimlanes[0].y + swimlanes[0].height)
    }
  })
})
