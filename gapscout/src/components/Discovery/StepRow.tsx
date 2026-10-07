import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, TriangleAlert } from 'lucide-react'
import type { Step, Milestone, Team, System } from '../../data/types'
import type { EditableStep } from './types'
import { createDebouncedSave, type SaveStatus } from '../../lib/autosave'
import { validateStep } from '../../lib/sipocValidator'
import { validateStepChain } from '../../lib/sipocChainValidator'
import { milestonesById } from '../../lib/stepSequence'
import {
  parseStepFieldValue,
  stepFieldValuesEqual,
  type PendingStepEdit,
} from '../../lib/stepFieldValue'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import { ConfirmModal } from '../shared/ConfirmModal'
import { Empty } from '../shared/Empty'

/** Fields whose editor is MultiSelectDropdown rather than a text/number/select input. */
const DROPDOWN_FIELDS = ['suppliers', 'customers']

interface StepRowProps {
  step: EditableStep
  index: number
  /** Rows as displayed, in display order: drives neighbour lookups and auto-fill. */
  allSteps: EditableStep[]
  /**
   * Every step in the project, in process order. SIPOC rules read the next
   * step, so a filtered `allSteps` would let a hidden neighbour's supplier go
   * unseen and make both validation indicators depend on the active filter.
   */
  validationSteps: EditableStep[]
  /**
   * Process position to show in the `#` column instead of the stored `order`,
   * or null to show (and edit) `order` itself. Non-null only in the All Steps
   * view, where `order` restarts at 1 in every milestone (#299).
   */
  displayNumber: number | null
  /**
   * The number the row above is showing in its `#` column, or null when there is
   * no row above. The auto-fill buttons name the step they pull from, so they
   * have to cite the same number the reader can see; the stored `order` restarts
   * at 1 in every milestone and so names a row that is not there (#303).
   */
  previousDisplayNumber: number | null
  milestones: Milestone[]
  teams: Team[]
  systems: System[]
  isSelected: boolean
  onToggleSelect: () => void
  /**
   * Persist `updates`. `options.unattended` marks a write the row cannot be
   * asked about any more because it has already unmounted, so an owner that
   * would normally hold the write back behind a confirmation has to write it
   * instead — the deferral is what loses the edit (#257).
   */
  onUpdate: (updates: Partial<Step>, options?: { unattended?: boolean }) => Promise<void>
  /**
   * Reports the open cell editor's uncommitted value so an owner can save what
   * the user sees. Only wired for new rows: on macOS WKWebView (Tauri) clicking
   * a button does not move focus, so the editor's onBlur commit never fires and
   * "Save Step" would otherwise persist the last committed state.
   */
  onPendingEditChange?: (pending: PendingStepEdit | null) => void
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onDrop?: (e: React.DragEvent) => void
}

export function StepRow({
  step,
  index,
  allSteps,
  validationSteps,
  displayNumber,
  previousDisplayNumber,
  milestones,
  teams,
  systems,
  isSelected,
  onToggleSelect,
  onUpdate,
  onPendingEditChange,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: StepRowProps) {
  const [editingField, setEditingField] = useState<string | null>(
    step._isEditing ? 'label' : null
  )
  // Seeded from the label so an auto-opened editor reports the value it shows
  // rather than an empty pending edit.
  const [editValue, setEditValue] = useState(step._isEditing ? step.label : '')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const [showAutofillConfirm, setShowAutofillConfirm] = useState(false)
  const [autofillField, setAutofillField] = useState<'suppliers' | 'inputs' | null>(null)
  // True from the unmount cleanup onwards, so every write the debounce still
  // makes on this row's behalf is marked as one nobody can answer for (#257).
  const unattendedRef = useRef(false)

  // The seed save function is replaced by setSaveFunc below before any edit can
  // reach it, so it is the one that does not read `unattendedRef` — a ref read
  // during render is both a lint error and, here, always `false` anyway.
  const [debouncedSave] = useState(() =>
    createDebouncedSave(
      async (updates: Partial<Step>) => {
        await onUpdate(updates)
      },
      setSaveStatus,
      500
    )
  )

  useLayoutEffect(() => {
    debouncedSave.setSaveFunc(async (updates: Partial<Step>) => {
      await onUpdate(updates, { unattended: unattendedRef.current })
    })
  }, [debouncedSave, onUpdate])

  // Report the open text editor upward (new rows only). Suppliers/Customers are
  // excluded: MultiSelectDropdown owns its own draft and commits it on document
  // mousedown, which lands before the Save Step click. The reporter is held in a
  // ref so an inline parent callback does not re-run these effects every render.
  const pendingEditReporter = useRef(onPendingEditChange)
  useLayoutEffect(() => {
    pendingEditReporter.current = onPendingEditChange
  }, [onPendingEditChange])

  const openTextEditor =
    editingField !== null && !DROPDOWN_FIELDS.includes(editingField) ? editingField : null

  useEffect(() => {
    pendingEditReporter.current?.(
      openTextEditor ? { field: openTextEditor, value: editValue } : null
    )
  }, [openTextEditor, editValue])

  useEffect(() => () => pendingEditReporter.current?.(null), [])

  // The unmount cleanup below runs once with whatever it closed over, so the
  // editor it has to commit comes from a ref rather than from that closure.
  // `seed` is the value the editor opened with, and it — not the step — is what
  // the cleanup compares against: `handleStartEdit` seeds from a prop that can
  // already be stale, so an editor reopened inside the debounce window shows the
  // pre-edit value while the step moves on to the post-edit one. Compared
  // against the step, an editor nobody touched reads as a change and writes its
  // stale value back over the edit that just landed.
  const openEditorRef = useRef<(PendingStepEdit & { seed: string }) | null>(null)
  const isNewRowRef = useRef(step._isNew)
  useLayoutEffect(() => {
    isNewRowRef.current = step._isNew

    if (!openTextEditor) {
      openEditorRef.current = null
      return
    }

    // A different field means a different editor, and so a fresh seed. Tab
    // navigation swaps the field and its value in one batched render, which is
    // why this cannot rely on passing through a `null` in between.
    const open = openEditorRef.current
    openEditorRef.current = {
      field: openTextEditor,
      value: editValue,
      seed: open?.field === openTextEditor ? open.seed : editValue,
    }
  }, [openTextEditor, editValue, step._isNew])

  useEffect(() => {
    // StrictMode runs this cleanup once at mount and then mounts again, so the
    // flag has to be cleared on the way in or the row spends its life claiming
    // every write is unattended.
    unattendedRef.current = false

    return () => {
      unattendedRef.current = true

      // A cell editor left open when the row unmounts never got a blur, so
      // handleSaveEdit never ran and the typed value never reached the
      // debounce. Commit it here so the flush below has it (#256). New rows
      // are excluded — their editor is reported to the Save tray instead.
      const open = openEditorRef.current
      if (open && !isNewRowRef.current) {
        const parsed = parseStepFieldValue(open.field, open.value)
        const seed = parseStepFieldValue(open.field, open.seed)
        if (!parsed.ok) {
          toast.error(parsed.error)
        } else if (!seed.ok || !stepFieldValuesEqual(seed.value, parsed.value)) {
          void debouncedSave.save({ [open.field]: parsed.value })
        }
      }

      // An existing row unmounts with a committed edit still inside the
      // debounce window whenever the user switches milestone tabs right after
      // typing. Cancelling threw that edit away; flushing writes it (#190).
      debouncedSave.flush()
    }
  }, [debouncedSave])

  const handleStartEdit = (field: string, value: string | string[]) => {
    setEditingField(field)
    setEditValue(Array.isArray(value) ? value.join(', ') : value)
  }

  const handleSaveEdit = async (field: string) => {
    setEditingField(null)

    const parsed = parseStepFieldValue(field, editValue)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }

    // New rows only mutate local state until "Save Step" — debouncing that
    // buys nothing and would hide the value from a Save Step click landing
    // inside the window.
    if (step._isNew) {
      await onUpdate({ [field]: parsed.value }).catch((error) => {
        console.error('Failed to update new row:', error)
      })
      return
    }

    debouncedSave.save({ [field]: parsed.value })
  }

  const handleCancelEdit = () => {
    setEditingField(null)
    setEditValue('')
  }

  const handleTabNavigation = (e: React.KeyboardEvent, currentField: string) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      handleSaveEdit(currentField)
      if (currentField === 'inputs') {
        setEditingField('label')
        setEditValue(step.label)
      } else if (currentField === 'label') {
        setEditingField('outputs')
        setEditValue(step.outputs.join(', '))
      }
    }
  }

  const getEntityType = (entityName: string): 'team' | 'system' | null => {
    if (teams.find((t) => t.name === entityName)) return 'team'
    if (systems.find((s) => s.name === entityName)) return 'system'
    return null
  }

  const handleAutofillRequest = (field: 'suppliers' | 'inputs') => {
    const hasExistingData =
      field === 'suppliers' ? step.suppliers.length > 0 : step.inputs.length > 0

    if (hasExistingData) {
      setAutofillField(field)
      setShowAutofillConfirm(true)
    } else {
      performAutofill(field)
    }
  }

  const performAutofill = (field: 'suppliers' | 'inputs') => {
    const previousStep = index > 0 ? allSteps[index - 1] : null
    if (!previousStep) return

    setEditingField(null)
    setEditValue('')

    if (field === 'suppliers' && previousStep.customers.length > 0) {
      void onUpdate({ suppliers: previousStep.customers }).catch(() => undefined)
    } else if (field === 'inputs' && previousStep.outputs.length > 0) {
      void onUpdate({ inputs: previousStep.outputs }).catch(() => undefined)
    }

    setShowAutofillConfirm(false)
    setAutofillField(null)
  }

  const milestone = milestones.find((m) => m.id === step.milestoneId)
  // The badge's first/last exemption ranks on (milestone.order, step.order), so
  // it needs the milestones the row already has as a prop (#344).
  const milestoneById = milestonesById(milestones)
  // Indexed against the unfiltered list: validateStepChain walks by position,
  // so the visible-row index would make it read the wrong neighbour and
  // contradict the badge below whenever a filter is active.
  const validationIndex = validationSteps.findIndex((s) => s.id === step.id)
  const validation = validateStepChain(
    step,
    validationSteps,
    validationIndex === -1 ? index : validationIndex
  )
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <>
      <tr
        aria-selected={isSelected}
        className={`transition-all ${isDragging ? 'opacity-50' : ''} ${
          isDragOver ? 'border-t-4 border-t-orange-500' : ''
        }`}
        draggable={!editingField}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
      >
        <td>
          <div className="flex items-center gap-2">
            {!editingField && (
              <button
                className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
                title="Drag to reorder"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8h16M4 16h16"
                  />
                </svg>
              </button>
            )}
            <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
          </div>
        </td>

        <td className="text-center">
          {(() => {
            // Always recomputed. A persisted result goes stale the moment any
            // other write path — the Diagram modal, the wizard, a neighbour's
            // edit — changes what it described (#176).
            const currentValidation = validateStep(step, validationSteps, milestoneById)

            if (currentValidation.isValid) {
              return (
                <div title="All SIPOC fields complete">
                  <Check size={16} strokeWidth={2} aria-label="SIPOC complete" />
                </div>
              )
            }
            return (
              <div className="relative group">
                <TriangleAlert size={16} strokeWidth={2} className="text-gs-accent" />
                <div className="absolute left-0 top-6 z-50 hidden group-hover:block w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg">
                  <div className="font-semibold mb-1">SIPOC Issues:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {currentValidation.issues.map((issue, idx) => (
                      <li key={idx} className="text-xs">
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          })()}
        </td>

        <td>
          <div className="flex items-center gap-2">
            {displayNumber !== null ? (
              // All Steps shows the position in the whole process, which is not
              // the value the cell would write: `order` is scoped to its
              // milestone. Editing here would either write a number out of that
              // milestone's range or move a step the user was not pointing at,
              // so the order is edited from its own milestone tab instead (#299).
              <span
                className="flex-1 text-gray-700 font-medium"
                title="Position in the process. Open this step's milestone tab to change its order."
              >
                {displayNumber}
              </span>
            ) : editingField === 'order' ? (
              <input
                type="number"
                min="1"
                className="input-field w-16 text-center"
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => handleSaveEdit('order')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit('order')
                  if (e.key === 'Escape') handleCancelEdit()
                }}
              />
            ) : (
              <span
                className="flex-1 text-gray-700 font-medium cursor-pointer hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                onClick={() => handleStartEdit('order', step.order.toString())}
                title="Click to edit order number"
              >
                {/* eslint-disable-next-line no-restricted-syntax -- this branch
                    only renders when `displayNumber` is null, i.e. inside a
                    milestone tab where the stored order IS the position, and the
                    cell is the editor that writes it back (#345). */}
                {step.order}
              </span>
            )}

            {allSteps.filter(
              (s) => s.order === step.order && s.milestoneId === step.milestoneId
            ).length > 1 && (
              <span
                className="text-purple-600 text-xs font-bold"
                title={`Parallel step (runs at same time as other steps at position ${displayNumber ?? step.order})`}
              >
                ∥
              </span>
            )}

            {saveStatus === 'saving' && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </span>
            )}
            {saveStatus === 'saved' && (
              <span data-testid="step-save-status" className="text-xs text-gs-ink-muted">
                Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span data-testid="step-save-status" className="text-xs text-gs-accent-ink">
                Failed
              </span>
            )}
          </div>
        </td>

        <td>
          {editingField === 'milestoneId' ? (
            <select
              className="input-field w-full"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSaveEdit('milestoneId')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit('milestoneId')
                if (e.key === 'Escape') handleCancelEdit()
              }}
            >
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded"
              onClick={() => handleStartEdit('milestoneId', step.milestoneId)}
            >
              {milestone?.name || <Empty />}
            </div>
          )}
        </td>

        <td>
          {editingField === 'suppliers' ? (
            <MultiSelectDropdown
              selectedValues={step.suppliers}
              teams={teams}
              systems={systems}
              onSave={(values) => {
                void onUpdate({ suppliers: values }).catch(() => undefined)
                setEditingField(null)
              }}
              onCancel={handleCancelEdit}
              autoFillOption={
                index > 0 && allSteps[index - 1]
                  ? {
                      label: `Auto-fill from step ${previousDisplayNumber}`,
                      value: allSteps[index - 1].customers,
                    }
                  : undefined
              }
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded text-sm"
              onClick={() => setEditingField('suppliers')}
            >
              {step.suppliers.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {step.suppliers.map((supplier) => {
                    const type = getEntityType(supplier)
                    const isTeam = type === 'team'
                    const isSystem = type === 'system'
                    return (
                      <span
                        key={supplier}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                          isTeam
                            ? 'bg-blue-100 text-blue-800'
                            : isSystem
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {supplier}
                      </span>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Empty />
                  {index > 0 && allSteps[index - 1] && (
                    <button
                      className="btn-secondary text-xs px-2 py-1 whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAutofillRequest('suppliers')
                      }}
                      title={`Auto-fill from previous step (row ${previousDisplayNumber})'s Customer`}
                    >
                      ↓ Fill from #{previousDisplayNumber}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </td>

        <td>
          {editingField === 'inputs' ? (
            <input
              type="text"
              className="input-field w-full"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSaveEdit('inputs')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit('inputs')
                if (e.key === 'Escape') handleCancelEdit()
                handleTabNavigation(e, 'inputs')
              }}
              placeholder="Request, Data..."
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded text-sm"
              onClick={() => handleStartEdit('inputs', step.inputs)}
            >
              {step.inputs.length > 0 ? (
                step.inputs.join(', ')
              ) : (
                <div className="flex items-center gap-2">
                  <Empty />
                  {index > 0 && allSteps[index - 1] && (
                    <button
                      className="btn-secondary text-xs px-2 py-1 whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAutofillRequest('inputs')
                      }}
                      title={`Auto-fill from previous step (row ${previousDisplayNumber})'s Output`}
                    >
                      ↓ Fill from #{previousDisplayNumber}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </td>

        <td>
          {editingField === 'label' ? (
            <input
              type="text"
              className="input-field w-full"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSaveEdit('label')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit('label')
                if (e.key === 'Escape') handleCancelEdit()
                handleTabNavigation(e, 'label')
              }}
              placeholder="Enter process step..."
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded font-medium"
              style={{ color: 'var(--color-deep-navy)' }}
              onClick={() => handleStartEdit('label', step.label)}
            >
              {step.label || '(empty)'}
            </div>
          )}
        </td>

        <td>
          {editingField === 'outputs' ? (
            <input
              type="text"
              className="input-field w-full"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSaveEdit('outputs')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit('outputs')
                if (e.key === 'Escape') handleCancelEdit()
                handleTabNavigation(e, 'outputs')
              }}
              placeholder="Report, Result..."
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded text-sm"
              onClick={() => handleStartEdit('outputs', step.outputs)}
            >
              {step.outputs.length > 0 ? step.outputs.join(', ') : <Empty />}
            </div>
          )}
        </td>

        <td>
          {editingField === 'customers' ? (
            <MultiSelectDropdown
              selectedValues={step.customers}
              teams={teams}
              systems={systems}
              onSave={(values) => {
                void onUpdate({ customers: values }).catch(() => undefined)
                setEditingField(null)
              }}
              onCancel={handleCancelEdit}
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded text-sm"
              onClick={() => setEditingField('customers')}
            >
              {step.customers.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {step.customers.map((customer) => {
                    const type = getEntityType(customer)
                    const isTeam = type === 'team'
                    const isSystem = type === 'system'
                    return (
                      <span
                        key={customer}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                          isTeam
                            ? 'bg-blue-100 text-blue-800'
                            : isSystem
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {customer}
                      </span>
                    )
                  })}
                </div>
              ) : (
                <Empty />
              )}
            </div>
          )}
        </td>

        <td>
          {editingField === 'trigger' ? (
            <input
              type="text"
              className="input-field w-full"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSaveEdit('trigger')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit('trigger')
                if (e.key === 'Escape') handleCancelEdit()
              }}
              placeholder="What starts this?"
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded text-sm"
              onClick={() => handleStartEdit('trigger', step.trigger || '')}
            >
              {step.trigger || <Empty />}
            </div>
          )}
        </td>

        <td>
          {editingField === 'notes' ? (
            <input
              type="text"
              className="input-field w-full"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSaveEdit('notes')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit('notes')
                if (e.key === 'Escape') handleCancelEdit()
              }}
              placeholder="Additional notes..."
            />
          ) : (
            <div
              className="cursor-pointer hover:bg-gray-100 rounded text-sm"
              onClick={() => handleStartEdit('notes', step.notes || '')}
            >
              {step.notes || <Empty />}
            </div>
          )}
        </td>

        <td className="text-center relative">
          <div
            className="inline-block cursor-help"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            {validation.status === 'perfect' && (
              <span className="text-green-600" title={validation.message}>
                ✓
              </span>
            )}
            {validation.status === 'warning' && (
              <span className="text-orange-500" title={validation.message}>
                ⚠
              </span>
            )}
            {validation.status === 'broken' && (
              <span className="text-red-600" title={validation.message}>
                ✗
              </span>
            )}
            {(validation.status === 'end' || validation.status === 'start') && (
              <span className="text-gray-400" title={validation.message}>
                ○
              </span>
            )}

            {showTooltip && validation.details.length > 0 && (
              <div className="absolute z-50 right-0 top-full mt-1 w-80 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3">
                <div className="font-semibold mb-2">{validation.message}</div>
                {validation.details.map((detail, idx) => (
                  <div key={idx} className="mb-1 whitespace-pre-wrap">
                    {detail}
                  </div>
                ))}
                <div className="absolute -top-1 right-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
              </div>
            )}
          </div>
        </td>
      </tr>

      <ConfirmModal
        isOpen={showAutofillConfirm && autofillField !== null}
        onClose={() => {
          setShowAutofillConfirm(false)
          setAutofillField(null)
        }}
        title="Overwrite Existing Data?"
        icon={null}
        description={
          <>
            <p className="mb-4">
              {autofillField === 'suppliers'
                ? 'This will replace existing suppliers with the customer(s) from the previous step.'
                : 'This will replace existing inputs with the output(s) from the previous step.'}
            </p>
            <p className="text-sm text-gray-500">Are you sure you want to continue?</p>
          </>
        }
        confirmAction={{
          label: 'Yes, Auto Fill',
          style: 'primary',
          onClick: () => {
            if (autofillField) performAutofill(autofillField)
          },
        }}
      />
    </>
  )
}
