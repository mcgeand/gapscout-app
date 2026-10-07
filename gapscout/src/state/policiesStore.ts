import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Policy } from '../data/types'
import {
  createPolicy as dbCreatePolicy,
  listPolicies,
  updatePolicy as dbUpdatePolicy,
  deletePolicy as dbDeletePolicy,
} from '../services/db'
import { logger } from '../lib/logger'
import { createRequestGuard } from './requestGuard'
import { captureProjectScope, isProjectScopeCurrent, resolveProjectId } from './workspaceScope'

const loadGuard = createRequestGuard()

interface PoliciesStore {
  policies: Policy[]
  currentProjectId: string | null
  isLoading: boolean

  loadPolicies: (projectId: string) => Promise<void>
  addPolicy: (data: {
    projectId: string
    title: string
    content: string
    sourceDoc?: string
    relatedMilestones?: string[]
    testNotes?: string
    tags?: string[]
  }) => Promise<Policy | null>
  updatePolicy: (
    policyId: string,
    data: Partial<Omit<Policy, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>,
    explicitProjectId?: string,
  ) => Promise<void>
  deletePolicy: (policyId: string, explicitProjectId?: string) => Promise<void>
  clearPolicies: () => void
}

// `isLoading` follows the contract written above `useGapsStore` in
// `./gapsStore.ts`: cleared whenever `loadGuard.finish` says this was the last
// request in flight, never gated on project scope (#98, #405).
export const usePoliciesStore = create<PoliciesStore>((set, get) => ({
  policies: [],
  currentProjectId: null,
  isLoading: false,

  loadPolicies: async (projectId: string) => {
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const requestId = loadGuard.begin(projectId)
    try {
      set({ isLoading: true, currentProjectId: projectId })
      const policies = await listPolicies(projectId)
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) set({ policies })
    } catch (error) {
      if (loadGuard.isCurrent(requestId, projectId) && isProjectScopeCurrent(scope)) {
        logger.error('Failed to load policies', error)
        toast.error('Failed to load policies')
        set({ policies: [] })
      }
    } finally {
      if (loadGuard.finish(requestId, projectId)) set({ isLoading: false })
    }
  },

  addPolicy: async (data) => {
    const scope = captureProjectScope(data.projectId)
    if (!scope) return null
    const operationId = loadGuard.begin(data.projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })

      if (!data.title || data.title.trim().length === 0) {
        toast.error('Policy title is required')
        return null
      }
      if (!data.content || data.content.trim().length === 0) {
        toast.error('Policy content is required')
        return null
      }

      const policyId = await dbCreatePolicy({
        projectId: data.projectId,
        title: data.title.trim(),
        content: data.content.trim(),
        sourceDoc: data.sourceDoc?.trim() || undefined,
        relatedMilestones: data.relatedMilestones || [],
        testNotes: data.testNotes?.trim() || undefined,
        tags: data.tags || [],
      })

      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null
      toast.success(`Policy "${data.title}" created`)
      await get().loadPolicies(data.projectId)
      if (!loadGuard.isCurrent(operationId, data.projectId, 'mutation') || !isProjectScopeCurrent(scope)) return null

      return get().policies.find((p) => p.id === policyId) || null
    } catch (error) {
      if (loadGuard.isCurrent(operationId, data.projectId, 'mutation') && isProjectScopeCurrent(scope)) {
        logger.error('Failed to create policy', error)
        toast.error('Failed to create policy')
      }
      return null
    } finally {
      if (loadGuard.finish(operationId, data.projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  updatePolicy: async (policyId, data, explicitProjectId?: string) => {
    const entity = get().policies.find(policy => policy.id === policyId)
    const projectId = resolveProjectId(explicitProjectId, entity?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      await dbUpdatePolicy(policyId, data, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      toast.success('Policy updated')

      await get().loadPolicies(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to update policy', error)
      toast.error('Failed to update policy')
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  deletePolicy: async (policyId, explicitProjectId?: string) => {
    const policy = get().policies.find((p) => p.id === policyId)
    const projectId = resolveProjectId(explicitProjectId, policy?.projectId, get().currentProjectId)
    if (!projectId) return
    const scope = captureProjectScope(projectId)
    if (!scope) return
    const operationId = loadGuard.begin(projectId, 'mutation', 'operation')
    try {
      set({ isLoading: true })
      await dbDeletePolicy(policyId, projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      toast.success(`Policy "${policy?.title || 'Unknown'}" deleted`)

      await get().loadPolicies(projectId)
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
    } catch (error) {
      if (!loadGuard.isCurrent(operationId, projectId, 'mutation') || !isProjectScopeCurrent(scope)) return
      logger.error('Failed to delete policy', error)
      toast.error('Failed to delete policy')
    } finally {
      if (loadGuard.finish(operationId, projectId, 'mutation')) {
        set({ isLoading: false })
      }
    }
  },

  clearPolicies: () => {
    loadGuard.invalidate()
    // `invalidate()` empties the guard, so no in-flight `finally` can clear
    // `isLoading` any more; it has to be reset here.
    set({ policies: [], currentProjectId: null, isLoading: false })
  },
}))
