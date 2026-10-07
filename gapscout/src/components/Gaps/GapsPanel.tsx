/**
 * GapsPanel - Main panel for viewing and managing gaps
 * 
 * Displays all gaps for the current project with ability to:
 * - Create new gaps
 * - View gap details
 * - Edit existing gaps
 * - Filter and search gaps (Phase 3 - ZIP-145)
 * 
 * Reference: PRD Section 4.7 - Gap Analysis Panel
 * Ticket: ZIP-97
 */

import { useMemo, useState } from 'react'
import { Plus, TriangleAlert, CheckCircle, Clock, X } from 'lucide-react'
import { useGapsStore } from '../../state/gapsStore'
import { useProcessPositions } from '../../state/useProcessPositions'
import { useStepsStore } from '../../state/stepsStore'
import { useTeamsStore } from '../../state/teamsStore'
import { GapForm, GapFilters } from '../Gaps'
import { EmptyState } from '../shared/EmptyState'
import GapsTable from './GapsTable'
import { nextGapSort, sortGaps, type GapSortColumn } from '../../lib/gapSort'
import { openSlotForInsert, resealAfterMutation } from '../../state/sequenceOps'
import toast from 'react-hot-toast'
import type { Gap, GapStatus, SeverityLevel, MissingFieldType, RootCauseType } from '../../data/types'

interface GapsPanelProps {
  projectId: string
}

export default function GapsPanel({ projectId }: GapsPanelProps) {
  const {
    gaps,
    isLoading,
    filters,
    setFilters,
    clearFilters,
    getFilteredGaps,
    sort,
    setSort,
    bulkUpdateStatus,
    updateGap,
  } = useGapsStore()
  const { steps, milestones } = useStepsStore()
  // The table lists every gap in the project, so it names the position in the
  // whole process. The stored `order` restarts at 1 in each milestone, which
  // put the same "Step 1" against three different rows (#345).
  const positions = useProcessPositions()
  const { teams } = useTeamsStore()

  // Get filtered gaps
  const filteredGaps = getFilteredGaps()

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingGap, setEditingGap] = useState<Gap | null>(null)

  // Table state. Selection and expansion are ephemeral view state, so unlike
  // filters and sort they stay local and are not persisted.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedGapId, setExpandedGapId] = useState<string | null>(null)

  const handleCreateGap = () => {
    setEditingGap(null)
    setIsFormOpen(true)
  }

  const handleEditGap = (gap: Gap) => {
    setEditingGap(gap)
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    setIsFormOpen(false)
    setEditingGap(null)
  }

  // Get step info with milestone for display
  const getStepInfo = (stepId?: string, gap?: Gap) => {
    if (stepId) {
      const step = steps.find(s => s.id === stepId)
      if (!step) return { stepLabel: 'Unknown Step', milestoneName: 'Unknown Milestone', step: null }
      
      const milestone = milestones.find(m => m.id === step.milestoneId)
      return {
        stepLabel: `Step ${positions.get(step.id) ?? step.order}: ${step.label}`,
        milestoneName: milestone?.name || 'Unknown Milestone',
        step
      }
    } else if (gap?.order !== undefined) {
      // Process gap without step
      const milestone = gap.milestoneId ? milestones.find(m => m.id === gap.milestoneId) : null
      return {
        stepLabel: `Order ${positions.get(gap.id) ?? gap.order}: ${gap.observed}`,
        milestoneName: milestone?.name || 'Unknown Milestone',
        step: null
      }
    }
    return { stepLabel: 'Unknown Step', milestoneName: 'Unknown Milestone', step: null }
  }

  const getTeamName = (teamId: string | null | undefined): string => {
    if (!teamId) return 'Unassigned'
    const team = teams.find(t => t.id === teamId)
    return team ? team.name : 'Unknown Team'
  }

  // Flow position for the Step column: the owning step's position for step
  // gaps, the gap's own for process gaps. Sorting on the stored `order` ranked a
  // later milestone's first step alongside the process's first step (#345).
  const stepOrderOf = (gap: Gap): number | undefined => {
    if (gap.stepId) {
      const step = steps.find(s => s.id === gap.stepId)
      return step ? positions.get(step.id) ?? step.order : undefined
    }
    return positions.get(gap.id) ?? gap.order
  }

  const sortedGaps = useMemo(
    () =>
      sortGaps(filteredGaps, sort, {
        stepOrderOf,
        teamNameOf: (gap) => (gap.ownerTeamId ? getTeamName(gap.ownerTeamId) : undefined),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredGaps, sort, steps, teams, positions]
  )

  // Only selected rows that are still visible count. A selected gap can be
  // filtered out (edited to a status the filter excludes, or the filter
  // changed), and acting on ids that are no longer on screen would report a
  // count the user cannot see and leave the bulk bar stranded.
  const selectedVisibleIds = useMemo(
    () => sortedGaps.filter(gap => selectedIds.has(gap.id)).map(gap => gap.id),
    [sortedGaps, selectedIds]
  )

  const handleSortChange = (column: GapSortColumn) => {
    setSort(nextGapSort(sort, column))
  }

  const handleToggleSelect = (gapId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(gapId)) {
        next.delete(gapId)
      } else {
        next.add(gapId)
      }
      return next
    })
  }

  // Select-all acts on the visible rows only, so it never touches gaps hidden
  // by the current filters.
  const handleToggleSelectAll = () => {
    setSelectedIds(prev =>
      sortedGaps.every(gap => prev.has(gap.id)) ? new Set() : new Set(sortedGaps.map(gap => gap.id))
    )
  }

  const handleToggleExpand = (gapId: string) => {
    setExpandedGapId(current => (current === gapId ? null : gapId))
  }

  const handleBulkStatus = async (status: GapStatus) => {
    if (selectedVisibleIds.length === 0) return

    // A status change is a sequence event whenever it changes whether a gap
    // holds a position, which `isProcessGap` decides on `status !== 'Closed'`
    // (#353 clause 9). Closing takes the gap out of the sequence and leaves a
    // hole nothing else closes — the threshold shifts this replaced skipped
    // Closed rows by predicate, so the hole was invisible to them.
    //
    // Reopening is the opposite and needs the slot opened first: `order_num`
    // survives a close, but it is a stale number rather than a reservation, and
    // some other row has usually taken the position by the time the gap comes
    // back. The milestones are read before the write, because a gap that fails
    // to change status still has to be left out of the reseal.
    const selected = gaps.filter(gap => selectedVisibleIds.includes(gap.id))
    const affectedMilestoneIds = [...new Set(selected.map(gap => gap.milestoneId))]

    // Reopening is one gap at a time, and the sequencing matters: a Closed gap
    // is outside the sequence, so `openSlot` cannot see one whose slot has been
    // opened but whose status has not flipped yet. Opening every slot first and
    // flipping afterwards lands two gaps that share a stale `order_num` on the
    // same position — an accidental parallel pair. So each gap takes its slot,
    // is written back into the sequence at it, and only then is the next one
    // measured.
    //
    // Written with `updateGap` rather than `bulkUpdateStatus` because the gap
    // needs its `order` as well as its status, and because the silent flag
    // keeps this to one report rather than one toast per gap — the storm #107
    // opened on.
    const reopening =
      status === 'Open'
        ? selected.filter(
            gap =>
              gap.status === 'Closed' && gap.order !== undefined && !!gap.milestoneId && !gap.stepId
          )
        : []
    const reopeningIds = new Set(reopening.map(gap => gap.id))

    const failed: string[] = []
    let reopened = 0
    for (const gap of reopening) {
      try {
        // `openSlot` frees exactly position `at`, so that is where the gap goes
        // — and it goes there inside the same lock, because a reseal landing
        // between the two closes the slot and the gap lands on an occupied
        // order instead.
        await openSlotForInsert({
          projectId,
          milestoneId: gap.milestoneId!,
          at: gap.order!,
          write: () => updateGap(gap.id, { status, order: gap.order! }, projectId, { silent: true }),
        })
        reopened += 1
      } catch (error) {
        console.error('Failed to reopen a process gap into the sequence:', error)
        failed.push(gap.id)
      }
    }
    if (reopened > 0) {
      toast.success(`${reopened} gap${reopened > 1 ? 's' : ''} moved to ${status}`)
    }

    const rest = selectedVisibleIds.filter(id => !reopeningIds.has(id))
    if (rest.length > 0) {
      failed.push(...(await bulkUpdateStatus(rest, status, projectId)).failed)
    }

    try {
      await resealAfterMutation({ projectId, milestoneIds: affectedMilestoneIds })
    } catch (error) {
      // The status change itself landed and has been reported; a failed reseal
      // is a torn sequence and has to be said out loud rather than swallowed.
      console.error('Failed to reseal after a bulk status change:', error)
      toast.error('Status updated, but order numbers could not be tidied')
    }

    // Keep whatever did not land selected, so the bulk bar stays pointed at the
    // rows that still need the change instead of losing them among the others.
    setSelectedIds(new Set(failed))
  }

  // Helper to remove individual filter chips
  const removeStatusFilter = (status: GapStatus) => {
    setFilters({ statuses: filters.statuses.filter(s => s !== status) })
  }
  
  const removeTeamFilter = (teamId: string) => {
    setFilters({ ownerTeamIds: filters.ownerTeamIds.filter(t => t !== teamId) })
  }
  
  const removeMissingFieldFilter = (field: MissingFieldType) => {
    setFilters({ missingFields: filters.missingFields.filter(f => f !== field) })
  }
  
  const removeSeverityFilter = (severity: SeverityLevel) => {
    setFilters({ severities: filters.severities.filter(s => s !== severity) })
  }
  
  const removePriorityFilter = (priority: number) => {
    setFilters({ priorities: filters.priorities.filter(p => p !== priority) })
  }
  
  const removeRootCauseFilter = (cause: RootCauseType) => {
    setFilters({ rootCauses: filters.rootCauses.filter(c => c !== cause) })
  }

  const getSeverityLabel = (severity: SeverityLevel): string => {
    switch (severity) {
      case 'H': return 'High'
      case 'M': return 'Medium'
      case 'L': return 'Low'
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading gaps...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Gap Analysis</h2>
          <p className="text-gray-600 mt-1">
            Identify and track process improvement opportunities
          </p>
        </div>
        <button
          onClick={handleCreateGap}
          className="btn-primary flex items-center gap-gs-2"
        >
          <Plus size={16} />
          Create Gap
        </button>
      </div>

      {/* Filter Component */}
      <GapFilters />

      {/* Active Filter Chips */}
      {(filters.statuses.length > 0 || filters.ownerTeamIds.length > 0 || filters.includeUnassigned ||
        filters.missingFields.length > 0 || filters.includeDeadEnd || filters.severities.length > 0 ||
        filters.priorities.length > 0 || filters.rootCauses.length > 0 || filters.searchQuery.trim()) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Active filters:</span>
          
          {/* Status chips */}
          {filters.statuses.map(status => (
            <span key={status} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
              {status}
              <button onClick={() => removeStatusFilter(status)} className="hover:text-blue-900">
                <X size={14} />
              </button>
            </span>
          ))}
          
          {/* Team chips */}
          {filters.ownerTeamIds.map(teamId => (
            <span key={teamId} className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
              {getTeamName(teamId)}
              <button onClick={() => removeTeamFilter(teamId)} className="hover:text-purple-900">
                <X size={14} />
              </button>
            </span>
          ))}
          
          {filters.includeUnassigned && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
              Unassigned
              <button onClick={() => setFilters({ includeUnassigned: false })} className="hover:text-purple-900">
                <X size={14} />
              </button>
            </span>
          )}
          
          {/* Missing field chips */}
          {filters.missingFields.map(field => (
            <span key={field} className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm capitalize">
              Missing {field}
              <button onClick={() => removeMissingFieldFilter(field)} className="hover:text-orange-900">
                <X size={14} />
              </button>
            </span>
          ))}
          
          {filters.includeDeadEnd && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm">
              Dead End
              <button onClick={() => setFilters({ includeDeadEnd: false })} className="hover:text-orange-900">
                <X size={14} />
              </button>
            </span>
          )}
          
          {/* Severity chips */}
          {filters.severities.map(severity => (
            <span key={severity} className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">
              {getSeverityLabel(severity)}
              <button onClick={() => removeSeverityFilter(severity)} className="hover:text-red-900">
                <X size={14} />
              </button>
            </span>
          ))}
          
          {/* Priority chips */}
          {filters.priorities.map(priority => (
            <span key={priority} className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
              Priority {priority}
              <button onClick={() => removePriorityFilter(priority)} className="hover:text-green-900">
                <X size={14} />
              </button>
            </span>
          ))}
          
          {/* Root cause chips */}
          {filters.rootCauses.map(cause => (
            <span key={cause} className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">
              {cause}
              <button onClick={() => removeRootCauseFilter(cause)} className="hover:text-yellow-900">
                <X size={14} />
              </button>
            </span>
          ))}
          
          {/* Search query chip */}
          {filters.searchQuery.trim() && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-200 text-gray-800 rounded-full text-sm">
              Search: "{filters.searchQuery}"
              <button onClick={() => setFilters({ searchQuery: '' })} className="hover:text-gray-900">
                <X size={14} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Results Count */}
      <div className="mb-4 text-sm text-gray-600">
        Showing <span className="font-semibold text-gray-900">{filteredGaps.length}</span> of{' '}
        <span className="font-semibold text-gray-900">{gaps.length}</span> gaps
      </div>

      {/* Gap Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-700 mb-1">
            <TriangleAlert size={16} strokeWidth={2} />
            <span className="font-medium">Open</span>
          </div>
          <p className="text-2xl font-bold text-red-900">
            {filteredGaps.filter(g => g.status === 'Open').length}
          </p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-orange-700 mb-1">
            <Clock size={16} strokeWidth={2} />
            <span className="font-medium">In Review</span>
          </div>
          <p className="text-2xl font-bold text-orange-900">
            {filteredGaps.filter(g => g.status === 'Review').length}
          </p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-700 mb-1">
            <CheckCircle size={16} strokeWidth={2} />
            <span className="font-medium">Closed</span>
          </div>
          <p className="text-2xl font-bold text-green-900">
            {filteredGaps.filter(g => g.status === 'Closed').length}
          </p>
        </div>
      </div>

      {/* Gaps List */}
      {filteredGaps.length === 0 ? (
        gaps.length === 0 ? (
          // No gaps at all
          <EmptyState
            title="No gaps yet"
            message="A gap records the difference between what a step does and what it should do — the raw material of the analysis."
            action={
              <button
                onClick={handleCreateGap}
                className="btn-primary inline-flex items-center gap-gs-2"
              >
                <Plus size={16} strokeWidth={2} />
                Create First Gap
              </button>
            }
          />
        ) : (
          // Gaps exist, but none match filters
          <EmptyState
            title="No matching gaps"
            message={`None of the ${gaps.length} gaps in this project match the current filters.`}
            action={
              <button className="btn-secondary" onClick={clearFilters}>
                Clear All Filters
              </button>
            }
          />
        )
      ) : (
        <>
          {/* Bulk action bar - appears once rows are selected */}
          {selectedVisibleIds.length > 0 && (
            <div
              className="mb-gs-4 flex items-center gap-gs-3 px-gs-4 py-gs-3 bg-gs-accent-tint border border-gs-rule"
              data-testid="gap-bulk-bar"
            >
              <span className="text-sm font-medium text-gs-ink">
                {selectedVisibleIds.length} selected
              </span>
              <span className="text-sm text-gs-ink-muted">Set status:</span>
              {(['Open', 'Review', 'Closed'] as GapStatus[]).map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => handleBulkStatus(status)}
                  className="btn-secondary"
                >
                  {status}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="btn-ghost ml-auto"
              >
                Clear selection
              </button>
            </div>
          )}

          <GapsTable
            gaps={sortedGaps}
            sort={sort}
            onSortChange={handleSortChange}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            expandedGapId={expandedGapId}
            onToggleExpand={handleToggleExpand}
            onEditGap={handleEditGap}
            getStepLabel={(gap) => getStepInfo(gap.stepId, gap).stepLabel}
            getMilestoneName={(gap) => getStepInfo(gap.stepId, gap).milestoneName}
            getTeamName={getTeamName}
          />
        </>
      )}

      {/* Gap Form Modal */}
      <GapForm
        isOpen={isFormOpen}
        onClose={handleCloseForm}
        mode={editingGap ? 'edit' : 'create'}
        projectId={projectId}
        gap={editingGap}
        prefilledStepId={null}
        displayNumbers={positions}
      />
    </div>
  )
}
