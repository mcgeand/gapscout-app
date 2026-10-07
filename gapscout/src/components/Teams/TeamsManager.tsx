/**
 * Teams Manager - CRUD interface for managing project teams
 * 
 * Features:
 * - Table view with color swatches, names, descriptions
 * - Add/Edit team modal with color picker
 * - Delete with confirmation (checks for step dependencies)
 * - Show step count per team
 * 
 * Note: Drag-and-drop reordering deferred for now (can be added later)
 * 
 * References: PRD Section 4.3.1 - Teams Manager
 */

import { useState, useMemo, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { RegistryPanel } from '../shared/RegistryPanel'
import { EmptyState } from '../shared/EmptyState'
import { ConfirmModal } from '../shared/ConfirmModal'
import { useTeamsStore } from '../../state/teamsStore'
import { useStepsStore } from '../../state/stepsStore'
import { getTeamUsageCount, getTeamReferenceCount } from '../../services/db'
import { DEFAULT_COLORS } from '../../data/constants'
import type { Team } from '../../data/types'
import { Empty } from '../shared/Empty'

interface TeamsManagerProps {
  projectId: string
}

/** Steps that own the team through `steps.team_id`; the FK is RESTRICT, so this is a block. */
function ownedSentence(count: number): string {
  return count === 1
    ? 'This team owns 1 step; deleting it is blocked until that step is reassigned.'
    : `This team owns ${count} steps; deleting it is blocked until they are reassigned.`
}

/** Steps that only name the team in suppliers or customers; those names survive the delete. */
function referencedSentence(count: number): string {
  return count === 1
    ? '1 step names this team as a supplier or customer and will keep the name after it is deleted.'
    : `${count} steps name this team as a supplier or customer and will keep the name after it is deleted.`
}

export default function TeamsManager({ projectId }: TeamsManagerProps) {
  const { teams, isLoading, addTeam, updateTeam, deleteTeam } = useTeamsStore()
  const { steps } = useStepsStore()
  const [showAddEditModal, setShowAddEditModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Team | null>(null)
  const [deleteCounts, setDeleteCounts] = useState<
    { teamId: string; owned: number; referenced: number } | null
  >(null)
  const stepCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const step of steps) counts[step.teamId] = (counts[step.teamId] || 0) + 1
    return counts
  }, [steps])

  // Both counts, asked when the dialog opens. `stepCounts` above answers only
  // the owner half (steps.team_id) and it is the table's column; the second
  // half — steps that name the team in suppliers or customers — lives in the
  // JSON columns and only SQL can see it (#173).
  const confirmTeamId = showDeleteConfirm?.id
  const confirmTeamName = showDeleteConfirm?.name
  useEffect(() => {
    if (!confirmTeamId || !confirmTeamName) return
    let cancelled = false
    void Promise.all([
      getTeamUsageCount(confirmTeamId, projectId),
      getTeamReferenceCount(confirmTeamName, projectId),
    ])
      .then(([owned, referenced]) => {
        if (!cancelled) setDeleteCounts({ teamId: confirmTeamId, owned, referenced })
      })
      .catch((error) => {
        console.error('Failed to count team references:', error)
        if (!cancelled) setDeleteCounts(null)
      })
    return () => {
      cancelled = true
    }
  }, [confirmTeamId, confirmTeamName, projectId])

  // Carries its own team id so a dialog reopened on a different team shows
  // nothing rather than the previous team's counts while the query is in
  // flight. Reading it this way keeps the effect free of a synchronous reset.
  const confirmCounts = deleteCounts?.teamId === confirmTeamId ? deleteCounts : null

  const handleAddTeam = () => {
    setEditingTeam(null)
    setShowAddEditModal(true)
  }

  const handleEditTeam = (team: Team) => {
    setEditingTeam(team)
    setShowAddEditModal(true)
  }

  const handleDeleteTeam = async (team: Team) => {
    try {
      await deleteTeam(team.id, projectId)
      setShowDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete team:', error)
      toast.error('Failed to delete team')
    }
  }

  const handleSaveTeam = async (teamData: {
    name: string
    color: string
    description?: string
    tags?: string[]
  }) => {
    try {
      if (editingTeam) {
        // Update existing team
        await updateTeam(editingTeam.id, teamData, projectId)
      } else {
        // Create new team
        await addTeam({
          projectId,
          ...teamData,
          tags: teamData.tags || [],
        })
      }
      
      setShowAddEditModal(false)
      setEditingTeam(null)
    } catch (error) {
      console.error('Failed to save team:', error)
      throw error
    }
  }

  return (
    <>
      <RegistryPanel
        title="Teams"
        description="Define the teams that own process steps"
        action={
          <button onClick={handleAddTeam} className="btn-primary inline-flex items-center gap-gs-2">
            <Plus size={16} strokeWidth={2} />
            Add Team
          </button>
        }
        summary={
          <>
            {teams.length} team{teams.length !== 1 ? 's' : ''} •{' '}
            {Object.values(stepCounts).reduce((sum, count) => sum + count, 0)} total steps
          </>
        }
      >
        <>
            {isLoading ? (
              <EmptyState
                kind="loading"
                title="Opening the team registry"
                message="Reading teams from the local database."
              />
            ) : teams.length === 0 ? (
              <EmptyState
                title="No teams yet"
                message="Teams say who owns which process step. Add the first one and it becomes selectable on every step."
                action={
                  <button
                    className="btn-primary inline-flex items-center gap-gs-2"
                    onClick={handleAddTeam}
                  >
                    <Plus size={16} strokeWidth={2} />
                    Add Your First Team
                  </button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full tbl">
                  <thead>
                    <tr>
                      <th className="w-12">Color</th>
                      <th>Name</th>
                      <th>Description</th>
                      <th>Tags</th>
                      <th className="w-24">Steps</th>
                      <th className="w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((team) => (
                      <tr key={team.id}>
                        <td>
                          <div
                            className="w-8 h-8 rounded-full border-2 border-gray-200"
                            style={{ backgroundColor: team.color }}
                            title={team.color}
                          />
                        </td>
                        <td>
                          <span className="font-medium" style={{ color: 'var(--color-deep-navy)' }}>
                            {team.name}
                          </span>
                        </td>
                        <td>
                          {team.description || <Empty />}
                        </td>
                        <td>
                          {team.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {team.tags.map((tag, idx) => (
                                <span key={idx} className="badge-gray text-xs">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <Empty />
                          )}
                        </td>
                        <td>
                          <span className="badge-blue text-xs">
                            {stepCounts[team.id] || 0} steps
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleEditTeam(team)}
                              className="text-gray-600 hover:text-gray-900 p-1"
                              title="Edit team"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(team)}
                              className="text-red-600 hover:text-red-900 p-1"
                              title="Delete team"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      </RegistryPanel>

      {/* Add/Edit Team Modal */}
      {showAddEditModal && (
        <AddEditTeamModal
          isOpen={showAddEditModal}
          onClose={() => {
            setShowAddEditModal(false)
            setEditingTeam(null)
          }}
          onSave={handleSaveTeam}
          team={editingTeam}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <ConfirmModal
          isOpen={!!showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(null)}
          title="Delete Team?"
          description={
            <>
              <p>
                Are you sure you want to delete the team{' '}
                <strong>"{showDeleteConfirm.name}"</strong>?
              </p>
              {confirmCounts && confirmCounts.owned > 0 && (
                <p className="mt-gs-3">{ownedSentence(confirmCounts.owned)}</p>
              )}
              {confirmCounts && confirmCounts.referenced > 0 && (
                <p className="mt-gs-3">{referencedSentence(confirmCounts.referenced)}</p>
              )}
            </>
          }
          confirmAction={{
            label: 'Delete Team',
            style: 'danger',
            onClick: () => handleDeleteTeam(showDeleteConfirm),
          }}
        />
      )}
    </>
  )
}

// ============================================================================
// Add/Edit Team Modal
// ============================================================================

interface AddEditTeamModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: { name: string; color: string; description?: string; tags?: string[] }) => Promise<void>
  team: Team | null
}

function AddEditTeamModal({ isOpen, onClose, onSave, team }: AddEditTeamModalProps) {
  const [name, setName] = useState(team?.name || '')
  const [color, setColor] = useState(team?.color || DEFAULT_COLORS[0])
  const [description, setDescription] = useState(team?.description || '')
  const [tagsInput, setTagsInput] = useState(team?.tags.join(', ') || '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Team name is required')
      return
    }

    try {
      setIsSaving(true)
      const tags = tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)

      await onSave({
        name: name.trim(),
        color,
        description: description.trim() || undefined,
        tags,
      })

      onClose()
    } catch (error) {
      console.error('Failed to save team:', error)
      toast.error('Failed to save team')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={team ? 'Edit Team' : 'Add Team'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? 'Saving...' : team ? 'Save Changes' : 'Add Team'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-gs-4">
            <div>
              <label className="label-field">Team Name *</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., Marketing, Engineering, Sales"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="label-field">Color *</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-20 rounded border border-gray-300 cursor-pointer"
                />
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        color === c ? 'border-gray-900 scale-110' : 'border-gray-300 hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Current: {color}
              </p>
            </div>

            <div>
              <label className="label-field">Description (Optional)</label>
              <textarea
                className="textarea-field w-full"
                rows={3}
                placeholder="Brief description of this team's role..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Tags (Optional)</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., Customer-facing, Back-office"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
              <p className="text-xs text-gs-ink-muted mt-gs-1">
                Separate multiple tags with commas
              </p>
            </div>
      </div>
    </Modal>
  )
}
