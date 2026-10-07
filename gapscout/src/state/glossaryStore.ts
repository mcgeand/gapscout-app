import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { GlossaryEntry } from '../data/types'
import {
  createGlossaryEntry as dbCreateGlossaryEntry,
  listGlossaryEntries,
  updateGlossaryEntry as dbUpdateGlossaryEntry,
  deleteGlossaryEntry as dbDeleteGlossaryEntry,
} from '../services/db'
import { logger } from '../lib/logger'
import { createRequestGuard } from './requestGuard'
import { captureProjectScope, isProjectScopeCurrent, resolveProjectId } from './workspaceScope'

const loadGuard = createRequestGuard()

interface GlossaryStore {
  entries: GlossaryEntry[]
  currentProjectId: string | null
  isLoading: boolean

  loadGlossary: (projectId: string) => Promise<void>
  addGlossaryEntry: (data: {
    projectId: string
    term: string
    definition: string
    acronym?: string
    relatedSteps?: string[]
    tags?: string[]
  }) => Promise<GlossaryEntry | null>
  updateGlossaryEntry: (
    entryId: string,
    data: Partial<Omit<GlossaryEntry, 'id' | 'projectId' | 'createdAt'>>,
    explicitProjectId?: string,
  ) => Promise<void>
  deleteGlossaryEntry: (entryId: string, explicitProjectId?: string) => Promise<void>
  clearGlossary: () => void
}

// `isLoading` follows the contract written above `useGapsStore` in
// `./gapsStore.ts`: cleared whenever `loadGuard.finish` says this was the last
// request in flight, never gated on project scope (#98, #405).
export const useGlossaryStore = create<GlossaryStore>((set, get) => ({
  entries: [],
  currentProjectId: null,
  isLoading: false,

  loadGlossary: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId)
    try {
      set({ isLoading: true, currentProjectId: projectId })
      const entries = await listGlossaryEntries(projectId)
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) set({ entries })
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load glossary', error)
        toast.error('Failed to load glossary')
        set({ entries: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId)) set({ isLoading: false })
    }
  },

  addGlossaryEntry: async (data) => {
    const scope = captureProjectScope(data.projectId)
    if (!scope) return null
    const operationId = loadGuard.begin(data.projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      if (!data.term || data.term.trim().length === 0) {
        toast.error('Term is required')
        return null
      }
      if (!data.definition || data.definition.trim().length === 0) {
        toast.error('Definition is required')
        return null
      }

      const entryId = await dbCreateGlossaryEntry({
        projectId: data.projectId,
        term: data.term.trim(),
        definition: data.definition.trim(),
        acronym: data.acronym?.trim() || undefined,
        relatedSteps: data.relatedSteps || [],
        tags: data.tags || [],
      })

      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      toast.success(`Term "${data.term}" added`)
      await get().loadGlossary(data.projectId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null

      return get().entries.find((e) => e.id === entryId) || null
    } catch (error) {
      if (loadGuard.isCurrent(operationId, data.projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to create glossary entry', error)
        toast.error('Failed to add term')
      }
      return null
    } finally {
      if (loadGuard.finish(operationId, data.projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  updateGlossaryEntry: async (entryId, data, explicitProjectId?: string) => {
    const entity = get().entries.find(entry => entry.id === entryId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      await dbUpdateGlossaryEntry(entryId, data, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      toast.success('Term updated')

      await get().loadGlossary(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to update glossary entry', error)
      toast.error('Failed to update term')
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  deleteGlossaryEntry: async (entryId, explicitProjectId?: string) => {
    const entry = get().entries.find((e) => e.id === entryId)
    const projectId = resolveProjectId(explicitProjectId, entry?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      await dbDeleteGlossaryEntry(entryId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      toast.success(`Term "${entry?.term || 'Unknown'}" deleted`)

      await get().loadGlossary(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to delete glossary entry', error)
      toast.error('Failed to delete term')
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  clearGlossary: () => {
    loadGuard.invalidate()
    // `invalidate()` empties the guard, so no in-flight `finally` can clear
    // `isLoading` any more; it has to be reset here.
    set({ entries: [], currentProjectId: null, isLoading: false })
  },
}))
