/**
 * Swimlanes are the step's owner team, not its first supplier.
 *
 * Regression cover for #175: lanes keyed on `suppliers[0]`, so a step with a
 * perfectly good `team_id` landed in the grey "Unassigned" lane whenever it had
 * no supplier — which the SIPOC wizard guarantees for every step after the
 * first (sipocParser.ts only gives suppliers to step 1).
 */

import { describe, expect, it } from 'vitest'
import {
  stepsToNodesEdges,
  UNASSIGNED_LANE_ID,
  type ProcessEndNodeData,
  type StepNodeData,
} from '../lib/graphBuilder'
import { RULE } from '../lib/diagramInk'
import type { Gap, Milestone, Step, System, Team } from '../data/types'

const makeTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-ops',
  projectId: 'project-1',
  name: 'Operations',
  color: '#10B981',
  order: 0,
  tags: [],
  createdAt: 0,
  ...overrides,
})

const makeMilestone = (overrides: Partial<Milestone> = {}): Milestone => ({
  id: 'milestone-1',
  projectId: 'project-1',
  name: 'Requisition',
  order: 0,
  relatedPolicies: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const makeStep = (overrides: Partial<Step> = {}): Step => ({
  id: 'step-1',
  projectId: 'project-1',
  label: 'Raise request',
  teamId: 'team-ops',
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

const laneOf = (step: Step, teams: Team[]) => {
  const { nodes } = stepsToNodesEdges([step], [makeMilestone()], teams, [], [])
  const node = nodes.find(n => n.id === step.id)
  const data = node?.data as StepNodeData
  return { name: data.teamName, color: data.teamColor }
}

describe('stepsToNodesEdges — swimlane derivation', () => {
  it('puts a step in its owner team lane', () => {
    const team = makeTeam()
    expect(laneOf(makeStep(), [team])).toEqual({ name: 'Operations', color: '#10B981' })
  })

  it('uses the owner team even when the first supplier names a different team', () => {
    const ops = makeTeam()
    const approver = makeTeam({ id: 'team-approver', name: 'Approver', color: '#8B5CF6', order: 1 })

    // Supplier says Approver, ownership says Operations. Ownership wins.
    const step = makeStep({ teamId: ops.id, suppliers: ['Approver'] })

    expect(laneOf(step, [ops, approver])).toEqual({ name: 'Operations', color: '#10B981' })
  })

  it('keeps a supplier-less step in its owner lane instead of Unassigned', () => {
    // The wizard's shape: only the first parsed step carries suppliers.
    const team = makeTeam()
    expect(laneOf(makeStep({ suppliers: [] }), [team]).name).toBe('Operations')
  })

  it('falls back to Unassigned when the owner team id does not resolve', () => {
    // Legacy rows with a dangling team_id (#104) still have to render. The colour
    // is `--gs-rule`: a step nobody owns reads as an absence of team colour rather
    // than as a twelfth team (#212).
    const step = makeStep({ teamId: 'team-deleted' })
    expect(laneOf(step, [makeTeam()])).toEqual({ name: 'Unassigned', color: RULE })
  })

  it('separates steps owned by different teams into different lanes', () => {
    const ops = makeTeam()
    const approver = makeTeam({ id: 'team-approver', name: 'Approver', color: '#8B5CF6', order: 1 })

    // Identical suppliers — the old lane rule would have merged these two.
    const { nodes } = stepsToNodesEdges(
      [
        makeStep({ id: 'step-1', teamId: ops.id, suppliers: ['Shared'] }),
        makeStep({ id: 'step-2', teamId: approver.id, suppliers: ['Shared'] }),
      ],
      [makeMilestone()],
      [ops, approver],
      [],
      []
    )

    const lanes = nodes
      .filter(n => n.id.startsWith('step-'))
      .map(n => (n.data as StepNodeData).teamName)

    expect(lanes).toEqual(['Operations', 'Approver'])
  })
})

/**
 * Lane identity, not lane appearance.
 *
 * Lanes used to group on the team *name*, so two teams called "Ops" collapsed
 * into one band that silently took one of their colours (#244). The key is the
 * team id; a hand-off keeps joining the receiving team's lane because its
 * customer name is resolved to that team first.
 */
describe('stepsToNodesEdges — lane keys', () => {
  const makeSystem = (overrides: Partial<System> = {}): System => ({
    id: 'system-erp',
    projectId: 'project-1',
    name: 'SAP',
    tags: [],
    createdAt: 0,
    ...overrides,
  })

  const laneKeyOf = (nodes: ReturnType<typeof stepsToNodesEdges>['nodes'], id: string) => {
    const data = nodes.find(n => n.id === id)?.data as StepNodeData | ProcessEndNodeData
    return { laneId: data.laneId, laneOrder: data.laneOrder }
  }

  it('keys a step lane on the owner team id, not its name', () => {
    const team = makeTeam({ order: 3 })
    const { nodes } = stepsToNodesEdges([makeStep()], [makeMilestone()], [team], [], [])

    expect(laneKeyOf(nodes, 'step-1')).toEqual({ laneId: 'team:team-ops', laneOrder: 3 })
  })

  it('gives two teams sharing a name two lane keys', () => {
    const opsA = makeTeam({ id: 'team-ops-a', name: 'Ops', order: 0 })
    const opsB = makeTeam({ id: 'team-ops-b', name: 'Ops', color: '#3B82F6', order: 1 })

    const { nodes } = stepsToNodesEdges(
      [
        makeStep({ id: 'step-1', teamId: opsA.id }),
        makeStep({ id: 'step-2', teamId: opsB.id }),
      ],
      [makeMilestone()],
      [opsA, opsB],
      [],
      []
    )

    expect(laneKeyOf(nodes, 'step-1').laneId).toBe('team:team-ops-a')
    expect(laneKeyOf(nodes, 'step-2').laneId).toBe('team:team-ops-b')
  })

  it('puts a step with a dangling team id in the unassigned lane', () => {
    const { nodes } = stepsToNodesEdges(
      [makeStep({ teamId: 'team-deleted' })],
      [makeMilestone()],
      [makeTeam()],
      [],
      []
    )

    expect(laneKeyOf(nodes, 'step-1')).toEqual({ laneId: UNASSIGNED_LANE_ID, laneOrder: null })
  })

  it('joins a hand-off to the receiving team lane', () => {
    const ops = makeTeam({ order: 2 })
    const finance = makeTeam({ id: 'team-finance', name: 'Finance', order: 5 })

    const { nodes } = stepsToNodesEdges(
      [makeStep({ outputs: ['Report'], customers: ['Finance'] })],
      [makeMilestone()],
      [ops, finance],
      [],
      []
    )

    expect(laneKeyOf(nodes, 'end-Finance')).toEqual({ laneId: 'team:team-finance', laneOrder: 5 })
  })

  it('gives a hand-off to a system or an external party its own lane', () => {
    const { nodes } = stepsToNodesEdges(
      [
        makeStep({ id: 'step-1', outputs: ['Record'], customers: ['SAP'] }),
        makeStep({ id: 'step-2', outputs: ['Notice'], customers: ['Acme Supplies'] }),
      ],
      [makeMilestone()],
      [makeTeam()],
      [makeSystem()],
      []
    )

    expect(laneKeyOf(nodes, 'end-SAP')).toEqual({ laneId: 'name:SAP', laneOrder: null })
    expect(laneKeyOf(nodes, 'end-Acme Supplies')).toEqual({
      laneId: 'name:Acme Supplies',
      laneOrder: null,
    })
  })
})

/**
 * The gap count a node draws.
 *
 * `StepNode` used to read `step.gapIds`, a back-reference column that every gap
 * creation path writes as `[]` — so the diagram drew no gap badge for a step that
 * plainly had gaps, and had never drawn one. The count now comes from the gaps
 * register, which is what `RightPanel` and the CSV export already treat as the
 * source of truth (#212).
 */
describe('stepsToNodesEdges — per-step gap count', () => {
  const makeGap = (overrides: Partial<Gap> = {}): Gap =>
    ({
      id: 'gap-1',
      projectId: 'project-1',
      stepId: 'step-1',
      title: 'Manual rekeying',
      severity: 'High',
      status: 'Open',
      order: 1,
      tags: [],
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    }) as Gap

  const gapCountOf = (gaps: Gap[], stepId = 'step-1') => {
    const { nodes } = stepsToNodesEdges([makeStep()], [makeMilestone()], [makeTeam()], [], gaps)
    return (nodes.find(n => n.id === stepId)?.data as StepNodeData).gapCount
  }

  it('counts the open gaps raised against the step', () => {
    expect(gapCountOf([makeGap({ id: 'gap-1' }), makeGap({ id: 'gap-2' })])).toBe(2)
  })

  it('ignores closed gaps, matching the board header and tab counts', () => {
    expect(
      gapCountOf([makeGap({ id: 'gap-1' }), makeGap({ id: 'gap-2', status: 'Closed' })])
    ).toBe(1)
  })

  it('ignores a gap raised against another step', () => {
    expect(gapCountOf([makeGap({ id: 'gap-2', stepId: 'step-other' })])).toBe(0)
  })

  it('ignores a project-level gap with no step', () => {
    expect(gapCountOf([makeGap({ id: 'gap-2', stepId: undefined })])).toBe(0)
  })

  it('is zero when the register is empty, rather than undefined', () => {
    expect(gapCountOf([])).toBe(0)
  })

  /**
   * The regression itself: gap_ids is empty in real data, so a node that trusted it
   * showed nothing. Populating it must not resurrect the old source.
   */
  it('does not read the dead gap_ids back-reference', () => {
    const { nodes } = stepsToNodesEdges(
      [makeStep({ gapIds: ['gap-a', 'gap-b', 'gap-c'] })],
      [makeMilestone()],
      [makeTeam()],
      [],
      []
    )
    expect((nodes[0].data as StepNodeData).gapCount).toBe(0)
  })
})
