/**
 * Gaps Store - Zustand store for managing gaps
 *
 * Handles gap list, filtering, and all CRUD operations.
 * Integrates with SQLite database via Tauri plugin.
 *
 * References: PRD Section 4.7 - Gap Analysis Panel, Section 6.3 - State Management
 * Ticket: ZIP-96
 */

import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Gap, GapStatus, GapUpdate, SeverityLevel, RootCauseType, MissingFieldType } from '../data/types'
import {
  listGaps,
  listGapsByStep,
  getGap,
  createGap as dbCreateGap,
  updateGap as dbUpdateGap,
  deleteGap as dbDeleteGap,
  closeGap as dbCloseGap,
} from '../services/db'
import { logger } from '../lib/logger'
import { defaultGapSort, parseGapSort, type GapSort } from '../lib/gapSort'
import { createRequestGuard } from './requestGuard'
import { captureProjectScope, isProjectScopeCurrent, resolveProjectId } from './workspaceScope'

const loadGuard = createRequestGuard()
const selectionGuard = createRequestGuard()

/**
 * Filter state for gap filtering
 */
export interface GapFilters {
  // Status filters
  statuses: GapStatus[]

  // Team filter (owner)
  ownerTeamIds: string[]
  includeUnassigned: boolean

  // SIPOC missing field filters
  missingFields: MissingFieldType[]
  includeDeadEnd: boolean

  // Severity filter
  severities: SeverityLevel[]

  // Priority filter
  priorities: number[]

  // Root cause filter
  rootCauses: RootCauseType[]

  // Search query
  searchQuery: string
}

/**
 * Default filter state (Open status only)
 */
export const defaultFilters: GapFilters = {
  statuses: ['Open'],
  ownerTeamIds: [],
  includeUnassigned: false,
  missingFields: [],
  includeDeadEnd: false,
  severities: [],
  priorities: [],
  rootCauses: [],
  searchQuery: '',
}

/**
 * Outcome of a bulk status run. `failed` carries every id that did not end up
 * with the requested status — write errors, gaps that no longer exist, and ids
 * never attempted because the run aborted — so the caller can keep exactly
 * those rows selected for a retry.
 */
export interface BulkStatusResult {
  updated: string[]
  failed: string[]
}

interface GapsStore {
  // State
  gaps: Gap[]
  currentProjectId: string | null
  currentGap: Gap | null
  isLoading: boolean

  // Filter state
  filters: GapFilters
  isFilterPanelOpen: boolean

  // Sort state for the gap list table
  sort: GapSort

  // Actions
  loadGaps: (projectId: string) => Promise<void>
  loadGapsByStep: (stepId: string, projectId?: string) => Promise<void>
  addGap: (
    data: Omit<Gap, 'id' | 'createdAt' | 'updatedAt'>,
    options?: { silent?: boolean }
  ) => Promise<Gap | null>
  updateGap: (gapId: string, data: GapUpdate, explicitProjectId?: string, options?: { silent?: boolean }) => Promise<void>
  deleteGap: (gapId: string, explicitProjectId?: string) => Promise<void>
  closeGap: (gapId: string, explicitProjectId?: string) => Promise<void>
  selectGap: (gapId: string) => Promise<void>
  clearSelection: () => void
  bulkUpdateStatus: (
    gapIds: string[],
    status: GapStatus,
    explicitProjectId?: string
  ) => Promise<BulkStatusResult>
  promoteGapsForFilledFields: (
    stepId: string,
    filledFields: MissingFieldType[],
    explicitProjectId?: string
  ) => Promise<string[]>

  // Filter actions
  setFilters: (filters: Partial<GapFilters>) => void
  clearFilters: () => void
  toggleFilterPanel: () => void
  getFilteredGaps: () => Gap[]
  getActiveFilterCount: () => number

  // Sort actions
  setSort: (sort: GapSort) => void

  // Utility
  clearGaps: () => void
}

/**
 * The `isLoading` contract (#98).
 *
 * **What it covers.** `isLoading` is the flag for the `gaps` collection: every
 * action that replaces or mutates it — `loadGaps`, `loadGapsByStep`, `addGap`,
 * `updateGap`, `deleteGap`, `closeGap`, `bulkUpdateStatus` — sets it true before
 * its first await and clears it in a `finally` when the guard reports this was
 * the last request in flight. `loadGuard.finish` is that whole test: it returns
 * `isCurrent && activeRequests.size === 0`, so a newer request has either evicted
 * this record or is still in the map, and overlapping writes hold the flag up
 * until the last one lands.
 *
 * **Clearing is never gated on project scope.** Scope decides whether *data* may
 * be written, not whether the spinner may stop. A scope conjunct on the clear can
 * only ever subtract from `finish()`, and what it subtracts is the case where
 * nothing clears the flag at all — `GapsPanel` then spins on a list that has
 * finished loading. `isProjectScopeCurrent` still guards every `set` in the
 * collection actions below that touches `gaps` or `currentGap`, which is what
 * eef5aa0 (ZIP-664) was protecting. `selectGap` is the exception — it carries no
 * project scope at all, only its own `selectionGuard` — so do not read this as
 * ZIP-664 covering `currentGap` everywhere.
 *
 * **Anything that invalidates the guards clears the flag itself.** After
 * `loadGuard.invalidate()` every outstanding `finish()` returns false, so
 * `clearGaps` resets `isLoading` rather than leaving it to a `finally` that can no
 * longer run.
 *
 * **`selectGap` is deliberately outside the flag.** It writes `currentGap` only
 * and never touches the collection, and `GapsPanel` renders a full-panel
 * "Loading gaps..." in place of the list whenever `isLoading` is true — so wiring
 * selection in would blank the list on every search-result click. It gets its own
 * `selectionGuard` instead. `promoteGapsForFilledFields` likewise leaves the flag
 * to `bulkUpdateStatus`: its own `listGapsByStep` read never lands in `gaps`.
 *
 * **Errors are reported exactly once, in one of two shapes.** `updateGap`,
 * `deleteGap` and `closeGap` toast and rethrow, because their callers reseal a
 * milestone's order and must be able to tell a failed write from a successful one
 * (#349, #353). `addGap` returns `null` and `bulkUpdateStatus` returns its
 * `{ updated, failed }` split, because both have a result the caller already has
 * to inspect. Neither shape swallows: a write the user is not told about is a
 * different bug.
 */
export const useGapsStore = create<GapsStore>((set, get) => ({
  // Initial state
  gaps: [],
  currentProjectId: null,
  currentGap: null,
  isLoading: false,
  filters: defaultFilters,
  isFilterPanelOpen: false,
  sort: defaultGapSort,

  /**
   * Load all gaps for a project
   */
  loadGaps: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId, 'project')
    try {
      set({ isLoading: true, currentProjectId: projectId })
      const gaps = await listGaps(projectId)
      if (loadGuard.isCurrent(requestId, projectId, 'project') && isProjectScopeCurrent(scope)) {
        set({ gaps })
        logger.info(`Loaded ${gaps.length} gaps for project ${projectId}`)
      }
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId, 'project') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load gaps', error)
        toast.error('Failed to load gaps')
        set({ gaps: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId, 'project')) set({ isLoading: false })
    }
  },

  /**
   * Load gaps for a specific step
   */
  loadGapsByStep: async (stepId: string, explicitProjectId?: string) => {
    const projectId = explicitProjectId ?? get().currentProjectId
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId, 'step')
    try {
      set({ isLoading: true, currentProjectId: projectId })
      const gaps = await listGapsByStep(stepId, projectId)
      if (loadGuard.isCurrent(requestId, projectId, 'step') && isProjectScopeCurrent(scope)) {
        set({ gaps })
        logger.info(`Loaded ${gaps.length} gaps for step ${stepId}`)
      }
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId, 'step') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load gaps for step', error)
        toast.error('Failed to load gaps for step')
        set({ gaps: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId, 'step')) set({ isLoading: false })
    }
  },

  /**
   * Create a new gap
   */
  addGap: async (
    data: Omit<Gap, 'id' | 'createdAt' | 'updatedAt'>,
    options?: { silent?: boolean }
  ) => {
    const scope = captureProjectScope(data.projectId)
    if (!scope) return null
    const operationId = loadGuard.begin(data.projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      const gapId = await dbCreateGap(data)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      const newGap = await getGap(gapId, data.projectId)

      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      if (newGap) {
        set((state) => ({
          gaps: [newGap, ...state.gaps], // Add to front (most recent first)
        }))
        // `silent` as on `updateGap`: the SIPOC wizard can open several gaps in
        // one confirm and counts them on its landing panel (#220).
        if (!options?.silent) toast.success('Gap created')
        return newGap
      }
      return null
    } catch (error) {
      if (loadGuard.isCurrent(operationId, data.projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to create gap', error)
        toast.error('Failed to create gap')
      }
      return null
    } finally {
      if (loadGuard.finish(operationId, data.projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Update a gap
   */
  /**
   * `silent` suppresses the success toast only. A caller rewriting many gaps in
   * one pass — the step re-sync in `state/gapResync.ts` — reports the run once
   * instead of once per gap, which is the shape #107 asked for. Failures still
   * toast: a write the user is not told about is a different bug.
   */
  updateGap: async (gapId: string, data: GapUpdate, explicitProjectId?: string, options?: { silent?: boolean }) => {
    const entity = get().gaps.find(gap => gap.id === gapId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      const updatedGap = await dbUpdateGap(gapId, data, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      if (!updatedGap) {
        throw new Error(`Gap not found: ${gapId}`)
      }

      set((state) => ({
        gaps: state.gaps.map((gap) => gap.id === gapId ? updatedGap : gap),
        currentGap: state.currentGap?.id === gapId ? updatedGap : state.currentGap,
      }))

      if (!options?.silent) toast.success('Gap updated')
    } catch (error) {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to update gap', error)
        toast.error('Failed to update gap')
        throw error
      }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Set the same status on many gaps at once (gap list bulk action).
   *
   * Writes are sequential so a mid-run project switch stops the rest, and the
   * whole run reports through a single toast rather than one per gap.
   *
   * Reference: PRD Section 4.7.3 - Gap List View, Bulk Actions
   */
  bulkUpdateStatus: async (gapIds: string[], status: GapStatus, explicitProjectId?: string) => {
    if (gapIds.length === 0) return { updated: [], failed: [] }

    const first = get().gaps.find(gap => gapIds.includes(gap.id))
    const projectId = resolveProjectId(explicitProjectId, first?.projectId, get().currentProjectId)
    if (!projectId) {
      // Silent on a single row is tolerable; on a bulk action the user pressed a
      // button showing a count and deserves a trace of why nothing happened.
      logger.warn('Bulk status update skipped: could not resolve a project for the selection')
      return { updated: [], failed: gapIds }
    }
    const scope = captureProjectScope(projectId)
    if (!scope) {
      logger.warn(`Bulk status update skipped: project ${projectId} is no longer the active scope`)
      return { updated: [], failed: gapIds }
    }
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      // Closing stamps closedAt; reopening clears it, so a reopened gap does not
      // keep a stale close date.
      const patch: GapUpdate =
        status === 'Closed' ? { status, closedAt: Date.now() } : { status, closedAt: null }

      const updated: Gap[] = []
      const errored: string[] = []
      const missing: string[] = []
      let aborted = false

      for (const [index, gapId] of gapIds.entries()) {
        let result: Gap | null = null
        try {
          result = await dbUpdateGap(gapId, patch, projectId)
        } catch (error) {
          // Logged before the scope check: a write that failed mid-batch must
          // leave a trace even if the user has since navigated away, otherwise
          // the error object is discarded and nothing records it anywhere.
          logger.error(`Failed to update gap status: ${gapId}`, error)
          errored.push(gapId)
          if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) {
            aborted = true
            break
          }
          continue
        }

        if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) {
          // Earlier writes already committed. State stays correct because the
          // next loadGaps re-reads from SQLite, but the partial run must be
          // recorded rather than vanishing.
          logger.warn(
            `Bulk status update aborted after ${index} of ${gapIds.length} writes committed (project scope changed)`
          )
          aborted = true
          break
        }

        if (result) {
          updated.push(result)
        } else {
          // dbUpdateGap returns null only when the gap is gone from this project.
          logger.error(`Gap not found during bulk status update: ${gapId}`)
          missing.push(gapId)
        }
      }

      if (updated.length > 0) {
        const byId = new Map(updated.map(gap => [gap.id, gap]))
        set((state) => ({
          gaps: state.gaps.map((gap) => byId.get(gap.id) ?? gap),
          currentGap: state.currentGap ? byId.get(state.currentGap.id) ?? state.currentGap : state.currentGap,
        }))
      }

      if (aborted) {
        const attempted = new Set([...updated.map(g => g.id), ...errored, ...missing])
        return { updated: updated.map(g => g.id), failed: gapIds.filter(id => !attempted.has(id)) }
      }

      if (updated.length > 0) {
        toast.success(`${updated.length} gap${updated.length > 1 ? 's' : ''} moved to ${status}`)
      }
      if (missing.length > 0) {
        toast.error(`${missing.length} gap${missing.length > 1 ? 's' : ''} no longer exist${missing.length > 1 ? '' : 's'}`)
      }
      if (errored.length > 0) {
        toast.error(`Failed to update ${errored.length} gap${errored.length > 1 ? 's' : ''}`)
      }

      return { updated: updated.map(g => g.id), failed: [...errored, ...missing] }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Move a step's Open gaps to Review because the fields they were raised
   * against have just been filled.
   *
   * Reads from SQLite rather than `gaps` state: a step edit in the Discovery
   * grid runs with no gaps loaded, and the whole point is to catch every gap on
   * the step, not the subset the current tab happens to hold. Returns the ids
   * that moved so callers can log a no-op distinctly from a failure.
   *
   * Reference: PRD Section 4.7.2 - Auto-Status Logic
   */
  promoteGapsForFilledFields: async (
    stepId: string,
    filledFields: MissingFieldType[],
    explicitProjectId?: string
  ) => {
    if (filledFields.length === 0) return []

    const projectId = resolveProjectId(explicitProjectId, undefined, get().currentProjectId)
    if (!projectId) return []
    const scope = captureProjectScope(projectId)
    if (!scope) return []

    const gapsOnStep = await listGapsByStep(stepId, projectId)
    if (!isProjectScopeCurrent(scope)) return []

    const filled = new Set<MissingFieldType>(filledFields)
    const promotable = gapsOnStep
      .filter(gap => gap.status === 'Open' && gap.missingField !== undefined && filled.has(gap.missingField))
      .map(gap => gap.id)
    if (promotable.length === 0) return []

    // bulkUpdateStatus already owns the sequential writes, the scope aborts, the
    // id-replace state merge and the single toast; a second loop here would only
    // drift from it.
    const result = await get().bulkUpdateStatus(promotable, 'Review', projectId)
    return result.updated
  },

  /**
   * Delete a gap, and say so when it fails.
   *
   * It used to catch, toast and return normally, so both call sites resealed
   * the milestone as though the gap had gone — pulling the steps above it down
   * onto the order the gap was still holding, which is read as a parallel
   * branch nobody asked for (#349). Rethrowing is what lets a caller skip the
   * reseal; the toast stays, so the failure is still reported exactly once.
   */
  deleteGap: async (gapId: string, explicitProjectId?: string) => {
    const entity = get().gaps.find(gap => gap.id === gapId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      await dbDeleteGap(gapId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      // Remove from local state
      set((state) => ({
        gaps: state.gaps.filter((gap) => gap.id !== gapId),
        currentGap: state.currentGap?.id === gapId ? null : state.currentGap,
      }))

      toast.success('Gap deleted')
    } catch (error) {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to delete gap', error)
        toast.error('Failed to delete gap')
      }
      throw error
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Close a gap, and say so when it fails.
   *
   * The Addendum promoted closing to a sequence event — a Closed gap leaves the
   * sequence, so the position it held becomes a hole (#353 clause 9) — which
   * makes this the same shape as `deleteStep` and `deleteGap`: a caller that
   * cannot tell a failed close from a successful one reseals for a row that is
   * still there, and reports success on top of it. `GapForm` toasts "Gap
   * closed successfully" straight after this call.
   *
   * The toast stays, so the failure is still reported exactly once.
   */
  closeGap: async (gapId: string, explicitProjectId?: string) => {
    const entity = get().gaps.find(gap => gap.id === gapId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      await dbCloseGap(gapId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      const now = Date.now()

      // Update local state
      set((state) => ({
        gaps: state.gaps.map((gap) =>
          gap.id === gapId
            ? { ...gap, status: 'Closed', closedAt: now, updatedAt: now }
            : gap
        ),
        currentGap:
          state.currentGap?.id === gapId
            ? { ...state.currentGap, status: 'Closed', closedAt: now, updatedAt: now }
            : state.currentGap,
      }))

      toast.success('Gap closed')
    } catch (error) {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to close gap', error)
        toast.error('Failed to close gap')
      }
      throw error
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  /**
   * Select a gap (for viewing/editing)
   */
  selectGap: async (gapId: string) => {
    const requestId = selectionGuard.begin(gapId)
    try {
      const gap = await getGap(gapId)
      if (selectionGuard.isCurrent(requestId, gapId)) {
        set({ currentGap: gap })
        if (!gap) toast.error('Gap not found')
      }
    } catch (error) {
      logger.error('Failed to select gap', error)
      if (selectionGuard.isCurrent(requestId, gapId)) {
        set({ currentGap: null })
        toast.error('Failed to load gap details')
      }
    } finally {
      selectionGuard.finish(requestId, gapId)
    }
  },

  /**
   * Clear gap selection
   */
  clearSelection: () => {
    selectionGuard.invalidate()
    set({ currentGap: null })
  },

  /**
   * Clear all gaps (for cleanup)
   */
  clearGaps: () => {
    loadGuard.invalidate()
    selectionGuard.invalidate()
    // `isLoading` is reset here rather than left to the in-flight actions:
    // `invalidate()` empties the guard, so every outstanding `finish()` now
    // returns false and no `finally` will ever clear the flag again.
    set({ gaps: [], currentGap: null, currentProjectId: null, isLoading: false })
  },

  /**
   * Set filters (partial update)
   */
  setFilters: (newFilters: Partial<GapFilters>) => {
    set((state) => ({
      filters: { ...state.filters, ...newFilters }
    }))

    // Save to localStorage
    const filters = { ...get().filters, ...newFilters }
    localStorage.setItem('gapFilters', JSON.stringify(filters))
  },

  /**
   * Clear all filters (reset to default: Open only)
   */
  clearFilters: () => {
    set({ filters: defaultFilters })
    localStorage.setItem('gapFilters', JSON.stringify(defaultFilters))
  },

  /**
   * Toggle filter panel open/closed
   */
  toggleFilterPanel: () => {
    set((state) => ({ isFilterPanelOpen: !state.isFilterPanelOpen }))
  },

  /**
   * Set the gap table sort column and direction.
   *
   * Persisted under its own key rather than inside `gapFilters`: that blob is
   * rehydrated with an unvalidated JSON.parse, and sort state is validated.
   */
  setSort: (sort: GapSort) => {
    set({ sort })
    localStorage.setItem('gapSort', JSON.stringify(sort))
  },

  /**
   * Get filtered gaps based on current filter state
   * Uses AND logic: gaps must match ALL active filters
   */
  getFilteredGaps: () => {
    const { gaps, filters } = get()

    return gaps.filter(gap => {
      // Status filter
      if (filters.statuses.length > 0 && !filters.statuses.includes(gap.status)) {
        return false
      }

      // Owner team filter
      if (filters.ownerTeamIds.length > 0 || filters.includeUnassigned) {
        const hasTeam = filters.ownerTeamIds.includes(gap.ownerTeamId || '')
        const isUnassigned = !gap.ownerTeamId && filters.includeUnassigned
        if (!hasTeam && !isUnassigned) {
          return false
        }
      }

      // Missing field filter
      if (filters.missingFields.length > 0) {
        if (!gap.missingField || !filters.missingFields.includes(gap.missingField)) {
          return false
        }
      }

      // Dead end filter (gaps with no customers or customers that don't match next suppliers)
      // This is approximated - actual dead end detection would need step data
      if (filters.includeDeadEnd) {
        // For now, just check if missing "customer" field
        if (gap.missingField !== 'customer') {
          return false
        }
      }

      // Severity filter
      if (filters.severities.length > 0 && !filters.severities.includes(gap.severity)) {
        return false
      }

      // Priority filter
      if (filters.priorities.length > 0) {
        if (!gap.priority || !filters.priorities.includes(gap.priority)) {
          return false
        }
      }

      // Root cause filter
      if (filters.rootCauses.length > 0) {
        if (!gap.rootCause || !filters.rootCauses.includes(gap.rootCause)) {
          return false
        }
      }

      // Search query (searches all text fields)
      if (filters.searchQuery.trim()) {
        const query = filters.searchQuery.toLowerCase()
        const searchableText = [
          gap.observed,
          gap.expected,
          gap.fixIdea || '',
          gap.rootCause || '',
        ].join(' ').toLowerCase()

        if (!searchableText.includes(query)) {
          return false
        }
      }

      return true
    })
  },

  /**
   * Get count of active filters (excluding defaults)
   */
  getActiveFilterCount: () => {
    const { filters } = get()
    let count = 0

    // Count non-default filters
    if (filters.statuses.length !== 1 || filters.statuses[0] !== 'Open') {
      count++
    }
    if (filters.ownerTeamIds.length > 0) count++
    if (filters.includeUnassigned) count++
    if (filters.missingFields.length > 0) count++
    if (filters.includeDeadEnd) count++
    if (filters.severities.length > 0) count++
    if (filters.priorities.length > 0) count++
    if (filters.rootCauses.length > 0) count++
    if (filters.searchQuery.trim()) count++

    return count
  },
}))

// Load filters from localStorage on initialization
const savedFilters = localStorage.getItem('gapFilters')
if (savedFilters) {
  try {
    const parsed = JSON.parse(savedFilters)
    useGapsStore.setState({ filters: parsed })
  } catch (e) {
    logger.error('Failed to load saved filters', e)
  }
}

// Load sort from localStorage on initialization
const savedSort = localStorage.getItem('gapSort')
if (savedSort) {
  try {
    useGapsStore.setState({ sort: parseGapSort(JSON.parse(savedSort)) })
  } catch (e) {
    logger.error('Failed to load saved gap sort', e)
  }
}
