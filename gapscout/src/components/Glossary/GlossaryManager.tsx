import { useState, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { RegistryPanel } from '../shared/RegistryPanel'
import { EmptyState } from '../shared/EmptyState'
import { ConfirmModal } from '../shared/ConfirmModal'
import toast from 'react-hot-toast'
import { useGlossaryStore } from '../../state/glossaryStore'
import { useStepsStore } from '../../state/stepsStore'
import type { GlossaryEntry, Step } from '../../data/types'
import { Empty } from '../shared/Empty'

interface GlossaryManagerProps {
  projectId: string
}

export default function GlossaryManager({ projectId }: GlossaryManagerProps) {
  const { entries, isLoading, addGlossaryEntry, updateGlossaryEntry, deleteGlossaryEntry } = useGlossaryStore()
  const { steps } = useStepsStore()
  const [showAddEditModal, setShowAddEditModal] = useState(false)
  const [editingEntry, setEditingEntry] = useState<GlossaryEntry | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<GlossaryEntry | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        e.definition.toLowerCase().includes(q) ||
        (e.acronym?.toLowerCase().includes(q) ?? false),
    )
  }, [entries, searchTerm])

  const handleAdd = () => {
    setEditingEntry(null)
    setShowAddEditModal(true)
  }

  const handleEdit = (entry: GlossaryEntry) => {
    setEditingEntry(entry)
    setShowAddEditModal(true)
  }

  const handleDelete = async (entry: GlossaryEntry) => {
    try {
      await deleteGlossaryEntry(entry.id, projectId)
      setShowDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete term:', error)
      toast.error('Failed to delete term')
    }
  }

  const handleSave = async (data: {
    term: string
    definition: string
    acronym?: string
    relatedSteps: string[]
    tags: string[]
  }) => {
    try {
      if (editingEntry) {
        await updateGlossaryEntry(editingEntry.id, data, projectId)
      } else {
        await addGlossaryEntry({ projectId, ...data })
      }
      setShowAddEditModal(false)
      setEditingEntry(null)
    } catch (error) {
      console.error('Failed to save term:', error)
      throw error
    }
  }

  return (
    <>
      <RegistryPanel
        title="Glossary"
        description="Define terms, acronyms, and jargon used throughout the process"
        action={
          <button onClick={handleAdd} className="btn-primary inline-flex items-center gap-gs-2">
            <Plus size={16} strokeWidth={2} />
            Add Term
          </button>
        }
        summary={
          <>
            {entries.length} term{entries.length !== 1 ? 's' : ''}
            {searchTerm && entries.length !== filteredEntries.length
              ? ` • ${filteredEntries.length} matching`
              : ''}
          </>
        }
      >
        <>
            {!isLoading && entries.length > 0 && (
              <div className="mb-4">
                <input
                  type="text"
                  className="input-field w-full"
                  placeholder="Search terms, definitions, or acronyms..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            )}

            {isLoading ? (
              <EmptyState
                kind="loading"
                title="Opening the glossary"
                message="Reading terms from the local database."
              />
            ) : entries.length === 0 ? (
              <EmptyState
                title="No terms yet"
                message="The glossary is where jargon and acronyms get pinned down once, so a process map reads the same to everyone."
                action={
                  <button
                    className="btn-primary inline-flex items-center gap-gs-2"
                    onClick={handleAdd}
                  >
                    <Plus size={16} strokeWidth={2} />
                    Add Your First Term
                  </button>
                }
              />
            ) : filteredEntries.length === 0 ? (
              <EmptyState
                title="No matching terms"
                message={`Nothing matches "${searchTerm}". Clear the search to see all ${entries.length} terms.`}
                action={
                  <button className="btn-secondary" onClick={() => setSearchTerm('')}>
                    Clear Search
                  </button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full tbl">
                  <thead>
                    <tr>
                      <th className="w-48">Term</th>
                      <th>Definition</th>
                      <th className="w-24">Acronym</th>
                      <th>Tags</th>
                      <th className="w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <span className="font-medium" style={{ color: 'var(--color-deep-navy)' }}>
                            {entry.term}
                          </span>
                        </td>
                        <td>{entry.definition}</td>
                        <td>
                          {entry.acronym || <Empty />}
                        </td>
                        <td>
                          {entry.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {entry.tags.map((tag, idx) => (
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
                              onClick={() => handleEdit(entry)}
                              className="text-gray-600 hover:text-gray-900 p-1"
                              title="Edit term"
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
                              onClick={() => setShowDeleteConfirm(entry)}
                              className="text-red-600 hover:text-red-900 p-1"
                              title="Delete term"
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
        <AddEditGlossaryModal
          isOpen={showAddEditModal}
          onClose={() => {
            setShowAddEditModal(false)
            setEditingEntry(null)
          }}
          onSave={handleSave}
          entry={editingEntry}
          steps={steps}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmModal
          isOpen={!!showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(null)}
          title="Delete Term?"
          description={
            <p>
              Are you sure you want to delete the term <strong>"{showDeleteConfirm.term}"</strong>?
            </p>
          }
          confirmAction={{
            label: 'Delete Term',
            style: 'danger',
            onClick: () => handleDelete(showDeleteConfirm),
          }}
        />
      )}
    </>
  )
}

interface AddEditGlossaryModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: {
    term: string
    definition: string
    acronym?: string
    relatedSteps: string[]
    tags: string[]
  }) => Promise<void>
  entry: GlossaryEntry | null
  steps: Step[]
}

function AddEditGlossaryModal({ isOpen, onClose, onSave, entry, steps }: AddEditGlossaryModalProps) {
  const [term, setTerm] = useState(entry?.term || '')
  const [definition, setDefinition] = useState(entry?.definition || '')
  const [acronym, setAcronym] = useState(entry?.acronym || '')
  const [selectedSteps, setSelectedSteps] = useState<string[]>(entry?.relatedSteps || [])
  const [tagsInput, setTagsInput] = useState(entry?.tags.join(', ') || '')
  const [isSaving, setIsSaving] = useState(false)

  const toggleStep = (id: string) => {
    setSelectedSteps((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  const handleSave = async () => {
    if (!term.trim()) {
      toast.error('Term is required')
      return
    }
    if (!definition.trim()) {
      toast.error('Definition is required')
      return
    }

    try {
      setIsSaving(true)
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      await onSave({
        term: term.trim(),
        definition: definition.trim(),
        acronym: acronym.trim(),
        relatedSteps: selectedSteps,
        tags,
      })

      onClose()
    } catch (error) {
      console.error('Failed to save term:', error)
      toast.error('Failed to save term')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={entry ? 'Edit Term' : 'Add Term'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!term.trim() || !definition.trim() || isSaving}
          >
            {isSaving ? 'Saving...' : entry ? 'Save Changes' : 'Add Term'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-gs-4">
            <div>
              <label className="label-field">Term *</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., Purchase Requisition"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="label-field">Definition *</label>
              <textarea
                className="textarea-field w-full"
                rows={4}
                placeholder="What does this term mean in context..."
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Acronym (Optional)</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., PR"
                value={acronym}
                onChange={(e) => setAcronym(e.target.value)}
              />
            </div>

            <div>
              <label className="label-field">Related Steps (Optional)</label>
              {steps.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No steps in this project yet.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                  {steps.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                      <input
                        type="checkbox"
                        checked={selectedSteps.includes(s.id)}
                        onChange={() => toggleStep(s.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{s.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="label-field">Tags (Optional)</label>
              <input
                type="text"
                className="input-field w-full"
                placeholder="e.g., finance, procurement"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
              <p className="text-xs text-gs-ink-muted mt-gs-1">Separate multiple tags with commas</p>
            </div>
      </div>
    </Modal>
  )
}
