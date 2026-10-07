/**
 * Project Store - Zustand store for managing projects
 *
 * Handles project list, current project selection, and all CRUD operations.
 * Integrates with SQLite database via Tauri plugin.
 */

import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Project, ProjectChanges, ProjectState, ProjectSummary } from '../data/types'
import {
  initDB,
  listProjects,
  getProject,
  createProject as dbCreateProject,
  updateProject as dbUpdateProject,
  deleteProject as dbDeleteProject
} from '../services/db'
import { logger } from '../lib/logger'
import { createRequestGuard } from './requestGuard'

const selectionGuard = createRequestGuard()

interface ProjectStore {
  // State
  /**
   * Summaries, not bare projects: the list draws each project's step and open
   * gap counts, and `listProjects` computes them in the read it was already
   * doing (#213). `currentProject` stays a plain `Project` — the board reads
   * its own steps and gaps and has no use for a snapshot count.
   */
  projects: ProjectSummary[]
  currentProject: Project | null
  isLoading: boolean
  isInitialized: boolean

  // Actions
  initialize: () => Promise<void>
  loadProjects: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  createProject: (
    data: {
      name: string
      description?: string
      /** Defaults to nothing — a project nobody classifies carries no state (#263). */
      state?: ProjectState
    },
    options?: { silent?: boolean }
  ) => Promise<Project | null>
  updateProject: (projectId: string, data: ProjectChanges) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  clearSelection: () => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  projects: [],
  currentProject: null,
  isLoading: false,
  isInitialized: false,

  // Initialize database and load projects
  initialize: async () => {
    try {
      set({ isLoading: true })

      // Initialize database
      await initDB()
      logger.info('Database initialized')

      // Load projects
      await get().loadProjects()

      set({ isInitialized: true })
    } catch (error) {
      logger.error('Failed to initialize project store', error)
      toast.error('Failed to initialize database')
    } finally {
      set({ isLoading: false })
    }
  },

  // Load all projects from database
  loadProjects: async () => {
    try {
      set({ isLoading: true })

      const projects = await listProjects()
      logger.info(`Loaded ${projects.length} projects`)

      set({ projects })
    } catch (error) {
      logger.error('Failed to load projects', error)
      toast.error('Failed to load projects')
    } finally {
      set({ isLoading: false })
    }
  },

  // Select and load a specific project
  selectProject: async (projectId: string) => {
    const requestId = selectionGuard.begin(projectId)
    try {
      set({ isLoading: true, currentProject: null })

      const project = await getProject(projectId)

      if (selectionGuard.isCurrent(requestId, projectId)) {
        if (project) {
          set({ currentProject: project })
          logger.info('Selected project', project.name)
        } else {
          set({ currentProject: null })
          toast.error('Project not found')
        }
      }
    } catch (error) {
      logger.error('Failed to select project', error)
      if (selectionGuard.isCurrent(requestId, projectId)) {
        set({ currentProject: null })
        toast.error('Failed to load project')
      }
    } finally {
      if (selectionGuard.finish(requestId, projectId)) set({ isLoading: false })
    }
  },

  // Create a new project
  createProject: async (
    data: { name: string; description?: string; state?: ProjectState },
    options?: { silent?: boolean }
  ) => {
    try {
      set({ isLoading: true })

      // Validate
      if (!data.name || data.name.trim().length === 0) {
        toast.error('Project name is required')
        return null
      }

      // Create project - returns the new project ID
      const projectId = await dbCreateProject({
        name: data.name.trim(),
        description: data.description?.trim(),
        state: data.state,
      })

      logger.info('Created project with ID', projectId)
      if (!options?.silent) toast.success(`Project "${data.name}" created`)

      // Reload projects list
      await get().loadProjects()

      // Get the newly created project
      return await getProject(projectId)
    } catch (error) {
      logger.error('Failed to create project', error)
      toast.error('Failed to create project')
      return null
    } finally {
      set({ isLoading: false })
    }
  },

  // Update an existing project
  updateProject: async (projectId: string, data: ProjectChanges) => {
    try {
      set({ isLoading: true })

      // Trim on the way in, as `createProject` does. An untrimmed name was
      // harmless before, but a rename now clears `legacy_name` (#265): a name
      // differing from the stored one only by whitespace would read as a
      // rename and destroy migration v6's record of the original.
      await dbUpdateProject(projectId, {
        ...data,
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      })

      logger.info('Updated project', projectId)
      toast.success('Project updated')

      // Reload projects list
      await get().loadProjects()

      // If this is the current project, reload it
      if (get().currentProject?.id === projectId) {
        await get().selectProject(projectId)
      }
    } catch (error) {
      logger.error('Failed to update project', error)
      toast.error('Failed to update project')
    } finally {
      set({ isLoading: false })
    }
  },

  // Delete a project
  deleteProject: async (projectId: string) => {
    try {
      set({ isLoading: true })

      const project = get().projects.find(p => p.id === projectId)

      await dbDeleteProject(projectId)

      logger.info('Deleted project', projectId)
      toast.success(`Project "${project?.name || 'Unknown'}" deleted`)

      // Clear selection if deleted project was selected
      if (get().currentProject?.id === projectId) {
        set({ currentProject: null })
      }

      // Reload projects list
      await get().loadProjects()
    } catch (error) {
      logger.error('Failed to delete project', error)
      toast.error('Failed to delete project')
    } finally {
      set({ isLoading: false })
    }
  },

  // Clear current project selection
  clearSelection: () => {
    selectionGuard.invalidate()
    set({ currentProject: null })
    logger.info('Cleared project selection')
  },
}))
