/**
 * Collapsing a milestone folds its steps into one box (#156, PRD §4.5.2).
 *
 * The four things the acceptance criteria ask for are the four things that can go
 * wrong quietly: the box has to carry real counts, the whole milestone has to take
 * one column, every edge that touched a folded step has to land on the box without
 * colliding with another, and expanding has to give back exactly the graph that was
 * there before.
 *
 * The lane cover is the non-obvious one. Lanes used to be re-derived from whichever
 * nodes the layout was handed, so a team whose every step sat inside the folded
 * milestone lost its band — and the box, which spans the bands its steps are in,
 * would then have had nothing to span.
 */

import { describe, expect, it } from 'vitest'
import { milestoneBoxId, stepsToNodesEdges } from '../lib/graphBuilder'
import { layoutGraph, MILESTONE_BOX_WIDTH } from '../lib/layout'
import type { Gap, Milestone, Step, Team } from '../data/types'

const team = (id: string, name: string, order: number): Team => ({
  id,
  projectId: 'project-1',
  name,
  color: '#10B981',
  order,
  tags: [],
  createdAt: 0,
})

const milestone = (id: string, name: string, order: number): Milestone => ({
  id,
  projectId: 'project-1',
  name,
  order,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
})

const step = (overrides: Partial<Step> & Pick<Step, 'id' | 'teamId' | 'milestoneId'>): Step => ({
  projectId: 'project-1',
  label: overrides.id,
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

const gap = (id: string, stepId: string, status: Gap['status'] = 'Open'): Gap => ({
  id,
  projectId: 'project-1',
  stepId,
  observed: id,
  expected: '',
  severity: 'H',
  status,
  links: [],
  createdAt: 0,
  updatedAt: 0,
})

const REQUESTOR = team('team-req', 'Requestor', 0)
const APPROVER = team('team-app', 'Approver', 1)
const PAYER = team('team-pay', 'Payer', 2)

const REQUISITION = milestone('ms-req', 'Requisition', 0)
const APPROVAL = milestone('ms-app', 'Approval', 1)
const PAYMENT = milestone('ms-pay', 'Payment', 2)
const MILESTONES = [REQUISITION, APPROVAL, PAYMENT]

/**
 * Requisition hands to Approval, which hands to Payment. Approval is worked by
 * two teams, so folding it is the case that spans bands.
 */
const processSteps = (): Step[] => [
  step({
    id: 'raise-request',
    teamId: REQUESTOR.id,
    milestoneId: REQUISITION.id,
    order: 1,
    outputs: ['Request'],
  }),
  step({
    id: 'check-budget',
    teamId: APPROVER.id,
    milestoneId: APPROVAL.id,
    order: 1,
    inputs: ['Request'],
    outputs: ['Budget check'],
  }),
  step({
    id: 'sign-off',
    teamId: PAYER.id,
    milestoneId: APPROVAL.id,
    order: 2,
    inputs: ['Budget check'],
    outputs: ['Approved request'],
  }),
  step({
    id: 'pay-invoice',
    teamId: REQUESTOR.id,
    milestoneId: PAYMENT.id,
    order: 1,
    inputs: ['Approved request'],
  }),
]

const TEAMS = [REQUESTOR, APPROVER, PAYER]
const APPROVAL_BOX = milestoneBoxId(APPROVAL.id)

const build = (collapsed: string[] = [], gaps: Gap[] = []) =>
  stepsToNodesEdges(processSteps(), MILESTONES, TEAMS, [], gaps, new Set(collapsed))

const nodeIds = (graph: ReturnType<typeof build>) => graph.nodes.map(node => node.id).sort()

describe('stepsToNodesEdges — collapsed milestones', () => {
  it('replaces a milestone’s steps with one box', () => {
    const graph = build([APPROVAL.id])

    expect(nodeIds(graph)).not.toContain('check-budget')
    expect(nodeIds(graph)).not.toContain('sign-off')
    expect(nodeIds(graph).filter(id => id === APPROVAL_BOX)).toHaveLength(1)
    expect(nodeIds(graph)).toContain('raise-request')
    expect(nodeIds(graph)).toContain('pay-invoice')
  })

  it('shows the folded step count and the open gap count on the box', () => {
    const gaps = [
      gap('gap-1', 'check-budget'),
      gap('gap-2', 'sign-off'),
      gap('gap-3', 'sign-off', 'Closed'),
      gap('gap-4', 'pay-invoice'),
    ]
    const box = build([APPROVAL.id], gaps).nodes.find(node => node.id === APPROVAL_BOX)!

    expect(box.data.stepCount).toBe(2)
    // Closed gaps do not count, matching the step node's corner tag.
    expect(box.data.gapCount).toBe(2)
    expect(box.data.label).toBe('Approval')
  })

  it('folds the whole milestone into one column, and leaves the others alone', () => {
    const graph = build([APPROVAL.id])
    const columnOf = (id: string) => graph.nodes.find(node => node.id === id)!.data.column

    expect(columnOf('raise-request')).toBe(0)
    expect(columnOf(APPROVAL_BOX)).toBe(1)
    expect(columnOf('pay-invoice')).toBe(2)
  })

  it('names the lanes the folded steps sit in, so the box can span them', () => {
    const box = build([APPROVAL.id]).nodes.find(node => node.id === APPROVAL_BOX)!

    expect(new Set(box.data.laneIds)).toEqual(
      new Set([`team:${APPROVER.id}`, `team:${PAYER.id}`])
    )
  })

  it('keeps a lane whose every step is folded', () => {
    // Approver works nothing outside Approval, so folding it removes the team's
    // only node. The band has to survive that.
    const lanes = build([APPROVAL.id]).lanes
    const approver = lanes.find(lane => lane.laneId === `team:${APPROVER.id}`)

    expect(approver).toBeDefined()
    // The gutter count is taken before the fold, so the team does not read as
    // having lost its step.
    expect(approver!.nodeCount).toBe(1)
  })

  it('ignores a milestone with no steps', () => {
    const empty = milestone('ms-empty', 'Empty', 3)
    const graph = stepsToNodesEdges(
      processSteps(),
      [...MILESTONES, empty],
      TEAMS,
      [],
      [],
      new Set([empty.id])
    )

    expect(graph.nodes.some(node => node.type === 'milestone')).toBe(false)
  })
})

describe('stepsToNodesEdges — edges across a collapsed milestone', () => {
  it('retargets an inbound edge and re-sources an outbound one', () => {
    const edges = build([APPROVAL.id]).edges

    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'raise-request', target: APPROVAL_BOX })
    )
    expect(edges).toContainEqual(
      expect.objectContaining({ source: APPROVAL_BOX, target: 'pay-invoice' })
    )
  })

  it('drops an edge that is now inside the box', () => {
    const edges = build([APPROVAL.id]).edges

    expect(edges.some(edge => edge.source === edge.target)).toBe(false)
    expect(
      edges.some(edge => edge.source === 'check-budget' || edge.target === 'sign-off')
    ).toBe(false)
  })

  it('gives every edge a unique id when several steps fold onto one', () => {
    // Both folded steps take 'Request', so both would draw an edge from
    // raise-request. React Flow drops silently on a duplicate id.
    const steps = processSteps().map(existing =>
      existing.id === 'sign-off' ? { ...existing, inputs: ['Request'] } : existing
    )
    const edges = stepsToNodesEdges(steps, MILESTONES, TEAMS, [], [], new Set([APPROVAL.id])).edges
    const ids = edges.map(edge => edge.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(edges.filter(edge => edge.target === APPROVAL_BOX)).toHaveLength(1)
  })

  it('retargets an edge to a terminal customer’s Process End node', () => {
    const steps = processSteps().map(existing =>
      existing.id === 'sign-off'
        ? { ...existing, customers: ['NetSuite'], outputs: ['Approved request'] }
        : existing
    )
    const edges = stepsToNodesEdges(steps, MILESTONES, TEAMS, [], [], new Set([APPROVAL.id])).edges

    expect(edges).toContainEqual(
      expect.objectContaining({ source: APPROVAL_BOX, target: 'end-NetSuite' })
    )
  })

  it('drops the label on a remapped edge and keeps it everywhere else', () => {
    const expanded = build().edges
    const collapsed = build([APPROVAL.id]).edges

    expect(expanded.find(edge => edge.id === 'raise-request-check-budget')?.label).toBe('Request')
    expect(collapsed.find(edge => edge.target === APPROVAL_BOX)?.label).toBeUndefined()
  })

  it('connects two boxes when both milestones are collapsed', () => {
    // PRD §4.5.2 states this case on its own: with both ends folded, the edge is
    // between the boxes and touches neither's steps.
    const edges = build([APPROVAL.id, PAYMENT.id]).edges
    const paymentBox = milestoneBoxId(PAYMENT.id)

    expect(edges).toContainEqual(
      expect.objectContaining({ source: APPROVAL_BOX, target: paymentBox })
    )
    expect(edges.some(edge => edge.target === 'pay-invoice')).toBe(false)
  })

  it('changes nothing when no milestone is collapsed', () => {
    const untouched = build()
    const emptySet = stepsToNodesEdges(processSteps(), MILESTONES, TEAMS, [], [], new Set())

    expect(nodeIds(emptySet)).toEqual(nodeIds(untouched))
    expect(emptySet.edges.map(edge => edge.id)).toEqual(untouched.edges.map(edge => edge.id))
  })
})

describe('layoutGraph — collapsed milestone boxes', () => {
  const layout = (collapsed: string[] = []) =>
    layoutGraph(build(collapsed), {
      direction: 'RIGHT',
      nodeSpacingX: 100,
      nodeSpacingY: 80,
      swimlaneSpacing: 140,
    })

  it('spans the box over the bands its steps sit in', async () => {
    const { nodes, swimlanes } = await layout([APPROVAL.id])
    const box = nodes.find(node => node.id === APPROVAL_BOX)!
    const spanned = swimlanes.filter(lane =>
      [`swimlane-team:${APPROVER.id}`, `swimlane-team:${PAYER.id}`].includes(lane.id)
    )

    expect(spanned).toHaveLength(2)
    const top = Math.min(...spanned.map(lane => lane.y))
    const bottom = Math.max(...spanned.map(lane => lane.y + lane.height))

    expect(box.position.y).toBe(top)
    expect(box.height).toBe(bottom - top)
    expect(box.width).toBe(MILESTONE_BOX_WIDTH)
    // Rendered from `style`, read for the export bounds from `width`/`height`.
    expect(box.style).toMatchObject({ width: MILESTONE_BOX_WIDTH, height: bottom - top })
  })

  it('still draws a band for a team whose every step is folded', async () => {
    const { swimlanes } = await layout([APPROVAL.id])

    expect(swimlanes.map(lane => lane.name)).toContain('Approver')
    expect(swimlanes.every(lane => lane.height > 0)).toBe(true)
  })

  it('draws every band and every box with the whole process folded', async () => {
    // Every lane is empty of visible nodes here, which is the only thing that
    // exercises the empty-lane path in placeSwimlanes.
    const { nodes, swimlanes } = await layout([REQUISITION.id, APPROVAL.id, PAYMENT.id])

    expect(nodes.filter(node => node.type === 'milestone')).toHaveLength(3)
    expect(swimlanes).toHaveLength(3)

    const finite = (value: number | null | undefined) => Number.isFinite(value ?? NaN)
    expect(swimlanes.every(lane => finite(lane.y) && lane.height > 0)).toBe(true)
    expect(
      nodes.every(node => finite(node.position.x) && finite(node.position.y) && finite(node.height))
    ).toBe(true)
  })

  it('never paints another node on top of the box', async () => {
    // A terminus lands at its source's column plus one, which is exactly where the
    // next milestone folds. The box spans whole bands, so a node sharing its column
    // has nowhere to move to and the box disappears underneath it.
    const steps = processSteps().map(existing =>
      existing.id === 'raise-request'
        ? { ...existing, customers: [PAYER.name], outputs: ['Request'] }
        : existing
    )
    const graph = stepsToNodesEdges(steps, MILESTONES, TEAMS, [], [], new Set([APPROVAL.id]))
    const { nodes } = await layoutGraph(graph, {
      direction: 'RIGHT',
      nodeSpacingX: 100,
      nodeSpacingY: 80,
      swimlaneSpacing: 140,
    })

    const box = nodes.find(node => node.id === APPROVAL_BOX)!
    const terminus = nodes.find(node => node.id === `end-${PAYER.name}`)!

    expect(terminus).toBeDefined()
    // The pre-condition this guards: graphBuilder gives both the same column, so
    // only the layout's slot split keeps them apart.
    expect(terminus.data.column).toBe(box.data.column)
    const boxRight = box.position.x + (box.width ?? 0)
    const terminusRight = terminus.position.x + 200
    // Disjoint horizontally is enough: the box owns its column outright.
    expect(terminusRight <= box.position.x || terminus.position.x >= boxRight).toBe(true)
  })

  it('puts the box in its own column, clear of the steps either side', async () => {
    const { nodes } = await layout([APPROVAL.id])
    const xOf = (id: string) => nodes.find(node => node.id === id)!.position.x

    expect(xOf('raise-request')).toBeLessThan(xOf(APPROVAL_BOX))
    expect(xOf(APPROVAL_BOX)).toBeLessThan(xOf('pay-invoice'))
  })
})
