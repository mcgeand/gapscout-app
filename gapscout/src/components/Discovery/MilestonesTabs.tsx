/**
 * Milestone filter as an ink segmented control (#209).
 *
 * One 2px rule box: All steps · each milestone · +. Active segment is ink /
 * on-ink (not accent — that job is primary action / high severity). The strip
 * filters and opens the add modal; the active milestone's own row below it
 * carries Edit and Delete (#106).
 */

import { useState } from 'react'
import { Plus, SquarePen, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Milestone } from '../../data/types'
import { milestoneWriteMessage } from '../../lib/milestoneWriteMessage'
import { Modal } from '../shared/Modal'

interface MilestonesTabsProps {
  milestones: Milestone[]
  activeMilestoneId: string | null // null = "All"
  onSelectMilestone: (milestoneId: string | null) => void
  onAddMilestone: () => void
  /** Opens the edit dialog for the active milestone. Omit to hide the control. */
  onEditMilestone?: (milestone: Milestone) => void
  /** Starts the delete flow for the active milestone. Omit to hide the control. */
  onDeleteMilestone?: (milestone: Milestone) => void
}

export default function MilestonesTabs({
  milestones,
  activeMilestoneId,
  onSelectMilestone,
  onAddMilestone,
  onEditMilestone,
  onDeleteMilestone,
}: MilestonesTabsProps) {
  const sortedMilestones = [...milestones].sort((a, b) => a.order - b.order)
  const active =
    activeMilestoneId !== null
      ? milestones.find((m) => m.id === activeMilestoneId)
      : undefined

  return (
    <div className="flex flex-col gap-gs-2">
      <div className="seg seg-ink overflow-x-auto">
        <div className="inline-flex" role="radiogroup" aria-label="Milestone filter">
          <label className="seg-option">
            <input
              type="radio"
              className="sr-only"
              name="milestone-filter"
              checked={activeMilestoneId === null}
              onChange={() => onSelectMilestone(null)}
            />
            <span className="seg-face whitespace-nowrap">All steps</span>
          </label>

          {sortedMilestones.map((milestone) => (
            <label key={milestone.id} className="seg-option" title={milestone.description || undefined}>
              <input
                type="radio"
                className="sr-only"
                name="milestone-filter"
                checked={activeMilestoneId === milestone.id}
                onChange={() => onSelectMilestone(milestone.id)}
              />
              <span className="seg-face whitespace-nowrap">{milestone.name}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          className="seg-add"
          onClick={onAddMilestone}
          title="Add new milestone"
          aria-label="Add new milestone"
        >
          <Plus size={16} strokeWidth={2} />
        </button>
      </div>

      {active && (
        <div className="flex flex-wrap items-start justify-between gap-gs-3">
          <div className="min-w-0 flex-1 text-sm text-gs-ink-muted">
            {active.description && <p>{active.description}</p>}
            {active.relatedPolicies.length > 0 && (
              <div className="mt-gs-1 flex flex-wrap items-center gap-gs-2">
                <span>Policies:</span>
                {active.relatedPolicies.map((policy) => (
                  <span key={policy} className="badge-gray text-xs">
                    {policy}
                  </span>
                ))}
              </div>
            )}
          </div>

          {(onEditMilestone || onDeleteMilestone) && (
            <div className="flex shrink-0 items-center gap-gs-2">
              {onEditMilestone && (
                <button
                  type="button"
                  className="btn-ghost inline-flex items-center gap-gs-2 px-gs-2 py-gs-1"
                  onClick={() => onEditMilestone(active)}
                  title={`Edit milestone "${active.name}"`}
                  aria-label={`Edit milestone ${active.name}`}
                >
                  <SquarePen size={16} strokeWidth={2} />
                  <span>Edit</span>
                </button>
              )}
              {onDeleteMilestone && (
                <button
                  type="button"
                  className="btn-ghost inline-flex items-center gap-gs-2 px-gs-2 py-gs-1"
                  onClick={() => onDeleteMilestone(active)}
                  title={`Delete milestone "${active.name}"`}
                  aria-label={`Delete milestone ${active.name}`}
                >
                  <Trash2 size={16} strokeWidth={2} />
                  <span>Delete</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Add Milestone Modal - Simple modal for creating new milestones
 */
interface AddMilestoneModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (name: string, description?: string) => Promise<void>
  existingMilestones: Milestone[]
}

export function AddMilestoneModal({
  isOpen,
  onClose,
  onSave,
  existingMilestones,
}: AddMilestoneModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Milestone name is required')
      return
    }

    try {
      setIsSaving(true)
      await onSave(name.trim(), description.trim() || undefined)

      setName('')
      setDescription('')
      onClose()
    } catch (error) {
      console.error('Failed to create milestone:', error)
      // The order this modal's caller computes comes from a React prop, so it
      // can be one snapshot behind the database — which makes this the one path
      // that actually produces a `MilestoneOrderConflictError`. Showing the
      // generic line here would hide the only sentence that says what happened.
      toast.error(milestoneWriteMessage(error, 'Failed to create milestone'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setName('')
    setDescription('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Add Milestone"
      description="Milestones organize your process into logical phases"
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? 'Creating...' : 'Create Milestone'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-gs-4">
        <div>
          <label className="label-field">Milestone Name *</label>
          <input
            type="text"
            className="input-field w-full"
            placeholder="e.g., Discovery, Planning, Execution"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                handleSave()
              }
            }}
            autoFocus
          />
          <p className="mt-gs-1 text-xs text-gs-ink-muted">
            Current order: {existingMilestones.length + 1}
          </p>
        </div>

        <div>
          <label className="label-field">Description (Optional)</label>
          <textarea
            className="textarea-field w-full"
            rows={3}
            placeholder="Brief description of this phase..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {existingMilestones.length > 0 && (
          <div>
            <label className="label-field">Existing Milestones</label>
            <div className="flex flex-wrap gap-gs-2">
              {existingMilestones
                .sort((a, b) => a.order - b.order)
                .map((m) => (
                  <span key={m.id} className="badge-gray text-xs">
                    {m.order + 1}. {m.name}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * Edit Milestone Modal (#106) - name and description only.
 *
 * Order is deliberately not editable here: milestone order is UNIQUE per
 * project (#131) and a move is a swap, which only `reorderMilestones` can
 * express. Related policies are left exactly as stored; nothing in this
 * dialog sends them, so an edit cannot drop them.
 *
 * Mounted with a `key` of the milestone id by the caller, so the fields seed
 * from the milestone once per opening rather than through an effect.
 */
interface EditMilestoneModalProps {
  isOpen: boolean
  onClose: () => void
  milestone: Milestone
  onSave: (name: string, description: string) => Promise<void>
}

export function EditMilestoneModal({
  isOpen,
  onClose,
  milestone,
  onSave,
}: EditMilestoneModalProps) {
  const [name, setName] = useState(milestone.name)
  const [description, setDescription] = useState(milestone.description ?? '')
  const [isSaving, setIsSaving] = useState(false)

  const canSave = name.trim().length > 0 && !isSaving

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Milestone name is required')
      return
    }

    try {
      setIsSaving(true)
      await onSave(name.trim(), description.trim())
      onClose()
    } catch (error) {
      console.error('Failed to update milestone:', error)
      toast.error(milestoneWriteMessage(error, 'Failed to update milestone'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSaving ? () => {} : onClose}
      title="Edit Milestone"
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={!canSave}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-gs-4">
        <div>
          <label className="label-field" htmlFor="edit-milestone-name">
            Milestone Name *
          </label>
          <input
            id="edit-milestone-name"
            type="text"
            className="input-field w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) {
                handleSave()
              }
            }}
            autoFocus
          />
        </div>

        <div>
          <label className="label-field" htmlFor="edit-milestone-description">
            Description (Optional)
          </label>
          <textarea
            id="edit-milestone-description"
            className="textarea-field w-full"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  )
}
