import { useState } from 'react'
import toast from 'react-hot-toast'
import MilestonesTabs, { AddMilestoneModal } from './MilestonesTabs'
import { createMilestone } from '../../services/db'
import type { Milestone } from '../../data/types'

interface MilestoneManagerProps {
  projectId: string
  milestones: Milestone[]
  activeMilestoneId: string | null
  onSelectMilestone: (id: string | null) => void
  onMilestoneCreated: () => void | Promise<void>
}

export function MilestoneManager({
  projectId,
  milestones,
  activeMilestoneId,
  onSelectMilestone,
  onMilestoneCreated,
}: MilestoneManagerProps) {
  const [showAddModal, setShowAddModal] = useState(false)

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
      await onMilestoneCreated()
    } catch (error) {
      console.error('Failed to create milestone:', error)
      throw error
    }
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <MilestonesTabs
          milestones={milestones}
          activeMilestoneId={activeMilestoneId}
          onSelectMilestone={onSelectMilestone}
          onAddMilestone={() => setShowAddModal(true)}
        />
      </div>
      <AddMilestoneModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddMilestone}
        existingMilestones={milestones}
      />
    </>
  )
}
