/**
 * DiagramCanvas - Main process diagram component
 * 
 * Integrates:
 * - Graph builder (steps → nodes/edges)
 * - ELK layout engine (positioning)
 * - React Flow (rendering & interaction)
 * - Custom nodes (StepNode, DecisionNode)
 * - Swimlane backgrounds
 * 
 * Reference: PRD Section 4.5 - Diagram Generation
 * Ticket: ZIP-90
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from 'reactflow'
import type { DefaultEdgeOptions, Node } from 'reactflow'
import 'reactflow/dist/style.css'
import './diagram.css'

import { EDGE_STROKE, stepsToNodesEdges, type MilestoneNodeData } from '../../lib/graphBuilder'
import { EDGE_LABEL, INK, INK_RGB, RULE } from '../../lib/diagramInk'
import { layoutGraph, getViewportFit, type SwimlaneLayout } from '../../lib/layout'
import { diagramInputSignature, useDiagramView } from '../../state/diagramView'
import { useStepsStore } from '../../state/stepsStore'
import { useTeamsStore } from '../../state/teamsStore'
import { useSystemsStore } from '../../state/systemsStore'
import { useProjectStore } from '../../state/projectStore'
import { useGapsStore } from '../../state/gapsStore'
import { useProcessPositions } from '../../state/useProcessPositions'
import { usePoliciesStore } from '../../state/policiesStore'
import { useGlossaryStore } from '../../state/glossaryStore'
import { ExportModal } from '../Export'
import {
  DIAGRAM_EDGE_TYPES,
  DIAGRAM_FIT_VIEW_OPTIONS,
  DIAGRAM_NODE_TYPES,
} from './diagramFlowRegistry'
import { captureProjectScope, isProjectScopeCurrent } from '../../state/workspaceScope'
import { resealAfterMutation } from '../../state/sequenceOps'
import SwimlaneBackground from './SwimlaneBackground'
import StepEditModal from './StepEditModal'
import NodeContextMenu from './NodeContextMenu'
import { copyStepsAsJson } from './copySteps'
import { PasteStepsModal } from './PasteStepsModal'
import { useDiagramClipboard } from '../../state/diagramClipboard'
import { compareSteps, milestonesById } from '../../lib/stepSequence'
import { GapForm } from '../Gaps'
import { ConfirmModal } from '../shared/ConfirmModal'
import toast from 'react-hot-toast'
import { ChevronDown, Download, RefreshCw } from 'lucide-react'
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside'
import type { SIPOC, Step } from '../../data/types'

/**
 * Edge appearance, stated inline rather than left to CSS classes.
 *
 * html-to-image stops recursing at any <svg> (clone-node.js cloneChildren), so it
 * never inlines computed styles for elements inside the edge layer. Anything left
 * to reactflow/dist/style.css or diagram.css is therefore dropped from an export:
 * edge lines vanish and label backgrounds fall back to SVG's black default. These
 * values match those stylesheets exactly, so on-screen rendering is unchanged.
 */
const DEFAULT_EDGE_OPTIONS = {
  type: 'smoothstep',
  animated: false,
  style: EDGE_STROKE,
  labelStyle: { fontSize: 11, fontWeight: 600, fill: EDGE_LABEL.color },
  labelBgStyle: { fill: EDGE_LABEL.background, stroke: EDGE_LABEL.border, strokeWidth: 1 },
} satisfies DefaultEdgeOptions

/**
 * Which node the pointer is over, by id, or null.
 *
 * `onSelectionContextMenu` fires from React Flow's NodesSelection rectangle,
 * which covers every node it holds — so the event's target names the rectangle
 * and there is no node to read off it. Hit-testing the point finds the node
 * underneath. `elementsFromPoint` is absent in jsdom, and a browser can also
 * return the rectangle alone if a node has moved under it, so both are a null
 * and the caller falls back to the first step in the selection.
 */
function nodeIdUnderCursor(x: number, y: number): string | null {
  if (typeof document.elementsFromPoint !== 'function') return null
  for (const element of document.elementsFromPoint(x, y)) {
    const id = element.closest('.react-flow__node')?.getAttribute('data-id')
    if (id) return id
  }
  return null
}

/**
 * Diagram Canvas Component
 */
interface DiagramCanvasProps {
  projectId: string
  /** Null until the wizard has been run; the Markdown pack then omits the section. */
  sipoc: SIPOC | null
}

export default function DiagramCanvas({ projectId, sipoc }: DiagramCanvasProps) {
  const { steps, milestones, selectStep } = useStepsStore()
  const { teams } = useTeamsStore()
  const { systems } = useSystemsStore()
  const currentProject = useProjectStore((state) => state.currentProject)

  // Read by the document and spreadsheet exports (PRD 4.12.1 / 4.12.2), and by
  // the graph builder for each node's open-gap count. All three are hydrated with
  // the rest of the workspace in ProcessBoard, so nothing here has to load them.
  const gaps = useGapsStore((state) => state.gaps)
  const policies = usePoliciesStore((state) => state.policies)
  const glossary = useGlossaryStore((state) => state.entries)

  // The diagram draws the whole process at once, so a gap raised from it names
  // the step by its position in that process rather than by the stored
  // per-milestone `order` (#345).
  const positions = useProcessPositions()

  // The canvas unmounts with the Diagram tab. The session store is what makes
  // a return visit draw the layout from a moment ago instead of the empty
  // state (#281). These hooks only read the store on mount.
  const restored = useDiagramView.getState().views[projectId]
  const [nodes, setNodes, onNodesChange] = useNodesState(restored?.nodes ?? [])
  const [edges, setEdges, onEdgesChange] = useEdgesState(restored?.edges ?? [])
  const [swimlanes, setSwimlanes] = useState<SwimlaneLayout[]>(restored?.swimlanes ?? [])
  const [isGenerating, setIsGenerating] = useState(false)
  const [hasGenerated, setHasGenerated] = useState(restored != null)

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingStep, setEditingStep] = useState<Step | null>(null)

  // Context menu state. `contextMenuSelection` is the multi-selection the menu
  // acts on, and it is only set when the right-click landed inside one.
  const [contextMenuStep, setContextMenuStep] = useState<Step | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [contextMenuSelection, setContextMenuSelection] = useState<Step[] | undefined>(undefined)

  // Multi-selection, as React Flow reports it (#155). Node ids rather than
  // steps: the array also carries milestone boxes and the process-end node,
  // which have no step behind them.
  const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>([])

  // Paste modal state. A null anchor means "append to the end of the milestone",
  // which is what ⌘V on the pane asks for.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteAnchor, setPasteAnchor] = useState<Step | null>(null)

  // Delete confirmation modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [stepToDelete, setStepToDelete] = useState<Step | null>(null)

  // Gap form modal state
  const [isGapFormOpen, setIsGapFormOpen] = useState(false)
  const [gapFormStepId, setGapFormStepId] = useState<string | null>(null)

  // Milestones the user has folded (PRD §4.5.2). A way of reading a large
  // diagram, not a property of the process, so it is session state: kept
  // across a tab switch with the layout, dropped on quit.
  const [collapsedMilestoneIds, setCollapsedMilestoneIds] = useState<ReadonlySet<string>>(
    () => new Set(restored?.collapsedMilestoneIds ?? [])
  )
  const [showMilestoneMenu, setShowMilestoneMenu] = useState(false)
  const milestoneMenuRef = useRef<HTMLDivElement>(null)
  const closeMilestoneMenu = useCallback(() => setShowMilestoneMenu(false), [])
  useDismissOnOutside(showMilestoneMenu, milestoneMenuRef, closeMilestoneMenu)

  const toggleMilestone = useCallback((milestoneId: string) => {
    setCollapsedMilestoneIds(previous => {
      const next = new Set(previous)
      if (!next.delete(milestoneId)) next.add(milestoneId)
      return next
    })
  }, [])

  // Only milestones that hold a step can be folded — an empty one would collapse
  // to a box with nothing in it, so graphBuilder ignores it and the menu hides it.
  const foldableMilestones = useMemo(
    () => milestones.filter(milestone => steps.some(step => step.milestoneId === milestone.id)),
    [milestones, steps]
  )

  const signature = useMemo(
    () => diagramInputSignature({
      steps,
      milestones,
      teams,
      systems,
      gaps,
      collapsedMilestoneIds,
    }),
    [steps, milestones, teams, systems, gaps, collapsedMilestoneIds]
  )

  // Export (PRD 4.12, #150). Scale/background live in the modal; the canvas
  // only owns the ref the capture needs and whether the modal is open.
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)

  // Scoped to this canvas rather than the document, so a second diagram
  // elsewhere on the page could never be captured by mistake.
  const getExportViewport = useCallback(
    () => canvasRef.current?.querySelector<HTMLElement>('.react-flow__viewport') ?? null,
    []
  )

  /**
   * Generate diagram from current steps
   */
  const generateInFlightRef = useRef(false)

  const generateDiagram = useCallback(async (options?: { silent?: boolean }) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    if (generateInFlightRef.current) return
    generateInFlightRef.current = true

    if (steps.length === 0) {
      toast.error('No steps to generate diagram from')
      generateInFlightRef.current = false
      return
    }

    if (teams.length === 0) {
      toast.error('No teams defined')
      generateInFlightRef.current = false
      return
    }

    try {
      setIsGenerating(true)

      // Step 1: Transform steps to graph (using SIPOC logic)
      const graph = stepsToNodesEdges(
        steps,
        milestones,
        teams,
        systems,
        gaps,
        collapsedMilestoneIds
      )

      console.log(`Graph Builder: ${graph.nodes.length} nodes, ${graph.edges.length} edges`)

      // Step 2: Apply layout (lanes come with the graph, so a band survives its
      // steps being folded into a collapsed milestone)
      const { nodes: layoutedNodes, swimlanes: layoutedSwimlanes } = await layoutGraph(graph, {
        direction: 'RIGHT',
        nodeSpacingX: 100,
        nodeSpacingY: 80,
        swimlaneSpacing: 140,
      })

      console.log(`Layout: Positioned ${layoutedNodes.length} nodes, ${layoutedSwimlanes.length} swimlanes`)
      if (!isProjectScopeCurrent(scope)) return

      // Written before the state updates, so the effect that would otherwise
      // schedule a second generate sees a signature that already matches.
      useDiagramView.getState().remember(projectId, {
        nodes: layoutedNodes,
        edges: graph.edges,
        swimlanes: layoutedSwimlanes,
        collapsedMilestoneIds: [...collapsedMilestoneIds],
        signature,
      })

      // Step 3: Update React Flow
      setNodes(layoutedNodes)
      setEdges(graph.edges)
      setSwimlanes(layoutedSwimlanes)
      setHasGenerated(true)

      if (!options?.silent) {
        toast.success('Diagram generated!', { id: 'diagram-generated' })
      }
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to generate diagram:', error)
        toast.error('Failed to generate diagram')
      }
    } finally {
      generateInFlightRef.current = false
      if (isProjectScopeCurrent(scope)) setIsGenerating(false)
    }
  }, [projectId, steps, milestones, teams, systems, gaps, collapsedMilestoneIds, signature, setNodes, setEdges])

  /**
   * Handle node click - select step and show in right panel
   *
   * A collapsed milestone expands instead (PRD §4.5.2). Its node id names a box,
   * not a step, so selecting on it would put the right panel on a step that does
   * not exist.
   */
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.type === 'milestone') {
        // A double-click fires `click` twice before `dblclick`, and the second one
        // would toggle straight back. Double-click is a real gesture on this canvas
        // — it opens the step editor — so without this a user who double-clicks a
        // box sees nothing happen at all.
        if (event.detail > 1) return
        toggleMilestone((node.data as MilestoneNodeData).milestoneId)
        return
      }
      const stepId = node.id
      selectStep(stepId)
      console.log('Selected step:', stepId)
    },
    [selectStep, toggleMilestone]
  )

  /**
   * Handle node double-click - open edit modal
   */
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const stepId = node.id
      const step = steps.find(s => s.id === stepId)
      if (step) {
        setEditingStep(step)
        setEditModalOpen(true)
      }
    },
    [steps]
  )

  /**
   * Handle modal close
   */
  const handleModalClose = useCallback(() => {
    setEditModalOpen(false)
    setEditingStep(null)
  }, [])

  const milestoneById = useMemo(() => milestonesById(milestones), [milestones])

  /**
   * The steps behind these node ids, in process order.
   *
   * Ordered with `compareSteps` rather than by `order`, which is scoped to a
   * milestone (#299): a selection that spans two milestones would otherwise be
   * copied interleaved, and the paste would write that interleaving down.
   */
  const stepsForNodeIds = useCallback(
    (ids: readonly string[]): Step[] =>
      ids
        .map(id => steps.find(s => s.id === id))
        .filter((step): step is Step => step !== undefined)
        .sort((a, b) => compareSteps(a, b, milestoneById)),
    [steps, milestoneById]
  )

  /**
   * Track the multi-selection.
   *
   * React Flow re-derives the array on every store touch, so this fires far more
   * often than the selection changes; comparing the ids and returning the old
   * array keeps an unchanged selection from re-rendering the canvas.
   */
  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    const ids = selected.map(node => node.id)
    setSelectedNodeIds(previous =>
      previous.length === ids.length && previous.every((id, index) => id === ids[index])
        ? previous
        : ids
    )
  }, [])

  /**
   * Handle right-click on node
   */
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()

    // Find the step data
    const step = steps.find(s => s.id === node.id)
    if (!step || node.type === 'processEnd') return

    // Right-clicking inside a multi-selection acts on the selection; on a node
    // outside it, on that node alone.
    const selection =
      selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id)
        ? stepsForNodeIds(selectedNodeIds)
        : []

    setContextMenuStep(step)
    setContextMenuSelection(selection.length > 1 ? selection : undefined)
    setContextMenuPosition({ x: event.clientX, y: event.clientY })
  }, [steps, selectedNodeIds, stepsForNodeIds])

  /**
   * Handle right-click on the selection rectangle.
   *
   * Shift+drag box-selects, and the rectangle React Flow draws over the result
   * swallows the nodes' own context-menu events — so without this the menu is
   * unreachable from exactly the gesture that makes a multi-selection.
   */
  const handleSelectionContextMenu = useCallback((event: React.MouseEvent, selectedNodes: Node[]) => {
    event.preventDefault()

    const selection = stepsForNodeIds(selectedNodes.map(node => node.id))
    if (selection.length === 0) return

    const underCursor = nodeIdUnderCursor(event.clientX, event.clientY)
    const anchor = selection.find(step => step.id === underCursor) ?? selection[0]

    setContextMenuStep(anchor)
    setContextMenuSelection(selection.length > 1 ? selection : undefined)
    setContextMenuPosition({ x: event.clientX, y: event.clientY })
  }, [stepsForNodeIds])

  /**
   * Close context menu
   */
  const handleContextMenuClose = useCallback(() => {
    setContextMenuStep(null)
    setContextMenuPosition(null)
    setContextMenuSelection(undefined)
  }, [])

  /**
   * Paste from the menu: after the step it was opened on.
   */
  const handleContextPaste = useCallback((anchor: Step) => {
    setPasteAnchor(anchor)
    setPasteOpen(true)
  }, [])

  const handlePasteClose = useCallback(() => {
    setPasteOpen(false)
    setPasteAnchor(null)
  }, [])

  /**
   * Handle edit from context menu
   */
  const handleContextEdit = useCallback((step: Step) => {
    setEditingStep(step)
    setEditModalOpen(true)
  }, [])

  /**
   * Handle delete from context menu
   */
  const handleContextDelete = useCallback((step: Step) => {
    setStepToDelete(step)
    setShowDeleteConfirm(true)
  }, [])

  /**
   * Delete a step and close the hole it leaves.
   *
   * The deletion itself, with no confirmation of its own: the two surfaces that
   * reach it — the context menu's dialog and the step editor's (#218) — each
   * confirm before calling, and a second prompt on the way through would be one
   * dialog answering another. Returns whether the delete actually happened, so
   * the caller only tears its own dialog down on success.
   */
  const deleteStepAndReseal = useCallback(
    async (target: Step): Promise<boolean> => {
      const scope = captureProjectScope(projectId)
      if (!scope) return false

      try {
        // `deleteStep` throws on failure now (#349), so the reseal below cannot
        // run after a delete that did not happen.
        await useStepsStore.getState().deleteStep(target.id, projectId)
        if (!isProjectScopeCurrent(scope)) return false

        // The diagram deleted a step without ever closing the hole it left, so a
        // step removed here renumbered nothing and the milestone kept a gap in
        // its sequence until some other surface repaired it.
        await resealAfterMutation({
          projectId,
          milestoneIds: [target.milestoneId],
          scope,
        })
        if (!isProjectScopeCurrent(scope)) return false
        toast.success(`Step "${target.label}" deleted`)
        return true
      } catch (error) {
        if (isProjectScopeCurrent(scope)) {
          console.error('Failed to delete step:', error)
          toast.error('Failed to delete step')
        }
        return false
      }
    },
    [projectId]
  )

  /**
   * Confirm and delete step
   */
  const confirmDelete = useCallback(async () => {
    if (!stepToDelete) return
    if (!(await deleteStepAndReseal(stepToDelete))) return
    setShowDeleteConfirm(false)
    setStepToDelete(null)
  }, [deleteStepAndReseal, stepToDelete])

  /**
   * Cancel delete
   */
  const cancelDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    setStepToDelete(null)
  }, [])

  /**
   * Handle "Add Gap" from context menu
   */
  const handleContextAddGap = useCallback((step: Step) => {
    setGapFormStepId(step.id)
    setIsGapFormOpen(true)
  }, [])

  /**
   * ⌘C / ⌘V on the pane.
   *
   * A document listener rather than React Flow's `useKeyPress`: the copy has to
   * see the selection and the buffer, and `useKeyPress` only reports that a key
   * is down. Three things gate it, and each of them is a bug that was easy to
   * write: a keystroke aimed at a field, a keystroke aimed at a dialog over the
   * canvas, and a keystroke the open context menu already binds — the menu runs
   * the same two shortcuts, so without the last gate ⌘C copies twice.
   */
  useEffect(() => {
    const anyModalOpen =
      editModalOpen || showDeleteConfirm || isGapFormOpen || showExportModal || pasteOpen

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key !== 'c' && key !== 'v') return
      if (anyModalOpen || contextMenuStep) return

      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')
      ) {
        return
      }

      if (key === 'c') {
        const selection = stepsForNodeIds(selectedNodeIds)
        if (selection.length === 0) return
        event.preventDefault()
        void copyStepsAsJson(selection, projectId)
        return
      }

      if (!useDiagramClipboard.getState().clipboard?.steps.length) return
      event.preventDefault()
      // No anchor: ⌘V on the pane pointed at no step, so the modal appends.
      setPasteAnchor(null)
      setPasteOpen(true)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    editModalOpen,
    showDeleteConfirm,
    isGapFormOpen,
    showExportModal,
    pasteOpen,
    contextMenuStep,
    selectedNodeIds,
    stepsForNodeIds,
    projectId,
  ])

  /**
   * Regenerate when the process changes after the first generate.
   * A mount that restores a layout with the same signature does not: that
   * is the tab switch (#281), and regenerating it would toast again for a
   * diagram the user already has.
   */
  useEffect(() => {
    if (!hasGenerated || isGenerating) return
    const view = useDiagramView.getState().views[projectId]
    if (view?.signature === signature) return

    const timer = setTimeout(() => {
      console.log('Data changed, regenerating diagram...')
      void generateDiagram({ silent: true })
    }, 300)
    return () => clearTimeout(timer)
  }, [signature, hasGenerated, isGenerating, generateDiagram, projectId])

  // A drag updates React Flow's nodes without a new layout. Keep the session
  // copy in step so the next mount has the positions the user left.
  useEffect(() => {
    if (!hasGenerated || nodes.length === 0) return
    const view = useDiagramView.getState().views[projectId]
    if (!view) return
    useDiagramView.getState().remember(projectId, {
      ...view,
      nodes,
      edges,
      swimlanes,
      collapsedMilestoneIds: [...collapsedMilestoneIds],
    })
  }, [hasGenerated, nodes, edges, swimlanes, collapsedMilestoneIds, projectId])

  /**
   * Fit view on initial generation
   */
  useEffect(() => {
    if (!hasGenerated || nodes.length === 0) return
    // Small delay to ensure nodes are rendered. Cleared on unmount so a
    // tab switch does not call into a canvas that is already gone.
    const timer = setTimeout(() => {
      const viewport = getViewportFit(nodes, 1200, 800)
      console.log('Fitting viewport:', viewport)
    }, 100)
    return () => clearTimeout(timer)
  }, [hasGenerated, nodes])

  return (
    <div
      ref={canvasRef}
      className="diagram-canvas"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {/* Generate Button (shown when no diagram) */}
      {!hasGenerated && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            textAlign: 'center',
          }}
        >
          <button
            onClick={() => void generateDiagram()}
            disabled={isGenerating || steps.length === 0}
            className="btn-primary flex items-center gap-gs-2"
          >
            <RefreshCw size={16} strokeWidth={2} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating ? 'Generating...' : 'Generate Diagram'}
          </button>

          {steps.length === 0 && (
            <p className="mt-gs-4 text-sm text-gs-ink-muted">
              Add some steps in the Discovery Grid first
            </p>
          )}
        </div>
      )}

      {/* React Flow Diagram */}
      {hasGenerated && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={handleNodeContextMenu}
          onSelectionContextMenu={handleSelectionContextMenu}
          onSelectionChange={handleSelectionChange}
          // The store owns deletion, so React Flow must not: its default
          // Backspace binding removes the selected nodes from this component's
          // local state only, leaving the diagram disagreeing with the database
          // until the next regenerate puts the steps back.
          deleteKeyCode={null}
          nodeTypes={DIAGRAM_NODE_TYPES}
          edgeTypes={DIAGRAM_EDGE_TYPES}
          fitView
          fitViewOptions={DIAGRAM_FIT_VIEW_OPTIONS}
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          proOptions={{ hideAttribution: true }}
        >
          {/* Swimlane Background */}
          <SwimlaneBackground swimlanes={swimlanes} />

          {/* Grid Background */}
          {/* A presentation attribute on an SVG pattern, so it takes a literal.
              The dot grid is a sibling of the viewport and never reaches an export. */}
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={RULE} />

          {/* Zoom/Pan Controls */}
          <Controls 
            showInteractive={false}
            style={{
              left: '20px',
              bottom: '20px',
            }}
          />

          {/* MiniMap */}
          {/* Ink, not team colour. The AC puts team colour in exactly two places
              and the minimap is neither; at this size the hues were noise anyway. */}
          <MiniMap
            nodeColor={INK}
            maskColor={`rgba(${INK_RGB}, 0.1)`}
            style={{
              backgroundColor: 'var(--gs-surface)',
              border: `2px solid ${INK}`,
              borderRadius: 0,
              right: '20px',
              bottom: '20px',
            }}
            zoomable
            pannable
          />
        </ReactFlow>
      )}

      {/* Floating controls (top-right).

          Export sits outside the hasGenerated gate: the CSV registers need no
          diagram, so hiding the button until Generate has run would put the
          steps and gaps exports behind a diagram they do not use. The modal
          disables the three diagram formats on its own and says why. */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 5,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
        }}
      >
        <button
          onClick={() => setShowExportModal(true)}
          className="btn-secondary flex items-center gap-gs-2"
          title="Export the diagram, a Markdown pack, or a CSV register"
        >
          <Download size={16} strokeWidth={2} />
          Export
        </button>

        {/* Milestones. A menu rather than a button because collapsing is per
            milestone, and the diagram has nowhere else to reach one from. */}
        {hasGenerated && foldableMilestones.length > 0 && (
          <div className="relative" ref={milestoneMenuRef}>
            <button
              type="button"
              onClick={() => setShowMilestoneMenu(open => !open)}
              className="btn-secondary flex items-center gap-gs-2"
              aria-haspopup="menu"
              aria-expanded={showMilestoneMenu}
              title="Collapse a milestone into a single box, or expand it again"
            >
              Milestones
              <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            {showMilestoneMenu && (
              <div
                role="menu"
                className="absolute right-0 mt-gs-1 w-64 bg-gs-surface border-2 border-gs-ink z-[var(--gs-z-popover)]"
              >
                {foldableMilestones.map(milestone => {
                  const isCollapsed = collapsedMilestoneIds.has(milestone.id)
                  return (
                    <button
                      key={milestone.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={isCollapsed}
                      className="btn-ghost w-full flex items-center justify-between gap-gs-2 text-left"
                      onClick={() => toggleMilestone(milestone.id)}
                    >
                      <span className="truncate" title={milestone.name}>
                        {milestone.name}
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] font-semibold text-gs-ink-muted">
                        {isCollapsed ? 'Collapsed' : 'Expanded'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Regenerate */}
        {hasGenerated && (
          <button
            onClick={() => void generateDiagram()}
            disabled={isGenerating}
            className="btn-secondary flex items-center gap-gs-2"
            title="Regenerate diagram from current data"
          >
            <RefreshCw size={16} strokeWidth={2} className={isGenerating ? 'animate-spin' : ''} />
            Regenerate
          </button>
        )}
      </div>

      {/* Edit Modal */}
      <StepEditModal
        projectId={projectId}
        step={editingStep}
        isOpen={editModalOpen}
        onClose={handleModalClose}
        onDelete={editingStep ? () => deleteStepAndReseal(editingStep) : undefined}
      />

      {/* Paste Modal (#155). The 300 ms debounced regenerate repaints the
          diagram once the pasted steps reach the store, so nothing here
          touches nodes or edges itself. */}
      <PasteStepsModal
        projectId={projectId}
        isOpen={pasteOpen}
        onClose={handlePasteClose}
        anchorStep={pasteAnchor}
      />

      {/* Context Menu */}
      <NodeContextMenu
        step={contextMenuStep}
        position={contextMenuPosition}
        onClose={handleContextMenuClose}
        onEdit={handleContextEdit}
        onDelete={handleContextDelete}
        onAddGap={handleContextAddGap}
        selectedSteps={contextMenuSelection}
        onPaste={handleContextPaste}
      />

      {/* Delete Confirmation. The shared shell (#204) rather than a hand-rolled
          dialog, which carried a 12px radius and a drop shadow of its own. */}
      <ConfirmModal
        isOpen={showDeleteConfirm && !!stepToDelete}
        onClose={cancelDelete}
        title="Delete Step?"
        description={
          <>
            Are you sure you want to delete <strong>"{stepToDelete?.label}"</strong>? This action
            cannot be undone.
          </>
        }
        confirmAction={{ label: 'Delete', onClick: confirmDelete, style: 'danger' }}
      />

      {/* Gap Form Modal */}
      <GapForm
        isOpen={isGapFormOpen}
        onClose={() => {
          setIsGapFormOpen(false)
          setGapFormStepId(null)
        }}
        mode="create"
        projectId={projectId}
        prefilledStepId={gapFormStepId}
        displayNumbers={positions}
      />

      {/* Export Modal (PRD 4.12, #150) */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        project={currentProject}
        steps={steps}
        gaps={gaps}
        teams={teams}
        milestones={milestones}
        systems={systems}
        policies={policies}
        glossary={glossary}
        sipoc={sipoc}
        getViewport={getExportViewport}
        nodes={nodes}
        swimlanes={swimlanes}
        hasDiagram={nodes.length > 0}
      />
    </div>
  )
}

