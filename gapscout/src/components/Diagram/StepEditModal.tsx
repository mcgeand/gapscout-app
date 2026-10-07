/**
 * StepEditModal - the step editor the diagram opens.
 *
 * Same fields as before (#218 changed the grammar, not the data): label, owner
 * team, milestone, the four SIPOC lists, systems, trigger, result, KPI, notes,
 * and the decision branches.
 *
 * The structure is GapForm's (design 7b, which says "the same field grammar as
 * 7a"): a `<form>` of `<section>`s under `form-section-head` rules, controls on
 * `input-field` / `select-field` / `textarea-field`, closed sets as chips, the
 * branches as the Jira-links repeater, and the footer's submit reaching the
 * form through `form={FORM_ID}` because the footer sits outside it.
 *
 * The owner team is the step's swimlane in the diagram. It is required:
 * steps.team_id is NOT NULL, so the select never offers a blank option once the
 * id resolves.
 *
 * Reference: PRD Section 4.6 - Bidirectional Editing
 * Ticket: ZIP-93
 */

import { useEffect, useId, useState, type FormEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { ConfirmModal } from '../shared/ConfirmModal'
import type { Step, StepBranch } from '../../data/types'
import { compareSteps, milestonesById } from '../../lib/stepSequence'
import { useStepsStore } from '../../state/stepsStore'
import { useProcessPositions } from '../../state/useProcessPositions'
import { resyncGapsAfterStepWrite, snapshotOpenGapIds } from '../../state/gapResync'
import { useSystemsStore } from '../../state/systemsStore'
import { useTeamsStore } from '../../state/teamsStore'
import toast from 'react-hot-toast'
import { captureProjectScope, isProjectScopeCurrent } from '../../state/workspaceScope'
import { openSlotForInsert, resealAfterMutation } from '../../state/sequenceOps'

/** Ties the footer's submit button to the form inside the shell's body. */
const FORM_ID = 'step-edit-form'

interface StepEditModalProps {
  projectId: string
  step: Step | null
  isOpen: boolean
  onClose: () => void
  /**
   * Deletes the step being edited. The modal confirms first, so the handler is
   * the deletion itself and must not confirm again — the canvas passes the same
   * routine its context-menu delete runs.
   *
   * Resolves whether the delete happened. The editor closes only on `true`; on
   * `false` it stays open with the user's edits, and the handler's own toast is
   * the error surface.
   *
   * Optional: without it the footer draws no delete action, which is what the
   * tests that render the editor on its own get.
   */
  onDelete?: () => Promise<boolean>
}

/**
 * Step Edit Modal Component
 */
export default function StepEditModal({ projectId, step, isOpen, onClose, onDelete }: StepEditModalProps) {
  const { updateStep, milestones, steps } = useStepsStore()
  const { systems } = useSystemsStore()
  const { teams } = useTeamsStore()

  const uid = useId()
  const id = (name: string) => `${uid}-${name}`

  /**
   * Every step number this editor prints. The diagram is never scoped to one
   * milestone, so the stored per-milestone `order` names nothing the reader can
   * find here (#345) — the running process position does.
   */
  const displayNumbers = useProcessPositions()
  const positionOf = (row: Step) => displayNumbers.get(row.id) ?? row.order

  // Form state
  const [label, setLabel] = useState('')
  const [teamId, setTeamId] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [inputs, setInputs] = useState<string[]>([])
  const [outputs, setOutputs] = useState<string[]>([])
  const [customers, setCustomers] = useState<string[]>([])
  const [selectedSystems, setSelectedSystems] = useState<string[]>([])
  const [trigger, setTrigger] = useState('')
  const [result, setResult] = useState('')
  const [kpi, setKpi] = useState('')
  const [notes, setNotes] = useState('')
  const [isDecision, setIsDecision] = useState(false)
  const [branches, setBranches] = useState<StepBranch[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Temp inputs for multi-value fields
  const [supplierInput, setSupplierInput] = useState('')
  const [inputInput, setInputInput] = useState('')
  const [outputInput, setOutputInput] = useState('')
  const [customerInput, setCustomerInput] = useState('')

  /**
   * Whether the step's team id still resolves to a live team.
   *
   * Both the placeholder option and the save guard read this, and they have to
   * agree: a dangling team_id (#104) renders as an unselected required field,
   * so a guard that only checked for an empty string would let Save through.
   */
  const teamIsResolved = teams.some(t => t.id === teamId)

  // Auto Fill state
  const [showAutofillConfirm, setShowAutofillConfirm] = useState(false)
  const [autofillField, setAutofillField] = useState<'suppliers' | 'inputs' | null>(null)

  /**
   * Load step data when modal opens.
   *
   * TODO(audit): replace this prop-syncing effect with `<StepEditModal key={step.id} />`
   * from the parent so each step opens a fresh modal instance instead of hydrating
   * 14 fields via setState. See React docs:
   * https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (step && isOpen) {
      setLabel(step.label)
      setTeamId(step.teamId)
      setMilestoneId(step.milestoneId)
      setSuppliers(step.suppliers || [])
      setInputs(step.inputs || [])
      setOutputs(step.outputs || [])
      setCustomers(step.customers || [])
      setSelectedSystems(step.systems || [])
      setTrigger(step.trigger || '')
      setResult(step.result || '')
      setKpi(step.kpi || '')
      setNotes(step.notes || '')
      setIsDecision(step.decision || false)
      setBranches(step.branches || [])
    }
  }, [step, isOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Handle save - update step in store
   */
  const handleSave = async () => {
    if (!step) return

    // Validation
    if (!label.trim()) {
      toast.error('Step label is required')
      return
    }

    if (!teamIsResolved) {
      toast.error('Owner team is required')
      return
    }

    const scope = captureProjectScope(projectId)
    if (!scope) return

    // Before the write, for the same reason the grid snapshots: this modal
    // sends every SIPOC field at once, so a gap whose own missing field is
    // among them is promoted to Review by `updateStep` (#88) and would then be
    // skipped by the re-sync that is supposed to correct its wording (#279).
    const wasOpen = snapshotOpenGapIds(step.id)

    // Captured before the write: afterwards the step only knows where it landed
    // (#335). The modal can move a step between milestones, and `order` is
    // scoped to its milestone (#299), so the number that travelled with it
    // belongs to a sequence it has left — it lands on whatever row already holds
    // that position in the destination, which is read as a parallel branch.
    const originMilestoneId = step.milestoneId
    const movedMilestone = originMilestoneId !== milestoneId

    // A row with no condition or no target is a repeater row the user opened
    // and left empty; persisting it would draw an unlabelled edge to nowhere.
    // A branch onto this step, or onto one that has since been deleted, is an
    // edge the diagram cannot draw either — `branchTargets` offers neither, so
    // both only ever arrive from what was stored. `label` rides along untouched.
    const savedBranches = branches
      .map(branch => ({ ...branch, when: branch.when.trim() }))
      .filter(
        branch =>
          branch.when &&
          branch.toStepId &&
          branch.toStepId !== step.id &&
          steps.some(s => s.id === branch.toStepId)
      )

    setIsSubmitting(true)
    try {
      const patch = {
        label: label.trim(),
        teamId,
        milestoneId,
        suppliers,
        inputs,
        outputs,
        customers,
        systems: selectedSystems,
        trigger: trigger.trim() || undefined,
        result: result.trim() || undefined,
        kpi: kpi.trim() || undefined,
        notes: notes.trim() || undefined,
        decision: isDecision,
        branches: isDecision ? savedBranches : [],
      }

      // Room in the destination first, so the step is not written onto an
      // occupied position — and opened and filled as one operation, because the
      // window between them is what a concurrent reseal closes. Both milestones
      // are locked: the write empties a position in the origin too.
      if (movedMilestone) {
        await openSlotForInsert({
          projectId,
          milestoneId,
          at: step.order,
          scope,
          alsoLock: originMilestoneId,
          write: async () => {
            await updateStep(step.id, patch, projectId)
          },
        })
      } else {
        await updateStep(step.id, patch, projectId)
      }
      if (!isProjectScopeCurrent(scope)) return

      // Both milestones: the origin has the hole the step left, and the
      // destination has whatever the open slot did not get filled exactly. A
      // same-milestone save passes the same id twice, which is de-duplicated,
      // and the reseal then writes nothing because the sequence never changed.
      //
      // The milestone-wide re-sync is gated on the move. Crossing a boundary
      // re-decides "first", "last" and every chain check for both milestones
      // (#291, #344); a plain field edit changes none of that for anyone but
      // the step itself, and the narrower re-sync below already covers it.
      const { syncedCount: resealSyncedCount } = await resealAfterMutation({
        projectId,
        milestoneIds: [originMilestoneId, milestoneId],
        scope,
        resync: movedMilestone,
      })
      if (!isProjectScopeCurrent(scope)) return

      // Narrower than the pass above, and it carries `wasOpen`, so it reaches a
      // gap this very save promoted to Review — which the wholesale pass
      // deliberately skips.
      //
      // The grid rewrites the gaps a save has made stale; this path did not, so
      // the same step saved here kept gaps naming fields it already had (#279).
      // Never throws, so a failed gap write cannot reach the catch below and
      // report a step save that worked as a failure.
      const { syncedCount: stepSyncedCount } = await resyncGapsAfterStepWrite({
        stepId: step.id,
        projectId,
        wasOpen,
      })
      if (!isProjectScopeCurrent(scope)) return

      // Both passes, so the number the user reads is the number of gaps the
      // save actually rewrote. They cannot double-count: `planGapResync` plans
      // nothing where the wording would not change, so a gap the wholesale pass
      // has already corrected is skipped by the narrower one.
      const syncedCount = resealSyncedCount + stepSyncedCount

      toast.success(
        syncedCount > 0
          ? `Step updated • ${syncedCount} gap${syncedCount > 1 ? 's' : ''} auto-synced`
          : 'Step updated!'
      )
      onClose()
    } catch (error) {
      if (isProjectScopeCurrent(scope)) {
        console.error('Failed to update step:', error)
        toast.error('Failed to update step')
      }
    } finally {
      // In a `finally` because the handler returns early on three stale-scope
      // checks; without it a scope change would leave the button reading
      // "Saving..." for good.
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleSave()
  }

  /**
   * Multi-value field helpers
   */
  const addSupplier = () => {
    if (supplierInput.trim()) {
      setSuppliers([...suppliers, supplierInput.trim()])
      setSupplierInput('')
    }
  }

  const removeSupplier = (index: number) => {
    setSuppliers(suppliers.filter((_, i) => i !== index))
  }

  const addInput = () => {
    if (inputInput.trim()) {
      setInputs([...inputs, inputInput.trim()])
      setInputInput('')
    }
  }

  const removeInput = (index: number) => {
    setInputs(inputs.filter((_, i) => i !== index))
  }

  const addOutput = () => {
    if (outputInput.trim()) {
      setOutputs([...outputs, outputInput.trim()])
      setOutputInput('')
    }
  }

  const removeOutput = (index: number) => {
    setOutputs(outputs.filter((_, i) => i !== index))
  }

  const addCustomer = () => {
    if (customerInput.trim()) {
      setCustomers([...customers, customerInput.trim()])
      setCustomerInput('')
    }
  }

  const removeCustomer = (index: number) => {
    setCustomers(customers.filter((_, i) => i !== index))
  }

  /**
   * Auto Fill Functions - Pull data from previous step
   */
  const getPreviousStep = (): Step | null => {
    if (!step) return null
    
    // Rank by process position, not by `order` alone: `order` is scoped to its
    // milestone (#299), so a flat sort put a later milestone's step ahead of an
    // earlier one and offered a previous step from the wrong milestone (#301).
    const milestoneById = milestonesById(milestones)
    const sortedSteps = [...steps].sort((a, b) => compareSteps(a, b, milestoneById))
    const currentIndex = sortedSteps.findIndex(s => s.id === step.id)
    
    if (currentIndex <= 0) return null // No previous step
    return sortedSteps[currentIndex - 1]
  }

  const handleAutofillRequest = (field: 'suppliers' | 'inputs') => {
    const previousStep = getPreviousStep()
    if (!previousStep) return

    // Check if current field has data
    const hasData = field === 'suppliers' ? suppliers.length > 0 : inputs.length > 0

    if (hasData) {
      // Show confirmation
      setAutofillField(field)
      setShowAutofillConfirm(true)
    } else {
      // No data, autofill directly
      performAutofill(field)
    }
  }

  const performAutofill = (field: 'suppliers' | 'inputs') => {
    const previousStep = getPreviousStep()
    if (!previousStep) return

    if (field === 'suppliers') {
      // Suppliers ← Previous step's Customers
      setSuppliers(previousStep.customers || [])
      toast.success(`Auto-filled ${previousStep.customers?.length || 0} supplier(s) from previous step`)
    } else if (field === 'inputs') {
      // Inputs ← Previous step's Outputs
      setInputs(previousStep.outputs || [])
      toast.success(`Auto-filled ${previousStep.outputs?.length || 0} input(s) from previous step`)
    }

    setShowAutofillConfirm(false)
    setAutofillField(null)
  }

  const toggleSystem = (systemId: string) => {
    setSelectedSystems(prev =>
      prev.includes(systemId)
        ? prev.filter(id => id !== systemId)
        : [...prev, systemId]
    )
  }

  /** Branch repeater helpers. A branch has no id, so the index is the handle. */
  const addBranch = () => setBranches([...branches, { when: '', toStepId: '' }])

  const updateBranch = (index: number, patch: Partial<StepBranch>) =>
    setBranches(branches.map((branch, i) => (i === index ? { ...branch, ...patch } : branch)))

  const removeBranch = (index: number) =>
    setBranches(branches.filter((_, i) => i !== index))

  // `isOpen` stays in the guard even though Modal checks it too: the autofill
  // confirmation is a sibling of the dialog, not a child, so without this a
  // closed editor could still leave that confirmation on screen.
  if (!isOpen || !step) return null

  const previousStep = getPreviousStep()
  const previousNumber = previousStep ? positionOf(previousStep) : null

  /**
   * The SIPOC block, as the four cells of design 7b's 2x2 grid rather than four
   * stacked rows. One descriptor each so the cells cannot drift apart: the same
   * chip list, the same add row, and — for the two fields a predecessor can
   * supply — the same fill action.
   */
  const sipocCells = [
    {
      key: 'suppliers' as const,
      heading: 'Supplier',
      values: suppliers,
      draft: supplierInput,
      setDraft: setSupplierInput,
      add: addSupplier,
      remove: removeSupplier,
      addLabel: 'Add supplier',
      /** Suppliers come from the previous step's Customers. */
      fillFrom: 'Customer',
    },
    {
      key: 'inputs' as const,
      heading: 'Inputs',
      values: inputs,
      draft: inputInput,
      setDraft: setInputInput,
      add: addInput,
      remove: removeInput,
      addLabel: 'Add input',
      /** Inputs come from the previous step's Outputs. */
      fillFrom: 'Output',
    },
    {
      key: 'outputs' as const,
      heading: 'Output',
      values: outputs,
      draft: outputInput,
      setDraft: setOutputInput,
      add: addOutput,
      remove: removeOutput,
      addLabel: 'Add output',
      fillFrom: null,
    },
    {
      key: 'customers' as const,
      heading: 'Customer',
      values: customers,
      draft: customerInput,
      setDraft: setCustomerInput,
      add: addCustomer,
      remove: removeCustomer,
      addLabel: 'Add customer',
      fillFrom: null,
    },
  ]

  /** Branch targets: every step but this one. */
  const branchTargets = [...steps]
    .filter(s => s.id !== step.id)
    .sort((a, b) => compareSteps(a, b, milestonesById(milestones)))

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Edit step ${positionOf(step)}`}
        description="Changes appear in the grid and the diagram at once"
        size="xl"
        footer={
          <div className="flex w-full items-center justify-between gap-gs-2">
            {onDelete ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isSubmitting}
                className="btn-danger inline-flex items-center gap-gs-2"
              >
                <Trash2 size={16} strokeWidth={2} />
                Delete step
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-gs-2">
              <button type="button" onClick={onClose} disabled={isSubmitting} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" form={FORM_ID} disabled={isSubmitting} className="btn-primary">
                {isSubmitting ? 'Saving...' : 'Save step'}
              </button>
            </div>
          </div>
        }
      >
        <form id={FORM_ID} className="flex flex-col gap-gs-6" onSubmit={handleSubmit}>
          {/* ---------------------------------------------------------------
              The step — what a save refuses to go without, plus the SIPOC the
              grid shows in the same row. Same split as GapForm's "the gap".
              --------------------------------------------------------------- */}
          <section>
            <div className="form-section-head">
              <h3 className="form-section-title">The step</h3>
              <span className="form-section-note">Required to save</span>
            </div>

            <div className="flex flex-col gap-gs-4">
              <div>
                <label className="label-field" htmlFor={id('label')}>
                  Step label
                </label>
                <input
                  id={id('label')}
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="input-field w-full"
                  placeholder="e.g., Review purchase request"
                />
              </div>

              <div className="grid grid-cols-2 gap-gs-4">
                {/* The owner team is the step's swimlane in the diagram. */}
                <div>
                  <label className="label-field" htmlFor={id('team')}>
                    Owner team
                  </label>
                  <select
                    id={id('team')}
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="select-field w-full"
                  >
                    {!teamIsResolved && <option value="">Select team...</option>}
                    {teams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label-field" htmlFor={id('milestone')}>
                    Milestone
                  </label>
                  <select
                    id={id('milestone')}
                    value={milestoneId}
                    onChange={(e) => setMilestoneId(e.target.value)}
                    className="select-field w-full"
                  >
                    <option value="">Select milestone...</option>
                    {milestones.map(milestone => (
                      <option key={milestone.id} value={milestone.id}>
                        {milestone.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-gs-4">
                {sipocCells.map(cell => (
                  <div key={cell.key} className="flex flex-col gap-gs-2">
                    <label className="label-field" htmlFor={id(cell.key)}>
                      {cell.heading}
                    </label>

                    {cell.values.length > 0 ? (
                      <div className="chips">
                        {cell.values.map((value, i) => (
                          // `.chip-face` defaults to the muted, unselected
                          // option colour; a stored value is data, so the
                          // utility puts it back in ink.
                          <span key={`${value}-${i}`} className="chip-face text-gs-ink">
                            {value}
                            <button
                              type="button"
                              onClick={() => cell.remove(i)}
                              aria-label={`Remove ${value}`}
                              className="inline-flex items-center"
                            >
                              <X size={16} strokeWidth={2} />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gs-ink-muted">— none yet</p>
                    )}

                    <div className="flex gap-gs-2">
                      <input
                        id={id(cell.key)}
                        type="text"
                        value={cell.draft}
                        onChange={(e) => cell.setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter adds a value rather than submitting the form,
                          // which is what a bare Enter in a form control does.
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            cell.add()
                          }
                        }}
                        className="input-field flex-1"
                        placeholder={cell.addLabel}
                      />
                      <button
                        type="button"
                        onClick={cell.add}
                        aria-label={cell.addLabel}
                        className="btn-ghost inline-flex items-center gap-gs-2"
                      >
                        <Plus size={16} strokeWidth={2} />
                        Add
                      </button>
                    </div>

                    {/* Words, not an arrow glyph: the old button said the
                        direction and not the source. The number is the
                        predecessor's process position, which is the number the
                        reader can find on any surface. */}
                    {cell.fillFrom && previousStep && (
                      <button
                        type="button"
                        onClick={() => handleAutofillRequest(cell.key === 'suppliers' ? 'suppliers' : 'inputs')}
                        aria-label={`Fill from step ${previousNumber} — the previous step's ${cell.fillFrom}`}
                        className="btn-ghost self-start"
                      >
                        Fill from step {previousNumber}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---------------------------------------------------------------
              Details — Result and KPI are the only fields the Discovery grid
              has no column for; trigger, systems and notes sit with them
              because they are read together (design 7b).
              --------------------------------------------------------------- */}
          <section>
            <div className="form-section-head">
              <h3 className="form-section-title">Details</h3>
              <span className="form-section-note">The fields the grid doesn&apos;t show</span>
            </div>

            <div className="grid grid-cols-2 gap-gs-4">
              <div>
                <label className="label-field" htmlFor={id('trigger')}>
                  Trigger
                </label>
                <input
                  id={id('trigger')}
                  type="text"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  className="input-field w-full"
                />
                <p className="mt-gs-1 text-xs text-gs-ink-muted">What starts this step?</p>
              </div>

              <div>
                <span className="label-field" id={id('systems-label')}>
                  Systems
                </span>
                {systems.length > 0 ? (
                  <div className="chips" role="group" aria-labelledby={id('systems-label')}>
                    {systems.map(system => (
                      <label key={system.id} className="chip">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selectedSystems.includes(system.id)}
                          onChange={() => toggleSystem(system.id)}
                        />
                        <span className="chip-face">{system.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gs-ink-muted">
                    No systems in the registry yet.
                  </p>
                )}
              </div>

              <div>
                <label className="label-field" htmlFor={id('result')}>
                  Result
                </label>
                <input
                  id={id('result')}
                  type="text"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  className="input-field w-full"
                />
                <p className="mt-gs-1 text-xs text-gs-ink-muted">What happens after?</p>
              </div>

              <div>
                <label className="label-field" htmlFor={id('kpi')}>
                  KPI
                </label>
                <input
                  id={id('kpi')}
                  type="text"
                  value={kpi}
                  onChange={(e) => setKpi(e.target.value)}
                  className="input-field w-full"
                  placeholder="Success metric"
                />
              </div>
            </div>

            <div className="mt-gs-4">
              <label className="label-field" htmlFor={id('notes')}>
                Notes
              </label>
              <textarea
                id={id('notes')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="textarea-field w-full"
                placeholder="Additional notes..."
              />
            </div>
          </section>

          {/* ---------------------------------------------------------------
              Decision — a shape in the diagram and a fork in the flow, and the
              branches only exist while the box is ticked. Unticking it saves an
              empty list rather than nothing: the diagram draws `step.branches`
              without asking whether the step is still a decision, and
              `updateStep` skips the column on `undefined`.
              --------------------------------------------------------------- */}
          <section>
            <div className="form-section-head">
              <h3 className="form-section-title">Decision</h3>
            </div>

            <label className="flex items-center gap-gs-2">
              <input
                type="checkbox"
                checked={isDecision}
                onChange={(e) => setIsDecision(e.target.checked)}
              />
              <span className="text-sm font-medium text-gs-ink">This step is a decision</span>
            </label>
            <p className="mt-gs-1 text-xs text-gs-ink-muted">
              Draws as a diamond and splits the flow into branches
            </p>

            {isDecision && (
              <div className="mt-gs-4">
                <div className="flex items-center justify-between">
                  <span className="label-field" id={id('branches-label')}>
                    Branches
                  </span>
                  <button
                    type="button"
                    onClick={addBranch}
                    className="btn-ghost inline-flex items-center gap-gs-2"
                  >
                    <Plus size={16} strokeWidth={2} />
                    Add branch
                  </button>
                </div>

                {branches.length > 0 ? (
                  <ul className="flex flex-col gap-gs-2" aria-labelledby={id('branches-label')}>
                    {branches.map((branch, index) => (
                      <li key={index} className="flex gap-gs-2">
                        <input
                          type="text"
                          value={branch.when}
                          onChange={(e) => updateBranch(index, { when: e.target.value })}
                          placeholder="When…"
                          aria-label="Branch condition"
                          className="input-field flex-1"
                        />
                        <select
                          value={branch.toStepId}
                          onChange={(e) => updateBranch(index, { toStepId: e.target.value })}
                          aria-label="Branch target step"
                          className="select-field flex-1"
                        >
                          <option value="">Go to…</option>
                          {branchTargets.map(target => (
                            <option key={target.id} value={target.id}>
                              Step {positionOf(target)} · {target.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeBranch(index)}
                          aria-label="Remove branch"
                          className="btn-ghost self-start"
                        >
                          <Trash2 size={16} strokeWidth={2} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gs-ink-muted">
                    No branches yet — add one to split the flow.
                  </p>
                )}
              </div>
            )}
          </section>
        </form>
      </Modal>

      {/* Delete confirmation. The canvas runs the deletion itself — it owns the
          reseal that closes the hole the step leaves — so this dialog is the
          only confirmation on the path. */}
      {showDeleteConfirm && onDelete && (
        <ConfirmModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          above
          title="Delete this step?"
          description={
            <>
              This permanently deletes <strong>{step.label}</strong>, and the steps after it
              renumber. It cannot be undone.
            </>
          }
          confirmAction={{
            label: 'Delete step',
            style: 'danger',
            onClick: async () => {
              setShowDeleteConfirm(false)
              // Only on success: a failed delete leaves the editor open with the
              // user's edits, and the handler has already raised the toast.
              if (await onDelete?.()) onClose()
            },
          }}
        />
      )}

      {/* Auto Fill Confirmation Modal */}
      {showAutofillConfirm && autofillField && (
        <ConfirmModal
          isOpen={showAutofillConfirm}
          onClose={() => setShowAutofillConfirm(false)}
          above
          icon="warning"
          title="Overwrite Existing Data?"
          description={
            <>
              <p>
                This will replace your current {autofillField} with data from the previous step.
              </p>
              <p className="mt-gs-3 border border-gs-rule p-gs-3 text-gs-ink">
                <span className="font-semibold">Auto Fill Preview:</span>
                <br />
                {autofillField === 'suppliers' && previousStep && (
                  <>
                    Pulling {previousStep.customers?.length || 0} customer(s) from previous
                    step
                  </>
                )}
                {autofillField === 'inputs' && previousStep && (
                  <>Pulling {previousStep.outputs?.length || 0} output(s) from previous step</>
                )}
              </p>
            </>
          }
          confirmAction={{
            label: 'Replace & Auto Fill',
            style: 'primary',
            onClick: () => performAutofill(autofillField),
          }}
        />
      )}
    </>
  )
}
