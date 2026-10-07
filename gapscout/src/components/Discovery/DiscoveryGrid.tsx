/**
 * Discovery Grid - Table interface for viewing/editing process steps
 * 
 * Features:
 * - View all process steps in table format
 * - Click to edit cells (inline editing)
 * - Team dropdown
 * - Add/delete rows
 * - SIPOC coverage indicators
 * 
 * References: PRD Section 4.4 - Discovery Grid
 */

import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import toast from 'react-hot-toast'
import { useTeamsStore } from '../../state/teamsStore'
import { useSystemsStore } from '../../state/systemsStore'
import { useStepsStore } from '../../state/stepsStore'
import { resyncGapsAfterStepWrite, snapshotOpenGapIds } from '../../state/gapResync'
import { openSlotForInsert, resealAfterMutation } from '../../state/sequenceOps'
import { planAppend, toSequenceRows } from '../../lib/sequence'
import { createStep } from '../../services/db'
import type { Step, Milestone, Gap, MissingFieldType } from '../../data/types'
import { MilestoneManager } from './MilestoneManager'
import { validateStep } from '../../lib/sipocValidator'
import { compareSteps, isProcessGap, milestonesById, processPositions } from '../../lib/stepSequence'
import { splitStepPatch } from '../../lib/stepPatch'
import {
  getProcessGapsToShiftAfterGapDeletion,
  getStepsToShiftAfterGapDeletion,
} from '../../lib/gapDeletion'
import { ValidationWarningModal } from './ValidationWarningModal'
import { ConfirmModal } from '../shared/ConfirmModal'
import { ProcessGapManager } from './ProcessGapManager'
import { EditableRowTable, type StepOrGap } from './EditableRowTable'
import { useGapsStore } from '../../state/gapsStore'
import type { EditableStep } from './types'
import { captureProjectScope, isProjectScopeCurrent } from '../../state/workspaceScope'
import '../../styles/discovery.css'
import { Link2, Plus } from 'lucide-react'
import { EmptyState } from '../shared/EmptyState'

interface DiscoveryGridProps {
  projectId: string
}

export default function DiscoveryGrid({ projectId }: DiscoveryGridProps) {
  const { teams } = useTeamsStore()
  const { systems } = useSystemsStore()
  const {
    steps: storeSteps,
    milestones: storeMilestones,
    loadSteps: loadStepsInStore,
    loadMilestones,
    addMilestone: addMilestoneInStore,
    updateStep: updateStepInStore,
    reorderSteps: reorderStepsInStore,
    deleteStep: deleteStepFromStore
  } = useStepsStore()
  const [steps, setSteps] = useState<EditableStep[]>(() =>
    useStepsStore.getState().currentProjectId === projectId ? storeSteps : []
  )
  const [milestones, setMilestones] = useState<Milestone[]>(() =>
    useStepsStore.getState().currentProjectId === projectId ? storeMilestones : []
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeMilestoneId, setActiveMilestoneId] = useState<string | null>(null)
  const [filterEntity, setFilterEntity] = useState<string | null>(null)
  const [cancelConfirmation, setCancelConfirmation] = useState<{
    show: boolean
    stepId: string | null
  }>({ show: false, stepId: null })
  // Drag and drop state
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [hoveredInsertIndex, setHoveredInsertIndex] = useState<number | null>(null)
  
  // Delete confirmation modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  
  // Step deletion with gaps modal (ZIP-148 Phase 2)
  const [showDeleteOptionsModal, setShowDeleteOptionsModal] = useState(false)
  const [deletionContext, setDeletionContext] = useState<{
    steps: EditableStep[]
    hasGaps: boolean
    gapCount: number
  } | null>(null)
  
  // Validation warning modal
  const [showValidationWarning, setShowValidationWarning] = useState(false)
  const [validationContext, setValidationContext] = useState<{
    step: EditableStep
    missingFields: string[]
    pendingUpdates: Partial<Step>
    stepPersisted?: boolean
  } | null>(null)
  const validationAttemptRef = useRef(0)
  const validationInFlightRef = useRef<number | null>(null)

  useEffect(() => {
    validationAttemptRef.current += 1
    validationInFlightRef.current = null
    return () => {
      validationAttemptRef.current += 1
    }
  }, [projectId])

  // Process gap creation
  const [showProcessGapForm, setShowProcessGapForm] = useState(false)
  const [processGapData, setProcessGapData] = useState<{
    order: number
    milestoneId: string
    /**
     * The number the target row is showing in the `#` column, when that is not
     * the stored per-milestone `order` — i.e. the All Steps view (#333). The
     * gap form names positions to the reader, so it has to name the number the
     * reader can see, exactly as the insertion toast does (#303).
     */
    displayOrder?: number
  } | null>(null)
  const [editingGap, setEditingGap] = useState<Gap | null>(null)
  
  // Delete gap confirmation
  const [showDeleteGapConfirm, setShowDeleteGapConfirm] = useState(false)
  const [gapToDelete, setGapToDelete] = useState<Gap | null>(null)
  
  // Gaps store for creating/updating gaps
  const {
    addGap: createGapInStore,
    updateGap: updateGapInStore,
    gaps,
  } = useGapsStore()

  useEffect(() => {
    if (!projectId || storeSteps.length > 0 || useStepsStore.getState().currentProjectId !== projectId) return
    void loadStepsInStore(projectId)
    // The workspace normally loads steps before rendering this component; this fallback keeps the grid usable in isolation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const reloadMilestones = async () => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    try {
      await loadMilestones(projectId)
      if (!isProjectScopeCurrent(scope)) return
      setMilestones(useStepsStore.getState().milestones)
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to reload milestones:', error)
        toast.error('Failed to reload milestones')
      }
    }
  }

  // Resolve the milestone a new row belongs to, creating the project's first one
  // when it has none.
  //
  // A project can reach this grid with no milestone row at all — created outside
  // the setup wizard, restored from data that predates it, or seeded by
  // something that never made one. The grid used to answer "+ Add First Step"
  // with "No milestone found. Please create a project first.", which is wrong on
  // both counts: the project exists, and creating another one is not the fix
  // (#168). Every step needs a milestone to scope its order (#299), so make the
  // same "Main Flow" the setup wizard creates (`ProjectList.tsx`), the way the
  // SIPOC wizard already auto-creates an "Unassigned" team for a project with
  // none (`ProcessBoard.tsx`).
  //
  // The guard is "no milestones at all", not "no milestone named Main Flow": a
  // template seeds its own phases and must not gain a fifth one, and order 0 is
  // only free while the list is empty.
  //
  // A second click while the create is in flight is dropped, not queued behind
  // it. `milestones` is the closure's copy and stays empty for the whole await,
  // so both clicks would otherwise pass the guard and write two "Main Flow"
  // milestones at order 0 — silently, because the milestones table carries no
  // uniqueness on `(project_id, "order")`. Sharing one promise between them is
  // not enough either: both callers resume in the same microtask drain, before
  // React has re-rendered, so both would append a row from the same stale
  // `steps` and the second `setSteps` would drop the first one's row while
  // still raising its toast. The button that got them here is the empty state's,
  // and it is gone the moment the first row exists, so one row is the answer.
  //
  // Returns null when the create fails. The store reports that failure itself,
  // so callers return silently rather than raising a second toast.
  const defaultMilestoneCreation = useRef<Promise<Milestone | null> | null>(null)

  const resolveDefaultMilestone = async (
    preferred?: Milestone
  ): Promise<Milestone | null> => {
    const existing =
      preferred ?? milestones.find(m => m.name === 'Main Flow') ?? milestones[0]
    if (existing) return existing

    if (defaultMilestoneCreation.current) return null

    const creation = (async () => {
      const scope = captureProjectScope(projectId)
      if (!scope) return null

      const created = await addMilestoneInStore(
        {
          projectId,
          name: 'Main Flow',
          order: 0,
          description: 'Primary process flow',
          relatedPolicies: [],
        },
        { silent: true }
      )
      if (!created || !isProjectScopeCurrent(scope)) return null

      setMilestones(useStepsStore.getState().milestones)
      return created
    })()

    defaultMilestoneCreation.current = creation
    try {
      return await creation
    } finally {
      defaultMilestoneCreation.current = null
    }
  }

  const [previousStoreMilestones, setPreviousStoreMilestones] = useState(storeMilestones)
  if (storeMilestones !== previousStoreMilestones) {
    setPreviousStoreMilestones(storeMilestones)
    setMilestones(storeMilestones)
  }

  // Sync local steps with store steps when storeSteps reference changes.
  // Render-time setState (guarded by previous-prop tracking) is React's blessed
  // alternative to a sync useEffect: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  // It avoids the cascading-render hazard the rule guards against.
  const [prevStoreSteps, setPrevStoreSteps] = useState(storeSteps)
  if (storeSteps !== prevStoreSteps) {
    setPrevStoreSteps(storeSteps)
    setSteps(prev => {
      const uiFlags = new Map(prev.map(s => [s.id, { _isNew: s._isNew, _isEditing: s._isEditing }]))
      const syncedSteps = storeSteps.map(s => ({
        ...s,
        ...uiFlags.get(s.id),
      }))
      // Keep any new unsaved steps that aren't in the store yet
      const newSteps = prev.filter(s => s._isNew && !storeSteps.find(ss => ss.id === s.id))
      return [...syncedSteps, ...newSteps]
    })
  }

  // Steps and gaps both sort by process position — milestone order, then the
  // step's order within it — because `order` is scoped to its milestone (#299).
  // A flat `order` sort put a later milestone's step ahead of an earlier one,
  // which is what made the All Steps view show the process out of sequence.
  const milestoneById = milestonesById(milestones)

  // Filter steps by active milestone and entity, then sort by process position
  const filteredSteps = steps
    .filter(step => {
      // Filter by milestone
      if (activeMilestoneId && step.milestoneId !== activeMilestoneId) {
        return false
      }
      
      // Filter by entity (team or system)
      if (filterEntity) {
        const isSupplier = step.suppliers.includes(filterEntity)
        const isCustomer = step.customers.includes(filterEntity)
        return isSupplier || isCustomer
      }
      
      return true
    })
    .sort((a, b) => compareSteps(a, b, milestoneById))
  
  // Get process gaps (those with order but no stepId, and not closed)
  const processGaps = gaps.filter(gap => 
    gap.order !== undefined && 
    !gap.stepId &&
    gap.status !== 'Closed' && // Filter out closed gaps
    (!activeMilestoneId || gap.milestoneId === activeMilestoneId)
  )
  
  // Merge steps and gaps, sorted by process position. A process gap reserves an
  // order in the flow exactly as a step does, so it ranks on the same tuple.
  const mergedItems: StepOrGap[] = [
    ...filteredSteps.map(s => ({ ...s, _type: 'step' as const })),
    ...processGaps.map(g => ({ ...g, _type: 'gap' as const }))
  ].sort((a, b) => compareSteps(a, b, milestoneById))

  // The `#` column in the All Steps view. `order` restarts at 1 in every
  // milestone, so the stored value read as a broken sequence once the rows were
  // sorted properly. A dense running position over the whole process reads
  // right, and parallel rows — which share a rank — share a number.
  //
  // Only in All Steps: inside a milestone tab the stored order already IS the
  // position, and showing anything else would put a number in the cell that the
  // cell's own editor does not accept.
  //
  // Same accessor as `useProcessPositions`, deliberately fed different rows: the
  // hook reads the store, while this reads `steps`, which carries the unsaved
  // `_isNew` rows the grid is currently showing. A pending row is on screen and
  // has to be numbered, but no other surface can see it — so while one is open,
  // the grid's numbers run one ahead of the drawer's from that row down. The
  // gap closes the moment the row saves, and no surface shows both maps at once
  // (#345).
  const displayNumbers =
    activeMilestoneId === null ? processPositions(steps, gaps, milestones) : null

  // Add new row at specific position
  const handleInsertRow = async (atIndex: number) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return

    // Ahead of the milestone, which can now be a write: a project with neither
    // teams nor milestones would otherwise be told to set up teams having just
    // had a milestone persisted for a step it cannot add.
    const defaultTeam = teams[0]
    if (!defaultTeam) {
      toast.error('No teams found. Please set up teams first.')
      return
    }

    // `resolveDefaultMilestone` reports its own failure, and it is the only way
    // this can be null now that a milestone-less project gets one made for it.
    const defaultMilestone = await resolveDefaultMilestone()
    if (!defaultMilestone || !isProjectScopeCurrent(scope)) return

    // The tray sits above the row it inserts before, and `atIndex` is that row's
    // index in `mergedItems` — the list the table actually renders. Reading
    // `filteredSteps[atIndex]` instead skipped every gap row above it, so the
    // order came from whichever step happened to share the index.
    //
    // Both the order and the milestone come from that row. `order` is scoped to
    // its milestone (#299), so taking it from a row in milestone B and then
    // shifting milestone A put the new step at a position belonging to a
    // sequence it is not in (#302). A gap reserves an order the same way a step
    // does, so either kind of row is a valid target.
    //
    // They come as a pair or not at all. `Gap.milestoneId` is optional, so a
    // row can carry an order with no milestone to scope it; lending that order
    // to the default milestone's sequence is the same mismatch this is fixing.
    const targetRow = mergedItems[atIndex]
    const rowMilestone = milestones.find(m => m.id === targetRow?.milestoneId)
    const targetMilestone = rowMilestone ?? defaultMilestone
    const insertOrder = rowMilestone ? targetRow?.order ?? 1 : 1

    try {
      // One call, and no arithmetic here. `openSlot` reads the milestone's live
      // rows, ranks its steps and process gaps together and pushes the position
      // at `insertOrder` and everything above it up — so the new step cannot
      // land on an order a gap still holds (#307), and a milestone that was
      // already holed does not acquire a second one.
      await openSlotForInsert({ projectId, milestoneId: targetMilestone.id, at: insertOrder, scope })
      if (!isProjectScopeCurrent(scope)) return

      setSteps(prev => {
        const now = Date.now()
        const newStep: EditableStep = {
          id: nanoid(),
          projectId,
          label: '',
          teamId: defaultTeam.id,
          milestoneId: targetMilestone.id,
          order: insertOrder,
          suppliers: [],
          inputs: [],
          outputs: [],
          customers: [],
          systems: [],
          trigger: undefined,
          result: undefined,
          kpi: undefined,
          decision: false,
          branches: undefined,
          notes: undefined,
          comments: [],
          links: [],
          gapIds: [],
          diagramPosition: undefined,
          createdAt: now,
          updatedAt: now,
          _isNew: true,
          _isEditing: true,
        }
        // Only the unsaved rows are patched here. `openSlotForInsert` has
        // already reloaded the store, and the render-time sync above carries
        // those new orders into this list; a row that exists only in the grid
        // is invisible to the reload and has to be moved by hand.
        const updatedSteps = prev.map(step =>
          step._isNew && step.milestoneId === targetMilestone.id && step.order >= insertOrder
            ? { ...step, order: step.order + 1 }
            : step
        )
        return [...updatedSteps, newStep]
      })

    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        // The store action that used to own this reported it; the module
        // deliberately does not toast, so the report belongs here or the insert
        // fails in silence.
        console.error('Failed to persist inserted step order:', error)
        toast.error('Failed to insert step')
      }
    }
  }

  // Handle creating a process gap from hover tray
  const handleCreateProcessGap = async (atIndex: number) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return

    // Reports its own failure; see `resolveDefaultMilestone`.
    const defaultMilestone = await resolveDefaultMilestone()
    if (!defaultMilestone || !isProjectScopeCurrent(scope)) return

    // Same target as `handleInsertRow`, and for the same reasons. `atIndex` is
    // an index into `mergedItems`, the list the table renders; reading
    // `filteredSteps[atIndex]` skipped every gap row above it, which took the
    // order from whichever step happened to share the index and threw outright
    // on the last row's tray, where `filteredSteps` has already run out (#306).
    //
    // Both order and milestone come from that one row. The milestone used to
    // come from the row *above* instead, which is wrong at a milestone
    // boundary: a tray above the first row of milestone B took B's order and
    // A's milestone, and `order` is scoped to its milestone (#299) — the same
    // pairing #302 fixed for step insertion.
    //
    // Order and milestone come as a pair or not at all, as in `handleInsertRow`.
    const targetRow = mergedItems[atIndex]
    const rowMilestone = milestones.find(m => m.id === targetRow?.milestoneId)
    const milestoneId = (rowMilestone ?? defaultMilestone).id
    const gapOrder = rowMilestone ? targetRow?.order ?? 1 : 1

    // Just open the gap form - don't shift orders yet
    // Orders will be shifted when the gap is actually saved (via conflict resolution)
    setProcessGapData({
      order: gapOrder,
      milestoneId,
      // Gated on `rowMilestone`, not on `targetRow`, for the same reason order
      // and milestone are: when the row carries no milestone this falls back to
      // order 1 of the default one, and the row's own running number would then
      // name a position the gap is not going into.
      displayOrder: rowMilestone ? displayNumbers?.get(targetRow!.id) : undefined,
    })
    setShowProcessGapForm(true)
  }

  // Handle closing a process gap (convert to step)
  const handleCloseProcessGap = async (gap: Gap) => {
    const defaultMilestone = milestones.find(m => m.id === gap.milestoneId) || milestones[0]
    const defaultTeam = teams[0]
    
    if (!defaultMilestone || !defaultTeam) {
      toast.error('Cannot close gap: missing milestone or team')
      return
    }
    
    // Build the new step inside the setSteps updater so Date.now() runs at commit time.
    setSteps(prev => {
      const now = Date.now()
      const newStep: EditableStep = {
        id: nanoid(),
        projectId,
        label: '', // User will need to fill this
        teamId: defaultTeam.id,
        milestoneId: gap.milestoneId || defaultMilestone.id,
        order: gap.order!,
        suppliers: [],
        inputs: [],
        outputs: [],
        customers: [],
        systems: [],
        trigger: undefined,
        result: undefined,
        kpi: undefined,
        decision: false,
        branches: undefined,
        notes: undefined,
        comments: [],
        links: [],
        gapIds: [gap.id], // Link this step to the gap it's resolving
        diagramPosition: undefined,
        createdAt: now,
        updatedAt: now,
        _isNew: true,
        _isEditing: true,
        _closingGapId: gap.id, // Track which gap this step is closing
      }
      return [...prev, newStep]
    })
    
    // Don't close the gap yet - wait for step to be saved
    toast('Fill in SIPOC details and save to close this gap', { 
      duration: 4000 
    })
  }

  // Handle deleting a process gap
  const handleDeleteGap = async () => {
    if (!gapToDelete) return
    const scope = captureProjectScope(projectId)
    if (!scope) return

    try {
      // Counted before the delete, and only to word the toast: what actually
      // moves is decided by the reseal, measured against the live sequence.
      const stepsToShift = getStepsToShiftAfterGapDeletion(steps, gapToDelete)
      const gapsToShift = getProcessGapsToShiftAfterGapDeletion(gaps, gapToDelete)

      // `deleteGap` now throws on failure, so this `await` is what stops the
      // reseal running after a delete that did not happen — which used to pull
      // the steps above the gap down onto the order it was still holding (#349).
      await useGapsStore.getState().deleteGap(gapToDelete.id, projectId)
      if (!isProjectScopeCurrent(scope)) return

      // One call, no arithmetic. The reseal closes the hole across steps and
      // process gaps together (#312, #341), reloads both stores and re-syncs the
      // milestone's gap wording. A gap with no milestone was in no sequence, so
      // there is nothing to reseal.
      await resealAfterMutation({
        projectId,
        milestoneIds: [gapToDelete.milestoneId],
        scope,
      })
      if (!isProjectScopeCurrent(scope)) return

      toast.success(
        stepsToShift.length + gapsToShift.length > 0
          ? 'Gap deleted and order numbers adjusted'
          : 'Gap deleted'
      )
      setShowDeleteGapConfirm(false)
      setGapToDelete(null)
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to delete gap:', error)
        toast.error('Failed to delete gap')
      }
    }
  }

  // Add new row at end
  const handleAddRow = async () => {
    const scope = captureProjectScope(projectId)
    if (!scope) return

    // Ahead of the milestone for the same reason as in `handleInsertRow`.
    const defaultTeam = teams[0]
    if (!defaultTeam) {
      toast.error('No teams found. Please set up teams first.')
      return
    }

    // Reports its own failure; see `resolveDefaultMilestone`.
    const defaultMilestone = await resolveDefaultMilestone(
      activeMilestoneId !== null
        ? milestones.find(m => m.id === activeMilestoneId)
        : undefined
    )
    if (!defaultMilestone || !isProjectScopeCurrent(scope)) return

    // Add at the end of the milestone the row is going into. `order` is scoped
    // to its milestone (#299), so a project-wide max put a new step at 7 in a
    // milestone that holds two — a hole the sequence never closes. The module
    // counts positions rather than rows, so a parallel pair at the end yields
    // the next integer rather than skipping one, and it counts the process gaps
    // that hold a position alongside the steps.
    // One past the highest order stored in this milestone. `planAppend` counts
    // from the stored maximum rather than the number of positions, so a
    // milestone that already has a hole does not hand the new row an order
    // another row is holding.
    const nextOrder = planAppend(toSequenceRows(steps, gaps, defaultMilestone.id))

    const newStep: EditableStep = {
      id: nanoid(),
      projectId,
      label: '',
      teamId: defaultTeam.id,
      milestoneId: defaultMilestone.id,
      order: nextOrder,
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
      systems: [],
      trigger: undefined,
      result: undefined,
      kpi: undefined,
      decision: false,
      branches: undefined,
      notes: undefined,
      comments: [],
      links: [],
      gapIds: [],
      diagramPosition: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      _isNew: true,
      _isEditing: true,
    }

    setSteps([...steps, newStep])
    // No toast here (#282): the row is still pending until Save Step. Announcing
    // "added" before the write claims a success the Cancel path would reverse.
  }

  // Show delete confirmation modal
  const handleDeleteClick = () => {
    if (selectedIds.size === 0) {
      console.log('No steps selected for deletion')
      return
    }
    console.log(`Opening delete confirmation for ${selectedIds.size} steps`)
    setShowDeleteConfirm(true)
  }

  // Perform the actual deletion
  const confirmDelete = async () => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    console.log(`Confirming deletion of ${selectedIds.size} selected steps:`, Array.from(selectedIds))
    setShowDeleteConfirm(false)

    try {
      const stepsToDelete = steps.filter(s => selectedIds.has(s.id))
      console.log('Steps to delete:', stepsToDelete.map(s => ({ id: s.id, label: s.label, isNew: s._isNew })))
      
      // ZIP-148 Phase 2: Check if any steps have open gaps. Off the store, not
      // the render-time `gaps` prop, same reason as the loop below (#261).
      const liveGaps = useGapsStore.getState().gaps
      const stepsWithGaps = stepsToDelete.filter(step =>
        !step._isNew && liveGaps.some(g => g.stepId === step.id && g.status === 'Open')
      )

      if (stepsWithGaps.length > 0) {
        // Show options modal: Shift or Create Ghost Gap
        const totalGaps = stepsWithGaps.reduce((count, step) => {
          return count + liveGaps.filter(g => g.stepId === step.id && g.status === 'Open').length
        }, 0)
        
        setDeletionContext({
          steps: stepsToDelete,
          hasGaps: true,
          gapCount: totalGaps
        })
        setShowDeleteOptionsModal(true)
        return // Don't delete yet, wait for user choice
      }
      
      // No gaps, proceed with normal deletion
      await executeStepDeletion(stepsToDelete, 'shift') // Default to shift
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to delete steps:', error)
        toast.error('Failed to delete steps')
      }
    }
  }

  // Execute step deletion with chosen strategy (ZIP-148 Phase 2)
  const executeStepDeletion = async (
    stepsToDelete: EditableStep[], 
    strategy: 'shift' | 'ghost'
  ) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return

    // Every milestone the loop took a row out of, resealed once at the end
    // rather than once per deletion. The reseal reads live rows, so it is
    // correct against whatever the loop left behind — and doing it per
    // iteration meant a full-project read, two store reloads and a
    // milestone-wide gap re-sync for each of twenty selected steps.
    //
    // It runs in `finally`, not after the loop: a delete that throws part way
    // leaves the earlier ones' holes open, and those still have to close.
    const touchedMilestoneIds = new Set<string>()

    try {
      for (const step of stepsToDelete) {
        if (!step._isNew) {
          // Close the deletion options modal
          setShowDeleteOptionsModal(false)
          setDeletionContext(null)
          
          if (strategy === 'ghost') {
            // Create process gap at this step's order
            // Off the store, not the render-time `gaps` prop: this loop writes
            // a gap per iteration, so by the second step the closure captured
            // at render is already behind what the save has done (#261).
            const stepGaps = useGapsStore
              .getState()
              .gaps.filter(g => g.stepId === step.id && g.status === 'Open')
            const gapDescription = stepGaps.length > 0
              ? `Step deleted with ${stepGaps.length} open gap(s): ${stepGaps.map(g => g.observed).join(', ')}`
              : `Step "${step.label}" deleted - process gap created`
            
            await createGapInStore({
              projectId,
              order: step.order,
              milestoneId: step.milestoneId,
              missingField: 'output', // Ghost gap for deleted step
              observed: gapDescription,
              expected: 'Step needs to be recreated or process flow validated',
              severity: 'H',
              priority: 1,
              status: 'Open',
              links: [],
            })
            if (!isProjectScopeCurrent(scope)) return

            // Delete the step. The ghost gap has taken its exact order, so the
            // sequence is already dense and the reseal below writes nothing —
            // but the milestone is still recorded, because the gap only holds
            // that position if it was created, and the create can fail.
            await deleteStepFromStore(step.id, projectId)
            if (!isProjectScopeCurrent(scope)) return
            touchedMilestoneIds.add(step.milestoneId)
          } else {
            // strategy === 'shift'
            //
            // The milestone comes from the store, not from `step`: each
            // iteration renumbers it, so the component's `steps` array — never
            // re-read across the loop — describes the sequence as it was before
            // the first deletion (#339). A step the store no longer knows about
            // is skipped rather than resealed from a stale row.
            const liveStep = useStepsStore.getState().steps.find(s => s.id === step.id)
            if (!liveStep) continue
            // Throws on failure now, so a delete that did not happen no longer
            // falls through to a reseal that pulls the sequence one short (#349).
            await deleteStepFromStore(step.id, projectId)
            if (!isProjectScopeCurrent(scope)) return
            touchedMilestoneIds.add(liveStep.milestoneId)
          }
        }
      }
      
      if (!isProjectScopeCurrent(scope)) return

      // Remove from local state
      setSteps(steps.filter(s => !stepsToDelete.some(d => d.id === s.id)))
      setSelectedIds(new Set())
      
      const strategyText = strategy === 'ghost' ? '• Process gaps created' : '• Orders shifted'
      toast.success(`Deleted ${stepsToDelete.length} step(s) ${strategyText}`)
      
      // Reload from store
      await loadStepsInStore(projectId)
      if (!isProjectScopeCurrent(scope)) return
      await useGapsStore.getState().loadGaps(projectId)
      if (!isProjectScopeCurrent(scope)) return

      // ZIP-148 Phase 2: Run chain validation after deletion
      const allSteps = useStepsStore.getState().steps
      // Milestones from the same live store read as the steps, not the
      // component's copy: validation ranks on (milestone.order, step.order)
      // (#344), and a delete can have reloaded both.
      const liveMilestones = useStepsStore.getState().milestones
      const allMilestones = milestonesById(liveMilestones)
      // Rebuilt here rather than reusing the render-time `displayNumbers`: the
      // delete reloaded both stores, so the component's copy is a render behind
      // and would miss every id it names (#345).
      const livePositions =
        activeMilestoneId === null
          ? processPositions(allSteps, useGapsStore.getState().gaps, liveMilestones)
          : null
      const chainGapsCreated: string[] = []
      
      // Validate all remaining steps for chain breaks
      for (let i = 0; i < allSteps.length; i++) {
        const currentStep = allSteps[i]
        const validation = validateStep(currentStep, allSteps, allMilestones)
        
        // Check for chain issues
        const hasChainIssues = validation.issues.some(issue => 
          issue.includes('not matched in next step') || 
          issue.includes('does not match input in next step') ||
          issue.includes('does not match output in previous step')
        )
        
        if (hasChainIssues) {
          // Check if chain gap already exists. From the store the reload above
          // has just refreshed, not the render-time `gaps` prop: the whole
          // point of that reload is to read what the deletion left behind, and
          // a closure captured at render throws it away — then raises a second
          // chain gap on a step that already has one (#261).
          const existingChainGap = useGapsStore.getState().gaps.find(g =>
            g.stepId === currentStep.id &&
            g.status === 'Open' &&
            g.observed?.includes('Chain break')
          )
          
          if (!existingChainGap) {
            const chainIssues = validation.issues.filter(issue => 
              issue.includes('not matched in next step') || 
              issue.includes('does not match input in next step') ||
              issue.includes('does not match output in previous step')
            )
            
            await createGapInStore({
              projectId,
              stepId: currentStep.id,
              missingField: i < allSteps.length - 1 ? 'customer' : 'supplier',
              observed: `Chain break after deletion: ${chainIssues.join(', ')}`,
              expected: 'Process flow should be continuous without breaks',
              severity: 'H',
              priority: 1,
              status: 'Open',
              links: [],
            })
            if (!isProjectScopeCurrent(scope)) return

            chainGapsCreated.push(`Step ${livePositions?.get(currentStep.id) ?? currentStep.order}`)
          }
        }
      }
      
      // Show chain validation results
      if (chainGapsCreated.length > 0) {
        if (!isProjectScopeCurrent(scope)) return
        toast(`${chainGapsCreated.length} chain gap${chainGapsCreated.length > 1 ? 's' : ''} detected (${chainGapsCreated.join(', ')})`, {
          duration: 5000,
          icon: <Link2 size={16} strokeWidth={2} />
        })
        await useGapsStore.getState().loadGaps(projectId)
        if (!isProjectScopeCurrent(scope)) return
      }

    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to delete steps:', error)
        toast.error('Failed to delete steps')
      }
    } finally {
      // One reseal for the whole run. Not gated on the project still being
      // open: the rows are already gone, so finishing the sequence is right
      // even if the user has navigated away — only the reload and the gap
      // re-sync inside are skipped (#348).
      if (touchedMilestoneIds.size > 0) {
        try {
          await resealAfterMutation({
            projectId,
            milestoneIds: [...touchedMilestoneIds],
            scope,
          })
        } catch (resealError) {
          if (isProjectScopeCurrent(scope)) {
            console.error('Failed to close the holes the deletion left:', resealError)
            toast.error('Steps deleted, but order numbers could not be tidied')
          }
        }
      }
    }
  }

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, stepId: string) => {
    setDraggedStepId(stepId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedStepId(null)
    setDragOverIndex(null)
  }

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    
    if (!draggedStepId) return

    // `dropIndex` indexes `mergedItems` — the list the table renders. Reading
    // `filteredSteps[dropIndex]` skipped every gap row above it, so a drop
    // below a gap took a different step's order and threw on the last row
    // (#306). Only step rows accept a drop, but the row still has to be found
    // in the list the index came from.
    const targetRow = mergedItems[dropIndex]
    if (!targetRow || targetRow._type !== 'step') {
      setDraggedStepId(null)
      setDragOverIndex(null)
      return
    }

    // Self-drop by id. Comparing a `filteredSteps` index against a
    // `mergedItems` one made a drop onto the row below yourself look like a
    // drop onto yourself as soon as a gap sat above the pair, and it was
    // swallowed with no feedback.
    if (targetRow.id === draggedStepId) {
      setDraggedStepId(null)
      setDragOverIndex(null)
      return
    }

    setDraggedStepId(null)
    setDragOverIndex(null)

    // Update the dragged step's order to match the target
    // This will cause it to appear at the same position as the target (parallel)
    // or user can manually edit to a different number for sequential.
    //
    // The milestone travels with the order: `order` is scoped to its milestone
    // (#299), so writing the target's order alone dropped a step onto a number
    // belonging to a sequence it was not in.
    const scope = captureProjectScope(projectId)
    if (!scope) return

    // The origin has to be read before the write: afterwards the step only
    // knows where it landed (#335). A same-milestone drop makes this the same
    // id twice, which the reseal de-duplicates.
    const originMilestoneId = useStepsStore.getState().steps.find(s => s.id === draggedStepId)?.milestoneId

    try {
      await updateStepInStore(
        draggedStepId,
        { order: targetRow.order, milestoneId: targetRow.milestoneId },
        projectId
      )
      if (!isProjectScopeCurrent(scope)) return

      // The tie at the destination is deliberate and is left alone — that is
      // drag-to-parallel, and the reseal preserves ties by design (#304). What
      // the reseal is here for is the hole the step left in its origin, which a
      // cross-milestone drag opens and nothing else closes; #310 still owns
      // what the destination should do about landing on an occupied position.
      await resealAfterMutation({
        projectId,
        milestoneIds: [originMilestoneId, targetRow.milestoneId],
        scope,
      })
      if (!isProjectScopeCurrent(scope)) return
      toast.success('Step order updated')
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to update step order:', error)
        toast.error('Failed to save new order')
      }
    }
  }

  const handleCancelNewRow = async (stepId: string) => {
    const step = steps.find(s => s.id === stepId)
    if (!step) return
    const scope = captureProjectScope(projectId)
    if (!scope) return

    const canceledOrder = step.order
    const closingGapId = step._closingGapId
    
    // Remove the new step from local state
    setSteps(prev => prev.filter(s => s.id !== stepId))
    
    // If this step was closing a gap, DON'T shift order numbers
    // because the gap is still occupying that order position
    if (closingGapId) {
      if (!isProjectScopeCurrent(scope)) return
      // The message is about the gap, so it names the gap's own position rather
      // than the cancelled row's. The two coincide — the row was created at the
      // gap's order in the gap's milestone, so they share a rank — but reading
      // that off the row made a reader reconstruct it (#345).
      //
      // This is the one converted site that uses the render-time map instead of
      // rebuilding from the store, and it has to: the cancelled row was never
      // saved, so a store read would not contain it and the map built over local
      // state is the only one that ranked it against the gap in the first place.
      const gapPosition = displayNumbers?.get(closingGapId) ?? canceledOrder
      // Plain "position": inside a milestone tab `displayNumbers` is null and
      // the number is the stored per-milestone order, not a process-wide rank.
      // Matches EditableRowTable's "Step saved at position N" (#357 Ask).
      toast(`Gap remains at position ${gapPosition}`)
      setCancelConfirmation({ show: false, stepId: null })
      return
    }
    
    // The insert opened a slot in this milestone; cancelling closes it again.
    // One reseal, replacing a per-step `updateStep` loop whose partial failure
    // left the milestone with both a hole and a tie (#350) — and which moved
    // steps only, so a process gap the insert had pushed up stayed there.
    //
    // Counted only to word the toast: what actually moves is decided by the
    // reseal against the milestone's live rows, not by these lists. Off `gaps`
    // rather than the rendered `processGaps`, which is narrowed to the active
    // milestone tab; the undo is about the milestone the canceled step was in,
    // whichever tab happens to be open.
    const stepsToRestore = steps.filter(
      s => s.milestoneId === step.milestoneId && s.order > canceledOrder && !s._isNew
    )
    const gapsToRestore = gaps.filter(
      gap => isProcessGap(gap) && gap.milestoneId === step.milestoneId && gap.order! > canceledOrder
    )

    try {
      await resealAfterMutation({ projectId, milestoneIds: [step.milestoneId], scope })
      if (!isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to restore order numbers after cancelling a row:', error)
        toast.error('Row canceled, but order numbers could not be restored')
        setCancelConfirmation({ show: false, stepId: null })
      }
      return
    }

    toast.success(
      stepsToRestore.length + gapsToRestore.length > 0
        ? 'Row canceled • Order numbers restored'
        : 'Row canceled'
    )

    // Close confirmation modal
    setCancelConfirmation({ show: false, stepId: null })
  }

  // Gap row callbacks (extracted for EditableRowTable boundary)
  const handleEditProcessGap = (gap: Gap) => {
    setProcessGapData({ order: gap.order!, milestoneId: gap.milestoneId || '' })
    setEditingGap(gap)
    setShowProcessGapForm(true)
  }

  const handleRequestDeleteGap = (gap: Gap) => {
    setGapToDelete(gap)
    setShowDeleteGapConfirm(true)
  }

  // Cancel new-row callbacks (extracted for EditableRowTable boundary)
  const handleRequestCancelWithConfirm = (stepId: string) => {
    setCancelConfirmation({ show: true, stepId })
  }

  // Validation modal trigger (extracted for EditableRowTable boundary)
  const handleShowValidationWarning = (ctx: {
    step: EditableStep
    missingFields: string[]
    pendingUpdates: Partial<Step>
  }) => {
    setValidationContext(ctx)
    setShowValidationWarning(true)
  }

  /**
   * Write a patch the validation modal was holding back.
   *
   * The modal defers the write so "Go Back & Edit" can return the user to the
   * row with the edit still uncommitted. Both exits that DO commit — Create Gap,
   * and Go Back when the row has gone (#296) — need the same `order`/field split
   * the inline editor makes, so it lives here rather than in each handler.
   *
   * It also runs the gap re-sync the inline editor runs. Without it the sequence
   * lands correctly on this route while the moved step's siblings keep gaps
   * describing a position they no longer hold (#298) — the other half of #291.
   */
  const persistPendingUpdates = async (step: Step, pendingUpdates: Partial<Step>) => {
    // Split against the order the database still holds, NOT `step.order`. The
    // modal is opened with the MERGED step (`{...item, ...updates}` in
    // EditableRowTable), so `step.order` is already the edited value — comparing
    // the patch against it makes every order edit look like a no-op and drops
    // the move on the floor while reporting success.
    const storedOrder =
      useStepsStore.getState().steps.find(s => s.id === step.id)?.order ?? step.order
    const { fieldUpdates, nextOrder } = splitStepPatch(pendingUpdates, storedOrder)
    // Scoped to the written step: `updateStep` only ever promotes gaps on the
    // step it wrote (#88), so a sibling caught by a milestone-wide re-sync is
    // still judged on its live status.
    const wasOpen = snapshotOpenGapIds(step.id)
    if (Object.keys(fieldUpdates).length > 0) {
      await updateStepInStore(step.id, fieldUpdates, projectId)
    }
    if (nextOrder !== null) {
      await reorderStepsInStore(step.id, nextOrder, projectId)
    }
    // No toast of its own: both callers already report their outcome, and the
    // re-sync writes silently, so one action still produces one message (#107).
    // It never throws either — on the Create Gap route a rethrow would abandon
    // the gap and log a step save that worked as a failure.
    const { syncedGapIds } = await resyncGapsAfterStepWrite({
      stepId: step.id,
      projectId,
      milestoneWide: nextOrder !== null,
      fallbackMilestoneId: step.milestoneId,
      wasOpen,
    })
    return syncedGapIds
  }

  /**
   * Leave the validation modal without creating a gap.
   *
   * "Go Back & Edit" normally leaves the edit uncommitted, because the user is
   * being returned to the row to finish it. When the row has gone there is
   * nothing to return to, and dropping the patch silently discarded work the
   * user had already done (#296) — clearing Suppliers or Customers commits on
   * document mousedown, so the write is legitimately attended at that instant
   * and the row can unmount under the open modal a moment later.
   *
   * Every exit routes here, not just the button: the header X, Escape and the
   * backdrop all leave by the same door, and losing the edit to a keystroke
   * instead of a click is the same bug.
   *
   * New rows are excluded: an unmounted new row was cancelled, and creating it
   * here would resurrect a row the user threw away.
   */
  const dismissValidationModal = async () => {
    const context = validationContext
    setShowValidationWarning(false)
    setValidationContext(null)

    const rowStillMounted =
      !!context && mergedItems.some(row => row.id === context.step.id)
    if (!context || context.step._isNew || rowStillMounted) {
      toast('Please complete the missing SIPOC fields')
      return
    }

    const scope = captureProjectScope(projectId)
    if (!scope) return

    try {
      await persistPendingUpdates(context.step, context.pendingUpdates)
      if (!isProjectScopeCurrent(scope)) return
      toast.success('Step updated — SIPOC fields still incomplete')
    } catch (error) {
      // No toast here: `updateStep` and `reorderSteps` each report their own
      // failure before rethrowing, and a range rejection already named the
      // range. Adding one more would stack two toasts on one failure.
      if (!isProjectScopeCurrent(scope)) return
      console.error('Failed to persist step on validation-modal dismiss:', error)
    }
  }

  // New-row state mutations (parent owns steps[]; child invokes these by intent)
  const handleUpdateNewRowLocally = (stepId: string, updates: Partial<Step>) => {
    setSteps(prev => prev.map(s => (s.id === stepId ? { ...s, ...updates } : s)))
  }

  const handleRemoveNewRow = (stepId: string) => {
    setSteps(prev => prev.filter(s => s.id !== stepId))
  }

  const gapDeletionShiftCount = gapToDelete
    ? getStepsToShiftAfterGapDeletion(steps, gapToDelete).length +
      getProcessGapsToShiftAfterGapDeletion(gaps, gapToDelete).length
    : 0

  return (
    <div className="space-y-4">
      <MilestoneManager
        projectId={projectId}
        milestones={milestones}
        activeMilestoneId={activeMilestoneId}
        onSelectMilestone={setActiveMilestoneId}
        onMilestoneCreated={reloadMilestones}
      />

      {/* Team/System Filter */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filter by Team/System
          </label>
          <div className="flex items-center gap-2 flex-1">
            <select
              value={filterEntity || ''}
              onChange={(e) => setFilterEntity(e.target.value || null)}
              className="input-field flex-1"
              style={{ maxWidth: '300px' }}
            >
              <option value="">All Steps</option>
              {teams.length > 0 && (
                <optgroup label="Teams">
                  {teams.map(team => (
                    <option key={team.id} value={team.name}>
                      {team.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {systems.length > 0 && (
                <optgroup label="Systems">
                  {systems.map(system => (
                    <option key={system.id} value={system.name}>
                      {system.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {filterEntity && (
              <>
                <button
                  onClick={() => setFilterEntity(null)}
                  className="btn-secondary flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear
                </button>
                <span className="text-sm text-gray-600 whitespace-nowrap">
                  Showing {filteredSteps.length} of {steps.length} steps
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--color-deep-navy)' }}>
            Discovery Grid
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {filteredSteps.length} step{filteredSteps.length !== 1 ? 's' : ''}
            {activeMilestoneId && ` in ${milestones.find(m => m.id === activeMilestoneId)?.name || 'milestone'}`}
            {' • '}Click any cell to edit
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <button
              className="btn-danger"
              onClick={handleDeleteClick}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {steps.length === 0 && (
        <EmptyState
          title="No steps yet"
          message="A step is one unit of work with its own suppliers, inputs, outputs and customers. Add one here, or run the SIPOC Wizard to draft several at once."
          action={
            <button
              className="btn-primary inline-flex items-center gap-gs-2"
              onClick={handleAddRow}
            >
              <Plus size={16} strokeWidth={2} />
              Add First Step
            </button>
          }
        />
      )}

      {/* Table */}
      {steps.length > 0 && (
        <EditableRowTable
          projectId={projectId}
          steps={steps}
          filteredSteps={filteredSteps}
          mergedItems={mergedItems}
          displayNumbers={displayNumbers}
          milestones={milestones}
          teams={teams}
          systems={systems}
          gaps={gaps}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onUpdateNewRowLocally={handleUpdateNewRowLocally}
          onRemoveNewRow={handleRemoveNewRow}
          draggedStepId={draggedStepId}
          dragOverIndex={dragOverIndex}
          hoveredInsertIndex={hoveredInsertIndex}
          setHoveredInsertIndex={setHoveredInsertIndex}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          onCreateProcessGap={handleCreateProcessGap}
          onCloseProcessGap={handleCloseProcessGap}
          onEditProcessGap={handleEditProcessGap}
          onRequestDeleteGap={handleRequestDeleteGap}
          onInsertRow={handleInsertRow}
          onRequestCancelNewRow={handleCancelNewRow}
          onRequestCancelWithConfirm={handleRequestCancelWithConfirm}
          onShowValidationWarning={handleShowValidationWarning}
        />
      )}

      {/* Add Step Button */}
      {steps.length > 0 && (
        <div className="flex justify-center mt-4">
          <button
            className="btn-primary"
            onClick={handleAddRow}
          >
            <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Step
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title={`Delete ${selectedIds.size} Step${selectedIds.size !== 1 ? 's' : ''}?`}
        description="This action cannot be undone. The selected steps will be permanently deleted."
        confirmAction={{ label: 'Delete', onClick: confirmDelete, style: 'danger' }}
      />

      <ConfirmModal
        isOpen={showDeleteGapConfirm && !!gapToDelete}
        onClose={() => {
          setShowDeleteGapConfirm(false)
          setGapToDelete(null)
        }}
        title="Delete Process Gap?"
        description={
          gapToDelete && (
            <>
              <p className="mb-2">
                This will permanently delete the gap at position{' '}
                <strong>{displayNumbers?.get(gapToDelete.id) ?? gapToDelete.order}</strong>
                {gapDeletionShiftCount > 0
                  ? ' and shift later rows down by 1.'
                  : '.'}
              </p>
              <div className="bg-gray-50 rounded p-2 text-xs text-gray-700">
                <strong>Gap:</strong> {gapToDelete.observed || 'Unknown process step'}
              </div>
            </>
          )
        }
        confirmAction={{ label: 'Delete Gap', onClick: handleDeleteGap, style: 'danger' }}
      />

      <ConfirmModal
        isOpen={showDeleteOptionsModal && !!deletionContext}
        onClose={() => {
          setShowDeleteOptionsModal(false)
          setDeletionContext(null)
        }}
        icon="warning"
        title={
          deletionContext
            ? `Step${deletionContext.steps.length > 1 ? 's' : ''} with Open Gaps`
            : ''
        }
        description={
          deletionContext && (
            <>
              <p className="mb-3">
                {deletionContext.steps.length} step
                {deletionContext.steps.length > 1 ? 's' : ''}{' '}
                {deletionContext.steps.length > 1 ? 'have' : 'has'} {deletionContext.gapCount} open
                gap{deletionContext.gapCount > 1 ? 's' : ''}. How should we handle deletion?
              </p>
              <div className="bg-gray-50 rounded p-3 max-h-32 overflow-y-auto">
                <p className="text-xs font-medium text-gray-700 mb-1">Affected steps:</p>
                {deletionContext.steps.map((step) => (
                  <div key={step.id} className="text-xs text-gray-600">
                    • Order {displayNumbers?.get(step.id) ?? step.order}: {step.label}
                  </div>
                ))}
              </div>
            </>
          )
        }
        options={
          deletionContext
            ? [
                {
                  label: 'Shift Orders & Validate',
                  description:
                    'Delete steps, shift subsequent order numbers up, and run chain validation',
                  onClick: () => executeStepDeletion(deletionContext.steps, 'shift'),
                  style: 'primary',
                },
                {
                  label: 'Create Ghost Gap',
                  description:
                    'Replace step with process gap placeholder (preserves order numbers)',
                  onClick: () => executeStepDeletion(deletionContext.steps, 'ghost'),
                  style: 'secondary',
                },
              ]
            : undefined
        }
      />

      {/* Validation Warning Modal */}
      <ValidationWarningModal
        isOpen={showValidationWarning}
        onClose={() => void dismissValidationModal()}
        missingFields={validationContext?.missingFields || []}
        stepLabel={validationContext?.step.label || ''}
        onGoBack={() => void dismissValidationModal()}
        onCreateGap={async () => {
          if (!validationContext || validationInFlightRef.current !== null) return
          const scope = captureProjectScope(projectId)
          if (!scope) return
          const attempt = ++validationAttemptRef.current
          validationInFlightRef.current = attempt
          const isCurrentAttempt = () =>
            validationInFlightRef.current === attempt && isProjectScopeCurrent(scope)

          try {
            const context = validationContext
            let persistedStepId = context.step.id
            // Gaps `persistPendingUpdates` has already corrected from post-write
            // state; the existing-gap branch below must not undo them.
            let resyncedGapIds: ReadonlySet<string> = new Set<string>()
            if (!isCurrentAttempt()) return

            if (!context.stepPersisted) {
              if (context.step._isNew) {
                const pendingStep = { ...context.step, ...context.pendingUpdates }
                // Same raw INSERT the grid's Save button makes, and the same
                // hazard: the row carries a user-typed `order` that nothing has
                // range- or collision-checked, so writing it verbatim can land
                // the step on an occupied position and declare parallel work.
                // Idempotent when the insert tray already opened the slot.
                //
                // A row replacing a process gap in place keeps the gap's
                // position and skips the slot — but only when it really is the
                // same position: `handleCloseProcessGap` falls back to
                // `milestones[0]` for a gap carrying no milestone of its own,
                // and that row is an ordinary insert into a sequence the gap
                // was never part of.
                const closingGap = pendingStep._closingGapId
                  ? gaps.find(g => g.id === pendingStep._closingGapId)
                  : undefined
                const replacesGapInPlace =
                  !!closingGap &&
                  closingGap.milestoneId === pendingStep.milestoneId &&
                  closingGap.order === pendingStep.order
                if (replacesGapInPlace) {
                  persistedStepId = await createStep(pendingStep)
                } else {
                  // Opened and filled as one operation. The gap between the two
                  // is what a concurrent reseal or a second insert corrupts.
                  await openSlotForInsert({
                    projectId,
                    milestoneId: pendingStep.milestoneId,
                    at: pendingStep.order,
                    scope,
                    write: async () => {
                      persistedStepId = await createStep(pendingStep)
                    },
                  })
                }
                if (!isCurrentAttempt()) return
                setSteps(prev => prev.filter(s => s.id !== context.step.id))
                setValidationContext(prev => prev ? {
                  ...prev,
                  step: {
                    ...prev.step,
                    ...prev.pendingUpdates,
                    id: persistedStepId,
                    _isNew: false,
                  },
                  stepPersisted: true,
                } : prev)

                // Open, write, THEN reseal — the module's contract, and the
                // half this path was missing. `pendingStep.order` is
                // user-typed and bounded only by `>= 1`, so an order past the
                // end of the milestone makes `openSlot` a no-op and
                // `createStep` writes it verbatim: a hole nothing else closes.
                // The sibling in `EditableRowTable`'s Save tray reseals for the
                // same reason.
                //
                // This also reloads both stores, so the `loadStepsInStore` the
                // create used to need is folded into it.
                await resealAfterMutation({
                  projectId,
                  milestoneIds: [pendingStep.milestoneId],
                  scope,
                })
                if (!isCurrentAttempt()) return
              } else {
                try {
                  resyncedGapIds = await persistPendingUpdates(context.step, context.pendingUpdates)
                } catch (error) {
                  console.error('Failed to persist validation step:', error)
                  return
                }
                if (!isCurrentAttempt()) return
                setValidationContext(prev => prev ? { ...prev, stepPersisted: true } : prev)
              }
            }

            if (!isCurrentAttempt()) return
            // From the store, not the render-time `gaps` prop: this handler has
            // already created or updated the step and re-synced its gaps, and a
            // closure captured at render sees none of it (#336, #261's class).
            const existingGap = useGapsStore
              .getState()
              .gaps.find(g => g.stepId === persistedStepId && g.status === 'Open')
            if (existingGap) {
              // `context.missingFields` was computed before the write, against a
              // list that carries the edited row's new order but not the shifted
              // neighbours. Where the re-sync has already rewritten this gap it
              // did so from the post-write store, so writing again would spend a
              // round-trip to replace the better answer with the worse one.
              if (resyncedGapIds.has(existingGap.id)) {
                toast.success('Existing gap updated with current missing fields')
              } else {
                try {
                  await updateGapInStore(existingGap.id, {
                    missingField: context.missingFields[0] as MissingFieldType,
                    observed: `Missing ${context.missingFields.join(', ')}`,
                    expected: 'All SIPOC fields should be complete',
                  }, projectId)
                } catch (error) {
                  console.error('Failed to update validation gap:', error)
                  return
                }
                if (!isCurrentAttempt()) return
                toast.success('Existing gap updated with current missing fields')
              }
            } else {
              const createdGap = await createGapInStore({
                projectId,
                stepId: persistedStepId,
                missingField: context.missingFields[0] as MissingFieldType,
                observed: `Missing ${context.missingFields.join(', ')}`,
                expected: 'All SIPOC fields should be complete',
                severity: 'M',
                priority: 2,
                status: 'Open',
                links: [],
              })
              if (!isCurrentAttempt() || !createdGap) return
              toast.success('Gap created for incomplete step')
            }
            if (!isCurrentAttempt()) return
            setShowValidationWarning(false)
            setValidationContext(null)
          } catch (error) {
            if (!isCurrentAttempt()) return
            console.error('Failed to create/update gap:', error)
            toast.error('Failed to create/update gap')
          } finally {
            if (validationInFlightRef.current === attempt) {
              validationInFlightRef.current = null
            }
          }
        }}
      />

      <ConfirmModal
        isOpen={cancelConfirmation.show && !!cancelConfirmation.stepId}
        onClose={() => setCancelConfirmation({ show: false, stepId: null })}
        title="Delete this row?"
        description="All entered data will be lost. This action cannot be undone."
        cancelLabel="Keep Editing"
        icon={null}
        confirmAction={{
          label: 'Delete Row',
          style: 'danger',
          onClick: () => {
            if (cancelConfirmation.stepId) {
              handleCancelNewRow(cancelConfirmation.stepId)
            }
          },
        }}
      />

      <ProcessGapManager
        projectId={projectId}
        formState={showProcessGapForm ? processGapData : null}
        editingGap={editingGap}
        onClose={async () => {
          setShowProcessGapForm(false)
          setProcessGapData(null)
          setEditingGap(null)
          await useGapsStore.getState().loadGaps(projectId)
          await loadStepsInStore(projectId)
        }}
        displayNumbers={displayNumbers}
      />
    </div>
  )
}
