/**
 * Stable React Flow type maps for the diagram canvas (#283).
 *
 * React Flow warns when `nodeTypes` or `edgeTypes` get a new object identity on
 * each render; keeping them at module scope avoids remounting every node.
 */
import type { EdgeTypes, FitViewOptions, NodeTypes } from 'reactflow'
import StepNode from './StepNode'
import DecisionNode from './DecisionNode'
import ProcessEndNode from './ProcessEndNode'
import MilestoneBox from './MilestoneBox'

export const DIAGRAM_NODE_TYPES: NodeTypes = {
  step: StepNode,
  decision: DecisionNode,
  processEnd: ProcessEndNode,
  milestone: MilestoneBox,
}

/** No custom edge components; an empty stable map silences the edgeTypes warning. */
export const DIAGRAM_EDGE_TYPES: EdgeTypes = {}

export const DIAGRAM_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  maxZoom: 1.2,
} satisfies FitViewOptions
