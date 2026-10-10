/**
 * GapForm - Create and edit gaps
 * 
 * Form for creating/editing gaps with full SIPOC validation.
 * Auto-detects missing SIPOC fields and allows manual override.
 * 
 * Reference: PRD Section 4.7.1 - Gap Creation
 * Ticket: ZIP-97
 */

import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { ConfirmModal } from '../shared/ConfirmModal'

/** Ties the footer's submit button to the form inside the shell's body. */
const FORM_ID = 'gap-form'
import toast from 'react-hot-toast'
import type { Gap, Step, Link, SeverityLevel, RootCauseType, TimeToFix, MissingFieldType } from '../../data/types'
import { useStepsStore } from '../../state/stepsStore'
import { useTeamsStore } from '../../state/teamsStore'
import { useGapsStore } from '../../state/gapsStore'
import { validateStep, type ValidationResult } from '../../lib/sipocValidator'
import { coerceEmptyToUndefined } from '../../lib/formUtils'
import { extractJiraKey, withJiraLabel } from '../../lib/jiraKey'
import { compareSteps, isProcessGap, milestonesById } from '../../lib/stepSequence'
import { moveWithinMilestone, withMilestoneSequence } from '../../lib/sequence'
import { openSlotForInsert, resealAfterMutation } from '../../state/sequenceOps'
import {
  getProcessGapsToShiftAfterGapDeletion,
  getStepsToShiftAfterGapDeletion,
} from '../../lib/gapDeletion'
import { captureProjectScope, isProjectScopeCurrent } from '../../state/workspaceScope'

interface GapFormProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  mode: 'create' | 'edit'
  gap?: Gap | null
  prefilledStepId?: string | null
  prefilledOrder?: number
  /**
   * The number the Discovery grid is showing for the position this gap is going
   * into, when that differs from the stored per-milestone `order` — i.e. the
   * All Steps view, where the `#` column runs across milestones (#333).
   *
   * Only the position the reader sees goes on screen; `order` is still what
   * gets written. Callers with no grid behind them omit it and the form falls
   * back to `order`, which is what those contexts show.
   */
  prefilledDisplayOrder?: number
  prefilledMilestoneId?: string
  /**
   * Process position by row id, for every number this form puts on screen: the
   * step it names in its header and its dropdown, and the position of the gap
   * being edited. The form opens from the Discovery grid and from three
   * project-wide surfaces, so it cannot decide for itself which scale to show —
   * the caller passes the map it is already showing. Null, or an id the map
   * does not hold, falls back to the stored `order`, which is what a milestone
   * tab shows (#345).
   */
  displayNumbers?: Map<string, number> | null
}

/**
 * The closed option sets the form draws as chips and segmented strips (design
 * 7a). They are module-level so the render stays a map rather than five
 * hand-written blocks, and so the `null` member of each — the one that clears
 * the field — is written down once beside the values it clears. Each `hint` is
 * both the tooltip and the accessible name, and begins with the visible label,
 * so the two never disagree (WCAG 2.5.3).
 */
const MISSING_FIELDS: MissingFieldType[] = ['supplier', 'input', 'output', 'customer']

const SEVERITIES: Array<{ value: SeverityLevel; label: string; hint: string }> = [
  { value: 'H', label: 'High', hint: 'High — critical issue' },
  { value: 'M', label: 'Med', hint: 'Med — notable impact' },
  { value: 'L', label: 'Low', hint: 'Low — minor inconvenience' },
]

const PRIORITIES: Array<{ value: number | null; label: string; hint: string }> = [
  { value: null, label: 'None', hint: 'None — no priority set' },
  { value: 1, label: '1', hint: '1 — critical' },
  { value: 2, label: '2', hint: '2 — high' },
  { value: 3, label: '3', hint: '3 — medium' },
  { value: 4, label: '4', hint: '4 — low' },
  { value: 5, label: '5', hint: '5 — nice to have' },
]

const ROOT_CAUSES: Array<{ value: RootCauseType | null; label: string; hint: string }> = [
  { value: null, label: 'Unknown', hint: 'Unknown — to be determined' },
  { value: 'Config', label: 'Config', hint: 'Config — configuration issue' },
  { value: 'Policy', label: 'Policy', hint: 'Policy — policy or compliance' },
  { value: 'Behavior', label: 'Behavior', hint: 'Behavior — human behavior' },
  { value: 'Data', label: 'Data', hint: 'Data — data quality' },
]

interface JiraLinkInput {
  id: string
  url: string
  ticketNumber: string
  error?: string
}

/**
 * Auto-detect missing SIPOC fields from a step
 */
function detectMissingSIPOCFields(step: Step | null): MissingFieldType[] {
  if (!step) return []
  
  const missing: MissingFieldType[] = []
  
  if (!step.suppliers || step.suppliers.length === 0 || step.suppliers.every(s => !s.trim())) {
    missing.push('supplier')
  }
  if (!step.inputs || step.inputs.length === 0 || step.inputs.every(i => !i.trim())) {
    missing.push('input')
  }
  if (!step.outputs || step.outputs.length === 0 || step.outputs.every(o => !o.trim())) {
    missing.push('output')
  }
  if (!step.customers || step.customers.length === 0 || step.customers.every(c => !c.trim())) {
    missing.push('customer')
  }
  
  return missing
}

/**
 * Validate Jira URL format
 */
function validateJiraUrl(url: string): boolean {
  if (!url.trim()) return false
  
  // Must contain a valid Jira ticket number
  const ticketNumber = extractJiraKey(url)
  if (!ticketNumber) return false
  
  // Must be a valid URL
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

type GapFormInnerProps = Omit<GapFormProps, 'isOpen'> & {
  /**
   * Asks the wrapper to remount this form in edit mode on an existing gap.
   * Only the gap-vs-gap order conflict uses it (#229).
   */
  onEditExisting?: (gap: Gap) => void
}

function GapFormInner({ onClose, onEditExisting, projectId, mode, gap, prefilledStepId, prefilledOrder, prefilledDisplayOrder, prefilledMilestoneId, displayNumbers }: GapFormInnerProps) {
  const { steps, milestones } = useStepsStore()
  const { teams } = useTeamsStore()
  const { addGap, updateGap, closeGap } = useGapsStore()

  // Every control in this form is labelled, so the tests can address one by its
  // label rather than by its index among the comboboxes — which is what they
  // did before, and what made a field reorder silently rewrite the wrong value.
  const uid = useId()
  const id = (name: string) => `${uid}-${name}`

  // SIPOC validation state
  const [sipocValidationResult, setSipocValidationResult] = useState<ValidationResult | null>(null)
  const [showValidationSection, setShowValidationSection] = useState(false)

  // Form state — initialized once at mount from props.
  // The outer GapForm keys this component by gap?.id, so reopening with a different
  // gap (or switching create↔edit) remounts and re-initializes — no init effect needed.
  const isEditWithGap = mode === 'edit' && gap !== null && gap !== undefined

  const [stepId, setStepId] = useState<string>(() =>
    isEditWithGap ? (gap.stepId || '') : (prefilledStepId || '')
  )
  const [order, setOrder] = useState<number | undefined>(() =>
    isEditWithGap ? gap.order : prefilledOrder
  )
  // milestoneId is fixed for the lifetime of this form instance (no in-form editor for it).
  const milestoneId = isEditWithGap ? (gap.milestoneId || '') : (prefilledMilestoneId || '')

  // The position to *name* on screen, as against `order`, the position to write.
  // In the grid's All Steps view the `#` column runs across milestones, so the
  // stored per-milestone `order` is a number that appears nowhere on screen
  // (#333). "Place After" moves `order` by one, so the shown number tracks the
  // same offset rather than going stale. With no display position supplied —
  // the grid's single-milestone view, where the stored order already is the
  // position — this is `order`, which is exactly what that context shows.
  //
  // In edit mode the gap already exists, so its position comes from the caller's
  // map rather than a prefill (#345); in create mode it does not exist yet and
  // `prefilledDisplayOrder` is the only place the number can come from.
  const storedBaseline = isEditWithGap ? gap.order : prefilledOrder
  const displayBaseline = isEditWithGap
    ? (gap.order !== undefined ? displayNumbers?.get(gap.id) : undefined)
    : prefilledDisplayOrder
  const shownOrder =
    displayBaseline !== undefined && storedBaseline !== undefined && order !== undefined
      ? displayBaseline + (order - storedBaseline)
      : order
  // One field per gap: `gaps.missing_field` is single-valued and PRD §4.7 specifies a
  // single Missing Field. When several are detected, the first in SIPOC order is the
  // proposal — the same one the auto-gap paths pick — and the user can change it.
  const [missingField, setMissingField] = useState<MissingFieldType | null>(() => {
    if (isEditWithGap) return gap.missingField ?? null
    if (prefilledStepId) {
      return detectMissingSIPOCFields(steps.find(s => s.id === prefilledStepId) || null)[0] ?? null
    }
    return null
  })
  const [autoDetectedFields, setAutoDetectedFields] = useState<MissingFieldType[]>(() => {
    if (isEditWithGap) return []
    if (prefilledStepId) {
      return detectMissingSIPOCFields(steps.find(s => s.id === prefilledStepId) || null)
    }
    return []
  })
  const [observed, setObserved] = useState<string>(() =>
    isEditWithGap ? gap.observed : ''
  )
  const [expected, setExpected] = useState<string>(() =>
    isEditWithGap ? gap.expected : ''
  )
  const [severity, setSeverity] = useState<SeverityLevel>(() =>
    isEditWithGap ? gap.severity : 'M'
  )
  const [priority, setPriority] = useState<number | null>(() =>
    isEditWithGap ? (gap.priority || null) : null
  )
  const [rootCause, setRootCause] = useState<RootCauseType | null>(() =>
    isEditWithGap ? (gap.rootCause || null) : null
  )
  const [ownerTeamId, setOwnerTeamId] = useState<string>(() =>
    isEditWithGap ? (gap.ownerTeamId || '') : ''
  )
  const [fixIdea, setFixIdea] = useState<string>(() =>
    isEditWithGap ? (gap.fixIdea || '') : ''
  )
  const [timeToFix, setTimeToFix] = useState<TimeToFix | null>(() =>
    isEditWithGap ? (gap.timeToFix || null) : null
  )
  const [jiraLinks, setJiraLinks] = useState<JiraLinkInput[]>(() => {
    if (isEditWithGap) {
      return gap.links
        .filter(link => link.type === 'jira')
        .map(link => ({ id: link.id, url: link.url, ticketNumber: withJiraLabel(link).label }))
    }
    return []
  })

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [orderConflict, setOrderConflict] = useState<{
    show: boolean
    conflictType: 'step' | 'gap'
    conflictItem: Step | Gap
  } | null>(null)

  // Auto-detect missing fields when step changes
  const handleStepChange = (newStepId: string) => {
    setStepId(newStepId)

    if (newStepId) {
      const selectedStep = steps.find(s => s.id === newStepId)
      const detected = detectMissingSIPOCFields(selectedStep || null)
      setAutoDetectedFields(detected)

      // Keep the current pick when the new step is also missing that field, so
      // switching steps does not discard a deliberate choice. Otherwise propose the
      // first field the new step actually lacks — carrying the old pick over would
      // leave the form offering a field the step already has.
      setMissingField(current =>
        current && detected.includes(current) ? current : detected[0] ?? null
      )
    } else {
      setAutoDetectedFields([])
      setMissingField(null)
    }
  }

  // Jira link handlers
  const addJiraLink = () => {
    setJiraLinks([...jiraLinks, { id: crypto.randomUUID(), url: '', ticketNumber: '' }])
  }

  const removeJiraLink = (id: string) => {
    setJiraLinks(jiraLinks.filter(link => link.id !== id))
  }

  const updateJiraLink = (id: string, url: string) => {
    const ticketNumber = extractJiraKey(url) || ''
    const isValid = url.trim() === '' || validateJiraUrl(url)
    
    setJiraLinks(jiraLinks.map(link => 
      link.id === id 
        ? { 
            ...link, 
            url, 
            ticketNumber,
            error: url.trim() && !isValid ? 'Invalid Jira URL or ticket format (e.g., PROJ-123)' : undefined
          }
        : link
    ))
  }

  // Form validation
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}
    
    // For process gaps (order provided), stepId is optional
    // For SIPOC gaps, stepId is required
    if (!stepId && order === undefined) {
      newErrors.stepId = 'Step or Order is required'
    }
    
    if (missingField === null) {
      newErrors.missingField = 'Select the missing SIPOC field'
    }
    
    if (!observed.trim()) {
      newErrors.observed = 'Observed state is required'
    }
    
    if (!expected.trim()) {
      newErrors.expected = 'Expected state is required'
    }
    
    // Validate Jira links
    const invalidJiraLinks = jiraLinks.filter(link => link.url.trim() && !validateJiraUrl(link.url))
    if (invalidJiraLinks.length > 0) {
      newErrors.jiraLinks = 'Please fix invalid Jira URLs'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Form validity derived from current inputs (computed each render).
  const isFormValid =
    (stepId !== '' || order !== undefined) && // Either step OR order required
    missingField !== null &&
    observed.trim() !== '' &&
    expected.trim() !== '' &&
    jiraLinks.every(link => !link.url.trim() || validateJiraUrl(link.url))

  const gapLinks = (): Link[] =>
    jiraLinks
      .filter(jl => jl.url.trim() && jl.ticketNumber)
      .map(jl => ({
        id: jl.id,
        url: jl.url,
        label: jl.ticketNumber,
        type: 'jira' as const,
        createdAt: Date.now(),
      }))

  /**
   * Persist a new gap row only — no sequence work.
   *
   * `openSlotForInsert` already holds the milestone chain while it runs its
   * `write`. Passing `createGapDirectly` there used to nest
   * `resealAfterMutation` → `withMilestoneSequence` on the same key, which
   * waits forever for its own outer lock and wedges every later edit (#484).
   *
   * `silent` suppresses the store's "Gap created" toast when the caller folds
   * the create into its own message (Place before).
   */
  const writeNewGap = async (options?: { silent?: boolean }): Promise<void> => {
    // Store owns the success toast (#282) unless the caller asked for silent.
    await addGap(
      {
        projectId,
        observed: observed.trim(),
        expected: expected.trim(),
        severity,
        links: gapLinks(),
        stepId: coerceEmptyToUndefined(stepId),
        priority: priority ?? undefined,
        rootCause: rootCause ?? undefined,
        ownerTeamId: coerceEmptyToUndefined(ownerTeamId),
        fixIdea: coerceEmptyToUndefined(fixIdea.trim()),
        timeToFix: timeToFix ?? undefined,
        status: 'Open',
        missingField: missingField ?? undefined,
        order: order ?? undefined,
        milestoneId: coerceEmptyToUndefined(milestoneId),
        closedAt: undefined,
      },
      { silent: options?.silent }
    )
  }

  // Helper: create or edit without the order-conflict prompt. Sequence work
  // stays outside any `openSlotForInsert` write callback — see `writeNewGap`.
  const createGapDirectly = async () => {
    const scope = captureProjectScope(projectId)
    if (!scope) return

    if (mode === 'create') {
      await writeNewGap()
      if (!isProjectScopeCurrent(scope)) return

      // A created process gap takes a position, so it is an opener like any
      // other — but not one that shifts rows. The conflict check above refuses
      // an occupied order and offers "Place Before", which is where the slot
      // gets opened; prompting is the deliberate behaviour here and an
      // `openSlot` would silently move work the user did not ask to move.
      //
      // What was missing is the other half: an order PAST the end passes the
      // conflict check unopposed, and the gap lands there leaving a hole. The
      // reseal closes it, and is a no-op on every ordinary create.
      const createdMilestoneId = coerceEmptyToUndefined(milestoneId)
      if (order !== undefined && createdMilestoneId && !coerceEmptyToUndefined(stepId)) {
        await resealAfterMutation({ projectId, milestoneIds: [createdMilestoneId], scope })
        if (!isProjectScopeCurrent(scope)) return
      }
    } else if (mode === 'edit' && gap) {
      // Editing a gap can move it inside its milestone or into another one, and
      // both are sequence events the form used to make silently: the conflict
      // check at the bottom of `handleSubmit` is gated on `mode === 'create'`,
      // and nothing shifted anything on either side. The gap twin of #335.
      //
      // The origin is read before the write, because afterwards the row only
      // knows where it landed. A same-milestone move is `moveWithinMilestone`
      // rather than open-a-slot-then-reseal: the row's own old position is
      // inside the milestone being ranked, so opening a slot there and then
      // closing the hole it left would land it one short of the number typed.
      const originMilestoneId = gap.milestoneId
      const targetMilestoneId = coerceEmptyToUndefined(milestoneId)
      const targetOrder = order ?? null
      const staysInSequence = targetOrder !== null && !!targetMilestoneId && !coerceEmptyToUndefined(stepId)

      const sharedGapData = {
        observed: observed.trim(),
        expected: expected.trim(),
        severity,
        links: gapLinks(),
      }

      const writeGapEdit = () =>
        updateGap(gap.id, {
          ...sharedGapData,
          stepId: coerceEmptyToUndefined(stepId) ?? null,
          priority,
          rootCause,
          ownerTeamId: coerceEmptyToUndefined(ownerTeamId) ?? null,
          fixIdea: fixIdea.trim() || null,
          timeToFix,
          status: gap.status,
          missingField: missingField,
          order: order ?? null,
          milestoneId: coerceEmptyToUndefined(milestoneId) ?? null,
          closedAt: gap.closedAt,
        }, projectId)

      if (staysInSequence && originMilestoneId === targetMilestoneId && isProcessGap(gap)) {
        // Move and write as one operation, for the same reason an open and its
        // fill are: the write re-asserts the order the move just chose, so a
        // concurrent reseal landing between them would be overwritten by a
        // number that is already stale.
        await withMilestoneSequence(projectId, [targetMilestoneId], async () => {
          await moveWithinMilestone(projectId, targetMilestoneId, gap.id, targetOrder)
          await writeGapEdit()
        })
      } else if (staysInSequence) {
        // The slot and the write that fills it, as one operation across both
        // milestones — the origin loses a position too, and the window between
        // opening and filling is what a concurrent reseal closes.
        await openSlotForInsert({
          projectId,
          milestoneId: targetMilestoneId,
          at: targetOrder,
          alsoLock: originMilestoneId,
          write: writeGapEdit,
        })
      } else {
        await writeGapEdit()
      }
      if (!isProjectScopeCurrent(scope)) return

      // Both sides. The origin has a hole wherever the gap left it, and the
      // destination has one wherever the open slot did not get filled exactly —
      // and a gap that has just been attached to a step or closed has left the
      // sequence entirely, which is clause 9 of #353 at this site.
      await resealAfterMutation({
        projectId,
        milestoneIds: [originMilestoneId, targetMilestoneId],
        scope,
      })
      if (!isProjectScopeCurrent(scope)) return
    }
  }

  // Form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      toast.error('Please fix validation errors')
      return
    }
    
    const scope = captureProjectScope(projectId)
    if (!scope) return
    setIsSubmitting(true)

    try {
      // Check for order conflicts (only for process gaps with order number)
      if (mode === 'create' && order !== undefined) {
        // `order` is scoped to its milestone and restarts at 1 in each (#299), so
        // every lookup here has to be scoped too — a project-wide match reports a
        // conflict against an unrelated milestone's step (#311). `steps.milestone_id`
        // is NOT NULL, so a strict compare is safe; `gaps.milestone_id` is nullable
        // and reaches us as `undefined`, which the form holds as ''.
        const conflictingStep = steps.find(
          s => s.milestoneId === milestoneId && s.order === order
        )
        if (conflictingStep) {
          setOrderConflict({
            show: true,
            conflictType: 'step',
            conflictItem: conflictingStep
          })
          setIsSubmitting(false)
          return
        }
        
        // Check if another gap exists at this order
        const { gaps } = useGapsStore.getState()
        const conflictingGap = gaps.find(g =>
          (g.milestoneId ?? '') === milestoneId &&
          g.order === order &&
          g.status !== 'Closed' &&
          (!gap || g.id !== gap.id) // Exclude current gap in edit mode
        )
        if (conflictingGap) {
          setOrderConflict({
            show: true,
            conflictType: 'gap',
            conflictItem: conflictingGap
          })
          setIsSubmitting(false)
          return
        }
      }
      
      // No conflicts, create gap
      await createGapDirectly()
      if (!isProjectScopeCurrent(scope)) return
      onClose()
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to save gap:', error)
        toast.error('Failed to save gap')
      }
    } finally {
      if (isProjectScopeCurrent(scope)) setIsSubmitting(false)
    }
  }

  // Validate SIPOC and attempt to close gap
  const handleValidateAndClose = async () => {
    if (!stepId || !gap) {
      toast.error('No step selected')
      return
    }

    // Get the current step
    const currentStep = steps.find(s => s.id === stepId)
    if (!currentStep) {
      toast.error('Step not found')
      return
    }

    // Validate SIPOC
    // Ranks on (milestone.order, step.order), so the first/last exemption fires
    // once for the process rather than once per milestone (#344).
    const validation = validateStep(currentStep, steps, milestonesById(milestones))
    setSipocValidationResult(validation)
    setShowValidationSection(true)

    if (validation.isValid) {
      // SIPOC is complete, close the gap
      const scope = captureProjectScope(projectId)
      if (!scope) return
      try {
        await closeGap(gap.id, projectId)
        if (!isProjectScopeCurrent(scope)) return

        // Closing a process gap takes it out of the sequence without touching
        // its `order_num`, so the position it held becomes a hole that the
        // threshold shifts could never see — they skip Closed rows by
        // predicate. Clause 9 of #353: a close is a closer.
        await resealAfterMutation({ projectId, milestoneIds: [gap.milestoneId], scope })
        if (!isProjectScopeCurrent(scope)) return

        // Add note to step documenting gap closure (ZIP-148 Phase 1B)
        const { updateStep: updateStepInStore } = useStepsStore.getState()
        
        // Create detailed note showing what was fixed
        const gapDate = new Date(gap.createdAt).toLocaleDateString()
        const missingFieldsText = gap.missingField 
          ? `Missing: ${gap.missingField}` 
          : 'SIPOC validation issues'
        const gapNote = `[${gapDate}] SIPOC updated from gap analysis - ${missingFieldsText} resolved. [View Gap: gap://${gap.id}]`
        
        const currentNotes = currentStep.notes || ''
        const updatedNotes = currentNotes 
          ? `${currentNotes}\n\n${gapNote}`
          : gapNote
        
        await updateStepInStore(currentStep.id, {
          notes: updatedNotes,
          updatedAt: Date.now()
        }, projectId)
        if (!isProjectScopeCurrent(scope)) return

        toast.success(`Gap closed! SIPOC validated • Note added to step`)
        onClose()
      } catch (error) {
        if (isProjectScopeCurrent(scope)) {
          // `closeGap` and `updateStep` both report their own failure, and this
          // block is only reachable through one of them — so the toast lives
          // there and not here, or a failed close says the same sentence twice.
          console.error('Failed to close gap:', error)
        }
      }
    } else {
      // Show validation errors
      toast.error('Cannot close gap - SIPOC validation failed')
    }
  }

  // Delete gap handler
  const handleDeleteGap = async () => {
    if (!gap) return
    const scope = captureProjectScope(projectId)
    if (!scope) return

    try {
      const { deleteGap: deleteGapFromStore } = useGapsStore.getState()

      // For process gaps with order numbers, close the position they leave
      if (gap.order !== undefined) {
        const { steps: allSteps } = useStepsStore.getState()
        const { gaps: allGaps } = useGapsStore.getState()
        // Counted before the delete, and only to word the toast: what actually
        // moves is decided by the reseal, measured against the live sequence.
        const stepsToShift = getStepsToShiftAfterGapDeletion(allSteps, gap)
        const gapsToShift = getProcessGapsToShiftAfterGapDeletion(allGaps, gap)

        // The delete throws on failure now, so this `await` is what stops the
        // reseal running after a delete that did not happen — which used to pull
        // the steps above the gap down onto the order it was still holding
        // (#349), the same tie the reseal exists to prevent.
        await deleteGapFromStore(gap.id, projectId)
        if (!isProjectScopeCurrent(scope)) return

        // One call, no arithmetic. The reseal ranks steps and process gaps
        // together (#312, #341), reloads both stores and re-syncs the
        // milestone's gap wording. A gap with no milestone was in no sequence,
        // so there is nothing to reseal.
        await resealAfterMutation({ projectId, milestoneIds: [gap.milestoneId], scope })
        if (!isProjectScopeCurrent(scope)) return

        toast.success(
          stepsToShift.length + gapsToShift.length > 0
            ? 'Gap deleted • Order numbers adjusted'
            : 'Gap deleted'
        )
      } else {
        // Regular SIPOC gap, just delete
        await deleteGapFromStore(gap.id, projectId)
        if (!isProjectScopeCurrent(scope)) return
        toast.success('Gap deleted')
      }
      
      setShowDeleteConfirm(false)
      onClose()
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to delete gap:', error)
        toast.error('Failed to delete gap')
      }
    }
  }

  // Get selected step for context
  const selectedStep = steps.find(s => s.id === stepId)

  // Every step number this form prints. Falls back to the stored `order` when
  // the caller supplied no map, which is the milestone-tab case where the two
  // are the same number (#345).
  const stepNumberOf = (step: Step) => displayNumbers?.get(step.id) ?? step.order
  const milestoneById = milestonesById(milestones)
  const deleteShiftCount =
    gap && gap.order !== undefined
      ? getStepsToShiftAfterGapDeletion(steps, gap).length +
        getProcessGapsToShiftAfterGapDeletion(useGapsStore.getState().gaps, gap).length
      : 0

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={mode === 'create' ? 'New gap' : 'Edit gap'}
        description={
          selectedStep ? (
            <>
              Step {stepNumberOf(selectedStep)}: {selectedStep.label}
            </>
          ) : order !== undefined ? (
            <>Process gap at position {shownOrder}</>
          ) : undefined
        }
        size="xl"
        footer={
          <div
            className={`flex w-full items-center gap-gs-2 ${
              mode === 'edit' ? 'justify-between' : 'justify-end'
            }`}
          >
            {mode === 'edit' && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isSubmitting}
                className="btn-danger inline-flex items-center gap-gs-2"
              >
                <Trash2 size={16} strokeWidth={2} />
                Delete Gap
              </button>
            )}
            <div className="flex items-center gap-gs-2">
              <button type="button" onClick={onClose} disabled={isSubmitting} className="btn-secondary">
                Cancel
              </button>
              <button
                type="submit"
                form={FORM_ID}
                disabled={isSubmitting || !isFormValid}
                className="btn-primary"
              >
                {isSubmitting ? 'Saving...' : 'Save gap'}
              </button>
            </div>
          </div>
        }
      >
        <form id={FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-gs-6">
          {/* ---------------------------------------------------------------
              The gap — everything `validateForm` refuses to save without.
              The split is a 2px rule rather than the "Additional Details
              (Optional)" disclosure it replaces: what belongs together here is
              a property of the field, not something the reader should have to
              open a block to discover (#217, design 7a).
              --------------------------------------------------------------- */}
          <section>
            <div className="form-section-head">
              <h3 className="form-section-title">The gap</h3>
              <span className="form-section-note">Required to save</span>
            </div>

            {order !== undefined ? (
              // Process gap: the position is fixed by the caller, so there is
              // nothing to choose — the block explains what this row is.
              <div className="border-2 border-gs-rule p-gs-4">
                <h4 className="text-sm font-semibold text-gs-ink">
                  Process gap at position {shownOrder}
                </h4>
                <p className="mt-gs-1 text-xs text-gs-ink-muted">
                  This gap represents a <strong>missing step</strong> in your process flow.
                  Describe what&apos;s missing below, then close the gap to create the actual step.
                </p>
              </div>
            ) : (
              <div>
                <label className="label-field" htmlFor={id('step')}>
                  Process step *
                </label>
                <select
                  id={id('step')}
                  value={stepId}
                  onChange={(e) => handleStepChange(e.target.value)}
                  disabled={mode === 'edit' || !!prefilledStepId}
                  className={`select-field w-full ${errors.stepId ? 'border-gs-accent' : ''}`}
                >
                  <option value="">Select a step...</option>
                  {steps
                    .slice()
                    .sort((a, b) => compareSteps(a, b, milestoneById))
                    .map(step => (
                      <option key={step.id} value={step.id}>
                        Step {stepNumberOf(step)}: {step.label}
                      </option>
                    ))}
                </select>
                {errors.stepId && (
                  <p className="mt-gs-1 text-sm text-gs-accent-ink">{errors.stepId}</p>
                )}
                <p className="mt-gs-1 text-xs text-gs-ink-muted">
                  Select an existing step with incomplete SIPOC fields
                </p>
              </div>
            )}

            <div className="mt-gs-4 grid grid-cols-2 gap-gs-4">
              <div>
                <label className="label-field" htmlFor={id('observed')}>
                  Observed — what happens today *
                </label>
                <textarea
                  id={id('observed')}
                  value={observed}
                  onChange={(e) => setObserved(e.target.value)}
                  placeholder="What do we currently see? What is the problem?"
                  rows={3}
                  className={`textarea-field w-full ${errors.observed ? 'border-gs-accent' : ''}`}
                />
                {errors.observed && (
                  <p className="mt-gs-1 text-sm text-gs-accent-ink">{errors.observed}</p>
                )}
              </div>

              <div>
                <label className="label-field" htmlFor={id('expected')}>
                  Expected — what should happen *
                </label>
                <textarea
                  id={id('expected')}
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="What should we see? What is the ideal outcome?"
                  rows={3}
                  className={`textarea-field w-full ${errors.expected ? 'border-gs-accent' : ''}`}
                />
                {errors.expected && (
                  <p className="mt-gs-1 text-sm text-gs-accent-ink">{errors.expected}</p>
                )}
              </div>
            </div>

            {/* One field per gap: `gaps.missing_field` is single-valued and PRD
                §4.7 specifies a single Missing Field (#181). Native radios in a
                radiogroup, so arrow keys and the group name are the platform's
                job — see the `.chip` block in globals.css. */}
            <div className="mt-gs-4">
              <span className="label-field" id={id('missing-label')}>
                Which SIPOC field is missing? *
              </span>
              <div className="chips" role="radiogroup" aria-labelledby={id('missing-label')}>
                {MISSING_FIELDS.map(field => {
                  const isAutoDetected = autoDetectedFields.includes(field)
                  return (
                    <label key={field} className="chip">
                      <input
                        type="radio"
                        className="sr-only"
                        name={id('missingField')}
                        value={field}
                        checked={missingField === field}
                        onChange={() => setMissingField(field)}
                      />
                      <span className="chip-face">
                        <span className="capitalize">{field}</span>
                        {isAutoDetected && <span className="chip-mark">Auto-detected</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
              {errors.missingField && (
                <p className="mt-gs-1 text-sm text-gs-accent-ink">{errors.missingField}</p>
              )}
              {autoDetectedFields.length > 0 && (
                <p className="mt-gs-2 text-xs text-gs-ink-muted">
                  {autoDetectedFields.length > 1
                    ? `This step is missing ${autoDetectedFields.length} SIPOC fields. Pick the one this gap is about; raise a separate gap for the others.`
                    : 'Auto-detected from the step. Please verify and adjust as needed.'}
                </p>
              )}
            </div>
          </section>

          {/* ---------------------------------------------------------------
              Triage — everything you can decide later. Nothing here blocks a
              save, which is the whole point of the split.
              --------------------------------------------------------------- */}
          <section>
            <div className="form-section-head">
              <h3 className="form-section-title">Triage</h3>
              <span className="form-section-note">All optional — fill it in when you review</span>
            </div>

            <div className="grid grid-cols-3 gap-gs-4">
              <div>
                <span className="label-field" id={id('severity-label')}>
                  Severity
                </span>
                <div
                  className="seg seg-sev"
                  role="radiogroup"
                  aria-labelledby={id('severity-label')}
                >
                  {SEVERITIES.map(option => (
                    <label key={option.value} className="seg-option" title={option.hint}>
                      <input
                        type="radio"
                        className="sr-only"
                        name={id('severity')}
                        value={option.value}
                        checked={severity === option.value}
                        onChange={() => setSeverity(option.value)}
                        aria-label={option.hint}
                      />
                      <span className="seg-face" data-sev={option.value}>
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Quiet, not the accent: a priority number is neither a primary
                  action nor a severity, and rule 3 has no fourth job to give. */}
              <div>
                <span className="label-field" id={id('priority-label')}>
                  Priority
                </span>
                <div
                  className="seg seg-quiet"
                  role="radiogroup"
                  aria-labelledby={id('priority-label')}
                >
                  {PRIORITIES.map(option => (
                    <label key={option.label} className="seg-option" title={option.hint}>
                      <input
                        type="radio"
                        className="sr-only"
                        name={id('priority')}
                        value={option.value ?? ''}
                        checked={priority === option.value}
                        onChange={() => setPriority(option.value)}
                        aria-label={option.hint}
                      />
                      <span className="seg-face">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="label-field" htmlFor={id('timeToFix')}>
                  Time to fix
                </label>
                <select
                  id={id('timeToFix')}
                  value={timeToFix || ''}
                  onChange={(e) => setTimeToFix(e.target.value ? e.target.value as TimeToFix : null)}
                  className="select-field w-full"
                >
                  <option value="">Not Estimated</option>
                  <option value="qwin">Quick Win (&lt; 1 week)</option>
                  <option value="near">Near-term (1-4 weeks)</option>
                  <option value="mid">Mid-term (1-3 months)</option>
                  <option value="long">Long-term (&gt; 3 months)</option>
                </select>
              </div>

              <div className="col-span-2">
                <span className="label-field" id={id('rootCause-label')}>
                  Root cause
                </span>
                <div className="chips" role="radiogroup" aria-labelledby={id('rootCause-label')}>
                  {ROOT_CAUSES.map(option => (
                    <label key={option.label} className="chip">
                      <input
                        type="radio"
                        className="sr-only"
                        name={id('rootCause')}
                        value={option.value ?? ''}
                        checked={rootCause === option.value}
                        onChange={() => setRootCause(option.value)}
                        aria-label={option.hint}
                      />
                      <span className="chip-face">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="label-field" htmlFor={id('ownerTeam')}>
                  Owner team
                </label>
                <select
                  id={id('ownerTeam')}
                  value={ownerTeamId}
                  onChange={(e) => setOwnerTeamId(e.target.value)}
                  className="select-field w-full"
                >
                  <option value="">Unassigned</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-gs-4">
              <label className="label-field" htmlFor={id('fixIdea')}>
                Fix idea
              </label>
              <textarea
                id={id('fixIdea')}
                value={fixIdea}
                onChange={(e) => setFixIdea(e.target.value)}
                placeholder="Proposed solution or next steps..."
                rows={3}
                className="textarea-field w-full"
              />
            </div>

            {/* Still a repeater rather than the mock's single cell: a gap can
                already hold several links, and 8d replaces Jira-specific
                handling with a configured tracker list anyway (#187). */}
            <div className="mt-gs-4">
              <div className="flex items-center justify-between">
                <span className="label-field" id={id('jira-label')}>
                  Jira links
                </span>
                <button
                  type="button"
                  onClick={addJiraLink}
                  className="btn-ghost inline-flex items-center gap-gs-2"
                >
                  <Plus size={16} strokeWidth={2} />
                  Add Jira Link
                </button>
              </div>

              {jiraLinks.length > 0 ? (
                <ul className="flex flex-col gap-gs-2" aria-labelledby={id('jira-label')}>
                  {jiraLinks.map((link) => (
                    <li key={link.id} className="flex gap-gs-2">
                      <div className="flex-1">
                        <input
                          type="url"
                          value={link.url}
                          onChange={(e) => updateJiraLink(link.id, e.target.value)}
                          placeholder="https://your-jira.atlassian.net/browse/PROJ-123"
                          aria-label="Jira link URL"
                          className={`input-field w-full font-mono ${
                            link.error ? 'border-gs-accent' : ''
                          }`}
                        />
                        {link.error && (
                          <p className="mt-gs-1 text-xs text-gs-accent-ink">{link.error}</p>
                        )}
                        {link.ticketNumber && !link.error && (
                          <p className="mt-gs-1 text-xs text-gs-ink-muted">
                            Ticket: {link.ticketNumber}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeJiraLink(link.id)}
                        aria-label={`Remove Jira link ${link.ticketNumber || link.url || 'row'}`}
                        className="btn-ghost self-start"
                      >
                        <Trash2 size={16} strokeWidth={2} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gs-ink-muted">
                  No Jira links yet. Add one to connect this gap to a ticket.
                </p>
              )}
              {errors.jiraLinks && (
                <p className="mt-gs-2 text-sm text-gs-accent-ink">{errors.jiraLinks}</p>
              )}
            </div>
          </section>

          {/* ---------------------------------------------------------------
              Edit mode adds one block. It is an action, not a field, so it sits
              below triage under its own rule rather than inside either grid.
              --------------------------------------------------------------- */}
          {mode === 'edit' && gap && gap.status !== 'Closed' && (
            <section>
              <div className="form-section-head">
                <h3 className="form-section-title">Close this gap</h3>
                <span className="form-section-note">SIPOC must be complete first</span>
              </div>

              {showValidationSection && sipocValidationResult && (
                <div
                  className={`mb-gs-4 p-gs-4 ${
                    sipocValidationResult.isValid
                      ? 'border-2 border-gs-rule'
                      : 'border-2 border-gs-accent bg-gs-accent-tint'
                  }`}
                >
                  {sipocValidationResult.isValid ? (
                    <p className="text-sm text-gs-ink">
                      <span className="sev sev-l">VALIDATED</span>{' '}
                      SIPOC is complete — this gap can be closed.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-gs-accent-ink">
                        <span className="sev sev-m">
                          {sipocValidationResult.missingFields.length} MISSING
                        </span>{' '}
                        <span className="capitalize">
                          {sipocValidationResult.missingFields.join(' · ')}
                        </span>
                      </p>
                      <p className="mt-gs-2 text-xs text-gs-ink-muted">
                        Complete these fields in the Discovery Grid before closing this gap.
                      </p>
                    </>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleValidateAndClose}
                className="btn-secondary w-full text-center"
              >
                Validate SIPOC &amp; Close Gap
              </button>
            </section>
          )}
        </form>
      </Modal>
      
      {/* Order Conflict Modal */}
      {orderConflict?.show && (
        <ConfirmModal
          isOpen={orderConflict.show}
          onClose={() => setOrderConflict(null)}
          above
          icon="warning"
          title="Order Conflict Detected"
          description={
            <>
              <p>
                {orderConflict.conflictType === 'step'
                  ? 'A step already exists at order '
                  : 'Another gap already exists at order '}
                <strong>{shownOrder}</strong>:
              </p>
              {/*
                The conflicting row was found at `order`, so it holds exactly the
                position this gap is going into and shows the same number the
                sentence above does. Naming it by its stored `order` cited a
                number the All Steps view never draws (#333).
              */}
              <p className="mt-gs-2 border border-gs-rule p-gs-3 text-gs-ink">
                {orderConflict.conflictType === 'step'
                  ? `Step ${shownOrder}: ${(orderConflict.conflictItem as Step).label}`
                  : `Gap ${shownOrder}: ${(orderConflict.conflictItem as Gap).observed}`}
              </p>
              <p className="mt-gs-3">
                {orderConflict.conflictType === 'gap'
                  ? 'Would you like to update the existing gap, or place this gap before or after it?'
                  : 'Would you like to place this gap before or after the existing step?'}
              </p>
            </>
          }
          options={[
            ...(orderConflict.conflictType === 'gap' && onEditExisting
              ? [
                  {
                    label: 'Update existing gap',
                    style: 'secondary' as const,
                    onClick: () => {
                      // Switch to edit mode on the gap already holding this order.
                      // The new-gap draft is discarded on purpose: Observed and
                      // Expected are NOT carried across, because the existing gap's
                      // text would otherwise be silently overwritten by (or merged
                      // with) what was typed for a different gap. The wrapper remounts
                      // the form keyed on the existing gap's id, pre-filled from it.
                      setOrderConflict(null)
                      onEditExisting(orderConflict.conflictItem as Gap)
                    },
                  },
                ]
              : []),
            {
              label: `Place before (position ${shownOrder})`,
              onClick: async () => {
                // Shift all subsequent steps, then create the gap.
                const scope = captureProjectScope(projectId)
                if (!scope) return
                setOrderConflict(null)
                setIsSubmitting(true)

                // Counted only to word the toast. `openSlotForInsert` moves
                // steps and process gaps together (#311, #307); counting only
                // steps under-reports and said "1 steps".
                const { gaps: liveGaps } = useGapsStore.getState()
                const displaced =
                  steps.filter(
                    (s) => s.milestoneId === milestoneId && s.order >= order!
                  ).length +
                  liveGaps.filter(
                    (g) =>
                      isProcessGap(g) &&
                      g.milestoneId === milestoneId &&
                      (g.order ?? 0) >= order!
                  ).length
                const rowLabel = displaced === 1 ? 'row' : 'rows'

                // Once the slot write lands the gap exists. A later reseal
                // failure must still close the form — leaving it open lets a
                // second Save create a duplicate (#484 review).
                let gapWritten = false
                try {
                  // Opened and filled as one operation: a concurrent reseal
                  // landing between the two closes the slot the gap is about to
                  // take, and it lands on an occupied order instead.
                  //
                  // `writeNewGap` only — not `createGapDirectly`. The create
                  // helper reseals, and a reseal under this lock waits forever
                  // for the same milestone chain (#484).
                  await openSlotForInsert({
                    projectId,
                    milestoneId,
                    at: order!,
                    scope,
                    write: () => writeNewGap({ silent: true }),
                  })
                  // Stale scope: openSlotForInsert re-closed the slot and
                  // returned without calling `write`. Treat that as abandon —
                  // not success — or we toast/close for a gap that never landed.
                  if (!isProjectScopeCurrent(scope)) return
                  gapWritten = true
                  toast.success(
                    displaced > 0
                      ? `Gap created — shifted ${displaced} ${rowLabel}`
                      : 'Gap created'
                  )
                  // Closes any hole the open slot left if the gap did not land
                  // exactly on it; a no-op on the ordinary path.
                  await resealAfterMutation({
                    projectId,
                    milestoneIds: [milestoneId],
                    scope,
                  })
                  onClose()
                } catch (error) {
                  console.error('Failed to shift orders:', error)
                  if (gapWritten) {
                    toast.error('Gap created, but finishing the sequence failed')
                    onClose()
                  } else {
                    toast.error('Failed to shift orders')
                  }
                } finally {
                  setIsSubmitting(false)
                }
              },
            },
            {
              label: `Place after (position ${(shownOrder ?? 0) + 1})`,
              style: 'secondary' as const,
              onClick: () => {
                setOrder((order ?? 0) + 1)
                setOrderConflict(null)
                toast.success(`Gap moved to position ${(shownOrder ?? 0) + 1}`)
              },
            },
          ]}
        />
      )}

      {/* Delete Gap Confirmation Modal */}
      {showDeleteConfirm && gap && (
        <ConfirmModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          above
          title={`Delete ${gap.order !== undefined ? 'Process ' : ''}Gap?`}
          description={
            <>
              <p>
                {/* The branch stays on the stored `order` — order 0 is the slot
                    before the first step, and nothing after it shifts — while
                    the number on screen is the position the reader can see. */}
                {gap.order !== undefined
                  ? deleteShiftCount > 0
                    ? `This will permanently delete the gap at position ${shownOrder} and shift later rows down by 1.`
                    : `This will permanently delete the gap at position ${shownOrder}.`
                  : 'This gap will be permanently deleted.'}
              </p>
              <p className="mt-gs-2 border border-gs-rule p-gs-3 text-xs text-gs-ink">
                <strong>Observed:</strong> {gap.observed}
              </p>
            </>
          }
          confirmAction={{ label: 'Delete Gap', style: 'danger', onClick: handleDeleteGap }}
        />
      )}
    </>
  )
}

export default function GapForm(props: GapFormProps) {
  if (!props.isOpen) return null
  // A separate component so the create→edit switch below is session state: it
  // unmounts with the modal, and a reopen starts from the caller's props again.
  return <GapFormSession {...props} />
}

function GapFormSession(props: GapFormProps) {
  const inner: Omit<GapFormProps, 'isOpen'> = props
  // The gap-vs-gap order conflict can hand a create over to editing the gap that
  // already holds the position (#229). The modal stays open; only the inner form
  // remounts, so this lifts `mode`/`gap` out of the props for the session.
  const [switchedTo, setSwitchedTo] = useState<Gap | null>(null)
  const mode = switchedTo ? 'edit' : inner.mode
  const gap = switchedTo ?? inner.gap
  // Re-key by gap.id so reopening with a different gap (or switching create↔edit)
  // remounts the inner form with fresh state derived from props.
  return (
    <GapFormInner
      key={gap?.id ?? 'new'}
      {...inner}
      mode={mode}
      gap={gap}
      onEditExisting={mode === 'create' ? setSwitchedTo : undefined}
    />
  )
}
