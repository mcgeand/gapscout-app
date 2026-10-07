/**
 * GapsTable - Sortable, selectable table of gaps for the Gaps tab.
 *
 * Columns, sort behaviour and the click-to-expand quick view follow
 * PRD Section 4.7.3 - Gap List View.
 *
 * Receives an already filtered and sorted list; sorting state itself lives in
 * gapsStore so it survives tab switches.
 *
 * Ticket: #161
 */

import { ChevronDown, ChevronRight, ChevronUp, SquarePen } from 'lucide-react'
import { formatRelativeTime, getSeverityInfo, getStatusInfo } from './gapDisplay'
import { PRIORITY_LABELS, TIME_TO_FIX_SHORT } from '../../data/constants'
import type { GapSort, GapSortColumn } from '../../lib/gapSort'
import type { Gap } from '../../data/types'
import { Empty } from '../shared/Empty'

interface GapsTableProps {
  gaps: Gap[]
  sort: GapSort
  onSortChange: (column: GapSortColumn) => void
  selectedIds: Set<string>
  onToggleSelect: (gapId: string) => void
  onToggleSelectAll: () => void
  expandedGapId: string | null
  onToggleExpand: (gapId: string) => void
  onEditGap: (gap: Gap) => void
  getStepLabel: (gap: Gap) => string
  getMilestoneName: (gap: Gap) => string
  getTeamName: (teamId: string | null | undefined) => string
}

const COLUMNS: { key: GapSortColumn; label: string; className?: string }[] = [
  { key: 'id', label: 'ID', className: 'w-24' },
  { key: 'step', label: 'Step' },
  { key: 'severity', label: 'Severity', className: 'w-28' },
  { key: 'status', label: 'Status', className: 'w-28' },
  { key: 'rootCause', label: 'Root Cause', className: 'w-32' },
  { key: 'ownerTeam', label: 'Owner Team', className: 'w-36' },
  { key: 'priority', label: 'Priority', className: 'w-28' },
  { key: 'timeToFix', label: 'Time to Fix', className: 'w-28' },
  { key: 'links', label: 'Jira Links', className: 'w-24' },
]

export default function GapsTable({
  gaps,
  sort,
  onSortChange,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  expandedGapId,
  onToggleExpand,
  onEditGap,
  getStepLabel,
  getMilestoneName,
  getTeamName,
}: GapsTableProps) {
  const allSelected = gaps.length > 0 && gaps.every(gap => selectedIds.has(gap.id))
  const someSelected = gaps.some(gap => selectedIds.has(gap.id))

  return (
    // Nine columns do not fit the page container, so the table scrolls inside its own box.
    <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
      <table className="w-full min-w-[900px] tbl" data-testid="gaps-table">
        <thead>
          <tr>
            <th className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected
                }}
                onChange={onToggleSelectAll}
                aria-label="Select all gaps"
                className="rounded border-gray-300"
              />
            </th>
            <th className="w-8" />
            {COLUMNS.map(({ key, label, className }) => {
              const isActive = sort.column === key
              const SortIcon = sort.direction === 'asc' ? ChevronUp : ChevronDown
              return (
                <th
                  key={key}
                  // aria-sort belongs on the columnheader, not the inner button.
                  aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={className ?? undefined}
                >
                  <button
                    type="button"
                    onClick={() => onSortChange(key)}
                    aria-label={`Sort by ${label}`}
                    // The header ground is --gs-ink, so the button inherits the
                    // th's own colour rather than btn-ghost's --gs-ink-muted,
                    // which is near-invisible on it. The active column is marked
                    // by weight and the caret, not by a second colour.
                    className={`inline-flex items-center gap-gs-1 p-0 text-inherit ${
                      isActive ? 'opacity-100' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    {label}
                    {isActive && <SortIcon size={16} strokeWidth={2} />}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {gaps.map(gap => {
            const statusInfo = getStatusInfo(gap.status)
            const severityInfo = getSeverityInfo(gap.severity)
            const StatusIcon = statusInfo.icon
            const isExpanded = expandedGapId === gap.id
            const isSelected = selectedIds.has(gap.id)

            return [
              <tr
                key={gap.id}
                onClick={() => onToggleExpand(gap.id)}
                data-testid={`gap-row-${gap.id}`}
                aria-selected={isSelected}
                className="cursor-pointer"
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(gap.id)}
                    aria-label={`Select gap ${gap.observed}`}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="text-gs-ink-faint">
                  {isExpanded ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronRight size={16} strokeWidth={2} />}
                </td>
                <td
                  className="font-mono text-gs-ink-muted"
                  title={`${gap.id} · created ${formatRelativeTime(gap.createdAt)}`}
                >
                  {gap.id.slice(0, 8)}
                </td>
                <td>
                  <p className="text-sm text-gray-900 font-medium truncate max-w-xs" title={getStepLabel(gap)}>
                    {getStepLabel(gap)}
                  </p>
                  <p className="text-xs text-gray-500 truncate max-w-xs">{getMilestoneName(gap)}</p>
                </td>
                <td>
                  <span className={`inline-flex items-center ${severityInfo.className}`}>
                    {severityInfo.label}
                  </span>
                </td>
                <td>
                  <span className={`inline-flex items-center gap-1 ${statusInfo.className}`}>
                    <StatusIcon size={16} strokeWidth={2} />
                    {gap.status}
                  </span>
                </td>
                <td>{gap.rootCause ?? <Empty />}</td>
                <td className="truncate max-w-[9rem]">
                  {gap.ownerTeamId ? getTeamName(gap.ownerTeamId) : <Empty />}
                </td>
                <td>
                  {gap.priority ? `${gap.priority} · ${PRIORITY_LABELS[gap.priority as keyof typeof PRIORITY_LABELS]}` : <Empty />}
                </td>
                <td>
                  {gap.timeToFix ? TIME_TO_FIX_SHORT[gap.timeToFix] : <Empty />}
                </td>
                <td>
                  {gap.links.length > 0 ? gap.links.length : <Empty />}
                </td>
              </tr>,

              isExpanded && (
                <tr key={`${gap.id}-detail`} data-testid={`gap-detail-${gap.id}`} className="bg-gs-sunken">
                  <td colSpan={COLUMNS.length + 2} className="px-gs-6 py-gs-4">
                    <div className="grid grid-cols-3 gap-6">
                      <div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                          Observed (Current)
                        </span>
                        <p className="text-sm text-gray-900 mt-1 leading-relaxed">{gap.observed}</p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                          Expected (Desired)
                        </span>
                        <p className="text-sm text-gray-900 mt-1 leading-relaxed">{gap.expected}</p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                          Fix Idea
                        </span>
                        <p className="text-sm text-gray-900 mt-1 leading-relaxed">
                          {gap.fixIdea || <Empty />}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditGap(gap)
                      }}
                      className="btn-secondary mt-gs-4 inline-flex items-center gap-gs-2"
                    >
                      <SquarePen size={16} strokeWidth={2} />
                      Edit Gap
                    </button>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
