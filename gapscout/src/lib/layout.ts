/**
 * Layout Engine - swimlane placement for process diagrams
 *
 * A swimlane map has two axes and both are positional, not relational: the lane
 * (y) is the owning team's registry position, and the column (x) is the step's
 * position in the process. Neither is something a graph algorithm should infer
 * from edges, so neither is inferred from edges here.
 *
 * This used to be an ELK `layered` pass. ELK assigns nodes with no edge between
 * them to the same layer, which under the root's `DOWN` direction meant one row:
 * a chain of steps in one lane stacked downward instead of running across it
 * (#286), and unchained steps came out in an arbitrary left-to-right order that
 * had nothing to do with `Step.order`. Feeding ELK the sequence as
 * `elk.partitioning` does not fix it — the option is ignored by the bundled
 * build, and unconnected nodes still collapse into a single column.
 *
 * Reference: PRD Section 4.5.1 - Layout Algorithm
 * Ticket: ZIP-89
 */

import type { Node } from 'reactflow'
import {
  laneBandId,
  UNASSIGNED_LANE_ID,
  type GraphData,
  type LaneDescriptor,
  type MilestoneNodeData,
  type StepNodeData,
} from './graphBuilder'
/**
 * Space reserved down the left of every band for the team label — `elk.padding
 * left=180` once, kept after ELK because the label is drawn there regardless of who
 * computes the geometry.
 *
 * The value lives in `diagramInk.ts` rather than here because the gutter is a drawn
 * block now and both lane renderers size it from the same number (#212). That file
 * imports nothing, which is what keeps diagramInk → layout → graphBuilder →
 * diagramInk from closing into a cycle; see its comment.
 */
import { LANE_LABEL_GUTTER } from './diagramInk'

/**
 * Layout configuration options
 */
export interface LayoutConfig {
  /**
   * Direction of flow. Ignored since #286 — placement is always left-to-right,
   * with the column taken from `Step.order`. Kept so callers need not change.
   */
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP'
  /** Horizontal spacing between nodes (default: 80) */
  nodeSpacingX?: number
  /** Vertical spacing between nodes (default: 60) */
  nodeSpacingY?: number
  /** Vertical spacing between swimlanes (default: 100) */
  swimlaneSpacing?: number
  /** Node width (default: 180) */
  nodeWidth?: number
  /** Node height (default: 60) */
  nodeHeight?: number
  /** Decision node size (default: 80x80) */
  decisionNodeSize?: number
}

/**
 * Default layout configuration
 */
const DEFAULT_CONFIG: Required<LayoutConfig> = {
  direction: 'RIGHT',
  nodeSpacingX: 80,
  nodeSpacingY: 60,
  swimlaneSpacing: 100,
  nodeWidth: 180,
  nodeHeight: 60,
  decisionNodeSize: 80,
}

/**
 * Narrowest band drawn, in graph units.
 *
 * Bands used to be a hard-coded 1400 wide in every renderer, which cut lanes
 * short on any process laid out wider than that (#197). The width now comes from
 * the widest laid-out lane; this is only a floor, so a two-step diagram still
 * draws a band rather than a stub.
 */
export const MIN_SWIMLANE_WIDTH = 1400

/**
 * Swimlane layout data for rendering
 */
export interface SwimlaneLayout {
  id: string
  name: string
  color: string
  x: number
  y: number
  width: number
  height: number
  nodeCount: number
}

/**
 * Layout result with nodes and swimlane data
 */
export interface LayoutResult {
  nodes: Node<StepNodeData>[]
  swimlanes: SwimlaneLayout[]
}

/**
 * Main layout function: place nodes in team swimlanes, left to right
 *
 * Stays `async` because every caller awaits it and because layout used to be an
 * ELK call; the work itself is now synchronous.
 *
 * Takes the whole `GraphData` rather than a node array because the lanes are part
 * of it: a band has to be drawn for a team whose every step is folded into a
 * collapsed milestone, and nothing in the visible nodes would say so.
 *
 * Edges are not consulted. Position comes from `Teams.order` and `Step.order`,
 * both carried on node data.
 *
 * @param graph - Nodes, edges and lanes from graphBuilder
 * @param config - Optional layout configuration
 * @returns Nodes with updated positions, and the bands to draw behind them
 */
export async function layoutGraph(
  graph: GraphData,
  config: LayoutConfig = {}
): Promise<LayoutResult> {
  const startTime = performance.now()
  const { nodes, lanes } = graph

  // Merge config with defaults
  const layoutConfig = { ...DEFAULT_CONFIG, ...config }

  // Early return if no nodes
  if (nodes.length === 0) {
    return { nodes: [], swimlanes: [] }
  }

  const slots = assignSlots(nodes)
  const columns = placeColumns(nodes, slots, layoutConfig)
  const { swimlanes, positions, sizes } = placeSwimlanes(nodes, lanes, slots, columns, layoutConfig)
  const layoutedNodes = applyLayoutToNodes(nodes, positions, sizes)

  const endTime = performance.now()
  const duration = endTime - startTime

  console.log(`Layout: Positioned ${nodes.length} nodes in ${duration.toFixed(2)}ms`)

  return { nodes: layoutedNodes, swimlanes }
}

/** Breathing room above and below the tallest row in a band. */
const LANE_PADDING_Y = 30

/** Space past the rightmost node, so a band never ends flush against it. */
const BAND_RIGHT_PADDING = 30

/**
 * Top-to-bottom lane order.
 *
 * PRD 4.5.1: lane order matches `Teams.order`. Lanes with no owning team — the
 * Unassigned fallback, and hand-offs to a system or an external party — sort to
 * the bottom. Ties break on name then lane key so the order is total and does
 * not shift when a step is added (#243).
 */
export function compareLanes(a: LaneDescriptor, b: LaneDescriptor): number {
  if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order
  if (a.order === null && b.order !== null) return 1
  if (a.order !== null && b.order === null) return -1
  return a.name.localeCompare(b.name) || a.laneId.localeCompare(b.laneId)
}

/**
 * Width of a collapsed milestone's box. Its height is the bands it spans, so it
 * is computed rather than declared.
 */
export const MILESTONE_BOX_WIDTH = 200

/**
 * On-screen size of a node, by type.
 *
 * A milestone box reports a nominal height: it is never placed in a band, so the
 * value is only ever read when sizing its column.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): types narrow vs union TBD when diagram surface is reviewed
function nodeSize(node: Node<any>, config: Required<LayoutConfig>): { width: number; height: number } {
  if (node.type === 'decision') {
    return { width: config.decisionNodeSize, height: config.decisionNodeSize }
  }
  if (node.type === 'processEnd') {
    return { width: 200, height: 80 } // Wider label; height matches a step row
  }
  if (node.type === 'milestone') {
    return { width: MILESTONE_BOX_WIDTH, height: config.nodeHeight }
  }
  return { width: config.nodeWidth, height: config.nodeHeight }
}

/** Explicit size the layout hands back for a node it sizes itself. */
interface NodeSize {
  width: number
  height: number
}

/** A node's column, defaulting to the first for anything graphBuilder did not rank. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
const columnOf = (node: Node<any>): number => node.data?.column ?? 0

/**
 * The column slot each node draws in, by node id.
 *
 * A folded milestone's box takes a slot to itself. It spans whole bands, so a node
 * sharing its column would be painted on top of it with nowhere to move to — the
 * per-lane row stacking below can only separate nodes *inside* one band, and the box
 * is not in a band at all.
 *
 * A terminus is the case that bit. `createProcessEndNodes` places one at its source's
 * column plus one, which is exactly where the next milestone folds: a step handing to
 * a team nobody later supplies, followed by a folded milestone that team works in, put
 * the end node squarely over the box and hid it.
 *
 * Ordinary nodes come first within a column, because a terminus there was produced by
 * a step in the column before and so belongs to the left of the milestone that follows.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
function assignSlots(nodes: Node<any>[]): Map<string, number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
  const keyOf = (node: Node<any>) => `${columnOf(node)}:${node.type === 'milestone' ? 1 : 0}`

  const ordered = [...new Set(nodes.map(keyOf))].sort((a, b) => {
    const [aColumn, aKind] = a.split(':').map(Number)
    const [bColumn, bKind] = b.split(':').map(Number)
    return aColumn - bColumn || aKind - bKind
  })
  const indexByKey = new Map(ordered.map((key, index) => [key, index]))

  return new Map(nodes.map(node => [node.id, indexByKey.get(keyOf(node))!]))
}

/**
 * Geometry of one column: where it starts and how wide it is.
 */
interface ColumnLayout {
  x: number
  width: number
}

/**
 * Turn column indices into x positions.
 *
 * Only columns that actually hold a node get space, so a gap in `Step.order` — a
 * deleted step, or orders that start at 5 — does not open a gap in the diagram.
 * Each column is as wide as its widest node, so a 200-wide Process End does not
 * force every step column to match it.
 */
function placeColumns(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
  nodes: Node<any>[],
  slots: Map<string, number>,
  config: Required<LayoutConfig>
): Map<number, ColumnLayout> {
  const widthByColumn = new Map<number, number>()
  for (const node of nodes) {
    const column = slots.get(node.id) ?? 0
    const { width } = nodeSize(node, config)
    widthByColumn.set(column, Math.max(widthByColumn.get(column) ?? 0, width))
  }

  const columns = new Map<number, ColumnLayout>()
  let x = LANE_LABEL_GUTTER
  for (const column of [...widthByColumn.keys()].sort((a, b) => a - b)) {
    const width = widthByColumn.get(column)!
    columns.set(column, { x, width })
    x += width + config.nodeSpacingX
  }

  return columns
}

/**
 * Stack the bands in registry order and place each lane's nodes inside its band.
 *
 * Lane position is positional, not a graph relation: `Teams.order` decides the
 * band, `Step.order` decides the column, and nothing here consults an edge. That
 * is what stops a chain of steps owned by one team from running *down* its band
 * instead of across it (#286), and it is the same argument that took band `y`
 * off ELK in #278.
 *
 * Two nodes only share a row when they share a column — parallel steps in one
 * lane — and then they stack, which is the one place a band grows taller.
 * Bands all start at x=0 and share one width, so a lane is a full-width band
 * rather than a box floating at whatever x its contents got (#197).
 */
function placeSwimlanes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
  nodes: Node<any>[],
  lanes: LaneDescriptor[],
  slots: Map<string, number>,
  columns: Map<number, ColumnLayout>,
  config: Required<LayoutConfig>
): {
  swimlanes: SwimlaneLayout[]
  positions: Map<string, { x: number; y: number }>
  sizes: Map<string, NodeSize>
} {
  // A collapsed milestone belongs to no single lane, so it is placed across the
  // bands once they exist rather than inside one of them.
  const milestoneNodes: Node<MilestoneNodeData>[] = nodes.filter(node => node.type === 'milestone')

  // Group the rest by lane key (owner team id, or an end node's customer entity).
  // Both StepNodeData and ProcessEndNodeData carry laneId.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
  const nodesByLaneId = new Map<string, Node<any>[]>()
  for (const node of nodes) {
    if (node.type === 'milestone') continue
    const laneId: string = node.data?.laneId ?? UNASSIGNED_LANE_ID
    const laneNodes = nodesByLaneId.get(laneId) ?? []
    laneNodes.push(node)
    nodesByLaneId.set(laneId, laneNodes)
  }

  const bandOrder = [...lanes].sort(compareLanes)

  // One width for every band, wide enough for the widest column (#197)
  const rightmost = Math.max(
    ...[...columns.values()].map(column => column.x + column.width)
  )
  const width = Math.max(MIN_SWIMLANE_WIDTH, rightmost + BAND_RIGHT_PADDING)

  const swimlanes: SwimlaneLayout[] = []
  const positions = new Map<string, { x: number; y: number }>()
  const sizes = new Map<string, NodeSize>()

  let y = 0
  for (const lane of bandOrder) {
    const laneNodes = nodesByLaneId.get(lane.laneId) ?? []

    // Within a lane, only nodes sharing a column need separate rows. Sorting by
    // id keeps that assignment stable across renders of the same data.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
    const rowsByColumn = new Map<number, Node<any>[]>()
    for (const node of [...laneNodes].sort((a, b) => a.id.localeCompare(b.id))) {
      const column = slots.get(node.id) ?? 0
      const stacked = rowsByColumn.get(column) ?? []
      stacked.push(node)
      rowsByColumn.set(column, stacked)
    }

    // A lane whose every node is folded into a collapsed milestone still draws a
    // band — one row tall, so the team does not vanish from the diagram.
    const rowCount = rowsByColumn.size
      ? Math.max(...[...rowsByColumn.values()].map(stacked => stacked.length))
      : 1
    const rowHeight = laneNodes.length
      ? Math.max(...laneNodes.map(node => nodeSize(node, config).height))
      : config.nodeHeight
    const rowPitch = rowHeight + config.nodeSpacingY
    const height = LANE_PADDING_Y * 2 + rowCount * rowHeight + (rowCount - 1) * config.nodeSpacingY

    swimlanes.push({
      id: lane.bandId,
      name: lane.name,
      color: lane.color,
      x: 0,
      y,
      width,
      height,
      nodeCount: lane.nodeCount,
    })

    for (const [column, stacked] of rowsByColumn) {
      const x = columns.get(column)?.x ?? LANE_LABEL_GUTTER
      stacked.forEach((node, row) => {
        positions.set(node.id, { x, y: y + LANE_PADDING_Y + row * rowPitch })
      })
    }

    y += height + config.swimlaneSpacing
  }

  placeMilestoneBoxes(milestoneNodes, swimlanes, slots, columns, positions, sizes)

  return { swimlanes, positions, sizes }
}

/**
 * Span each collapsed milestone's box over the bands its steps sit in.
 *
 * The box does not join a lane. A milestone owned by one team therefore folds
 * neatly inside that team's band, and one worked by several reads as a folded
 * phase crossing them — which is the truth, and is why it carries no team colour.
 *
 * It spans first touched band to last, so a milestone that skips an intervening
 * lane covers that lane's band too. Drawing only over the bands it touches would
 * take more than one rectangle, and the alternative — picking one lane — would
 * name an owner the milestone does not have.
 */
function placeMilestoneBoxes(
  milestoneNodes: Node<MilestoneNodeData>[],
  swimlanes: SwimlaneLayout[],
  slots: Map<string, number>,
  columns: Map<number, ColumnLayout>,
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, NodeSize>
): void {
  if (milestoneNodes.length === 0 || swimlanes.length === 0) return

  const bandById = new Map(swimlanes.map(lane => [lane.id, lane]))

  for (const node of milestoneNodes) {
    // A lane key with no band is not expected — graphBuilder describes a lane for
    // every node — but falling back to every band keeps a box on screen rather
    // than collapsing it to nothing.
    const spanned = node.data.laneIds
      .map(laneId => bandById.get(laneBandId(laneId)))
      .filter((lane): lane is SwimlaneLayout => lane !== undefined)
    const bands = spanned.length > 0 ? spanned : swimlanes

    const top = Math.min(...bands.map(lane => lane.y))
    const bottom = Math.max(...bands.map(lane => lane.y + lane.height))

    positions.set(node.id, {
      x: columns.get(slots.get(node.id) ?? 0)?.x ?? LANE_LABEL_GUTTER,
      y: top,
    })
    sizes.set(node.id, { width: MILESTONE_BOX_WIDTH, height: bottom - top })
  }
}

/**
 * Apply computed positions — and, for a node the layout sizes itself, its size —
 * back to React Flow nodes.
 *
 * A milestone box's height is the bands it spans, so it is set here rather than in
 * the component. `style` is what React Flow renders from; `width`/`height` are what
 * `getNodesBounds` reads, and the image export sizes its canvas from that before
 * anything has been measured on screen.
 */
function applyLayoutToNodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): types narrow vs union TBD when diagram surface is reviewed
  nodes: Node<any>[],
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, NodeSize>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO(audit #15): see above
): Node<any>[] {
  return nodes.map(node => {
    const position = positions.get(node.id)
    const size = sizes.get(node.id)

    if (position) {
      return {
        ...node,
        position,
        ...(size
          ? {
              width: size.width,
              height: size.height,
              style: { ...node.style, width: size.width, height: size.height },
            }
          : {}),
      }
    }

    // Fallback: keep original position (shouldn't happen)
    console.warn(`No position computed for node ${node.id}`)
    return node
  })
}

/**
 * Utility: Calculate bounding box of all nodes
 * Useful for determining canvas size
 */
export function calculateBounds(nodes: Node[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    const x = node.position.x
    const y = node.position.y
    const width = node.width || 180
    const height = node.height || 60

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Utility: Get recommended viewport fit for diagram
 * Returns zoom level and center point
 */
export function getViewportFit(
  nodes: Node[],
  viewportWidth: number,
  viewportHeight: number,
  padding = 50
): {
  x: number
  y: number
  zoom: number
} {
  const bounds = calculateBounds(nodes)

  if (bounds.width === 0 || bounds.height === 0) {
    return { x: 0, y: 0, zoom: 1 }
  }

  // Calculate zoom to fit
  const zoomX = (viewportWidth - padding * 2) / bounds.width
  const zoomY = (viewportHeight - padding * 2) / bounds.height
  const zoom = Math.min(zoomX, zoomY, 1.5) // Cap at 1.5x

  // Calculate center position
  const centerX = bounds.minX + bounds.width / 2
  const centerY = bounds.minY + bounds.height / 2

  const x = viewportWidth / 2 - centerX * zoom
  const y = viewportHeight / 2 - centerY * zoom

  return { x, y, zoom }
}
