/**
 * Teams Store - Zustand store for managing teams registry
 *
 * Handles team list per project, CRUD operations, and reordering.
 * Teams define who owns which process steps.
 */

import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Team } from '../data/types'
import {
  createTeam as dbCreateTeam,
  listTeams,
  updateTeam as dbUpdateTeam,
  deleteTeam as dbDeleteTeam,
  getTeamUsageCount,
  getTeamReferenceCount,
} from '../services/db'
import { logger } from '../lib/logger'
import { createRequestGuard } from './requestGuard'
import { captureProjectScope, isProjectScopeCurrent, resolveProjectId } from './workspaceScope'

const loadGuard = createRequestGuard()

interface TeamsStore {
  // State
  teams: Team[]
  currentProjectId: string | null
  isLoading: boolean

  // Actions
  loadTeams: (projectId: string) => Promise<void>
  addTeam: (
    data: {
      projectId: string
      name: string
      color: string
      description?: string
      tags?: string[]
    },
    options?: { silent?: boolean }
  ) => Promise<Team | null>
  updateTeam: (teamId: string, data: Partial<Team>, explicitProjectId?: string) => Promise<void>
  deleteTeam: (teamId: string, explicitProjectId?: string) => Promise<void>
  reorderTeams: (teamId: string, newOrder: number, explicitProjectId?: string) => Promise<void>
  clearTeams: () => void
}

// `isLoading` follows the contract written above `useGapsStore` in
// `./gapsStore.ts`: cleared whenever `loadGuard.finish` says this was the last
// request in flight, never gated on project scope (#98, #405).
export const useTeamsStore = create<TeamsStore>((set, get) => ({
  // Initial state
  teams: [],
  currentProjectId: null,
  isLoading: false,

  // Load all teams for a project
  loadTeams: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId)
    try {
      set({ isLoading: true, currentProjectId: projectId })
      const teams = await listTeams(projectId)
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.info(`Loaded ${teams.length} teams for project ${projectId}`)
        set({ teams })
      }
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load teams', error)
        toast.error('Failed to load teams')
        set({ teams: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId)) set({ isLoading: false })
    }
  },

  // Add a new team
  addTeam: async (data, options) => {
    const scope = captureProjectScope(data.projectId)
    if (!scope) return null
    const operationId = loadGuard.begin(data.projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      // Validate
      if (!data.name || data.name.trim().length === 0) {
        toast.error('Team name is required')
        return null
      }

      // Get current teams to determine order
      const currentTeams = get().teams
      const maxOrder = currentTeams.length > 0
        ? Math.max(...currentTeams.map(t => t.order))
        : 0

      // Create team with next order number
      const teamId = await dbCreateTeam({
        projectId: data.projectId,
        name: data.name.trim(),
        color: data.color,
        description: data.description?.trim(),
        tags: data.tags || [],
        order: maxOrder + 1,
      })

      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      logger.info('Created team', teamId)
      // `silent` suppresses the success toast only, matching `updateGap`. The
      // SIPOC wizard creates a team per reviewed owner and reports the total on
      // its landing panel, so a toast per team stacks over the panel that
      // replaced them (#220).
      if (!options?.silent) toast.success(`Team "${data.name}" created`)

      // Reload teams for this project
      await get().loadTeams(data.projectId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null

      // Return the newly created team
      return get().teams.find(t => t.id === teamId) || null
    } catch (error) {
      if (loadGuard.isCurrent(operationId, data.projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to create team', error)
        toast.error('Failed to create team')
      }
      return null
    } finally {
      if (loadGuard.finish(operationId, data.projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // Update an existing team
  updateTeam: async (teamId: string, data: Partial<Team>, explicitProjectId?: string) => {
    const entity = get().teams.find(t => t.id === teamId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      await dbUpdateTeam(teamId, data, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Updated team', teamId)
      toast.success('Team updated')

      await get().loadTeams(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (loadGuard.isCurrent(operationId, projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to update team', error)
        toast.error('Failed to update team')
      }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // Delete a team (with dependency pre-check)
  deleteTeam: async (teamId: string, explicitProjectId?: string) => {
    const team = get().teams.find(t => t.id === teamId)
    const projectId = resolveProjectId(explicitProjectId, team?.projectId, get().currentProjectId)
    if (!projectId) {
      logger.error('Cannot check team usage: no projectId available')
      toast.error('Cannot delete team: no project selected')
      return
    }
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      if (!projectId) {
        logger.error('Cannot check team usage: no projectId available')
        toast.error('Cannot delete team: no project selected')
        return
      }

      const usageCount = await getTeamUsageCount(teamId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      if (usageCount > 0) {
        toast.error(
          `Cannot delete team "${team?.name || 'Unknown'}" — used by ${usageCount} step${usageCount === 1 ? '' : 's'}`
        )
        return
      }

      // Supplier/customer chips hold the team NAME, not its id, so they survive
      // the delete as dead text (#173). That does not block the delete — the
      // issue defers both blocking and cleanup — but the success toast names
      // how much is left behind. Without a name there is nothing to count.
      const referenceCount = team?.name
        ? await getTeamReferenceCount(team.name, projectId).catch(error => {
            logger.warn('Reference count failed; deleting without naming leftovers', error)
            return 0
          })
        : 0
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      await dbDeleteTeam(teamId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info('Deleted team', teamId)
      const deletedName = team?.name || 'Unknown'
      toast.success(
        referenceCount > 0
          ? `Team "${deletedName}" deleted — still named as supplier or customer on ${referenceCount} step${referenceCount === 1 ? '' : 's'}`
          : `Team "${deletedName}" deleted`
      )

      // Reload teams for current project
      await get().loadTeams(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to delete team', error)

      const errorStr = String(error)
      if (errorStr.includes('FOREIGN KEY') || errorStr.includes('constraint')) {
        toast.error('Cannot delete team: steps are still assigned to it')
      } else {
        toast.error('Failed to delete team')
      }
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // Reorder a team (update its order field)
  reorderTeams: async (teamId: string, newOrder: number, explicitProjectId?: string) => {
    const teams = get().teams
    const team = teams.find(t => t.id === teamId)
    const projectId = resolveProjectId(explicitProjectId, team?.projectId, get().currentProjectId)
    if (!team || !projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      if (!team) {
        throw new Error('Team not found')
      }

      const oldOrder = team.order

      // Update orders for all affected teams
      // If moving up (newOrder < oldOrder), shift others down
      // If moving down (newOrder > oldOrder), shift others up
      const updates: Promise<void>[] = []

      if (newOrder < oldOrder) {
        // Moving up: increment order for teams between newOrder and oldOrder
        teams
          .filter(t => t.order >= newOrder && t.order < oldOrder)
          .forEach(t => {
            updates.push(dbUpdateTeam(t.id, { order: t.order + 1 }, projectId))
          })
      } else if (newOrder > oldOrder) {
        // Moving down: decrement order for teams between oldOrder and newOrder
        teams
          .filter(t => t.order > oldOrder && t.order <= newOrder)
          .forEach(t => {
            updates.push(dbUpdateTeam(t.id, { order: t.order - 1 }, projectId))
          })
      }

      // Update the target team's order
      updates.push(dbUpdateTeam(teamId, { order: newOrder }, projectId))

      // Execute all updates
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      await Promise.all(updates)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return

      logger.info(`Reordered team ${teamId} from ${oldOrder} to ${newOrder}`)
      toast.success('Team order updated')

      // Reload teams for current project
      await get().loadTeams(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to reorder teams', error)
      toast.error('Failed to reorder teams')
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  // Clear teams (when switching projects)
  clearTeams: () => {
    loadGuard.invalidate()
    // `invalidate()` empties the guard, so no in-flight `finally` can clear
    // `isLoading` any more; it has to be reset here.
    set({ teams: [], currentProjectId: null, isLoading: false })
    logger.info('Cleared teams')
  },
}))
