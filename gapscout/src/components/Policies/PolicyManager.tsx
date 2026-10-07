import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { RegistryPanel } from '../shared/RegistryPanel'
import { EmptyState } from '../shared/EmptyState'
import { ConfirmModal } from '../shared/ConfirmModal'
import toast from 'react-hot-toast'
import { usePoliciesStore } from '../../state/policiesStore'
import { useStepsStore } from '../../state/stepsStore'
import type { Policy, Milestone } from '../../data/types'
import { Empty } from '../shared/Empty'

interface PolicyManagerProps {
  projectId: string
}

export default function PolicyManager({ projectId }: PolicyManagerProps) {
  const { policies, isLoading, addPolicy, updatePolicy, deletePolicy } = usePoliciesStore()
  const { milestones } = useStepsStore()
  const [showAddEditModal, setShowAddEditModal] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Policy | null>(null)

  const milestoneNameById = (id: string) => milestones.find((m) => m.id === id)?.name ?? 'Unknown'

  const handleAddPolicy = () => {
    setEditingPolicy(null)
    setShowAddEditModal(true)
  }

  const handleEditPolicy = (policy: Policy) => {
    setEditingPolicy(policy)
    setShowAddEditModal(true)
  }

  const handleDeletePolicy = async (policy: Policy) => {
    try {
      await deletePolicy(policy.id, projectId)
      setShowDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete policy:', error)
      toast.error('Failed to delete policy')
    }
  }

  const handleSavePolicy = async (policyData: {
    title: string
    content: string
    sourceDoc?: string
    relatedMilestones: string[]
    testNotes?: string
    tags: string[]
  }) => {
    try {
      if (editingPolicy) {
        await updatePolicy(editingPolicy.id, policyData, projectId)
      } else {
        await addPolicy({ projectId, ...policyData })
      }
      setShowAddEditModal(false)
      setEditingPolicy(null)
    } catch (error) {
      console.error('Failed to save policy:', error)
      throw error
    }
  }

  return (
    <>
      <RegistryPanel
        title="Policies"
        description="Capture business rules and compliance requirements that govern process steps"
        action={
          <button
            onClick={handleAddPolicy}
            className="btn-primary inline-flex items-center gap-gs-2"
          >
            <Plus size={16} strokeWidth={2} />
            Add Policy
          </button>
        }
        summary={<>{policies.length} polic{policies.length !== 1 ? 'ies' : 'y'}</>}
      >
        <>
            {isLoading ? (
              <EmptyState
                kind="loading"
                title="Opening the policy register"
                message="Reading policies from the local database."
              />
            ) : policies.length === 0 ? (
              <EmptyState
                title="No policies yet"
                message="Policies are the business rules a process has to obey. Add the first one and you can attach it to a milestone."
                action={
                  <button
                    className="btn-primary inline-flex items-center gap-gs-2"
                    onClick={handleAddPolicy}
                  >
                    <Plus size={16} strokeWidth={2} />
                    Add Your First Policy
                  </button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full tbl">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Related Milestones</th>
                      <th>Tags</th>
                      <th className="w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((policy) => (
                      <tr key={policy.id}>
                        <td>
                          <div className="font-medium" style={{ color: 'var(--color-deep-navy)' }}>
                            {policy.title}
                          </div>
                          {policy.sourceDoc && (
                            <div className="text-xs text-gray-500 mt-1 truncate max-w-md" title={policy.sourceDoc}>
                              {policy.sourceDoc}
                            </div>
                          )}
                        </td>
                        <td>
                          {policy.relatedMilestones.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {policy.relatedMilestones.map((id) => (
                                <span key={id} className="badge-blue text-xs">
                                  {milestoneNameById(id)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <Empty />
                          )}
                        </td>
                        <td>
                          {policy.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {policy.tags.map((tag, idx) => (
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
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleEditPolicy(policy)}
                              className="text-gray-600 hover:text-gray-900 p-1"
                              title="Edit policy"
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
                            <button
                              onClick={() => setShowDeleteConfirm(policy)}
                              className="text-red-600 hover:text-red-900 p-1"
                              title="Delete policy"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
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

      {showAddEditModal && (
        <AddEditPolicyModal
          isOpen={showAddEditModal}
          onClose={() => {
            setShowAddEditModal(false)
            setEditingPolicy(null)
          }}
          onSave={handleSavePolicy}
          policy={editingPolicy}
          milestones={milestones}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmModal
          isOpen={!!showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(null)}
          title="Delete Policy?"
          description={
            <p>
              Are you sure you want to delete the policy{' '}
              <strong>"{showDeleteConfirm.title}"</strong>?
            </p>
          }
          confirmAction={{
            label: 'Delete Policy',
            style: 'danger',
            onClick: () => handleDeletePolicy(showDeleteConfirm),
          }}
        />
      )}
    </>
  )
}

interface AddEditPolicyModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: {
    title: string
    content: string
    sourceDoc?: string
    relatedMilestones: string[]
    testNotes?: string
    tags: string[]
  }) => Promise<void>
  policy: Policy | null
  milestones: Milestone[]
}

function AddEditPolicyModal({ isOpen, onClose, onSave, policy, milestones }: AddEditPolicyModalProps) {
  const [title, setTitle] = useState(policy?.title || '')
  const [content, setContent] = useState(policy?.content || '')
  const [sourceDoc, setSourceDoc] = useState(policy?.sourceDoc || '')
  const [selectedMilestones, setSelectedMilestones] = useState<string[]>(policy?.relatedMilestones || [])
  const [testNotes, setTestNotes] = useState(policy?.testNotes || '')
  const [tagsInput, setTagsInput] = useState(policy?.tags.join(', ') || '')
  const [isSaving, setIsSaving] = useState(false)

  const toggleMilestone = (id: string) => {
    setSelectedMilestones((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Policy title is required')
      return
    }
    if (!content.trim()) {
      toast.error('Policy content is required')
      return
    }

    try {
      setIsSaving(true)
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      await onSave({
        title: title.trim(),
        content: content.trim(),
        sourceDoc: sourceDoc.trim(),
        relatedMilestones: selectedMilestones,
        testNotes: testNotes.trim(),
        tags,
      })

      onClose()
    } catch (error) {
      console.error('Failed to save policy:', error)
      toast.error('Failed to save policy')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={policy ? 'Edit Policy' : 'Add Policy'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!title.trim() || !content.trim() || isSaving}
          >
            {isSaving ? 'Saving...' : policy ? 'Save Changes' : 'Add Policy'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-gs-4">
            <div>
              <label className="label-field">Title *</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., Single-approver under $10k"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="label-field">Content *</label>
              <textarea
                className="textarea-field w-full"
                rows={5}
                placeholder="State the policy rule or requirement..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Source Doc (Optional)</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="URL or document reference"
                value={sourceDoc}
                onChange={(e) => setSourceDoc(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Related Milestones (Optional)</label>
              {milestones.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No milestones in this project yet.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                  {milestones.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                      <input
                        type="checkbox"
                        checked={selectedMilestones.includes(m.id)}
                        onChange={() => toggleMilestone(m.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{m.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="label-field">Test Notes (Optional)</label>
              <textarea
                className="textarea-field w-full"
                rows={3}
                placeholder="How to verify compliance..."
                value={testNotes}
                onChange={(e) => setTestNotes(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Tags (Optional)</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., compliance, finance"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Separate multiple tags with commas</p>
            </div>
      </div>
    </Modal>
  )
}
