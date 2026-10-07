/**
 * EditableRowTable - Presentational + orchestration table for DiscoveryGrid
 *
 * Extracted from DiscoveryGrid.tsx as part of ZIP-319.
 * Owns the table chrome (thead/tbody), insert-zone tray, the per-row
 * StepRow.onUpdate orchestration, the new-row Save/Cancel tray with all of
 * its chain-validation/gap-sync side effects, and the horizontal-scroll
 * indicator. Modal/state ownership stays in the parent (DiscoveryGrid),
 * which passes intent callbacks down (onShowValidationWarning,
 * onRequestCancelWithConfirm, etc.).
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import { TriangleAlert, Check, X } from 'lucide-react'
import type { Step, Milestone, Team, System, Gap, MissingFieldType } from '../../data/types'
import type { EditableStep } from './types'
import { createStep } from '../../services/db'
import { validateStep } from '../../lib/sipocValidator'
import { validateNewRow, getNewRowValidationMessage } from '../../lib/newRowValidator'
import { compareSteps, milestonesById, processPositions } from '../../lib/stepSequence'
import { splitStepPatch } from '../../lib/stepPatch'
import {
  applyPendingStepEdit,
  parseStepFieldValue,
  type PendingStepEdit,
} from '../../lib/stepFieldValue'
import { useStepsStore } from '../../state/stepsStore'
import { useGapsStore } from '../../state/gapsStore'
import { resyncGapsAfterStepWrite, snapshotOpenGapIds } from '../../state/gapResync'
import { openSlotForInsert, resealAfterMutation } from '../../state/sequenceOps'
import { StepRow } from './StepRow'

/**
 * The process-gap row is framed in dashed orange on the <tr>. Under the collapsed
 * border model Preflight applies, a cell border outranks a row border at equal
 * width and solid outranks dashed, so `.tbl td`'s 1px solid rule would win the
 * bottom edge and leave the row half-framed. The cells restate the dashed edge
 * as a utility, which beats the component layer.
 */
const GAP_ROW_CELL = 'border-b border-dashed border-orange-200'

export type StepOrGap =
  | (EditableStep & { _type: 'step' })
  | (Gap & { _type: 'gap' })

interface EditableRowTableProps {
  projectId: string
  steps: EditableStep[]
  filteredSteps: EditableStep[]
  mergedItems: StepOrGap[]
  /**
   * Process position to show in the `#` column, by row id, or null to show each
   * row's stored `order`. Non-null only in the All Steps view (#299).
   */
  displayNumbers: Map<string, number> | null
  milestones: Milestone[]
  teams: Team[]
  systems: System[]
  gaps: Gap[]
  selectedIds: Set<string>
  setSelectedIds: (s: Set<string>) => void
  // New-row state callbacks (parent owns the steps[] state; child calls these
  // to mutate it without a leaked setter).
  onUpdateNewRowLocally: (stepId: string, updates: Partial<Step>) => void
  onRemoveNewRow: (stepId: string) => void
  // Drag state
  draggedStepId: string | null
  dragOverIndex: number | null
  hoveredInsertIndex: number | null
  setHoveredInsertIndex: (i: number | null) => void
  onDragStart: (e: React.DragEvent, stepId: string) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDragEnd: () => void
  onDrop: (e: React.DragEvent, dropIndex: number) => Promise<void>
  // Gap row actions (from parent)
  onCreateProcessGap: (atIndex: number) => Promise<void>
  onCloseProcessGap: (gap: Gap) => Promise<void>
  onEditProcessGap: (gap: Gap) => void
  onRequestDeleteGap: (gap: Gap) => void
  // Insert / new-row actions (from parent)
  onInsertRow: (atIndex: number) => Promise<void>
  onRequestCancelNewRow: (stepId: string) => void
  onRequestCancelWithConfirm: (stepId: string) => void
  // Validation modal trigger (parent owns the modal state)
  onShowValidationWarning: (ctx: {
    step: EditableStep
    missingFields: string[]
    pendingUpdates: Partial<Step>
  }) => void
}

export function EditableRowTable({
  projectId,
  steps,
  filteredSteps,
  mergedItems,
  displayNumbers,
  milestones,
  teams,
  systems,
  gaps,
  selectedIds,
  setSelectedIds,
  onUpdateNewRowLocally,
  onRemoveNewRow,
  draggedStepId,
  dragOverIndex,
  hoveredInsertIndex,
  setHoveredInsertIndex,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onCreateProcessGap,
  onCloseProcessGap,
  onEditProcessGap,
  onRequestDeleteGap,
  onInsertRow,
  onRequestCancelNewRow,
  onRequestCancelWithConfirm,
  onShowValidationWarning,
}: EditableRowTableProps) {
  const {
    updateStep: updateStepInStore,
    loadSteps: loadStepsInStore,
    reorderSteps: reorderStepsInStore,
  } = useStepsStore()
  const { addGap: createGapInStore, updateGap: updateGapInStore } = useGapsStore()

  // Uncommitted cell-editor values for new rows, keyed by row id. Lets the Save
  // tray validate and persist what the user sees rather than the last committed
  // state (see StepRow's onPendingEditChange).
  const [pendingEdits, setPendingEdits] = useState<Record<string, PendingStepEdit>>({})

  // Every step, in process order. Validation reads neighbours, so it has to see
  // rows a filter is hiding — and `validateStepChain` walks by array index, so
  // the list has to be sorted rather than left in store order. `order` is scoped
  // to its milestone (#299), so the sort ranks by (milestone order, step order);
  // a flat sort handed the chain a neighbour from the wrong milestone.
  const milestoneById = useMemo(() => milestonesById(milestones), [milestones])
  const validationSteps = useMemo(
    () => [...steps].sort((a, b) => compareSteps(a, b, milestoneById)),
    [steps, milestoneById]
  )

  // A StepRow's `index` is only ever used to reach its neighbours in `allSteps`,
  // which is `filteredSteps` — so it has to be an index into that list. The row
  // loop below runs over `mergedItems`, which interleaves process-gap rows, and
  // handing that index down made a row with a gap above it read the wrong
  // neighbour: with one gap, `allSteps[index - 1]` is the row itself, and the
  // auto-fill offered to copy a step's own customers into its own suppliers.
  const stepIndexOf = (id: string) => filteredSteps.findIndex((s) => s.id === id)

  // The number the row above is showing, by the `#` column's own formula.
  // Anything that names a row to the reader has to name the number the reader
  // can see, and in the All Steps view that is the running position, not the
  // stored per-milestone `order` (#303).
  const previousDisplayNumberOf = (id: string) => {
    const previous = filteredSteps[stepIndexOf(id) - 1]
    if (!previous) return null
    return displayNumbers?.get(previous.id) ?? previous.order
  }

  const handlePendingEditChange = React.useCallback(
    (stepId: string, pending: PendingStepEdit | null) => {
      setPendingEdits((prev) => {
        if (!pending) {
          if (!(stepId in prev)) return prev
          const next = { ...prev }
          delete next[stepId]
          return next
        }
        const current = prev[stepId]
        if (current && current.field === pending.field && current.value === pending.value) {
          return prev
        }
        return { ...prev, [stepId]: pending }
      })
    },
    []
  )

  // Horizontal-scroll detection state
  const [isScrollable, setIsScrollable] = useState(false)
  const [scrolledToEnd, setScrolledToEnd] = useState(false)
  const tableWrapperRef = useRef<HTMLDivElement>(null)

  // Detect horizontal scroll state
  useEffect(() => {
    const el = tableWrapperRef.current
    if (!el) return

    const checkScroll = () => {
      const hasScroll = el.scrollWidth > el.clientWidth
      const isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 5

      setIsScrollable(hasScroll)
      setScrolledToEnd(isAtEnd)
    }

    // Use setTimeout to ensure DOM has updated after filteredSteps changes
    const timer = setTimeout(checkScroll, 0)

    el.addEventListener('scroll', checkScroll)
    window.addEventListener('resize', checkScroll)

    return () => {
      clearTimeout(timer)
      el.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [filteredSteps])

  // Toggle row selection (kept local: writes through setSelectedIds prop)
  const handleToggleSelect = (id: string) => {
    const newSelection = new Set(selectedIds)
    if (newSelection.has(id)) {
      newSelection.delete(id)
    } else {
      newSelection.add(id)
    }
    setSelectedIds(newSelection)
  }

  return (
    <div className="relative">
      <div
        ref={tableWrapperRef}
        className={`bg-white rounded-lg border border-gray-200 overflow-x-auto ${
          isScrollable && !scrolledToEnd ? 'scroll-fade-right' : ''
        }`}
      >
      <table className="w-full tbl">
        <thead>
          <tr>
            <th className="w-10">
              <input
                type="checkbox"
                checked={filteredSteps.length > 0 && filteredSteps.every(s => selectedIds.has(s.id))}
                onChange={(e) => {
                  if (e.target.checked) {
                    // Select all visible (filtered) steps
                    setSelectedIds(new Set(filteredSteps.map(s => s.id)))
                  } else {
                    setSelectedIds(new Set())
                  }
                }}
              />
            </th>
            <th className="text-center w-16" title="Validation Status">
              <TriangleAlert size={16} strokeWidth={2} aria-label="Validation status" />
            </th>
            <th className="w-28">#</th>
            <th className="min-w-[120px]">Milestone</th>
            <th className="min-w-[150px]">Supplier</th>
            <th className="min-w-[150px]">Inputs</th>
            <th className="min-w-[200px]">Process</th>
            <th className="min-w-[150px]">Output</th>
            <th className="min-w-[150px]">Customer</th>
            <th className="min-w-[120px]">Trigger</th>
            <th className="min-w-[150px]">Notes</th>
            <th>SIPOC</th>
          </tr>
        </thead>
        <tbody>
          {mergedItems.map((item, idx) => (
            <React.Fragment key={item._type === 'step' ? item.id : `gap-${item.id}`}>
              {/* Insert zone before row */}
              <tr
                className="group hover:bg-orange-50 transition-colors"
                style={{ height: hoveredInsertIndex === idx ? '48px' : '4px' }}
                onMouseEnter={() => setHoveredInsertIndex(idx)}
                onMouseLeave={() => setHoveredInsertIndex(null)}
              >
                <td colSpan={12} className="tbl-bare text-center">
                  {hoveredInsertIndex === idx && (
                    <div className="flex items-center justify-center gap-4 py-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onInsertRow(idx)
                        }}
                        className="btn-primary flex items-center gap-gs-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Insert Step
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onCreateProcessGap(idx)
                        }}
                        className="btn-danger flex items-center gap-gs-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        Create Gap
                      </button>
                    </div>
                  )}
                </td>
              </tr>

              {/* Actual step or gap row */}
              {item._type === 'gap' ? (
                /* Process Gap Row */
                <tr className="bg-orange-50 border-l-4 border-orange-400 border-y border-r border-dashed border-orange-200 hover:bg-orange-100 transition-colors">
                  <td className={GAP_ROW_CELL}>
                    <input
                      type="checkbox"
                      disabled
                      className="w-4 h-4 opacity-50"
                    />
                  </td>
                  <td className={`text-center text-gs-accent ${GAP_ROW_CELL}`}>
                    <TriangleAlert size={16} strokeWidth={2} aria-label="Process gap" className="inline" />
                  </td>
                  <td className={`font-mono text-orange-800 font-bold ${GAP_ROW_CELL}`}>
                    {displayNumbers?.get(item.id) ?? item.order}
                  </td>
                  <td colSpan={6} className={GAP_ROW_CELL}>
                    <div className="flex items-center gap-2">
                      <TriangleAlert size={16} strokeWidth={2} className="text-gs-accent shrink-0" />
                      <div className="flex-1">
                        <span className="font-semibold text-orange-900">Process Gap: </span>
                        <span className="italic text-orange-800">{item.observed || 'Unknown process step'}</span>
                      </div>
                    </div>
                  </td>
                  <td colSpan={3} className={GAP_ROW_CELL}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onEditProcessGap(item)}
                        className="btn-secondary text-xs px-2 py-1 whitespace-nowrap"
                      >
                        Edit Gap
                      </button>
                      <button
                        onClick={() => onCloseProcessGap(item)}
                        className="btn-secondary text-xs px-2 py-1 whitespace-nowrap"
                      >
                        Close Gap
                      </button>
                      <button
                        onClick={() => onRequestDeleteGap(item)}
                        className="btn-secondary text-xs px-2 py-1 whitespace-nowrap"
                      >
                        Delete Gap
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
            <StepRow
                  step={item}
              index={stepIndexOf(item.id)}
                  allSteps={filteredSteps}
                  validationSteps={validationSteps}
                  displayNumber={displayNumbers?.get(item.id) ?? null}
                  previousDisplayNumber={previousDisplayNumberOf(item.id)}
              milestones={milestones}
                  teams={teams}
                  systems={systems}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={() => handleToggleSelect(item.id)}
                  isDragging={draggedStepId === item.id}
                  isDragOver={dragOverIndex === idx}
                  onDragStart={(e) => onDragStart(e, item.id)}
                  onDragOver={(e) => onDragOver(e, idx)}
                  onDragEnd={onDragEnd}
                  onDrop={(e) => onDrop(e, idx)}
                  onPendingEditChange={
                    item._isNew
                      ? (pending) => handlePendingEditChange(item.id, pending)
                      : undefined
                  }
              onUpdate={async (updates, options) => {
                try {
                      // For NEW rows: just update local state, don't save yet
                      if (item._isNew) {
                        onUpdateNewRowLocally(item.id, updates)
                        return
                      }

                      // See `splitStepPatch`: `order` moves the step and the
                      // rest is a field write, and one patch can carry both.
                      const { fieldUpdates, nextOrder } = splitStepPatch(updates, item.order)
                      const isOrderEdit = nextOrder !== null
                      const hasFieldUpdates = Object.keys(fieldUpdates).length > 0

                      // Check if user is CLEARING a SIPOC field. Order is not a
                      // SIPOC field and cannot clear one, so only the rest of
                      // the patch is considered.
                      const sipocFields = ['suppliers', 'inputs', 'label', 'outputs', 'customers']
                      const isClearingSIPOC = sipocFields.some(field => {
                        if (!(field in fieldUpdates)) return false

                        // Check if field is being cleared
                        const oldValue = item[field as keyof typeof item]
                        const newValue = fieldUpdates[field as keyof typeof fieldUpdates]

                        if (field === 'label') {
                          return oldValue && !newValue
                        } else {
                          const oldArray = Array.isArray(oldValue) ? oldValue : []
                          const newArray = Array.isArray(newValue) ? newValue : []
                          return oldArray.length > 0 && newArray.length === 0
                        }
                      })

                      // Create updated step for validation
                      const updatedStep = { ...item, ...updates } as EditableStep

                      // Validate against a list carrying the same edit, as the
                      // new-row Save tray does below. Otherwise an `order`
                      // change leaves this row's stale copy in the list, and
                      // chain validation compares the row against itself as its
                      // own "next step" (#240).
                      const stepsForValidation = steps.map(s =>
                        s.id === item.id ? updatedStep : s
                      )
                      const validation = validateStep(updatedStep, stepsForValidation, milestoneById)

                      // If user is clearing a SIPOC field AND validation fails, show warning.
                      // Not for an unattended write: the row has unmounted, so the
                      // modal would ask a question of nobody and its "Go Back & Edit"
                      // exit would drop the edit on the way out (#257). Writing an
                      // invalid step is the lesser of the two — the row's ⚠ badge and
                      // the gap auto-sync below both still say so.
                      if (isClearingSIPOC && !validation.isValid && !options?.unattended) {
                        onShowValidationWarning({
                          step: updatedStep,
                          missingFields: validation.missingFields,
                          pendingUpdates: updates,
                        })
                        return // Don't save yet
                      }

                      // Snapshot before the first await: `updateStep` promotes
                      // the gaps whose missing field this patch fills (#88), and
                      // afterwards status alone cannot tell one this edit moved
                      // from one a reviewer already had (#279).
                      const wasOpen = snapshotOpenGapIds(item.id)

                      // The Milestone cell is editable inline, so this is a
                      // cross-milestone move as much as the Edit Step modal is —
                      // the grid twin of #335, and `order` is scoped to its
                      // milestone (#299), so the number travelling with the step
                      // belongs to the sequence it is leaving. Read the origin
                      // before the write; afterwards the row only knows where it
                      // landed.
                      const originMilestoneId = item.milestoneId
                      const destinationMilestoneId = fieldUpdates.milestoneId
                      const movedMilestone =
                        !!destinationMilestoneId && destinationMilestoneId !== originMilestoneId

                      // Room in the destination first, so the step is not written
                      // onto a position another row already holds. Nothing has
                      // been written yet if this fails.
                      // Update existing step - use store to notify subscribers.
                      // A move opens the destination slot and writes into it as
                      // one operation, locking the origin too, because the write
                      // empties a position there as well.
                      if (movedMilestone) {
                        await openSlotForInsert({
                          projectId,
                          milestoneId: destinationMilestoneId,
                          at: item.order,
                          alsoLock: originMilestoneId,
                          write: async () => {
                            await updateStepInStore(item.id, fieldUpdates, projectId)
                          },
                        })
                      } else if (hasFieldUpdates) {
                        await updateStepInStore(item.id, fieldUpdates, projectId)
                      }
                      if (nextOrder !== null) {
                        // Throws on failure, so a rejected reorder reaches
                        // StepRow's save indicator and skips the gap sync below
                        // rather than reporting a move that did not land.
                        await reorderStepsInStore(item.id, nextOrder, projectId)
                      }

                      // Both milestones: the origin has the hole the step left,
                      // the destination whatever the open slot did not get filled
                      // exactly. Crossing a boundary re-decides "first", "last"
                      // and every chain check on both sides (#291, #344), which
                      // is why the wholesale re-sync runs here and not for an
                      // ordinary field edit.
                      let resealSyncedCount = 0
                      if (movedMilestone) {
                        ;({ syncedCount: resealSyncedCount } = await resealAfterMutation({
                          projectId,
                          milestoneIds: [originMilestoneId, destinationMilestoneId],
                        }))
                      }

                      // AUTO-SYNC: Update associated gaps with new validation (ZIP-148 Phase 1)
                      //
                      // Narrowed to the step when the reseal above already ran a
                      // milestone-wide pass, which it does for a move. A patch
                      // that is both a move and an order edit would otherwise
                      // sweep the origin twice — the second pass finds nothing
                      // to write, but it re-validates every step in the
                      // milestone to discover that. What this pass still owes,
                      // and the reason it runs at all, is `wasOpen`: a gap this
                      // very save promoted to Review is skipped by the wholesale
                      // pass and corrected here.
                      const resync = await resyncGapsAfterStepWrite({
                        stepId: item.id,
                        projectId,
                        milestoneWide: isOrderEdit && !movedMilestone,
                        fallbackMilestoneId: item.milestoneId,
                        wasOpen,
                      })

                      const { openGapsForStep } = resync
                      // Both passes, so the number the user reads is the number
                      // of gaps the save actually rewrote. `planGapResync` plans
                      // nothing where the wording would not change, so a gap the
                      // wholesale pass corrected is skipped by the narrower one.
                      const syncedCount = resealSyncedCount + resync.syncedCount
                      // A vanished row has no post-write validation to read, so
                      // the pre-write result stands in, as it always has.
                      const isValidAfterWrite = resync.editedStep ? resync.isValid : validation.isValid

                      if (syncedCount > 0) {
                        toast.success(`Step updated • ${syncedCount} gap${syncedCount > 1 ? 's' : ''} auto-synced`)
                      } else if (openGapsForStep.length > 0 && isValidAfterWrite) {
                        // Step is now valid, but gaps exist - notify user
                        toast(`Step is now valid! Consider closing ${openGapsForStep.length} open gap${openGapsForStep.length > 1 ? 's' : ''}`, {
                          duration: 4000
                        })
                      }

                  // Local state will be synced via useEffect
                  console.log('Step updated via store, diagram will auto-regenerate')
                } catch (error) {
                  console.error('Failed to save step:', error)
                  throw error
                }
              }}
            />
              )}

            {/* Save/Cancel Tray for New Rows (only for steps, not gaps) */}
            {item._type === 'step' && item._isNew && (
              <tr className="bg-blue-50 border-t border-blue-200">
                <td colSpan={12}>
                  {(() => {
                    // Fold in whatever the still-open cell editor holds, so the
                    // indicator, the Save button's enabled state, and the write
                    // itself all agree with what is on screen (#171).
                    const pendingEdit = pendingEdits[item.id]
                    const effectiveItem = applyPendingStepEdit(item, pendingEdit)
                    const validation = validateNewRow(effectiveItem)
                    return (
                      <div className="flex flex-col items-center gap-3">
                        {/* Validation Summary */}
                        <div className="flex items-center gap-2">
                          {!validation.isValid ? (
                            <>
                              <TriangleAlert size={16} strokeWidth={2} className="text-gs-accent" />
                              <span className="text-sm text-amber-700">
                                {getNewRowValidationMessage(validation)}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-green-700 flex items-center gap-2">
                              <Check className="w-4 h-4" />
                              Ready to save
                            </span>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()

                              // Check if there's any SIPOC data (not just order ID)
                              const hasSipocData =
                                (effectiveItem.suppliers && effectiveItem.suppliers.length > 0) ||
                                (effectiveItem.inputs && effectiveItem.inputs.length > 0) ||
                                (effectiveItem.label || '').trim() !== '' ||
                                (effectiveItem.outputs && effectiveItem.outputs.length > 0) ||
                                (effectiveItem.customers && effectiveItem.customers.length > 0)

                              if (hasSipocData) {
                                // Show custom confirmation modal
                                onRequestCancelWithConfirm(item.id)
                              } else {
                                // No data, cancel immediately
                                onRequestCancelNewRow(item.id)
                              }
                            }}
                            className="flex items-center gap-2 px-6 py-2 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors text-sm font-medium cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.preventDefault()
                              e.stopPropagation()

                              // Refuse rather than silently dropping a value the
                              // open editor cannot parse (e.g. a bad order).
                              if (pendingEdit) {
                                const parsed = parseStepFieldValue(
                                  pendingEdit.field,
                                  pendingEdit.value
                                )
                                if (!parsed.ok) {
                                  toast.error(parsed.error)
                                  return
                                }
                              }

                              if (!validation.isValid) {
                                toast.error('Please complete required fields before saving')
                                return
                              }

                              try {
                                // Validate against a list carrying the same
                                // pending edit. Otherwise a pending `order`
                                // change leaves this row's stale copy in the
                                // list, and chain validation compares the row
                                // against itself as its own "next step".
                                const stepsForValidation = steps.map(s =>
                                  s.id === item.id ? effectiveItem : s
                                )
                                const fullValidation = validateStep(effectiveItem, stepsForValidation, milestoneById)

                                // The row's `order` is whatever the user typed —
                                // `parseStepFieldValue` only enforces `>= 1`, with
                                // no ceiling and no collision check — so a raw
                                // INSERT could land it on an occupied position and
                                // declare parallel work nobody asked for. Opening
                                // the slot first is what makes the number mean
                                // "insert here"; it is idempotent when the insert
                                // tray already opened one, because the module ranks
                                // the milestone before deciding what to push.
                                //
                                // A row closing a process gap is the exception: it
                                // is replacing the gap at that position, not
                                // inserting beside it, and the gap is closed a few
                                // lines below. Opening a slot would push the gap up
                                // and leave the pair straddling two positions.
                                //
                                // Only when it really is replacing it, though.
                                // `handleCloseProcessGap` falls back to
                                // `milestones[0]` for a gap that carries no
                                // milestone of its own, so the row can arrive
                                // holding that gap's order against a milestone the
                                // gap was never in — lending a position to a
                                // sequence it does not belong to. There the row is
                                // an ordinary insert and has to open its own slot.
                                const closingGap = item._closingGapId
                                  ? gaps.find(g => g.id === item._closingGapId)
                                  : undefined
                                const replacesGapInPlace =
                                  !!closingGap &&
                                  closingGap.milestoneId === effectiveItem.milestoneId &&
                                  closingGap.order === effectiveItem.order
                                // Typed as possibly-undefined rather than
                                // `string`: `openSlotForInsert` can return
                                // without running `write` — a project switch
                                // across the open abandons the insert — so the
                                // bare form was only safe because this call
                                // passes no `scope`, and would be read
                                // unassigned the moment one is added. The
                                // lookups below already tolerate a miss.
                                let createdStepId: string | undefined
                                if (replacesGapInPlace) {
                                  createdStepId = await createStep(effectiveItem)
                                } else {
                                  // Opened and filled as one operation: the gap
                                  // between the two is the window a concurrent
                                  // reseal or a second insert corrupts.
                                  await openSlotForInsert({
                                    projectId,
                                    milestoneId: effectiveItem.milestoneId,
                                    at: effectiveItem.order,
                                    write: async () => {
                                      createdStepId = await createStep(effectiveItem)
                                    },
                                  })
                                }

                                // Remove temp step from local state
                                onRemoveNewRow(item.id)

                                // Reload store to get the saved step with its real ID
                                await loadStepsInStore(projectId)

                                // If this step was closing a gap, mark the gap as closed
                                if (item._closingGapId) {
                                  await updateGapInStore(item._closingGapId, {
                                    status: 'Closed',
                                    closedAt: Date.now()
                                  }, projectId)
                                  // Reload gaps to hide the closed gap
                                  await useGapsStore.getState().loadGaps(projectId)

                                  // CHAIN VALIDATION: Check if closing this gap created chain breaks
                                  const allSteps = useStepsStore.getState().steps
                                  // By the id `createStep` just returned. Searching on
                                  // `order` wrote this note onto a same-numbered step in
                                  // another milestone, because `order` numbers a step
                                  // within its milestone (#299, #332) — and even scoped,
                                  // a parallel pair shares one order and would be a coin
                                  // toss. The id is the only unambiguous answer.
                                  const newStep = allSteps.find(s => s.id === createdStepId)
                                  // `displayNumbers` is the grid's render-time
                                  // map and predates this step, so the toast
                                  // below would fall through to the stored
                                  // order for the very row it is naming.
                                  // Rebuilt from the same live read (#345);
                                  // null keeps a milestone tab on the stored
                                  // order, which is what its `#` column shows.
                                  const livePositions =
                                    displayNumbers === null
                                      ? null
                                      : processPositions(
                                          allSteps,
                                          useGapsStore.getState().gaps,
                                          useStepsStore.getState().milestones
                                        )
                                  const positionOf = (step: Step) =>
                                    livePositions?.get(step.id) ?? step.order
                                  // Neighbours still have to be found by position, but
                                  // within the milestone: `listSteps` orders by
                                  // `milestone_id`, a nanoid, so the old index ± 1 walked
                                  // into an arbitrary milestone at every block boundary
                                  // and could raise a chain-break gap on an untouched
                                  // step.
                                  const inMilestone = (order: number) =>
                                    allSteps.find(s =>
                                      s.milestoneId === effectiveItem.milestoneId &&
                                      s.order === order
                                    )

                                  if (newStep) {
                                    // Add note to step documenting gap closure (ZIP-148 Phase 1)
                                    const gapNote = `Step created by closing Process Gap. [View Gap Details: gap://${item._closingGapId}]`
                                    const currentNotes = newStep.notes || ''
                                    const updatedNotes = currentNotes
                                      ? `${currentNotes}\n\n${gapNote}`
                                      : gapNote

                                    await updateStepInStore(newStep.id, {
                                      notes: updatedNotes
                                    }, projectId)
                                    const chainGapsCreated: string[] = []

                                    // Helper: Check if validation has chain issues
                                    const hasChainIssues = (validation: ReturnType<typeof validateStep>) => {
                                      return validation.issues.some(issue =>
                                        issue.includes('not matched in next step') ||
                                        issue.includes('does not match input in next step') ||
                                        issue.includes('does not match output in previous step')
                                      )
                                    }

                                    // Get chain-specific issues
                                    const getChainIssues = (validation: ReturnType<typeof validateStep>) => {
                                      return validation.issues.filter(issue =>
                                        issue.includes('not matched in next step') ||
                                        issue.includes('does not match input in next step') ||
                                        issue.includes('does not match output in previous step')
                                      )
                                    }

                                    // Validate the new step for chain issues
                                    const newStepValidation = validateStep(newStep, allSteps, milestoneById)
                                    if (!newStepValidation.isValid && hasChainIssues(newStepValidation)) {
                                      const chainIssues = getChainIssues(newStepValidation)
                                      // Create gap for chain break in the new step
                                      await createGapInStore({
                                        projectId,
                                        stepId: newStep.id,
                                        missingField: 'customer', // Chain break
                                        observed: `Chain break: ${chainIssues.join(', ')}`,
                                        expected: 'Outputs should match next step inputs, Customers should match next step suppliers',
                                        severity: 'H',
                                        priority: 1,
                                        status: 'Open',
                                        links: [],
                                      })
                                      chainGapsCreated.push(`Step ${positionOf(newStep)}`)
                                    }

                                    const prevStep = inMilestone(effectiveItem.order - 1)
                                    if (prevStep) {
                                      const prevValidation = validateStep(prevStep, allSteps, milestoneById)
                                      if (!prevValidation.isValid && hasChainIssues(prevValidation)) {
                                        const chainIssues = getChainIssues(prevValidation)
                                        // Check if gap already exists for this step.
                                        // From the store, not the render-time
                                        // `gaps` prop: this handler has already
                                        // closed a gap and reloaded them, and a
                                        // closure captured at render sees none
                                        // of it (#261).
                                        const existingGap = useGapsStore.getState().gaps.find(g =>
                                          g.stepId === prevStep.id &&
                                          g.status === 'Open' &&
                                          g.observed?.includes('Chain break')
                                        )

                                        if (!existingGap) {
                                          await createGapInStore({
                                            projectId,
                                            stepId: prevStep.id,
                                            missingField: 'customer',
                                            observed: `Chain break: ${chainIssues.join(', ')}`,
                                            expected: 'Outputs should match next step inputs, Customers should match next step suppliers',
                                            severity: 'H',
                                            priority: 1,
                                            status: 'Open',
                                            links: [],
                                          })
                                          chainGapsCreated.push(`Step ${positionOf(prevStep)}`)
                                        }
                                      }
                                    }

                                    const nextStep = inMilestone(effectiveItem.order + 1)
                                    if (nextStep) {
                                      const nextValidation = validateStep(nextStep, allSteps, milestoneById)
                                      if (!nextValidation.isValid && hasChainIssues(nextValidation)) {
                                        const chainIssues = getChainIssues(nextValidation)
                                        // Check if gap already exists for this
                                        // step, off the store for the same
                                        // reason as the previous step above
                                        // (#261).
                                        const existingGap = useGapsStore.getState().gaps.find(g =>
                                          g.stepId === nextStep.id &&
                                          g.status === 'Open' &&
                                          g.observed?.includes('Chain break')
                                        )

                                        if (!existingGap) {
                                          await createGapInStore({
                                            projectId,
                                            stepId: nextStep.id,
                                            missingField: 'supplier',
                                            observed: `Chain break: ${chainIssues.join(', ')}`,
                                            expected: 'Suppliers should match previous step customers, Inputs should match previous step outputs',
                                            severity: 'H',
                                            priority: 1,
                                            status: 'Open',
                                            links: [],
                                          })
                                          chainGapsCreated.push(`Step ${positionOf(nextStep)}`)
                                        }
                                      }
                                    }

                                    // Show appropriate toast message
                                    if (chainGapsCreated.length > 0) {
                                      toast.success(`Gap closed • ${chainGapsCreated.length} chain gap${chainGapsCreated.length > 1 ? 's' : ''} created (${chainGapsCreated.join(', ')})`, {
                                        duration: 5000
                                      })
                                      // Reload gaps to show new chain gaps
                                      await useGapsStore.getState().loadGaps(projectId)
                                    } else {
                                      toast.success('Step created • Gap closed')
                                    }
                                  }
                                }

                                // Check if full SIPOC validation failed (incomplete step)
                                if (!fullValidation.isValid) {
                                  // Get the newly created step
                                  const storeStepsNow = useStepsStore.getState().steps
                                  const savedStep = storeStepsNow.find(s => s.id === createdStepId)

                                  if (savedStep) {
                                    // Check for existing gap off the store, for the same reason as the chain
                                    // lookups above (#261) — but excluding chain gaps, so this kind-agnostic
                                    // completeness check can't adopt the chain gap just raised on this step.
                                    const existingGap = useGapsStore.getState().gaps.find(g =>
                                      g.stepId === savedStep.id &&
                                      g.status === 'Open' &&
                                      !g.observed?.includes('Chain break')
                                    )

                                    if (existingGap) {
                                      // Update existing gap
                                      await updateGapInStore(existingGap.id, {
                                        missingField: fullValidation.missingFields[0] as MissingFieldType,
                                        observed: `Missing ${fullValidation.missingFields.join(', ')}`,
                                        expected: 'All SIPOC fields should be complete',
                                      }, projectId)
                                      // Only show toast if we didn't already show "Gap closed"
                                      if (!item._closingGapId) {
                                        toast.success('Step created • Gap updated with missing fields')
                                      }
                                    } else {
                                      // Create new gap
                                      await createGapInStore({
                                        projectId,
                                        stepId: savedStep.id,
                                        missingField: fullValidation.missingFields[0] as MissingFieldType,
                                        observed: `Missing ${fullValidation.missingFields.join(', ')}`,
                                        expected: 'All SIPOC fields should be complete',
                                        severity: 'M',
                                        priority: 2,
                                        status: 'Open',
                                        links: [],
                                      })
                                      // Only show toast if we didn't already show "Gap closed"
                                      if (!item._closingGapId) {
                                        toast.success('Step created • Gap created for incomplete SIPOC')
                                      }
                                    }
                                  }
                                } else if (!item._closingGapId) {
                                  // Only show generic toast if we didn't already show "Gap closed"
                                  const storeStepsNow = useStepsStore.getState().steps
                                  const savedStep = storeStepsNow.find(s => s.id === createdStepId)
                                  const livePositions =
                                    displayNumbers === null
                                      ? null
                                      : processPositions(
                                          storeStepsNow,
                                          useGapsStore.getState().gaps,
                                          useStepsStore.getState().milestones
                                        )
                                  const position = savedStep
                                    ? livePositions?.get(savedStep.id) ?? savedStep.order
                                    : effectiveItem.order
                                  toast.success(`Step saved at position ${position}`)
                                }

                                // Last, once every write above has landed. The
                                // closing-gap path is the one that needs it: the
                                // gap leaves the sequence when it goes Closed,
                                // and the new step has taken its position, so
                                // without this the milestone keeps a hole where
                                // the pair used to straddle (#353 clause 9). On
                                // every other path the milestone is already
                                // dense and the reseal writes nothing at all.
                                await resealAfterMutation({
                                  projectId,
                                  milestoneIds: [effectiveItem.milestoneId],
                                })
                              } catch (error) {
                                console.error('Failed to create step:', error)
                                toast.error('Failed to create step')
                              }
                            }}
                            disabled={!validation.isValid}
                            className="btn-primary flex items-center gap-gs-2"
                          >
                            <Check className="w-4 h-4" />
                            Save Step
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </td>
              </tr>
            )}

            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>

    {/* Scroll indicator */}
    {isScrollable && !scrolledToEnd && (
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
        <div className="bg-white/90 backdrop-blur rounded-l-lg px-2 py-8 shadow-lg animate-pulse">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    )}
    </div>
  )
}
