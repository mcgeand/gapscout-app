/**
 * Systems Manager - CRUD interface for managing systems registry
 * 
 * Features:
 * - Table view with system names, types, vendors, usage counts
 * - Add/Edit system modal with type dropdown
 * - Delete with confirmation (checks for step dependencies)
 * - Show which steps use each system
 * 
 * References: PRD Section 4.3.2 - Systems Manager
 */

import { useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { RegistryPanel } from '../shared/RegistryPanel'
import { EmptyState } from '../shared/EmptyState'
import { ConfirmModal } from '../shared/ConfirmModal'
import { useSystemsStore } from '../../state/systemsStore'
import { useStepsStore } from '../../state/stepsStore'
import type { System, SystemType } from '../../data/types'
import { coerceEmptyToUndefined } from '../../lib/formUtils'
import { Empty } from '../shared/Empty'

interface SystemsManagerProps {
  projectId: string
}

const SYSTEM_TYPES: SystemType[] = ['ERP', 'CRM', 'WMS', 'Custom', 'Other']

export default function SystemsManager({ projectId }: SystemsManagerProps) {
  const { systems, isLoading, addSystem, updateSystem, deleteSystem } = useSystemsStore()
  const { steps } = useStepsStore()
  const [showAddEditModal, setShowAddEditModal] = useState(false)
  const [editingSystem, setEditingSystem] = useState<System | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<System | null>(null)
  const [showUsageModal, setShowUsageModal] = useState<System | null>(null)
  const { usageCounts, systemUsageDetails } = useMemo(() => {
    const counts: Record<string, number> = {}
    const details: Record<string, string[]> = {}
    for (const step of steps) {
      for (const systemName of step.systems) {
        counts[systemName] = (counts[systemName] || 0) + 1
        if (!details[systemName]) details[systemName] = []
        details[systemName].push(step.label)
      }
    }
    return { usageCounts: counts, systemUsageDetails: details }
  }, [steps])

  const handleAddSystem = () => {
    setEditingSystem(null)
    setShowAddEditModal(true)
  }

  const handleEditSystem = (system: System) => {
    setEditingSystem(system)
    setShowAddEditModal(true)
  }

  const handleDeleteSystem = async (system: System) => {
    try {
      await deleteSystem(system.id, projectId)
      setShowDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete system:', error)
      toast.error('Failed to delete system')
    }
  }

  const handleSaveSystem = async (systemData: {
    name: string
    description?: string
    vendor?: string
    type?: SystemType
    tags?: string[]
  }) => {
    try {
      if (editingSystem) {
        // Update existing system
        await updateSystem(editingSystem.id, systemData, projectId)
      } else {
        // Create new system
        await addSystem({
          projectId,
          ...systemData,
          tags: systemData.tags || [],
        })
      }
      
      setShowAddEditModal(false)
      setEditingSystem(null)
    } catch (error) {
      console.error('Failed to save system:', error)
      throw error
    }
  }

  const handleShowUsage = (system: System) => {
    setShowUsageModal(system)
  }

  return (
    <>
      <RegistryPanel
        title="Systems"
        description="Track tools and software used in your processes"
        action={
          <button
            onClick={handleAddSystem}
            className="btn-primary inline-flex items-center gap-gs-2"
          >
            <Plus size={16} strokeWidth={2} />
            Add System
          </button>
        }
        summary={
          <>
            {systems.length} system{systems.length !== 1 ? 's' : ''} •{' '}
            {Object.values(usageCounts).reduce((sum, count) => sum + count, 0)} total usages
          </>
        }
      >
        <>
            {isLoading ? (
              <EmptyState
                kind="loading"
                title="Opening the systems registry"
                message="Reading systems from the local database."
              />
            ) : systems.length === 0 ? (
              <EmptyState
                title="No systems yet"
                message="Systems record the tools a process runs on. Add the first one and it becomes selectable on every step."
                action={
                  <button
                    className="btn-primary inline-flex items-center gap-gs-2"
                    onClick={handleAddSystem}
                  >
                    <Plus size={16} strokeWidth={2} />
                    Add Your First System
                  </button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full tbl">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="w-32">Type</th>
                      <th className="w-40">Vendor</th>
                      <th>Description</th>
                      <th>Tags</th>
                      <th className="w-24">Usage</th>
                      <th className="w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {systems.map((system) => {
                      const usageCount = usageCounts[system.name] || 0
                      return (
                        <tr key={system.id}>
                          <td>
                            <span className="font-medium" style={{ color: 'var(--color-deep-navy)' }}>
                              {system.name}
                            </span>
                          </td>
                          <td>
                            {system.type ? (
                              <span className="badge-blue text-xs">
                                {system.type}
                              </span>
                            ) : (
                              <Empty />
                            )}
                          </td>
                          <td>
                            {system.vendor || <Empty />}
                          </td>
                          <td>
                            {system.description || <Empty />}
                          </td>
                          <td>
                            {system.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {system.tags.map((tag, idx) => (
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
                            {usageCount > 0 ? (
                              <button
                                onClick={() => handleShowUsage(system)}
                                className="badge-orange text-xs cursor-pointer hover:opacity-80"
                              >
                                {usageCount} step{usageCount !== 1 ? 's' : ''}
                              </button>
                            ) : (
                              <span className="badge-gray text-xs">
                                0 steps
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleEditSystem(system)}
                                className="text-gray-600 hover:text-gray-900 p-1"
                                title="Edit system"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setShowDeleteConfirm(system)}
                                className="text-red-600 hover:text-red-900 p-1"
                                title="Delete system"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </>
      </RegistryPanel>

      {/* Add/Edit System Modal */}
      {showAddEditModal && (
        <AddEditSystemModal
          isOpen={showAddEditModal}
          onClose={() => {
            setShowAddEditModal(false)
            setEditingSystem(null)
          }}
          onSave={handleSaveSystem}
          system={editingSystem}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <ConfirmModal
          isOpen={!!showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(null)}
          title="Delete System?"
          description={
            <>
              <p>
                Are you sure you want to delete the system{' '}
                <strong>"{showDeleteConfirm.name}"</strong>?
              </p>
              {(usageCounts[showDeleteConfirm.name] || 0) > 0 && (
                <p className="mt-gs-3">
                  This system is currently used by{' '}
                  <strong>{usageCounts[showDeleteConfirm.name]} step(s)</strong>. Deleting it may
                  cause data inconsistencies.
                </p>
              )}
            </>
          }
          confirmAction={{
            label: 'Delete System',
            style: 'danger',
            onClick: () => handleDeleteSystem(showDeleteConfirm),
          }}
        />
      )}

      {/* Usage Details Modal */}
      {showUsageModal && (
        <UsageDetailsModal
          isOpen={!!showUsageModal}
          onClose={() => setShowUsageModal(null)}
          system={showUsageModal}
          stepLabels={systemUsageDetails[showUsageModal.name] || []}
        />
      )}
    </>
  )
}

// ============================================================================
// Add/Edit System Modal
// ============================================================================

interface AddEditSystemModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: { name: string; description?: string; vendor?: string; type?: SystemType; tags?: string[] }) => Promise<void>
  system: System | null
}

function AddEditSystemModal({ isOpen, onClose, onSave, system }: AddEditSystemModalProps) {
  const [name, setName] = useState(system?.name || '')
  const [type, setType] = useState<SystemType | ''>(system?.type as SystemType || '')
  const [vendor, setVendor] = useState(system?.vendor || '')
  const [description, setDescription] = useState(system?.description || '')
  const [tagsInput, setTagsInput] = useState(system?.tags.join(', ') || '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('System name is required')
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
        type: coerceEmptyToUndefined(type),
        vendor: coerceEmptyToUndefined(vendor.trim()),
        description: coerceEmptyToUndefined(description.trim()),
        tags,
      })

      onClose()
    } catch (error) {
      console.error('Failed to save system:', error)
      toast.error('Failed to save system')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={system ? 'Edit System' : 'Add System'}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? 'Saving...' : system ? 'Save Changes' : 'Add System'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-gs-4">
            <div>
              <label className="label-field">System Name *</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., Salesforce, SAP, QuickBooks"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="label-field">Type</label>
              <select
                className="select-field w-full"
                value={type}
                onChange={(e) => setType(e.target.value as SystemType)}
              >
                <option value="">Select type...</option>
                {SYSTEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                ERP = Enterprise Resource Planning, CRM = Customer Relationship Management, WMS = Warehouse Management System
              </p>
            </div>

            <div>
              <label className="label-field">Vendor (Optional)</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., Microsoft, Oracle, Custom-built"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Description (Optional)</label>
              <textarea
                className="textarea-field w-full"
                rows={3}
                placeholder="Brief description of what this system does..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Tags (Optional)</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., Cloud, On-premise, API"
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

// ============================================================================
// Usage Details Modal
// ============================================================================

interface UsageDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  system: System
  stepLabels: string[]
}

function UsageDetailsModal({ isOpen, onClose, system, stepLabels }: UsageDetailsModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="System Usage"
      description={
        <>
          Steps using <strong>{system.name}</strong>
        </>
      }
      size="sm"
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-[13px] text-gs-ink-muted">
            {stepLabels.length} step{stepLabels.length !== 1 ? 's' : ''}
          </p>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {stepLabels.length === 0 ? (
        <p className="text-[13px] text-gs-ink-muted">No steps are using this system yet.</p>
      ) : (
        <ul className="flex flex-col gap-gs-2">
          {stepLabels.map((label, idx) => (
            <li key={idx} className="flex items-start gap-gs-2 text-[13px]">
              <span className="text-gs-ink-faint">•</span>
              <span className="text-gs-ink">{label}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

