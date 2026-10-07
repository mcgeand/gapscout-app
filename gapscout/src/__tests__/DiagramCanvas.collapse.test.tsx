/**
 * Collapsing and expanding a milestone from the canvas (#156, PRD §4.5.2).
 *
 * The graph rules are covered as pure functions in milestoneCollapse.test.ts; what
 * only the component can answer is whether the toggle actually reaches them, and
 * whether a click on a box expands it rather than selecting a step. That second one
 * is a real trap: `handleNodeClick` used to call `selectStep(node.id)` for anything
 * clicked, and a box's id names no step.
 *
 * React Flow is mocked down to a list of buttons, one per node, so a click can be
 * fired at a specific node without a canvas.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { Node } from 'reactflow'

const { layoutGraph, toast } = vi.hoisted(() => ({
  layoutGraph: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('reactflow', () => ({
  default: ({
    nodes,
    onNodeClick,
    children,
  }: {
    nodes: Node[]
    onNodeClick: (event: unknown, node: Node) => void
    children?: React.ReactNode
  }) => (
    <div>
      {nodes.map(node => (
        <button key={node.id} onClick={event => onNodeClick(event, node)}>
          {`node:${node.id}`}
        </button>
      ))}
      {children}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  useNodesState: (initial: Node[]) => {
    const [nodes, setNodes] = useState(initial)
    return [nodes, setNodes, vi.fn()]
  },
  useEdgesState: (initial: unknown[]) => {
    const [edges, setEdges] = useState(initial)
    return [edges, setEdges, vi.fn()]
  },
  getNodesBounds: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 100 })),
}))
// The real graph builder runs; only the geometry is stubbed out.
vi.mock('../lib/layout', () => ({
  layoutGraph,
  getViewportFit: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
}))
vi.mock('../components/Diagram/SwimlaneBackground', () => ({ default: () => null }))
vi.mock('../components/Diagram/StepEditModal', () => ({ default: () => null }))
vi.mock('../components/Diagram/NodeContextMenu', () => ({ default: () => null }))
vi.mock('../components/Gaps', () => ({ GapForm: () => null }))
vi.mock('../components/Export', () => ({ ExportModal: () => null }))
vi.mock('react-hot-toast', () => ({ default: toast }))

import DiagramCanvas from '../components/Diagram/DiagramCanvas'
import { milestoneBoxId } from '../lib/graphBuilder'
import { useStepsStore } from '../state/stepsStore'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useDiagramView } from '../state/diagramView'
import { beginProjectScope } from '../state/workspaceScope'
import type { Milestone, Step } from '../data/types'

const milestone = (id: string, name: string, order: number): Milestone => ({
  id,
  projectId: 'project-a',
  name,
  order,
  relatedPolicies: [],
  createdAt: 1,
  updatedAt: 1,
})

const step = (id: string, milestoneId: string, order: number): Step => ({
  id,
  projectId: 'project-a',
  label: id,
  teamId: 'team-a',
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
  createdAt: 1,
  updatedAt: 1,
})

const REQUISITION = milestone('ms-req', 'Requisition', 0)
const APPROVAL = milestone('ms-app', 'Approval', 1)
const APPROVAL_BOX = milestoneBoxId(APPROVAL.id)

const nodeButton = (id: string) => screen.queryByRole('button', { name: `node:${id}` })

/**
 * The real `selectStep` reads the step back from the database, which this test has
 * no need of — what matters is only whether the canvas asked for a selection at
 * all, and with which id.
 */
const selectStep = vi.fn(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  useDiagramView.getState().clear()
  layoutGraph.mockImplementation(async (graph: { nodes: Node[] }) => ({
    nodes: graph.nodes,
    swimlanes: [],
  }))
  useStepsStore.setState({
    steps: [
      step('raise-request', REQUISITION.id, 1),
      step('check-budget', APPROVAL.id, 1),
      step('sign-off', APPROVAL.id, 2),
    ],
    milestones: [REQUISITION, APPROVAL],
    currentProjectId: 'project-a',
    currentStep: null,
    isLoading: false,
    selectStep,
  })
  useTeamsStore.setState({
    teams: [
      { id: 'team-a', projectId: 'project-a', name: 'Team A', color: '#000000', order: 1, tags: [], createdAt: 1 },
    ],
    currentProjectId: 'project-a',
    isLoading: false,
  })
  useSystemsStore.setState({ systems: [], currentProjectId: 'project-a', isLoading: false })
  beginProjectScope('project-a')
})

async function generate() {
  render(<DiagramCanvas projectId="project-a" sipoc={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate Diagram' }))
  await waitFor(() => expect(nodeButton('check-budget')).toBeInTheDocument())
}

async function collapseApproval() {
  fireEvent.click(screen.getByRole('button', { name: /Milestones/ }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Approval/ }))
  await waitFor(() => expect(nodeButton(APPROVAL_BOX)).toBeInTheDocument(), { timeout: 3000 })
}

describe('DiagramCanvas — milestone collapse', () => {
  it('lists only milestones that hold a step', async () => {
    await generate()
    fireEvent.click(screen.getByRole('button', { name: /Milestones/ }))

    expect(screen.getByRole('menuitemcheckbox', { name: /Requisition/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Approval/ })).toBeInTheDocument()
  })

  it('folds the milestone’s steps into a box when toggled', async () => {
    await generate()
    await collapseApproval()

    expect(nodeButton('check-budget')).not.toBeInTheDocument()
    expect(nodeButton('sign-off')).not.toBeInTheDocument()
    expect(nodeButton('raise-request')).toBeInTheDocument()
  })

  it('expands on a click on the box, without selecting a step that does not exist', async () => {
    await generate()
    await collapseApproval()

    fireEvent.click(nodeButton(APPROVAL_BOX)!)

    await waitFor(() => expect(nodeButton('check-budget')).toBeInTheDocument(), { timeout: 3000 })
    expect(nodeButton(APPROVAL_BOX)).not.toBeInTheDocument()
    // The box id names no step, so asking to select it would put the right panel
    // on nothing at all.
    expect(selectStep).not.toHaveBeenCalled()
  })

  it('ignores the second click of a double-click on a box', async () => {
    await generate()
    await collapseApproval()

    // A double-click fires `click` twice; toggling on both would expand and
    // re-collapse, so the box would sit there doing nothing.
    fireEvent.click(nodeButton(APPROVAL_BOX)!, { detail: 2 })

    await new Promise(resolve => setTimeout(resolve, 600))
    expect(nodeButton(APPROVAL_BOX)).toBeInTheDocument()
    expect(nodeButton('check-budget')).not.toBeInTheDocument()
  })

  it('selects the step when an ordinary node is clicked', async () => {
    await generate()
    fireEvent.click(nodeButton('raise-request')!)

    expect(selectStep).toHaveBeenCalledWith('raise-request')
  })
})
