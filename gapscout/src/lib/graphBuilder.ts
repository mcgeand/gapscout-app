/**
 * Graph Builder - Transform GapScout steps into React Flow nodes and edges
 * 
 * Converts Step[] data into the graph structure needed for diagram visualization.
 * Swimlanes come from the step's owner team (steps.team_id); edges connect forward
 * on SIPOC Customer→Supplier matching, falling back to output→input when no team
 * names the hand-off (see createSipocEdges).
 *
 * A milestone the caller names as collapsed folds into one box node instead of its
 * steps (PRD §4.5.2), and every edge that touched one of those steps is remapped
 * onto the box — see `foldEdges`.
 * 
 * Reference: PRD Section 4.5 - Diagram Generation
 * Ticket: ZIP-88
 */

import type { Step, Milestone, Team, System, Gap } from '../data/types'
import type { Node, Edge } from 'reactflow'
import {
  compareRank,
  rankKey,
  rankOf,
  type SequenceRank,
} from './stepSequence'
import { INK_FAINT, RULE } from './diagramInk'

/**
 * Stroke applied inline to every edge.
 *
 * Stated inline rather than left to reactflow/dist/style.css because image export
 * (services/exportDiagram.ts) cannot see class-based CSS inside an <svg>, so an
 * edge that relies on the stylesheet draws as nothing at all in a PNG or SVG. The
 * literal comes from lib/diagramInk.ts for the same reason `var()` is unusable
 * there.
 */
export const EDGE_STROKE = {
  strokeWidth: 2,
  stroke: INK_FAINT,
  fill: 'none',
} as const

/**
 * Swimlane key for a node.
 *
 * Team lanes key on the team **id**, so two teams that happen to share a name
 * stay in separate lanes with their own colours (#244). Everything else keys on
 * the name it is known by — a Process End node whose customer is a system or an
 * external party has no team to point at.
 */
export const teamLaneId = (teamId: string) => `team:${teamId}`
export const nameLaneId = (name: string) => `name:${name}`

/** Lane for a step whose `team_id` does not resolve (legacy rows, #104). */
export const UNASSIGNED_LANE_ID = 'unassigned'

/**
 * Node id for a collapsed milestone's box.
 *
 * Prefixed so it can never collide with a step id, which matters because
 * `foldEdges` rewrites edge endpoints from step ids to these.
 */
export const milestoneBoxId = (milestoneId: string) => `milestone-${milestoneId}`

/**
 * Band id for a lane, in the form the two lane renderers expect.
 *
 * Lives here rather than in `layout.ts` because the lane list is built here now:
 * a band has to survive its steps being folded into a milestone box, so it cannot
 * be re-derived from whichever nodes happen to be visible.
 */
export const laneBandId = (laneId: string) => `swimlane-${laneId}`

/**
 * Custom node data structure for React Flow
 */
export interface StepNodeData {
  label: string
  step: Step
  teamColor: string
  teamName: string
  /** Stable swimlane key — see teamLaneId / nameLaneId */
  laneId: string
  /** Owning team's registry position, or null when no team resolves */
  laneOrder: number | null
  /** Position along the process, shared by parallel steps — see assignColumns */
  column: number
  milestoneId: string
  milestoneName: string
  isParallel?: boolean // Step has same order as another in milestone
  /**
   * Open gaps raised against this step, counted from the gaps register.
   *
   * Not `step.gapIds`: that column is a filtering hint every creation path writes
   * as `[]` (exportCSV.ts says as much), so a node reading it drew no gap badge for
   * a step that plainly had gaps. `gaps.step_id` is the source of truth, the same
   * one RightPanel counts from.
   */
  gapCount: number
}

/**
 * Process end node data structure
 * Represents the terminal point where a process outputs to a customer
 * that doesn't have their own process steps
 */
export interface ProcessEndNodeData {
  label: string
  entityName: string // Customer name (team or system)
  teamColor: string
  teamName: string
  /** Stable swimlane key — see teamLaneId / nameLaneId */
  laneId: string
  /** Receiving team's registry position, or null when the customer is not a team */
  laneOrder: number | null
  /** Position along the process — one past the last step that feeds it */
  column: number
  isSystem: boolean
}

/**
 * A milestone folded into one box (PRD §4.5.2).
 *
 * It carries no team colour and no lane of its own: a milestone is not a team, and
 * one that spans several of them would have to pick a lane to lie about. The box is
 * placed across the bands its steps sit in instead — `laneIds` is what the layout
 * spans it over.
 */
export interface MilestoneNodeData {
  label: string
  milestoneId: string
  /** Steps folded into this box. */
  stepCount: number
  /** Open gaps across those steps, counted exactly as a step node counts its own. */
  gapCount: number
  /** Lanes the folded steps sit in, unordered; the layout puts them in band order. */
  laneIds: string[]
  /** Position along the process — the single column the whole milestone folds into */
  column: number
}

/**
 * One swimlane, as the diagram knows it.
 *
 * Built here rather than derived from the laid-out nodes because a lane has to
 * outlive its contents: a team whose only steps are inside a collapsed milestone
 * still owns a band, and re-deriving from visible nodes would delete it.
 */
export interface LaneDescriptor {
  /** Id of the band, in the `swimlane-<laneId>` form renderers expect */
  bandId: string
  /** Stable lane key (`team:<id>`, `name:<x>`, `unassigned`) */
  laneId: string
  name: string
  color: string
  /** Owning team's registry position, or null when no team owns the lane */
  order: number | null
  /**
   * Nodes in the lane, counted before any collapse. The gutter shows this, so a
   * folded milestone must not make a team look like it lost steps.
   */
  nodeCount: number
}

/**
 * Result structure containing nodes, edges and the lanes they belong to
 */
export interface GraphData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): demo file accesses StepNodeData-only fields; revisit when diagram surface is split
  nodes: Node<any>[]
  edges: Edge[]
  lanes: LaneDescriptor[]
}

/**
 * Default team for steps with missing/invalid teamId.
 *
 * `--gs-rule` rather than a grey of its own: a step nobody owns should read as an
 * absence of team colour, not as a twelfth team.
 */
const DEFAULT_TEAM = {
  name: 'Unassigned',
  color: RULE,
}

/**
 * Default milestone for steps with missing/invalid milestoneId
 */
const DEFAULT_MILESTONE = {
  name: 'Unassigned',
}

/**
 * Main transformer function: Steps → React Flow Graph
 * 
 * @param steps - Array of process steps
 * @param milestones - Array of milestones for grouping
 * @param teams - Array of teams for swimlane lookup
 * @param systems - Array of systems for swimlane lookup
 * @param gaps - The project's gaps, for the per-step open-gap count. Required
 *   rather than defaulted: the badge was dead for exactly as long as nobody fed
 *   it, and a default would let the next caller recreate that silently.
 * @param collapsedMilestoneIds - Milestones to fold into a single box each (PRD
 *   §4.5.2). Defaults to none, which is the whole of the previous behaviour: an
 *   empty set changes nothing, so unlike `gaps` there is no silent-default trap.
 * @returns Graph data with nodes, edges and lanes
 */
export function stepsToNodesEdges(
  steps: Step[],
  milestones: Milestone[],
  teams: Team[],
  systems: System[],
  gaps: Gap[],
  collapsedMilestoneIds: ReadonlySet<string> = new Set()
): GraphData {
  // Early return if no steps
  if (steps.length === 0) {
    return { nodes: [], edges: [], lanes: [] }
  }

  // Create lookup maps for performance.
  // Step nodes key on team id (owner team); the Process End nodes below key on the
  // customer *name*, which may be a team or a system, hence both team maps.
  const teamIdMap = new Map(teams.map(t => [t.id, t]))
  const teamNameMap = new Map(teams.map(t => [t.name, t]))
  const systemNameMap = new Map(systems.map(s => [s.name, s]))
  const milestoneMap = new Map(milestones.map(m => [m.id, m]))

  // Only milestones that actually hold a step can fold; ticking an empty one
  // would otherwise put a box with nothing in it on the canvas.
  const folded = new Set(
    steps
      .filter(step => collapsedMilestoneIds.has(step.milestoneId))
      .map(step => step.milestoneId)
  )

  // Where each step sits along the process; the layout turns these into x
  const columns = assignColumns(steps, milestoneMap, folded)

  const gapCounts = openGapCounts(gaps)

  // Phase 1: Create nodes from steps
  const nodes = createNodes(steps, teamIdMap, milestoneMap, columns, gapCounts)

  // Phase 2: Create edges based on SIPOC Customer→Supplier matching
  const edges = createSipocEdges(steps, milestoneMap)

  // Phase 3: Create "Process End" nodes for terminal customers
  const { endNodes, endEdges } = createProcessEndNodes(
    steps,
    teamNameMap,
    systemNameMap,
    columns,
    milestoneMap
  )

  // Lanes are described from every node the project has, folded or not, so a team
  // whose whole contribution sits inside a collapsed milestone keeps its band.
  const lanes = describeLanes([...nodes, ...endNodes])

  // Phase 4: Fold the collapsed milestones. Everything above ran over the full
  // step set, so the rules that build edges never have to know about collapse.
  const boxes = createMilestoneNodes(nodes, milestoneMap, folded, columns, gapCounts)
  const visibleNodes = nodes.filter(node => !folded.has(node.data.milestoneId))
  const allNodes = [...visibleNodes, ...boxes, ...endNodes]
  const allEdges = foldEdges([...edges, ...endEdges], nodeIdResolver(nodes, folded))

  console.log(`Graph Builder: Created ${visibleNodes.length} process nodes, ${boxes.length} milestone boxes, ${endNodes.length} end nodes, ${allEdges.length} edges`)

  return { nodes: allNodes, edges: allEdges, lanes }
}

/**
 * The lanes the diagram has, one per distinct lane key.
 *
 * Name, colour and registry position are read off the lane's own nodes, and the
 * count is taken here — before any milestone folds — so the gutter keeps showing
 * how many nodes the lane really holds.
 */
function describeLanes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see GraphData
  nodes: Node<any>[]
): LaneDescriptor[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
  const byLane = new Map<string, Node<any>[]>()
  for (const node of nodes) {
    const laneId: string = node.data?.laneId ?? UNASSIGNED_LANE_ID
    const laneNodes = byLane.get(laneId) ?? []
    laneNodes.push(node)
    byLane.set(laneId, laneNodes)
  }

  return [...byLane.entries()].map(([laneId, laneNodes]) => ({
    bandId: laneBandId(laneId),
    laneId,
    name: laneNodes[0].data.teamName,
    color: laneNodes[0].data.teamColor,
    order: laneNodes[0].data.laneOrder ?? null,
    nodeCount: laneNodes.length,
  }))
}

/**
 * One box per folded milestone, carrying the counts and the lanes to span.
 */
function createMilestoneNodes(
  stepNodes: Node<StepNodeData>[],
  milestoneMap: Map<string, Milestone>,
  folded: ReadonlySet<string>,
  columns: Map<string, number>,
  gapCounts: Map<string, number>
): Node<MilestoneNodeData>[] {
  return [...folded].map(milestoneId => {
    const nodesInMilestone = stepNodes.filter(node => node.data.milestoneId === milestoneId)

    // Every step in the milestone shares one column by construction — that is
    // what `assignColumns` canonicalises — so the first one names it.
    const column = columns.get(nodesInMilestone[0].id) ?? 0

    return {
      id: milestoneBoxId(milestoneId),
      type: 'milestone',
      data: {
        label: milestoneMap.get(milestoneId)?.name ?? DEFAULT_MILESTONE.name,
        milestoneId,
        stepCount: nodesInMilestone.length,
        gapCount: nodesInMilestone.reduce(
          (total, node) => total + (gapCounts.get(node.id) ?? 0),
          0
        ),
        laneIds: [...new Set(nodesInMilestone.map(node => node.data.laneId))],
        column,
      },
      position: { x: 0, y: 0 }, // Placed by the layout, which spans it over bands
    }
  })
}

/**
 * Step id → the node that now stands for it: itself, or its milestone's box.
 */
function nodeIdResolver(
  stepNodes: Node<StepNodeData>[],
  folded: ReadonlySet<string>
): (nodeId: string) => string {
  const boxByStepId = new Map(
    stepNodes
      .filter(node => folded.has(node.data.milestoneId))
      .map(node => [node.id, milestoneBoxId(node.data.milestoneId)])
  )
  return nodeId => boxByStepId.get(nodeId) ?? nodeId
}

/**
 * Rewrite every edge onto the nodes that are actually drawn.
 *
 * An edge between two steps of the same folded milestone disappears — it is now
 * inside the box. One that crosses the boundary keeps its stroke and gets a new
 * id from the remapped pair, because several steps handing to the same target
 * collapse onto one edge and React Flow drops silently on a duplicate id.
 *
 * A remapped edge loses its label. The label names the outputs *this* step's
 * target takes as inputs; between a box and a step that intersection spans every
 * folded step, so keeping one of them would claim the milestone hands over only
 * that. Order is the dedupe rule — authored branches are laid down first, so a
 * conditional route out of a milestone keeps its dashed stroke.
 *
 * With nothing folded the resolver is the identity, every edge is returned
 * untouched, and this is a no-op.
 */
function foldEdges(edges: Edge[], nodeIdOf: (nodeId: string) => string): Edge[] {
  const folded: Edge[] = []
  const seen = new Set<string>()

  for (const edge of edges) {
    const source = nodeIdOf(edge.source)
    const target = nodeIdOf(edge.target)
    if (source === target) continue

    const remapped = source !== edge.source || target !== edge.target
    const id = remapped ? `${source}-${target}` : edge.id
    if (seen.has(id)) continue
    seen.add(id)

    folded.push(remapped ? { ...edge, id, source, target, label: undefined } : edge)
  }

  return folded
}

/**
 * Only a strictly later step can receive a hand-off.
 *
 * Strict is the point: two steps at the same rank are parallel (`detectParallelSteps`),
 * and parallel steps do not feed each other. Without this, `createSipocEdges` matched
 * in both directions and drew a rework loop back up the chain that nobody authored
 * (#174). A real loop back is authored in `Step.result` as `→ Step N if …`, parsed
 * into `Step.branches`, and drawn by the branch pass below — which deliberately keeps
 * no direction constraint.
 */
function isForward(from: SequenceRank, to: SequenceRank): boolean {
  return compareRank(from, to) < 0
}

/**
 * The steps a customer hand-off lands on: those at the earliest later rank that
 * name the party as a supplier.
 *
 * Matching every later step fanned one hand-off out across the whole process
 * whenever a party was named by team (#363). A project where "Procurement" is a
 * customer on step 1 and a supplier on steps 2, 9 and 17 drew all three arcs,
 * though step 1 hands to Procurement once and the later steps are Procurement
 * passing on something else. The first step to pick the party up is the hand-off.
 *
 * Nearest *rank* rather than nearest step, so a hand-off into parallel work still
 * reaches every branch.
 *
 * `forwardSteps` must already be sorted by rank and hold only later steps.
 */
function nearestSuppliers(
  customer: string,
  forwardSteps: Step[],
  rank: (step: Step) => SequenceRank
): Step[] {
  const first = forwardSteps.find(candidate => candidate.suppliers?.includes(customer))
  if (!first) return []
  return forwardSteps.filter(
    candidate =>
      compareRank(rank(candidate), rank(first)) === 0 && candidate.suppliers?.includes(customer)
  )
}

/**
 * What actually travels along an edge: the source's outputs that the target names
 * as inputs.
 */
function sharedFlow(source: Step, target: Step): string[] {
  const inputs = new Set(target.inputs ?? [])
  return (source.outputs ?? []).filter(output => inputs.has(output))
}

/**
 * Edge label: what the target actually receives, or nothing.
 *
 * Labelling with *all* of the source's outputs claimed things the target never
 * receives — the "Draft PR" on a step that takes no Draft PR (#174). An empty
 * intersection means the SIPOC names nothing flowing, so the edge draws bare
 * rather than borrowing a label from elsewhere.
 */
function flowLabel(source: Step, target: Step): string | undefined {
  const shared = sharedFlow(source, target)
  return shared.length > 0 ? shared.join(', ') : undefined
}

/**
 * Position along the process, as a column index the layout can turn into an x.
 *
 * Densely indexing the *distinct* ranks does two things at once: steps run left to
 * right in the order the grid lists them, and parallel steps — same milestone, same
 * order, which is exactly `detectParallelSteps` — share a column so they stack in
 * one place rather than drifting apart.
 *
 * The layout used to ask ELK for this and got an arbitrary order back, because a
 * set of steps with no edges between them is, to a layered algorithm, one layer
 * (#286). Process position is authored data, not something to infer from edges.
 *
 * A folded milestone's steps are all ranked at the same point, so the whole
 * milestone takes one column and its box sits there. They stay in the returned
 * map rather than being dropped, because `createProcessEndNodes` still places a
 * terminus one column past whichever step hands to it.
 */
function assignColumns(
  steps: Step[],
  milestoneMap: Map<string, Milestone>,
  folded: ReadonlySet<string> = new Set()
): Map<string, number> {
  const ranks = new Map(
    steps.map(step => [step.id, columnRank(step, milestoneMap, folded)])
  )

  const distinctRanks = [...new Map([...ranks.values()].map(rank => [rankKey(rank), rank])).values()]
    .sort(compareRank)

  const columnByRank = new Map(distinctRanks.map((rank, index) => [rankKey(rank), index]))

  return new Map([...ranks].map(([id, rank]) => [id, columnByRank.get(rankKey(rank))!]))
}

/**
 * The step order a folded milestone's steps all collapse onto.
 *
 * Any constant works — `milestones(project_id, "order")` is UNIQUE (#131), so no
 * other milestone can reach this rank, and every step that does reach it is in
 * the same box. It is finite rather than `-Infinity` because `compareRank`
 * subtracts, and `-Infinity - -Infinity` is NaN.
 */
const FOLDED_STEP_ORDER = 0

/** A step's rank for column purposes: its own, or its milestone's when folded. */
function columnRank(
  step: Step,
  milestoneMap: Map<string, Milestone>,
  folded: ReadonlySet<string>
): SequenceRank {
  const rank = rankOf(step, milestoneMap)
  return folded.has(step.milestoneId) ? [rank[0], FOLDED_STEP_ORDER] : rank
}

/**
 * Phase 1: Create React Flow nodes from steps
 *
 * The swimlane is the step's owner team (`steps.team_id`), which is what the Teams
 * registry, its usage counts and the step editor all address. Lanes used to key on
 * `suppliers[0]` instead, which put every step without a supplier into the grey
 * Unassigned lane even when it had a perfectly good owner team.
 */
/**
 * Open gaps per step id.
 *
 * Open only, matching the board header's "N open gaps" and the Gaps tab count. The
 * corner tag means "look here", and a closed gap is one nobody needs to look at.
 */
function openGapCounts(gaps: Gap[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const gap of gaps) {
    if (!gap.stepId || gap.status !== 'Open') continue
    counts.set(gap.stepId, (counts.get(gap.stepId) ?? 0) + 1)
  }
  return counts
}

function createNodes(
  steps: Step[],
  teamIdMap: Map<string, Team>,
  milestoneMap: Map<string, Milestone>,
  columns: Map<string, number>,
  gapCounts: Map<string, number>
): Node<StepNodeData>[] {
  // Detect parallel steps (same order within milestone)
  const parallelStepIds = detectParallelSteps(steps)

  return steps.map(step => {
    // Swimlane comes from the owner team. The fallback covers a dangling team_id
    // left by legacy data (#104) rather than a step that simply has no supplier.
    const team = teamIdMap.get(step.teamId)
    const teamColor = team?.color ?? DEFAULT_TEAM.color
    const teamName = team?.name ?? DEFAULT_TEAM.name
    const laneId = team ? teamLaneId(team.id) : UNASSIGNED_LANE_ID
    const laneOrder = team?.order ?? null

    // Lookup milestone data
    const milestone = milestoneMap.get(step.milestoneId)
    const milestoneName = milestone?.name || DEFAULT_MILESTONE.name

    // Determine node type
    const nodeType = step.decision ? 'decision' : 'step'

    // Create node
    const node: Node<StepNodeData> = {
      id: step.id,
      type: nodeType,
      data: {
        label: step.label,
        step,
        teamColor,
        teamName,
        laneId,
        laneOrder,
        column: columns.get(step.id) ?? 0,
        milestoneId: step.milestoneId,
        milestoneName,
        isParallel: parallelStepIds.has(step.id),
        gapCount: gapCounts.get(step.id) ?? 0,
      },
      // Placeholder position (ELK layout will set actual positions)
      position: step.diagramPosition || { x: 0, y: 0 },
    }

    return node
  })
}

/**
 * Detect parallel steps (same order within same milestone)
 */
function detectParallelSteps(steps: Step[]): Set<string> {
  const parallelIds = new Set<string>()

  // Group steps by milestone
  const stepsByMilestone = new Map<string, Step[]>()
  for (const step of steps) {
    const milestoneSteps = stepsByMilestone.get(step.milestoneId) || []
    milestoneSteps.push(step)
    stepsByMilestone.set(step.milestoneId, milestoneSteps)
  }

  // Within each milestone, find steps with duplicate order numbers
  for (const milestoneSteps of stepsByMilestone.values()) {
    const orderCounts = new Map<number, Step[]>()

    for (const step of milestoneSteps) {
      const stepsAtOrder = orderCounts.get(step.order) || []
      stepsAtOrder.push(step)
      orderCounts.set(step.order, stepsAtOrder)
    }

    // Mark all steps with duplicate orders as parallel
    for (const stepsAtOrder of orderCounts.values()) {
      if (stepsAtOrder.length > 1) {
        for (const step of stepsAtOrder) {
          parallelIds.add(step.id)
        }
      }
    }
  }

  return parallelIds
}

/**
 * Phase 2: Create edges based on SIPOC Customer→Supplier matching
 *
 * Three rules, in order (PRD §4.5):
 *
 * 1. **Forward only, nearest only.** A step hands off to a strictly later step,
 *    never back up, and only to the first one that names the party. See
 *    `nearestSuppliers`.
 * 2. **Label by intersection.** See `flowLabel`.
 * 3. **Fall back to output→input.** Team-level matching says *who* hands over;
 *    it is silent when neither step names a team, which is why a chain like
 *    "PO sent to vendor" → "PO sent to vendor" drew nothing at all (#174). The
 *    fallback is per *output*, not per step: an output that no team edge already
 *    carries follows the material to the earliest later step that takes it as an
 *    input. Per step would lose a real hand-off whenever the step also had an
 *    unrelated team edge; earliest-only keeps the fallback from bringing back the
 *    fan-out that rule 1 cuts. It is also what still draws a long hand-off when
 *    one is real: a far step that takes this step's output is reached here.
 *
 * Authored branches are laid down first, so `→ Step N if …` keeps its label and
 * its dashed stroke even when the SIPOC rules would draw the same pair.
 */
function createSipocEdges(steps: Step[], milestoneMap: Map<string, Milestone>): Edge[] {
  const edges: Edge[] = []
  const edgeIds = new Set<string>() // Prevent duplicates

  const ranks = new Map(steps.map(step => [step.id, rankOf(step, milestoneMap)]))
  const rank = (step: Step) => ranks.get(step.id)!

  // Sort steps by process position, so "earliest match" below is the first hit
  const sortedSteps = [...steps].sort((a, b) => compareRank(rank(a), rank(b)))

  const addEdge = (source: Step, target: Step) => {
    const edgeId = `${source.id}-${target.id}`
    if (edgeIds.has(edgeId)) return false

    edges.push({
      id: edgeId,
      source: source.id,
      target: target.id,
      type: 'smoothstep',
      label: flowLabel(source, target),
      style: { ...EDGE_STROKE },
    })
    edgeIds.add(edgeId)
    return true
  }

  // Authored routing goes down first, so a branch keeps its own label and dashed
  // stroke rather than losing the id to a SIPOC edge for the same pair. It is
  // also exempt from the forward rule: `→ Step N if …` is how a rework loop is
  // expressed (PRD §4.4), and a loop by definition points back up the chain.
  for (const step of steps) {
    for (const branch of step.branches ?? []) {
      const edgeId = `${step.id}-${branch.toStepId}`
      if (edgeIds.has(edgeId)) continue

      edges.push({
        id: edgeId,
        source: step.id,
        target: branch.toStepId,
        label: branch.label || branch.when,
        type: 'smoothstep',
        style: { ...EDGE_STROKE, strokeDasharray: '5,5' }, // Dashed for decision branches
      })
      edgeIds.add(edgeId)
    }
  }

  for (const currentStep of sortedSteps) {
    const forwardSteps = sortedSteps.filter(
      candidate =>
        candidate.id !== currentStep.id && isForward(rank(currentStep), rank(candidate))
    )

    // Rule 1: this step's customers, matched against the nearest later suppliers
    const carried = new Set<string>()
    for (const customer of currentStep.customers ?? []) {
      for (const targetStep of nearestSuppliers(customer, forwardSteps, rank)) {
        addEdge(currentStep, targetStep)
        // Carried either way: a duplicate id means the flow is already drawn.
        for (const output of sharedFlow(currentStep, targetStep)) carried.add(output)
      }
    }

    // Rule 3: whatever no team edge already carries follows the material itself
    for (const output of currentStep.outputs ?? []) {
      if (carried.has(output)) continue
      const nextConsumer = forwardSteps.find(candidate => candidate.inputs?.includes(output))
      if (nextConsumer) addEdge(currentStep, nextConsumer)
    }
  }

  return edges
}

/**
 * Utility: Get all steps in a specific milestone
 */
export function getStepsByMilestone(
  steps: Step[],
  milestoneId: string
): Step[] {
  return steps
    .filter(step => step.milestoneId === milestoneId)
    .sort((a, b) => a.order - b.order)
}

/**
 * Phase 3: Create "Process End" nodes for terminal customers
 * Terminal customers are entities that receive outputs but don't supply any other step
 */
function createProcessEndNodes(
  steps: Step[],
  teamNameMap: Map<string, Team>,
  systemNameMap: Map<string, System>,
  columns: Map<string, number>,
  milestoneMap: Map<string, Milestone>
): { endNodes: Node<ProcessEndNodeData>[]; endEdges: Edge[] } {
  const endNodes: Node<ProcessEndNodeData>[] = []
  const endEdges: Edge[] = []
  
  const ranks = new Map(steps.map(step => [step.id, rankOf(step, milestoneMap)]))
  const rank = (step: Step) => ranks.get(step.id)!

  /**
   * A customer terminates the flow *for this step* when no strictly later step
   * names it as a supplier.
   *
   * This has to agree with the forward-only rule in `createSipocEdges`. Asking
   * whether a customer supplies *any* step did not: a customer that supplies only
   * an earlier step got no forward edge, and no end node either, so the hand-off
   * disappeared from the diagram entirely rather than being drawn as a terminus.
   */
  const servedLater = (customer: string, from: Step) =>
    steps.some(
      candidate =>
        isForward(rank(from), rank(candidate)) && candidate.suppliers?.includes(customer)
    )

  // Collect the customers no later step picks up, per step that hands to them
  const customerToSourceSteps = new Map<string, Step[]>()
  for (const step of steps) {
    for (const customer of step.customers ?? []) {
      if (servedLater(customer, step)) continue

      if (!customerToSourceSteps.has(customer)) {
        customerToSourceSteps.set(customer, [])
      }
      customerToSourceSteps.get(customer)!.push(step)
    }
  }
  
  // Create "Process End" node for each terminal customer
  for (const [customerName, sourceSteps] of customerToSourceSteps.entries()) {
    // Determine if this is a team or system
    const team = teamNameMap.get(customerName)
    const system = systemNameMap.get(customerName)
    
    // Team colour is a *team's* colour. An external party has no team, and a
    // system is not one either — both draw in `--gs-rule` so the only saturated
    // marks on the canvas remain the lane swatch and the node's left edge (#212).
    let teamColor = RULE
    let teamName = customerName
    let isSystem = false
    // A hand-off to a team shares that team's lane, so it keys on the team id
    // exactly as the team's own steps do. A system or an external party has no
    // team to join and keys on its name.
    let laneId = nameLaneId(customerName)
    let laneOrder: number | null = null

    if (team) {
      teamColor = team.color
      teamName = team.name
      laneId = teamLaneId(team.id)
      laneOrder = team.order
    } else if (system) {
      teamName = system.name
      isSystem = true
    }
    
    // Create unique ID for end node
    const endNodeId = `end-${customerName}`
    
    // Create the end node
    const endNode: Node<ProcessEndNodeData> = {
      id: endNodeId,
      type: 'processEnd',
      data: {
        label: 'Process End',
        entityName: customerName,
        teamColor,
        teamName,
        laneId,
        laneOrder,
        // One past the last step that hands over, so the terminus reads as the
        // end of the flow rather than sitting alongside its own source.
        column: Math.max(...sourceSteps.map(s => columns.get(s.id) ?? 0)) + 1,
        isSystem,
      },
      position: { x: 0, y: 0 }, // Will be positioned by ELK
    }
    
    endNodes.push(endNode)
    
    // Create edges from source steps to this end node
    for (const sourceStep of sourceSteps) {
      // A terminus has no inputs to intersect, so the label is everything the
      // step hands over — but never the placeholder word "Output" (#174).
      const outputLabel = sourceStep.outputs?.length
        ? sourceStep.outputs.join(', ')
        : undefined
      
      endEdges.push({
        id: `${sourceStep.id}-${endNodeId}`,
        source: sourceStep.id,
        target: endNodeId,
        type: 'smoothstep',
        label: outputLabel,
        style: {
          ...EDGE_STROKE,
          strokeDasharray: '3,3', // Dashed to indicate endpoint
        },
      })
    }
  }
  
  return { endNodes, endEdges }
}

/**
 * Utility: Get all steps assigned to a specific team
 */
export function getStepsByTeam(
  steps: Step[],
  teamId: string
): Step[] {
  return steps
    .filter(step => step.teamId === teamId)
    .sort((a, b) => a.order - b.order)
}

/**
 * Utility: Check if a step is a start point (no incoming edges)
 */
export function isStartNode(step: Step, allSteps: Step[]): boolean {
  // Check if any step has a branch pointing to this step
  const hasIncomingBranch = allSteps.some(s => 
    s.branches?.some(b => b.toStepId === step.id)
  )

  if (hasIncomingBranch) {
    return false
  }

  // Check if any step with lower order in same milestone
  const hasLowerOrderInMilestone = allSteps.some(s => 
    s.milestoneId === step.milestoneId && s.order < step.order
  )

  return !hasLowerOrderInMilestone
}

/**
 * Utility: Check if a step is an end point (no outgoing edges)
 */
export function isEndNode(step: Step, allSteps: Step[]): boolean {
  // Has branches defined
  if (step.branches && step.branches.length > 0) {
    return false
  }

  // Check if any step with higher order in same milestone
  const hasHigherOrderInMilestone = allSteps.some(s => 
    s.milestoneId === step.milestoneId && s.order > step.order
  )

  return !hasHigherOrderInMilestone
}

