# GapScout Library Functions

Core utility functions and transformers for GapScout.

## Graph Builder (`graphBuilder.ts`)

Transforms GapScout step data into React Flow graph format.

### Main Function

```typescript
stepsToNodesEdges(
  steps: Step[],
  milestones: Milestone[],
  teams: Team[],
  systems: System[],
  gaps: Gap[],
  collapsedMilestoneIds?: ReadonlySet<string>
): GraphData
```

**Input**: Process steps with order, teams, milestones, branches, and the
milestones the user has collapsed
**Output**: `{ nodes: Node[], edges: Edge[], lanes: LaneDescriptor[] }` for React
Flow and the layout

### Features

- ✅ **Sequential Flow**: Auto-connects steps in order within milestones
- ✅ **Decision Points**: Identifies `step.decision = true` as diamond nodes
- ✅ **Branches**: Creates labeled edges from decision branches
- ✅ **Parallel Steps**: Detects steps with same order number
- ✅ **Loops**: Supports backward branches (e.g., retry logic)
- ✅ **Team Enrichment**: Adds team color and name to node data
- ✅ **Graceful Defaults**: Handles missing teams/milestones

### Utilities

```typescript
// Filter steps by criteria
getStepsByMilestone(steps: Step[], milestoneId: string): Step[]
getStepsByTeam(steps: Step[], teamId: string): Step[]

// Identify graph endpoints
isStartNode(step: Step, allSteps: Step[]): boolean
isEndNode(step: Step, allSteps: Step[]): boolean
```

### Example Usage

```typescript
import { stepsToNodesEdges } from './lib/graphBuilder'
import { useStepsStore } from './state/stepsStore'
import { useTeamsStore } from './state/teamsStore'

// In your diagram component
const { steps, milestones } = useStepsStore()
const { teams } = useTeamsStore()

const { nodes, edges } = stepsToNodesEdges(steps, milestones, teams, systems, gaps)

// Pass to React Flow
<ReactFlow nodes={nodes} edges={edges} />
```

### Demo

Run the demo to see transformation output:

```typescript
import { demoGraphBuilder } from './lib/graphBuilder.demo'
demoGraphBuilder()
```

## Layout Engine (`layout.ts`)

Deterministic swimlane placement for process diagrams. Lane (y) comes from the
owning team's registry order; column (x) comes from each step's process position
(`Step.order` within its milestone). Edges are not consulted — #286 replaced the
former ELK layered pass, which stacked unconnected steps and ignored sequence.

### Main Function

```typescript
layoutGraph(
  graph: GraphData,
  config?: LayoutConfig
): Promise<LayoutResult>
```

**Input**: The whole graph from graphBuilder — its `lanes` are what the bands are
drawn from, so a team whose every step is inside a collapsed milestone keeps one
**Output**: `{ nodes, swimlanes }` — the same nodes with a computed
`position: {x, y}`, and a collapsed milestone's box sized to the bands it spans

### Features

- ✅ **Swimlanes**: Groups nodes by team (horizontal lanes)
- ✅ **Left-to-Right**: Columns follow step order within each milestone
- ✅ **No Overlaps**: Fixed node spacing from `LayoutConfig`
- ✅ **Fast**: Synchronous; typically well under 100ms for 50+ nodes
- ✅ **Configurable**: Spacing and node sizes (`direction` is kept for callers but ignored)

### Configuration

```typescript
interface LayoutConfig {
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP'  // ignored since #286
  nodeSpacingX?: number        // Default: 80
  nodeSpacingY?: number        // Default: 60
  swimlaneSpacing?: number     // Default: 100
  nodeWidth?: number           // Default: 180
  nodeHeight?: number          // Default: 60
  decisionNodeSize?: number    // Default: 80x80
}
```

### Utilities

```typescript
// Calculate diagram bounds
calculateBounds(nodes: Node[]): { minX, minY, maxX, maxY, width, height }

// Get viewport to fit diagram
getViewportFit(nodes: Node[], width: number, height: number): { x, y, zoom }
```

### Example Usage

```typescript
import { stepsToNodesEdges } from './lib/graphBuilder'
import { layoutGraph } from './lib/layout'

// 1. Transform steps to graph
const graph = stepsToNodesEdges(steps, milestones, teams, systems, gaps)

// 2. Apply layout
const { nodes, swimlanes } = await layoutGraph(graph, {
  nodeSpacingX: 100,
  swimlaneSpacing: 120,
})

// 3. Render in React Flow
<ReactFlow nodes={nodes} edges={graph.edges} />
```

### Tests

Swimlane and collapse behaviour is covered in `src/__tests__/layout.swimlanes.test.ts`
and `src/__tests__/milestoneCollapse.test.ts`.

## Other Utilities

- `autosave.ts` - Debounced auto-save utility (already exists)
- `sipocParser.ts` - SIPOC text parsing (already exists)

