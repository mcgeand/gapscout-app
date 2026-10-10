import { useState } from 'react'
import toast from 'react-hot-toast'
import MilestonesTabs, { AddMilestoneModal, EditMilestoneModal } from './MilestonesTabs'
import { ConfirmModal } from '../shared/ConfirmModal'
import { createMilestone, getMilestoneUsageCount, updateMilestone } from '../../services/db'
import type { MilestoneUsage } from '../../services/db'
import { describeMilestoneUsage, isMilestoneInUse } from '../../lib/milestoneUsage'
import { useStepsStore } from '../../state/stepsStore'
import type { Milestone } from '../../data/types'

interface MilestoneManagerProps {
  projectId: string
  milestones: Milestone[]
  activeMilestoneId: string | null
  onSelectMilestone: (id: string | null) => void
  /**
   * Called after any milestone write (create, edit, delete) so the caller can
   * re-read the list (#106).
   */
  onMilestonesChanged: () => void | Promise<void>
}

/** A delete the user has asked for, with the usage read before asking. */
interface PendingDelete {
  milestone: Milestone
  usage: MilestoneUsage
}

export function MilestoneManager({
  projectId,
  milestones,
  activeMilestoneId,
  onSelectMilestone,
  onMilestonesChanged,
}: MilestoneManagerProps) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleAddMilestone = async (name: string, description?: string) => {
    try {
      const maxOrder =
        milestones.length > 0 ? Math.max(...milestones.map((m) => m.order)) : -1
      await createMilestone({
        projectId,
        name,
        order: maxOrder + 1,
        description,
        relatedPolicies: [],
      })
      toast.success(`Milestone "${name}" created`)
      await onMilestonesChanged()
    } catch (error) {
      console.error('Failed to create milestone:', error)
      throw error
    }
  }

  // Name and description only. `order` is left out on purpose so the UNIQUE
  // (project_id, "order") index (#131) is never in play, and `relatedPolicies`
  // is left out so an edit cannot clear them.
  const handleEditMilestone = async (name: string, description: string) => {
    if (!editing) return
    try {
      await updateMilestone(editing.id, { name, description }, projectId)
      toast.success('Milestone updated')
      await onMilestonesChanged()
    } catch (error) {
      console.error('Failed to update milestone:', error)
      throw error
    }
  }

  // Read the usage count first so the dialog can say what blocks the delete
  // instead of offering a button that only produces an error toast. The store
  // repeats the same check on the way through, so a step added between this
  // read and the confirm is still refused.
  const handleRequestDelete = async (milestone: Milestone) => {
    try {
      const usage = await getMilestoneUsageCount(milestone.id, projectId)
      setPendingDelete({ milestone, usage })
    } catch (error) {
      console.error('Failed to read milestone usage:', error)
      toast.error('Failed to check whether this milestone is in use')
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    const { milestone } = pendingDelete
    setIsDeleting(true)
    try {
      await useStepsStore.getState().deleteMilestone(milestone.id, projectId)
      await onMilestonesChanged()
      // The store reports failure with a toast and leaves the row in place, so
      // "still there" is the failure signal; only a real delete drops the tab
      // the user was looking at.
      const stillThere = useStepsStore.getState().milestones.some((m) => m.id === milestone.id)
      if (!stillThere && activeMilestoneId === milestone.id) {
        onSelectMilestone(null)
      }
    } finally {
      setIsDeleting(false)
      setPendingDelete(null)
    }
  }

  const blocked = pendingDelete !== null && isMilestoneInUse(pendingDelete.usage)

  return (
    <>
      <MilestonesTabs
        milestones={milestones}
        activeMilestoneId={activeMilestoneId}
        onSelectMilestone={onSelectMilestone}
        onAddMilestone={() => setShowAddModal(true)}
        onEditMilestone={setEditing}
        onDeleteMilestone={handleRequestDelete}
      />
      <AddMilestoneModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddMilestone}
        existingMilestones={milestones}
      />
      {editing && (
        <EditMilestoneModal
          key={editing.id}
          isOpen
          onClose={() => setEditing(null)}
          milestone={editing}
          onSave={handleEditMilestone}
        />
      )}
      {pendingDelete && (
        <ConfirmModal
          isOpen
          onClose={() => setPendingDelete(null)}
          title={blocked ? 'Cannot delete milestone' : 'Delete milestone?'}
          icon={blocked ? 'warning' : 'danger'}
          busy={isDeleting}
          cancelLabel={blocked ? 'Close' : 'Cancel'}
          description={
            blocked ? (
              <p>
                <strong>{pendingDelete.milestone.name}</strong> is used by{' '}
                {describeMilestoneUsage(pendingDelete.usage)}. Move or delete{' '}
                {pendingDelete.usage.steps + pendingDelete.usage.processGaps === 1
                  ? 'it'
                  : 'them'}{' '}
                first.
              </p>
            ) : (
              <p>
                Delete <strong>{pendingDelete.milestone.name}</strong>? No steps or process gaps use
                it. This cannot be undone.
              </p>
            )
          }
          confirmAction={
            blocked
              ? undefined
              : { label: 'Delete Milestone', style: 'danger', onClick: handleConfirmDelete }
          }
        />
      )}
    </>
  )
}
