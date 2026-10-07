/**
 * Milestones Tabs - Horizontal tabs for filtering steps by milestone
 * 
 * Features:
 * - Tab for each milestone
 * - "All" tab to show all steps
 * - Click tab to filter Discovery Grid
 * - "+" button to add new milestone
 * - Active tab highlighting
 * 
 * References: PRD Section 4.4 - Discovery Grid (Milestones Section)
 */

import { useState } from 'react'
import toast from 'react-hot-toast'
import type { Milestone } from '../../data/types'
import { milestoneWriteMessage } from '../../lib/milestoneWriteMessage'
import { Modal } from '../shared/Modal'

interface MilestonesTabsProps {
  milestones: Milestone[]
  activeMilestoneId: string | null // null = "All"
  onSelectMilestone: (milestoneId: string | null) => void
  onAddMilestone: () => void
}

export default function MilestonesTabs({
  milestones,
  activeMilestoneId,
  onSelectMilestone,
  onAddMilestone,
}: MilestonesTabsProps) {
  const [isHoveringAdd, setIsHoveringAdd] = useState(false)

  // Sort milestones by order
  const sortedMilestones = [...milestones].sort((a, b) => a.order - b.order)

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="px-6 py-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          {/* "All" Tab */}
          <button
            onClick={() => onSelectMilestone(null)}
            className={`btn-ghost whitespace-nowrap ${
              activeMilestoneId === null
                ? 'bg-gs-accent text-gs-on-accent'
                : 'hover:bg-gs-sunken'
            }`}
          >
            All Steps
          </button>

          {/* Milestone Tabs */}
          {sortedMilestones.map((milestone) => (
            <button
              key={milestone.id}
              onClick={() => onSelectMilestone(milestone.id)}
              className={`btn-ghost whitespace-nowrap ${
                activeMilestoneId === milestone.id
                  ? 'bg-gs-accent text-gs-on-accent'
                  : 'hover:bg-gs-sunken'
              }`}
              title={milestone.description || undefined}
            >
              {milestone.name}
            </button>
          ))}

          {/* Add Milestone Button */}
          <button
            onClick={onAddMilestone}
            onMouseEnter={() => setIsHoveringAdd(true)}
            onMouseLeave={() => setIsHoveringAdd(false)}
            className="px-3 py-2 rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-400 text-gray-500 hover:text-gray-700 font-medium text-sm transition-colors whitespace-nowrap flex items-center gap-2"
            title="Add new milestone"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            {isHoveringAdd && <span>New Milestone</span>}
          </button>
        </div>
      </div>

      {/* Active Milestone Info */}
      {activeMilestoneId !== null && (
        <div className="px-6 pb-3">
          {(() => {
            const active = milestones.find((m) => m.id === activeMilestoneId)
            if (!active) return null

            return (
              <div className="flex items-start gap-3 text-sm">
                <div className="flex-1">
                  {active.description && (
                    <p className="text-gray-600">{active.description}</p>
                  )}
                  {active.relatedPolicies.length > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-gray-500">Policies:</span>
                      <div className="flex flex-wrap gap-1">
                        {active.relatedPolicies.map((policy, idx) => (
                          <span key={idx} className="badge-blue text-xs">
                            {policy}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    // TODO: Implement edit milestone
                    toast('Edit milestone coming soon!')
                  }}
                  className="text-gray-400 hover:text-gray-600 p-1"
                  title="Edit milestone"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>
              </div>
            )
          })()}
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
      
      // Reset form
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
              <p className="text-xs text-gray-500 mt-1">
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

            {/* Preview existing milestones */}
            {existingMilestones.length > 0 && (
              <div>
                <label className="label-field">Existing Milestones</label>
                <div className="flex flex-wrap gap-2">
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

