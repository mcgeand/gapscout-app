import { useState, useEffect, useId, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  Search,
  Workflow,
  TriangleAlert,
  Users,
  Boxes,
  Flag,
  FileText,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'
import { search } from '../../services/searchService'
import type { SearchResult, SearchEntityType } from '../../data/types'
import { useStepsStore } from '../../state/stepsStore'
import { useGapsStore } from '../../state/gapsStore'

const DEBOUNCE_MS = 300
const MAX_PER_GROUP = 8

const ENTITY_ORDER: SearchEntityType[] = [
  'step',
  'gap',
  'team',
  'system',
  'milestone',
  'policy',
  'glossary',
]

const ENTITY_LABELS: Record<SearchEntityType, string> = {
  step: 'Steps',
  gap: 'Gaps',
  team: 'Teams',
  system: 'Systems',
  milestone: 'Milestones',
  policy: 'Policies',
  glossary: 'Glossary',
}

const ENTITY_ICONS: Record<SearchEntityType, LucideIcon> = {
  step: Workflow,
  gap: TriangleAlert,
  team: Users,
  system: Boxes,
  milestone: Flag,
  policy: FileText,
  glossary: BookOpen,
}

// Only step + gap stores expose a selectX action today. Other entity types
// navigate to the project page; a dedicated selectX for the remaining stores
// is a follow-up (see hand-off proposed follow-ups).
const ENTITY_SELECTORS: Partial<Record<SearchEntityType, (id: string) => Promise<void>>> = {
  step: (id) => useStepsStore.getState().selectStep(id),
  gap: (id) => useGapsStore.getState().selectGap(id),
}

export default function SearchBar() {
  const { projectId } = useParams<{ projectId: string }>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Request-token: bumped on every new search AND on projectId change, so
  // any in-flight search resolving with stale results is discarded.
  const requestIdRef = useRef(0)
  const hintId = useId()

  const isDisabled = !projectId

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !isDisabled) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDisabled])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Invalidate any in-flight search when projectId changes. Ref-only mutation
  // (no setState) so this stays out of react-hooks/set-state-in-effect.
  useEffect(() => {
    requestIdRef.current += 1
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [projectId])

  const handleQueryChange = (next: string) => {
    setQuery(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = next.trim()
    if (!trimmed || !projectId) {
      setResults([])
      setIsOpen(false)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    const myRequestId = ++requestIdRef.current
    const requestProjectId = projectId
    debounceRef.current = setTimeout(() => {
      search(trimmed, requestProjectId)
        .then((found) => {
          if (myRequestId !== requestIdRef.current) return
          setResults(found)
          setIsOpen(true)
        })
        .finally(() => {
          if (myRequestId !== requestIdRef.current) return
          setIsLoading(false)
        })
    }, DEBOUNCE_MS)
  }

  const handleResultClick = useCallback(
    async (result: SearchResult) => {
      setIsOpen(false)
      setQuery('')
      const selector = ENTITY_SELECTORS[result.entityType]
      if (selector) {
        await selector(result.entityId)
      }
    },
    []
  )

  // Filter on render so any stale results from a previous projectId don't
  // surface in the new project's dropdown (belt to the request-token braces).
  const visibleResults = useMemo(
    () => results.filter((r) => r.projectId === projectId),
    [results, projectId]
  )

  const grouped = useMemo(() => {
    const out: Partial<Record<SearchEntityType, SearchResult[]>> = {}
    for (const result of visibleResults) {
      const bucket = out[result.entityType] ?? []
      bucket.push(result)
      out[result.entityType] = bucket
    }
    return out
  }, [visibleResults])

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          size={16}
          strokeWidth={2}
          className="absolute left-gs-3 top-1/2 -translate-y-1/2 text-gs-ink-faint pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsOpen(false)
              inputRef.current?.blur()
            }
          }}
          disabled={isDisabled}
          placeholder={
            isDisabled ? 'Open a project to search…' : 'Search steps, gaps, teams…'
          }
          aria-label="Global search"
          {...(isDisabled ? {} : { 'aria-describedby': hintId })}
          className="input-field w-full pl-8 pr-12"
        />
        {/* The hint names the key that is actually bound. The design draws ⌘K;
            ⌘F is what the listener above answers to, and a hint for a key that
            does nothing is the same defect as a button that does nothing.
            It moved out of the placeholder so it survives typing, and is
            described-by rather than hidden so it is still announced. */}
        {!isDisabled && (
          <kbd
            id={hintId}
            className="absolute right-gs-3 top-1/2 -translate-y-1/2 px-gs-1 text-[10px] font-mono font-bold tracking-wider text-gs-ink-faint pointer-events-none"
          >
            ⌘F
          </kbd>
        )}
      </div>

      {isOpen && !isDisabled && (
        <div
          role="menu"
          aria-label="Search results"
          className="absolute top-full mt-gs-1 left-0 right-0 bg-gs-surface border-2 border-gs-ink max-h-96 overflow-y-auto z-[var(--gs-z-popover)]"
        >
          {isLoading && visibleResults.length === 0 ? (
            <div className="px-gs-4 py-gs-3 text-sm text-gs-ink-muted">Searching…</div>
          ) : visibleResults.length === 0 ? (
            <div className="px-gs-4 py-gs-3 text-sm text-gs-ink-muted">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            ENTITY_ORDER.map((entityType) => {
              const items = grouped[entityType]
              if (!items || items.length === 0) return null
              const Icon = ENTITY_ICONS[entityType]
              const visible = items.slice(0, MAX_PER_GROUP)
              const remaining = items.length - visible.length
              return (
                <div key={entityType}>
                  <div className="px-gs-3 py-gs-1 text-[10px] font-mono font-bold uppercase tracking-wider text-gs-ink-muted bg-gs-sunken border-b border-gs-rule-faint">
                    {ENTITY_LABELS[entityType]}
                  </div>
                  {visible.map((result) => {
                    const label = formatLabel(result.content)
                    const snippet = formatSnippet(result.content)
                    return (
                      <button
                        key={`${result.entityType}-${result.entityId}`}
                        onClick={() => {
                          void handleResultClick(result)
                        }}
                        role="menuitem"
                        className="w-full px-gs-3 py-gs-2 flex items-start gap-gs-2 hover:bg-gs-sunken text-left border-b border-gs-rule-faint last:border-b-0"
                      >
                        <Icon
                          size={16}
                          strokeWidth={2}
                          className="mt-0.5 text-gs-ink-muted shrink-0"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-sm text-gs-ink truncate"
                            title={result.content.trim()}
                          >
                            {label}
                          </div>
                          {snippet && (
                            <div className="text-xs text-gs-ink-muted truncate">
                              {snippet}
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                  {remaining > 0 && (
                    <div className="px-gs-3 py-gs-1 text-xs text-gs-ink-faint italic">
                      +{remaining} more
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

const LABEL_MAX = 80
const SNIPPET_MIN = 20
const SNIPPET_MAX = 100

function formatLabel(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= LABEL_MAX) return trimmed
  return `${trimmed.slice(0, LABEL_MAX)}…`
}

function formatSnippet(content: string): string {
  const trimmed = content.trim()
  const rest = trimmed.slice(LABEL_MAX)
  if (rest.length < SNIPPET_MIN) return ''
  if (rest.length <= SNIPPET_MAX) return rest
  return `${rest.slice(0, SNIPPET_MAX)}…`
}
