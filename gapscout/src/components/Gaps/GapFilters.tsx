/**
 * GapFilters - Comprehensive filtering and search for gaps
 * 
 * Features:
 * - Filter by status, severity, priority, team, SIPOC field, root cause
 * - Debounced search across all text fields
 * - Removable filter chips
 * - Collapsible panel
 * - Persists to localStorage
 * 
 * Reference: ZIP-145
 */

import { useState, useEffect } from 'react'
import { Search, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useGapsStore } from '../../state/gapsStore'
import { useTeamsStore } from '../../state/teamsStore'
import type { GapStatus, SeverityLevel, RootCauseType, MissingFieldType } from '../../data/types'

const STATUS_OPTIONS: GapStatus[] = ['Open', 'Review', 'Closed']
const SEVERITY_OPTIONS: SeverityLevel[] = ['L', 'M', 'H']
const PRIORITY_OPTIONS = [1, 2, 3, 4, 5]
const ROOT_CAUSE_OPTIONS: RootCauseType[] = ['Config', 'Policy', 'Behavior', 'Data']
const MISSING_FIELD_OPTIONS: MissingFieldType[] = ['supplier', 'input', 'output', 'customer']

export default function GapFilters() {
  const { teams } = useTeamsStore()
  const { 
    filters, 
    setFilters, 
    clearFilters, 
    isFilterPanelOpen, 
    toggleFilterPanel,
    getActiveFilterCount 
  } = useGapsStore()
  
  const [searchInput, setSearchInput] = useState(filters.searchQuery)
  const activeFilterCount = getActiveFilterCount()

  // Debounced search (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters({ searchQuery: searchInput })
    }, 300)
    
    return () => clearTimeout(timer)
  }, [searchInput, setFilters])

  const handleStatusToggle = (status: GapStatus) => {
    const newStatuses = filters.statuses.includes(status)
      ? filters.statuses.filter(s => s !== status)
      : [...filters.statuses, status]
    setFilters({ statuses: newStatuses })
  }

  const handleTeamToggle = (teamId: string) => {
    const newTeams = filters.ownerTeamIds.includes(teamId)
      ? filters.ownerTeamIds.filter(t => t !== teamId)
      : [...filters.ownerTeamIds, teamId]
    setFilters({ ownerTeamIds: newTeams })
  }

  const handleMissingFieldToggle = (field: MissingFieldType) => {
    const newFields = filters.missingFields.includes(field)
      ? filters.missingFields.filter(f => f !== field)
      : [...filters.missingFields, field]
    setFilters({ missingFields: newFields })
  }

  const handleSeverityToggle = (severity: SeverityLevel) => {
    const newSeverities = filters.severities.includes(severity)
      ? filters.severities.filter(s => s !== severity)
      : [...filters.severities, severity]
    setFilters({ severities: newSeverities })
  }

  const handlePriorityToggle = (priority: number) => {
    const newPriorities = filters.priorities.includes(priority)
      ? filters.priorities.filter(p => p !== priority)
      : [...filters.priorities, priority]
    setFilters({ priorities: newPriorities })
  }

  const handleRootCauseToggle = (cause: RootCauseType) => {
    const newCauses = filters.rootCauses.includes(cause)
      ? filters.rootCauses.filter(c => c !== cause)
      : [...filters.rootCauses, cause]
    setFilters({ rootCauses: newCauses })
  }

  const getSeverityLabel = (severity: SeverityLevel): string => {
    switch (severity) {
      case 'H': return 'High'
      case 'M': return 'Medium'
      case 'L': return 'Low'
    }
  }

  return (
    <div className="mb-6">
      {/* Filter Toggle Header */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <button
          onClick={toggleFilterPanel}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-bold text-white rounded-full"
                    style={{ backgroundColor: '#F59E0B' }}>
                {activeFilterCount}
              </span>
            )}
          </div>
          {isFilterPanelOpen ? <ChevronUp size={18} strokeWidth={2} /> : <ChevronDown size={18} strokeWidth={2} />}
        </button>

        {/* Collapsible Filter Panel */}
        {isFilterPanelOpen && (
          <div className="px-6 pb-6 border-t border-gray-200">
            {/* Search Bar */}
            <div className="mt-4 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search Gaps
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} strokeWidth={2} />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search in observed, expected, fix idea..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
                />
                {searchInput && (
                  <button
                    onClick={() => setSearchInput('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X size={16} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>

            {/* Filter Grid */}
            <div className="grid grid-cols-3 gap-6">
              {/* Status Filter */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Status</h4>
                <div className="space-y-2">
                  {STATUS_OPTIONS.map(status => (
                    <label key={status} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.statuses.includes(status)}
                        onChange={() => handleStatusToggle(status)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-700">{status}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Severity Filter */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Severity</h4>
                <div className="space-y-2">
                  {SEVERITY_OPTIONS.map(severity => (
                    <label key={severity} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.severities.includes(severity)}
                        onChange={() => handleSeverityToggle(severity)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-700">{getSeverityLabel(severity)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Priority Filter */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Priority</h4>
                <div className="space-y-2">
                  {PRIORITY_OPTIONS.map(priority => (
                    <label key={priority} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.priorities.includes(priority)}
                        onChange={() => handlePriorityToggle(priority)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-700">Priority {priority}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Process Owner (Team) Filter */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Process Owner</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.includeUnassigned}
                      onChange={(e) => setFilters({ includeUnassigned: e.target.checked })}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                    />
                    <span className="text-sm text-gray-700 italic">Unassigned</span>
                  </label>
                  {teams.map(team => (
                    <label key={team.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.ownerTeamIds.includes(team.id)}
                        onChange={() => handleTeamToggle(team.id)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-700">{team.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Missing SIPOC Field Filter */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">SIPOC Status</h4>
                <div className="space-y-2">
                  {MISSING_FIELD_OPTIONS.map(field => (
                    <label key={field} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.missingFields.includes(field)}
                        onChange={() => handleMissingFieldToggle(field)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-700 capitalize">Missing {field}</span>
                    </label>
                  ))}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.includeDeadEnd}
                      onChange={(e) => setFilters({ includeDeadEnd: e.target.checked })}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                    />
                    <span className="text-sm text-gray-700">Dead End (no next step)</span>
                  </label>
                </div>
              </div>

              {/* Root Cause Filter */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Root Cause</h4>
                <div className="space-y-2">
                  {ROOT_CAUSE_OPTIONS.map(cause => (
                    <label key={cause} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.rootCauses.includes(cause)}
                        onChange={() => handleRootCauseToggle(cause)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 focus:outline-none"
                      />
                      <span className="text-sm text-gray-700">{cause}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Clear Filters Button */}
            {activeFilterCount > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={clearFilters}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Clear All Filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

