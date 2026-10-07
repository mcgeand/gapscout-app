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
  // Pulled in transitively by services/exportDiagram.ts.
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
import { useStepsStore } from '../state/stepsStore'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useDiagramView } from '../state/diagramView'
import { beginProjectScope } from '../state/workspaceScope'

const step = {
  id: 'step-a', projectId: 'project-a', label: 'Step A', teamId: 'team-a', milestoneId: 'milestone-a', order: 1,
  suppliers: [], inputs: [], outputs: [], customers: [], systems: [], comments: [], links: [], gapIds: [], createdAt: 1, updatedAt: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  useDiagramView.getState().clear()
  useStepsStore.setState({ steps: [step], milestones: [], currentProjectId: 'project-a', currentStep: null, isLoading: false })
  useTeamsStore.setState({ teams: [{ id: 'team-a', projectId: 'project-a', name: 'Team A', color: '#000', order: 1, tags: [], createdAt: 1 }], currentProjectId: 'project-a', isLoading: false })
  useSystemsStore.setState({ systems: [], currentProjectId: 'project-a', isLoading: false })
})

describe('DiagramCanvas route isolation', () => {
  it('does not commit a diagram or toast when layout resolves after the route changes', async () => {
    let resolveLayout!: (value: { nodes: unknown[]; swimlanes: unknown[] }) => void
    layoutGraph.mockReturnValueOnce(new Promise((resolve) => { resolveLayout = resolve }))
    beginProjectScope('project-a')

    render(<DiagramCanvas projectId="project-a" sipoc={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate Diagram' }))
    beginProjectScope('project-b')
    resolveLayout({ nodes: [{ id: 'step-a' }], swimlanes: [] })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Generating...' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalledWith('Diagram generated!')
  })
})
