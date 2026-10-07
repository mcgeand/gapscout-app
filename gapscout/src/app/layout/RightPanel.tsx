import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { useStepsStore } from '../../state/stepsStore'
import { useGapsStore } from '../../state/gapsStore'
import { useProcessPositions } from '../../state/useProcessPositions'
import { GapForm } from '../../components/Gaps'
import { CommentsSection } from '../../components/Comments'
import { formatRelativeTime, getSeverityInfo, getStatusInfo } from '../../components/Gaps/gapDisplay'
import type { Gap } from '../../data/types'
import { EmptyState } from '../../components/shared/EmptyState'

/**
 * RightPanel - Contextual drawer for the currently selected step
 *
 * Shows when a step is selected, lists its gaps with expand/collapse detail,
 * allows creating/editing gaps for that step, and carries the step's comment
 * thread below them (#157, PRD §4.9 — "Diagram: Right panel when step
 * selected").
 */
export default function RightPanel() {
  const { currentStep, clearSelection } = useStepsStore()
  const { gaps } = useGapsStore()
  // The drawer is never scoped to a milestone, so it names the position in the
  // whole process rather than the stored per-milestone `order` (#345).
  const positions = useProcessPositions()

  const [expandedGapId, setExpandedGapId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingGap, setEditingGap] = useState<Gap | null>(null)

  // Filter the already-loaded project-wide gaps list rather than calling
  // loadGapsByStep, which would replace it and break DiscoveryGrid/GapsPanel.
  const currentStepId = currentStep?.id
  const stepGaps = useMemo(
    () => (currentStepId ? gaps.filter(g => g.stepId === currentStepId) : []),
    [gaps, currentStepId]
  )

  const commentCount = currentStep?.comments?.length ?? 0

  if (!currentStep) return null

  const toggleExpanded = (gapId: string) => {
    setExpandedGapId(prev => (prev === gapId ? null : gapId))
  }

  const handleAddGap = () => {
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

  return (
    <aside className="w-80 bg-white border-l border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--color-deep-navy)' }}>
            Step {positions.get(currentStep.id) ?? currentStep.order}: {currentStep.label}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {stepGaps.length} gap{stepGaps.length === 1 ? '' : 's'} · {commentCount} comment
            {commentCount === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={clearSelection}
          className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          title="Close panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-gs-6">
        <section aria-labelledby="gaps-heading">
          {/* h3 to match the drawer title's level rather than nest under it:
              the `EmptyState` inside renders its own h3. */}
          <h3
            id="gaps-heading"
            className="text-xs font-semibold uppercase tracking-wide text-gs-ink-muted"
          >
            Gaps
          </h3>
          <div className="mt-gs-3">
            {stepGaps.length === 0 ? (
              <EmptyState
                title="No gaps for this step"
                message="A gap records the difference between what this step does and what it should do."
                action={
                  <button
                    onClick={handleAddGap}
                    className="btn-primary inline-flex items-center gap-gs-2"
                  >
                    <Plus size={16} strokeWidth={2} />
                    Add Gap
                  </button>
                }
              />
            ) : (
              <div className="space-y-3">
                {stepGaps.map(gap => {
                  const isExpanded = expandedGapId === gap.id
                  const severityInfo = getSeverityInfo(gap.severity)
                  const statusInfo = getStatusInfo(gap.status)
                  const StatusIcon = statusInfo.icon

                  return (
                    <div key={gap.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleExpanded(gap.id)}
                        className="w-full text-left p-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 ${statusInfo.className}`}>
                              <StatusIcon size={16} strokeWidth={2} />
                              {gap.status}
                            </span>
                            <span className={`inline-flex items-center ${severityInfo.className}`}>
                              {severityInfo.label}
                            </span>
                          </div>
                          {isExpanded ? (
                            <ChevronUp size={16} strokeWidth={2} className="text-gs-ink-muted flex-shrink-0" />
                          ) : (
                            <ChevronDown size={16} strokeWidth={2} className="text-gs-ink-muted flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-gray-900 truncate">{gap.observed}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatRelativeTime(gap.createdAt)}</p>
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
                          <div>
                            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                              Expected
                            </span>
                            <p className="text-sm text-gray-900 mt-1">{gap.expected}</p>
                          </div>
                          {gap.missingField && (
                            <div>
                              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                Missing Field
                              </span>
                              <p className="text-sm text-gray-900 mt-1 capitalize">{gap.missingField}</p>
                            </div>
                          )}
                          {gap.rootCause && (
                            <div>
                              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                Root Cause
                              </span>
                              <p className="text-sm text-gray-900 mt-1">{gap.rootCause}</p>
                            </div>
                          )}
                          {gap.fixIdea && (
                            <div>
                              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                Fix Idea
                              </span>
                              <p className="text-sm text-gray-900 mt-1">{gap.fixIdea}</p>
                            </div>
                          )}
                          {gap.timeToFix && (
                            <div>
                              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                Time to Fix
                              </span>
                              <p className="text-sm text-gray-900 mt-1 capitalize">{gap.timeToFix}</p>
                            </div>
                          )}
                          <button
                            onClick={() => handleEditGap(gap)}
                            className="btn-secondary w-full"
                          >
                            Edit Gap
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {/* The action used to sit in a panel footer. The drawer is no longer
              gaps-only, so a footer button below the comment thread would read
              as belonging to the comments. */}
          {stepGaps.length > 0 && (
            <button
              onClick={handleAddGap}
              className="btn-primary mt-gs-3 w-full inline-flex items-center gap-gs-2"
            >
              <Plus size={16} strokeWidth={2} />
              Add Gap
            </button>
          )}
        </section>

        <div className="section-rule" />

        <CommentsSection step={currentStep} />
      </div>

      {/* Gap Form Modal */}
      <GapForm
        isOpen={isFormOpen}
        onClose={handleCloseForm}
        mode={editingGap ? 'edit' : 'create'}
        projectId={currentStep.projectId}
        gap={editingGap}
        prefilledStepId={currentStep.id}
        displayNumbers={positions}
      />
    </aside>
  )
}
