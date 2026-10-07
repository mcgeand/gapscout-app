/**
 * exportMermaid - The process diagram as Mermaid flowchart text
 *
 * Reference: PRD Section 4.12.4 - Mermaid Export
 * Issue: #151
 *
 * Pure builder, matching services/exportMarkdown.ts and services/exportCSV.ts:
 * store data in, text out, and the caller owns the save dialog.
 *
 * The text is translated from the same `GraphData` the canvas draws, not
 * re-derived from steps. The forward-only SIPOC rule, the output→input fallback,
 * authored branches and Process End termini all live in lib/graphBuilder.ts, and
 * a second implementation here would drift from the first. The nodes and edges
 * the user sees on screen and the ones they paste into a wiki agree by
 * construction. Milestone collapse is the one canvas state not carried over:
 * the export always draws every step, because the collapse set is canvas state
 * the export modal does not hold.
 *
 * Mermaid's own swimlane support is "best effort" (PRD 4.12.4): a subgraph per
 * lane is as close as the syntax gets to a horizontal band.
 */

import type { Edge } from 'reactflow'
import type { Gap, Milestone, Project, Step, System, Team } from '../data/types'
import { stepsToNodesEdges, type GraphData } from '../lib/graphBuilder'
import { compareLanes } from '../lib/layout'
import { compareSteps, milestonesById } from '../lib/stepSequence'
import { buildExportFilename } from './exportFilename'

export interface MermaidInput {
  project: Project
  steps: Step[]
  gaps: Gap[]
  teams: Team[]
  milestones: Milestone[]
  systems: System[]
  /** Injectable for deterministic tests. */
  generatedAt?: Date
}

type GraphNode = GraphData['nodes'][number]

/** Two spaces per level, the indentation the Mermaid docs use. */
const INDENT = '  '

/**
 * Escape a label for use inside a quoted Mermaid string.
 *
 * Quoting a label lets it carry brackets, braces and parentheses, which would
 * otherwise close the node shape early. What quoting does not cover, Mermaid's
 * entity codes do: a quote ends the string, a pipe ends an edge label, a label
 * wrapped in backticks is read as markdown, and with the default `htmlLabels`
 * anything in angle brackets is parsed as a tag and stripped by DOMPurify.
 * Because Mermaid decodes `#name;` and `#digits;` anywhere in a label, a literal
 * `#` has to go first, or "ticket #123; closed" comes back with a `{` where the
 * number was.
 *
 * Returns '' for a whitespace-only value; callers must not emit `""`, which
 * Mermaid rejects as a parse error for the whole file.
 */
export function escapeLabel(value: string): string {
  return value
    .replace(/#/g, '#35;')
    .replace(/&/g, '#amp;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/"/g, '#quot;')
    .replace(/\|/g, '#124;')
    .replace(/`/g, '#96;')
    .replace(/\r\n|\r|\n/g, ' ')
    .trim()
}

/**
 * Stable Mermaid ids, derived from the graph's own keys.
 *
 * The graph's ids cannot be written out as they are: a nanoid may start with `-`
 * or `_`, a terminus id is `end-<customer name>` with whatever the name holds,
 * and `end` is the keyword that closes a subgraph. They also must not be
 * replaced with counters, because a counter renumbers every node after any
 * insertion and breaks the `classDef`/`style` lines a user adds in a wiki.
 *
 * So the key is kept and made safe: a type letter in front, every character
 * outside `[A-Za-z0-9_]` folded to `_`. Two keys that fold to the same thing —
 * "Vendor Inc" and "Vendor-Inc" — get a numeric suffix, in output order.
 *
 * Subgraphs key on `laneId` for the same reason the canvas does (#244): Mermaid
 * merges two subgraphs that share an id, so two teams both called "Ops" keyed on
 * their name would collapse into one lane. The name is only the display label.
 */
class IdAllocator {
  private readonly taken = new Set<string>()

  allocate(prefix: string, key: string): string {
    const base = `${prefix}_${key.replace(/[^A-Za-z0-9_]/g, '_')}`
    let id = base
    for (let n = 2; this.taken.has(id); n++) id = `${base}_${n}`
    this.taken.add(id)
    return id
  }
}

/**
 * Rectangle, diamond or stadium, per PRD 4.12.4 and the canvas's own node types.
 *
 * Throws on a type it has no shape for. Silently skipping one would drop the
 * node from every subgraph and turn each of its edges into a `%% skipped`
 * comment with green tests, which is exactly what would happen the day a
 * milestone box node reaches this function.
 */
function nodeShape(node: GraphNode): { prefix: string; open: string; close: string; label: string } {
  switch (node.type) {
    case 'step':
      return { prefix: 'S', open: '["', close: '"]', label: node.data.label }
    case 'decision':
      return { prefix: 'D', open: '{"', close: '"}', label: node.data.label }
    case 'processEnd':
      return { prefix: 'E', open: '(["', close: '"])', label: node.data.entityName }
    default:
      throw new Error(`Mermaid export has no shape for node type ${String(node.type)}`)
  }
}

/** The key a node's id is derived from: a step's own id, a terminus's customer name. */
function nodeKey(node: GraphNode): string {
  return node.type === 'processEnd' ? node.data.entityName : node.id
}

function nodeLine(node: GraphNode, id: string): string {
  const shape = nodeShape(node)
  // A blank label falls back to the id: `S_x[""]` is a parse error, `S_x["S_x"]` is a box.
  const label = escapeLabel(shape.label) || id
  return `${id}${shape.open}${label}${shape.close}`
}

/**
 * Solid for a SIPOC hand-off, dotted for anything the canvas dashes: an authored
 * branch and the hop into a terminus. Mermaid has one dotted stroke, so the two
 * dash patterns the canvas distinguishes collapse to it.
 *
 * An edge whose endpoint is not in the graph — a branch whose target step was
 * deleted — becomes a comment rather than nothing. The canvas drops that edge
 * silently; a wiki reader looking at a diamond with one outcome deserves a note.
 */
function edgeLine(edge: Edge, ids: Map<string, string>): string {
  const source = ids.get(edge.source)
  const target = ids.get(edge.target)
  const dashed = Boolean(edge.style?.strokeDasharray)
  const arrow = dashed ? '-.->' : '-->'
  const label = typeof edge.label === 'string' ? escapeLabel(edge.label) : ''

  if (!source || !target) {
    const from = source ?? 'a step not in this graph'
    const what = label ? `branch "${label}"` : 'edge'
    return `%% skipped: ${what} from ${from} points at a step not in this graph`
  }

  return label ? `${source} ${arrow}|"${label}"| ${target}` : `${source} ${arrow} ${target}`
}

/** ISO-8601 UTC, matching the Markdown pack's stamp. */
function header(project: Project, generatedAt: Date): string {
  return `%% ${escapeLabel(project.name)} (GapScout, ${generatedAt.toISOString()})`
}

export function buildMermaid(input: MermaidInput): string {
  const { project, teams, milestones, systems, gaps, generatedAt = new Date() } = input

  const lines: string[] = [header(project, generatedAt), 'flowchart LR']

  if (input.steps.length === 0) {
    lines.push(`${INDENT}%% No steps to draw`)
    return lines.join('\n') + '\n'
  }

  // graphBuilder keeps the order it is given for anything the rank does not
  // decide, so the steps are ranked first — with the id breaking a parallel tie —
  // and the output no longer depends on which order the store returned them in.
  const byMilestone = milestonesById(milestones)
  const steps = [...input.steps].sort(
    (a, b) => compareSteps(a, b, byMilestone) || a.id.localeCompare(b.id)
  )

  const graph = stepsToNodesEdges(steps, milestones, teams, systems, gaps)

  const nodesByLane = new Map<string, GraphNode[]>()
  for (const node of graph.nodes) {
    const laneNodes = nodesByLane.get(node.data.laneId) ?? []
    laneNodes.push(node)
    nodesByLane.set(node.data.laneId, laneNodes)
  }

  // Same order as the canvas's bands, and the same total tie-break.
  const lanes = [...graph.lanes].sort(compareLanes).map((lane) => ({
    lane,
    nodes: [...(nodesByLane.get(lane.laneId) ?? [])].sort(
      (a, b) => a.data.column - b.data.column || a.id.localeCompare(b.id)
    ),
  }))

  const allocator = new IdAllocator()
  const ids = new Map<string, string>()
  for (const { nodes } of lanes) {
    for (const node of nodes) {
      ids.set(node.id, allocator.allocate(nodeShape(node).prefix, nodeKey(node)))
    }
  }

  for (const { lane, nodes } of lanes) {
    const laneId = allocator.allocate('L', lane.laneId)
    lines.push(`${INDENT}subgraph ${laneId}["${escapeLabel(lane.name) || laneId}"]`)
    for (const node of nodes) {
      lines.push(`${INDENT}${INDENT}${nodeLine(node, ids.get(node.id)!)}`)
    }
    lines.push(`${INDENT}end`)
  }

  for (const edge of graph.edges) {
    lines.push(`${INDENT}${edgeLine(edge, ids)}`)
  }

  return lines.join('\n') + '\n'
}

/** UTF-8 without a byte-order mark; Mermaid parsers do not expect one. */
export function mermaidToBytes(mermaid: string): Uint8Array {
  return new TextEncoder().encode(mermaid)
}

/**
 * `[project-slug]_diagram_[YYYY-MM-DD].mmd`.
 *
 * Shares the diagram images' stem: it is the same diagram in a third format, and
 * the extension keeps it from overwriting either of them.
 */
export function buildMermaidFilename(projectName: string, date: Date = new Date()): string {
  return buildExportFilename(projectName, 'diagram', 'mmd', date)
}
