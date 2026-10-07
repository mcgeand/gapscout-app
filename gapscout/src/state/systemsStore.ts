/**
 * Systems Store - Zustand store for managing systems registry
 *
 * Handles system list per project, CRUD operations, and usage tracking.
 * Systems are tools/software (ERP, CRM, etc.) used in process steps.
 */

import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { System, SystemType } from '../data/types'
import {
  createSystem as dbCreateSystem,
  listSystems,
  updateSystem as dbUpdateSystem,
  deleteSystem as dbDeleteSystem,
  getSystemUsageCount,
} from '../services/db'
import { logger } from '../lib/logger'
import { createRequestGuard } from './requestGuard'
import { captureProjectScope, isProjectScopeCurrent, resolveProjectId } from './workspaceScope'

const loadGuard = createRequestGuard()

interface SystemWithUsage extends System {
  usageCount?: number
}

interface SystemsStore {
  // State
  systems: SystemWithUsage[]
  currentProjectId: string | null
  isLoading: boolean

  // Actions
  loadSystems: (projectId: string) => Promise<void>
  loadSystemsWithUsage: (projectId: string) => Promise<void>
  addSystem: (
    data: {
      projectId: string
      name: string
      description?: string
      vendor?: string
      type?: SystemType
      tags?: string[]
    },
    options?: { silent?: boolean }
  ) => Promise<System | null>
  updateSystem: (systemId: string, data: Partial<System>, explicitProjectId?: string) => Promise<void>
  deleteSystem: (systemId: string, explicitProjectId?: string) => Promise<void>
  clearSystems: () => void
}

// `isLoading` follows the contract written above `useGapsStore` in
// `./gapsStore.ts`: cleared whenever `loadGuard.finish` says this was the last
// request in flight, never gated on project scope (#98, #405).
export const useSystemsStore = create<SystemsStore>((set, get) => ({
  // Initial state
  systems: [],
  currentProjectId: null,
  isLoading: false,

  // Load all systems for a project
  loadSystems: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId)
    try {
      set({ isLoading: true, currentProjectId: projectId })

      const systems = await listSystems(projectId)
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.info(`Loaded ${systems.length} systems for project ${projectId}`)
        set({ systems })
      }
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load systems', error)
        toast.error('Failed to load systems')
        set({ systems: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId)) set({ isLoading: false })
    }
  },

  // Load systems with usage count
  loadSystemsWithUsage: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId)
    try {
      set({ isLoading: true, currentProjectId: projectId })

      const systems = await listSystems(projectId)

      // Load usage counts for all systems in parallel
      const systemsWithUsage = await Promise.all(
        systems.map(async (system) => ({
          ...system,
          usageCount: await getSystemUsageCount(system.id, projectId),
        }))
      )

      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.info(`Loaded ${systemsWithUsage.length} systems with usage counts`)
        set({ systems: systemsWithUsage })
      }
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load systems with usage', error)
        toast.error('Failed to load systems')
        set({ systems: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId)) set({ isLoading: false })
    }
  },

  // Add a new system
  addSystem: async (data, options) => {
    const scope = captureProjectScope(data.projectId)
    if (!scope) return null
    const operationId = loadGuard.begin(data.projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      // Validate
      if (!data.name || data.name.trim().length === 0) {
        toast.error('System name is required')
        return null
      }

      // Create system
      const systemId = await dbCreateSystem({
        projectId: data.projectId,
        name: data.name.trim(),
        description: data.description?.trim(),
        vendor: data.vendor?.trim(),
        type: data.type,
        tags: data.tags || [],
      })

      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      logger.info('Created system', systemId)
      if (!options?.silent) toast.success(`System "${data.name}" created`)

      // Reload systems for this project
      await get().loadSystems(data.projectId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null

      // Return the newly created system
      return get().systems.find(s => s.id === systemId) || null
    } catch (error) {
      if (loadGuard.isCurrent(operationId, data.projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to create system', error)
        toast.error('Failed to create system')
      }
      return null
    } finally {
      if (loadGuard.finish(operationId, data.projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // Update an existing system
  updateSystem: async (systemId: string, data: Partial<System>, explicitProjectId?: string) => {
    const entity = get().systems.find(s => s.id === systemId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      await dbUpdateSystem(systemId, data, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Updated system', systemId)
      toast.success('System updated')

      // Reload systems for current project
      await get().loadSystems(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to update system', error)
      toast.error('Failed to update system')
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // Delete a system (with usage check)
  deleteSystem: async (systemId: string, explicitProjectId?: string) => {
    const system = get().systems.find(s => s.id === systemId)
    const projectId = resolveProjectId(explicitProjectId, system?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      let usageCount = system?.usageCount
      if (usageCount === undefined) {
        if (!projectId) {
          logger.error('Cannot check system usage: no projectId available')
          toast.error('Cannot delete system: no project selected')
          return
        }
        usageCount = await getSystemUsageCount(systemId, projectId)
      }

      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      if (usageCount > 0) {
        toast.error(
          `Cannot delete system: ${usageCount} step${usageCount > 1 ? 's' : ''} still use${usageCount === 1 ? 's' : ''} it`
        )
        return
      }

      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      await dbDeleteSystem(systemId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Deleted system', systemId)
      toast.success(`System "${system?.name || 'Unknown'}" deleted`)

      // Reload systems for current project
      await get().loadSystems(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to delete system', error)

      const errorStr = String(error)
      if (errorStr.includes('FOREIGN KEY') || errorStr.includes('constraint')) {
        toast.error('Cannot delete system: steps are still using it')
      } else {
        toast.error('Failed to delete system')
      }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // Clear systems (when switching projects)
  clearSystems: () => {
    loadGuard.invalidate()
    // `invalidate()` empties the guard, so no in-flight `finally` can clear
    // `isLoading` any more; it has to be reset here.
    set({ systems: [], currentProjectId: null, isLoading: false })
    logger.info('Cleared systems')
  },
}))
