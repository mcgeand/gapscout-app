/**
 * The diagram survives leaving the tab (#281).
 *
 * DiagramCanvas unmounts with the route. The layout has to be in the session
 * store, or the next mount is the Generate button again and the canvas export
 * has nothing to rasterise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { layoutGraph, toast } = vi.hoisted(() => ({
  layoutGraph: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('reactflow', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Dots: 'dots' },
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  getNodesBounds: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 100 })),
}))
vi.mock('../lib/layout', () => ({
  layoutGraph,
  getViewportFit: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
}))
vi.mock('../lib/graphBuilder', () => ({
  stepsToNodesEdges: vi.fn(() => ({ nodes: [{ id: 'step-a' }], edges: [], lanes: [] })),
  EDGE_STROKE: { strokeWidth: 2, stroke: '#9b9797', fill: 'none' },
}))
vi.mock('../components/Diagram/StepNode', () => ({ default: () => null }))
vi.mock('../components/Diagram/DecisionNode', () => ({ default: () => null }))
vi.mock('../components/Diagram/ProcessEndNode', () => ({ default: () => null }))
vi.mock('../components/Diagram/MilestoneBox', () => ({ default: () => null }))
vi.mock('../components/Diagram/SwimlaneBackground', () => ({ default: () => null }))
vi.mock('../components/Diagram/StepEditModal', () => ({ default: () => null }))
vi.mock('../components/Diagram/NodeContextMenu', () => ({ default: () => null }))
vi.mock('../components/Gaps', () => ({ GapForm: () => null }))
vi.mock('react-hot-toast', () => ({ default: toast }))

import DiagramCanvas from '../components/Diagram/DiagramCanvas'
import { useDiagramView } from '../state/diagramView'
import { useStepsStore } from '../state/stepsStore'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import { beginProjectScope } from '../state/workspaceScope'

const step = {
  id: 'step-a', projectId: 'project-a', label: 'Step A', teamId: 'team-a', milestoneId: 'milestone-a', order: 1,
  suppliers: [], inputs: [], outputs: [], customers: [], systems: [], comments: [], links: [], gapIds: [], createdAt: 1, updatedAt: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  useDiagramView.getState().clear()
  layoutGraph.mockResolvedValue({
    nodes: [{ id: 'step-a', position: { x: 10, y: 20 } }],
    swimlanes: [],
  })
  useStepsStore.setState({ steps: [step], milestones: [], currentProjectId: 'project-a', currentStep: null, isLoading: false })
  useTeamsStore.setState({
    teams: [{ id: 'team-a', projectId: 'project-a', name: 'Team A', color: '#000', order: 1, tags: [], createdAt: 1 }],
    currentProjectId: 'project-a',
    isLoading: false,
  })
  useSystemsStore.setState({ systems: [], currentProjectId: 'project-a', isLoading: false })
  beginProjectScope('project-a')
})

async function generateAndLeave() {
  const view = render(<DiagramCanvas projectId="project-a" sipoc={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate Diagram' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument())
  view.unmount()
}

describe('DiagramCanvas session', () => {
  it('shows the existing diagram when the canvas remounts, and does not generate again', async () => {
    await generateAndLeave()
    expect(layoutGraph).toHaveBeenCalledTimes(1)

    render(<DiagramCanvas projectId="project-a" sipoc={null} />)
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate Diagram' })).not.toBeInTheDocument()

    await new Promise(resolve => setTimeout(resolve, 350))
    expect(layoutGraph).toHaveBeenCalledTimes(1)
    expect(useDiagramView.getState().views['project-a']?.nodes).toEqual([
      { id: 'step-a', position: { x: 10, y: 20 } },
    ])
  })

  it('regenerates silently when the process changes after the first generate (#107)', async () => {
    render(<DiagramCanvas projectId="project-a" sipoc={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate Diagram' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledTimes(1)

    useStepsStore.setState({
      steps: [{ ...step, label: 'Step A edited', updatedAt: 2 }],
    })

    await waitFor(() => expect(layoutGraph).toHaveBeenCalledTimes(2))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('regenerates when the process changed while the canvas was unmounted', async () => {
    await generateAndLeave()
    useStepsStore.setState({
      steps: [{ ...step, label: 'Step A renamed', updatedAt: 2 }],
    })

    render(<DiagramCanvas projectId="project-a" sipoc={null} />)
    await waitFor(() => expect(layoutGraph).toHaveBeenCalledTimes(2))
  })
})
