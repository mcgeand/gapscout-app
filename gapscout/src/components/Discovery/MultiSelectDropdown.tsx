/**
 * MultiSelectDropdown - Checkbox-based multi-select for teams and systems
 * 
 * Used for Supplier and Customer fields in Discovery Grid.
 * Groups teams and systems with checkboxes for quick selection.
 * 
 * Reference: ZIP-144 UX Enhancement
 */

import { useState, useRef, useEffect } from 'react'
import { Check } from 'lucide-react'

interface MultiSelectDropdownProps {
  selectedValues: string[]
  teams: Array<{ id: string; name: string }>
  systems: Array<{ id: string; name: string }>
  onSave: (values: string[]) => void
  onCancel: () => void
  autoFillOption?: {
    label: string
    value: string[]
  }
}

export function MultiSelectDropdown({
  selectedValues,
  teams,
  systems,
  onSave,
  onCancel,
  autoFillOption,
}: MultiSelectDropdownProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedValues))
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Toggle selection
  const handleToggle = (value: string) => {
    const newSelected = new Set(selected)
    if (newSelected.has(value)) {
      newSelected.delete(value)
    } else {
      newSelected.add(value)
    }
    setSelected(newSelected)
  }

  // Auto-fill from previous step
  const handleAutoFill = () => {
    if (autoFillOption) {
      setSelected(new Set(autoFillOption.value))
    }
  }

  // Calculate position on mount
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
      })
    }
  }, [])

  // Save on blur or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onSave(Array.from(selected))
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      } else if (e.key === 'Enter') {
        onSave(Array.from(selected))
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [selected, onSave, onCancel])

  return (
    <div ref={containerRef} className="relative">
      {/* Dropdown - Fixed positioning to escape overflow constraints */}
      <div 
        ref={dropdownRef}
        className="fixed bg-white border border-gray-300 rounded-lg shadow-xl w-64 max-h-80 overflow-y-auto select-none"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          zIndex: 1000,
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-50 border-b px-3 py-2 flex items-center justify-between z-10">
          <span className="text-xs font-semibold text-gray-700">
            Select Teams & Systems
          </span>
          <div className="flex gap-1">
            {autoFillOption && (
              <button
                onClick={handleAutoFill}
                className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title={autoFillOption.label}
              >
                ↓ Fill
              </button>
            )}
            <button
              onClick={() => onSave(Array.from(selected))}
              className="text-xs px-2 py-1 text-green-600 hover:bg-green-50 rounded transition-colors font-semibold"
            >
              Done
            </button>
          </div>
        </div>

        {/* Teams Section */}
        {teams.length > 0 && (
          <div className="border-b">
            <div className="px-3 py-2 bg-blue-50 text-xs font-semibold text-blue-900">
              Teams
            </div>
            <div className="py-1">
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-blue-50 cursor-pointer transition-colors select-none"
                  onClick={() => handleToggle(team.name)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="relative flex items-center justify-center w-4 h-4 border-2 border-blue-500 rounded flex-shrink-0 bg-white">
                    {selected.has(team.name) && (
                      <Check className="w-3 h-3 text-blue-600" strokeWidth={3} />
                    )}
                  </div>
                  <span className="text-sm text-gray-700">{team.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Systems Section */}
        {systems.length > 0 && (
          <div>
            <div className="px-3 py-2 bg-purple-50 text-xs font-semibold text-purple-900">
              Systems
            </div>
            <div className="py-1">
              {systems.map((system) => (
                <div
                  key={system.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-purple-50 cursor-pointer transition-colors select-none"
                  onClick={() => handleToggle(system.name)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="relative flex items-center justify-center w-4 h-4 border-2 border-purple-500 rounded flex-shrink-0 bg-white">
                    {selected.has(system.name) && (
                      <Check className="w-3 h-3 text-purple-600" strokeWidth={3} />
                    )}
                  </div>
                  <span className="text-sm text-gray-700">{system.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {teams.length === 0 && systems.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-gray-500">
            No teams or systems available.
            <br />
            Add them in the Teams/Systems tab.
          </div>
        )}

        {/* Footer Helper */}
        <div className="sticky bottom-0 bg-gray-50 border-t px-3 py-2 text-xs text-gray-600 z-10">
          {selected.size} selected • Click outside or press Enter to save
        </div>
      </div>
    </div>
  )
}

