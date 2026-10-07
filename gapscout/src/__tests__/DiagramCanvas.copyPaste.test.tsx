/**
 * #155: the diagram's copy and paste, from the canvas rather than from the menu.
 *
 * Three things are worth a test here and nowhere else:
 *
 * - **`deleteKeyCode={null}`.** React Flow's default Backspace removes the
 *   selected nodes from this component's local state and tells the store
 *   nothing, so the diagram would disagree with the database until the next
 *   regenerate silently put the steps back.
 * - **Process order.** The selection arrives in whatever order React Flow
 *   reports, and `order` is scoped to its milestone (#299) — so the fixture
 *   below puts the *earlier* milestone second in the store and gives its step
 *   `order: 1`. Sorting on `order` alone would copy the steps interleaved, and
 *   the paste would write that interleaving down.
 * - **⌘V with no anchor.** The pane has no step under it, so the modal is asked
 *   to append rather than to insert after something.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Only what this file reads back off the mock; the real props are wider. */
interface PasteProps {
  projectId: string
  isOpen: boolean
  anchorStep?: { id: string } | null
}

const { layoutGraph, toast, PasteStepsModal } = vi.hoisted(() => ({
  layoutGraph: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  // Typed through the generic rather than through a parameter the body ignores,
  // so `mock.lastCall[0]` is the props object and lint has no unused argument.
  PasteStepsModal: vi.fn<(props: PasteProps) => null>(() => null),
}))

/** The props of the last render, which is the one the assertions are about. */
const lastPasteProps = () => PasteStepsModal.mock.lastCall?.[0]

// A spy rather than a plain component: the props the canvas hands React Flow
// are the subject of the first test, and `lastCall` is where they land.
const ReactFlow = vi.hoisted(() =>
  vi.fn(({ children }: { children?: React.ReactNode }) => <div>{children}</div>)
)

vi.mock('reactflow', () => ({
  default: ReactFlow,
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
// Not `() => null`: the double-listener test needs the menu to be *open* in the
// DOM, and a null mock cannot say that it is. It registers no key handler of
// its own, so any copy the test sees came from the canvas.
vi.mock('../components/Diagram/NodeContextMenu', () => ({
  default: ({ step }: { step: { id: string } | null }) =>
    step ? <div role="menu" aria-label="Step menu" /> : null,
}))
vi.mock('../components/Diagram/PasteStepsModal', () => ({ PasteStepsModal }))
vi.mock('../components/Gaps', () => ({ GapForm: () => null }))
vi.mock('react-hot-toast', () => ({ default: toast }))

import DiagramCanvas from '../components/Diagram/DiagramCanvas'
import { useDiagramClipboard } from '../state/diagramClipboard'
import { useDiagramView } from '../state/diagramView'
import { useStepsStore } from '../state/stepsStore'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import { beginProjectScope } from '../state/workspaceScope'

const baseStep = {
  projectId: 'project-a',
  teamId: 'team-a',
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
}

// milestone-b runs first even though it is second in the store, and its one step
// carries `order: 1` — the same stored number as the first step of milestone-a.
const steps = [
  { ...baseStep, id: 'step-a', label: 'Step A', milestoneId: 'milestone-a', order: 1 },
  { ...baseStep, id: 'step-b', label: 'Step B', milestoneId: 'milestone-a', order: 2 },
  { ...baseStep, id: 'step-c', label: 'Step C', milestoneId: 'milestone-b', order: 1 },
]

const baseMilestone = { projectId: 'project-a', relatedPolicies: [], createdAt: 1, updatedAt: 1 }

const milestones = [
  { ...baseMilestone, id: 'milestone-a', name: 'Second', order: 2 },
  { ...baseMilestone, id: 'milestone-b', name: 'First', order: 1 },
]

const writeText = vi.fn<(text: string) => Promise<void>>()

/** Generate, so React Flow is mounted, and hand back the props it was given. */
async function renderGenerated() {
  beginProjectScope('project-a')
  layoutGraph.mockResolvedValue({ nodes: [{ id: 'step-a' }], swimlanes: [] })

  render(<DiagramCanvas projectId="project-a" sipoc={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate Diagram' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument())

  return reactFlowProps()
}

/**
 * The props of React Flow's latest render.
 *
 * Re-read rather than held: the handlers are rebuilt whenever the canvas
 * re-renders, and a stale `onNodeContextMenu` closes over the selection as it
 * was before `onSelectionChange` ran.
 */
function reactFlowProps() {
  return ReactFlow.mock.lastCall![0] as {
    deleteKeyCode: unknown
    onSelectionChange: (params: { nodes: { id: string }[] }) => void
    onSelectionContextMenu: unknown
    onNodeContextMenu: (
      event: { preventDefault: () => void; clientX: number; clientY: number },
      node: { id: string; type: string }
    ) => void
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useDiagramView.getState().clear()
  useDiagramClipboard.setState({ clipboard: null })
  useStepsStore.setState({
    steps,
    milestones,
    currentProjectId: 'project-a',
    currentStep: null,
    isLoading: false,
  })
  useTeamsStore.setState({
    teams: [
      { id: 'team-a', projectId: 'project-a', name: 'Team A', color: '#000', order: 1, tags: [], createdAt: 1 },
    ],
    currentProjectId: 'project-a',
    isLoading: false,
  })
  useSystemsStore.setState({ systems: [], currentProjectId: 'project-a', isLoading: false })

  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('DiagramCanvas copy and paste', () => {
  it('hands React Flow the selection handlers and disarms its delete key', async () => {
    const props = await renderGenerated()

    expect(props.deleteKeyCode).toBeNull()
    expect(typeof props.onSelectionChange).toBe('function')
    expect(typeof props.onSelectionContextMenu).toBe('function')
  })

  it('copies the selection on Cmd+C, in process order rather than stored order', async () => {
    const props = await renderGenerated()

    act(() => {
      props.onSelectionChange({ nodes: [{ id: 'step-a' }, { id: 'step-c' }, { id: 'step-b' }] })
    })
    fireEvent.keyDown(document, { key: 'c', metaKey: true })

    expect(useDiagramClipboard.getState().clipboard?.steps.map(step => step.id)).toEqual([
      'step-c',
      'step-a',
      'step-b',
    ])
    expect(useDiagramClipboard.getState().clipboard?.sourceProjectId).toBe('project-a')

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(JSON.parse(writeText.mock.calls[0][0]).kind).toBe('gapscout/steps')
    expect(toast.success).toHaveBeenCalledWith('Copied 3 steps as JSON')
  })

  it('leaves the buffer alone when nothing is selected', async () => {
    await renderGenerated()

    fireEvent.keyDown(document, { key: 'c', metaKey: true })

    expect(useDiagramClipboard.getState().clipboard).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('opens the paste modal with no anchor on Cmd+V', async () => {
    await renderGenerated()
    act(() => {
      useDiagramClipboard.getState().copy([steps[0]], 'project-a')
    })

    expect(lastPasteProps()).toMatchObject({ isOpen: false })

    fireEvent.keyDown(document, { key: 'v', metaKey: true })

    const pasteProps = lastPasteProps()
    expect(pasteProps).toMatchObject({ isOpen: true, projectId: 'project-a' })
    // Null, not a step: ⌘V on the pane pointed at nothing, so the modal appends.
    expect(pasteProps?.anchorStep ?? null).toBeNull()
  })

  it('stands down on Cmd+C while the context menu is open, so nothing copies twice', async () => {
    const props = await renderGenerated()

    act(() => {
      props.onSelectionChange({ nodes: [{ id: 'step-a' }, { id: 'step-b' }] })
    })

    // Opened on a node inside the selection. Re-read the handler first: the
    // selection above re-rendered the canvas and rebuilt it.
    act(() => {
      reactFlowProps().onNodeContextMenu(
        { preventDefault: () => {}, clientX: 10, clientY: 10 },
        { id: 'step-a', type: 'step' }
      )
    })
    expect(screen.getByRole('menu', { name: 'Step menu' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'c', metaKey: true })

    // Zero, not one: the menu binds the same shortcut while it is open, so the
    // canvas stands down entirely rather than both of them copying. The mock
    // menu binds nothing, which is what makes this count the canvas alone.
    expect(useDiagramClipboard.getState().clipboard).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringContaining('Copied'))
  })

  it('does nothing on Cmd+V while the buffer is empty', async () => {
    await renderGenerated()

    fireEvent.keyDown(document, { key: 'v', metaKey: true })

    expect(lastPasteProps()).toMatchObject({ isOpen: false })
  })
})
