import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

const mocks = vi.hoisted(() => ({
  createTeam: vi.fn(), listTeams: vi.fn(), updateTeam: vi.fn(),
  createSystem: vi.fn(), listSystems: vi.fn(), getSystemUsageCount: vi.fn(), updateSystem: vi.fn(),
  createStep: vi.fn(), listSteps: vi.fn(), getStep: vi.fn(), updateStep: vi.fn(), updateMilestone: vi.fn(),
  createGap: vi.fn(), getGap: vi.fn(), listGaps: vi.fn(), updateGap: vi.fn(),
  createPolicy: vi.fn(), listPolicies: vi.fn(), updatePolicy: vi.fn(),
  createGlossaryEntry: vi.fn(), listGlossaryEntries: vi.fn(), updateGlossaryEntry: vi.fn(),
}))

vi.mock('../services/db', () => ({
  ...mocks,
  updateTeam: mocks.updateTeam, deleteTeam: vi.fn(), getTeamUsageCount: vi.fn(),
  updateSystem: mocks.updateSystem, deleteSystem: vi.fn(),
  updateStep: mocks.updateStep, deleteStep: vi.fn(), listMilestones: vi.fn(), getMilestone: vi.fn(),
  createMilestone: vi.fn(), updateMilestone: mocks.updateMilestone, deleteMilestone: vi.fn(), getMilestoneUsageCount: vi.fn(),
  listGapsByStep: vi.fn(), updateGap: mocks.updateGap, deleteGap: vi.fn(), closeGap: vi.fn(),
  updatePolicy: mocks.updatePolicy, deletePolicy: vi.fn(),
  updateGlossaryEntry: mocks.updateGlossaryEntry, deleteGlossaryEntry: vi.fn(),
}))
vi.mock('react-hot-toast', () => ({ default: toast }))

import { beginProjectScope } from '../state/workspaceScope'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useStepsStore } from '../state/stepsStore'
import { useGapsStore } from '../state/gapsStore'
import { usePoliciesStore } from '../state/policiesStore'
import { useGlossaryStore } from '../state/glossaryStore'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const step = { id: 'step-a', projectId: 'project-a', label: 'Step A', teamId: 'team-a', milestoneId: 'milestone-a', order: 1, suppliers: [], inputs: [], outputs: [], customers: [], systems: [], comments: [], links: [], gapIds: [], createdAt: 1, updatedAt: 1 }
const gap = { id: 'gap-a', projectId: 'project-a', observed: 'Observed', expected: 'Expected', severity: 'M' as const, status: 'Open' as const, links: [], createdAt: 1, updatedAt: 1 }
const policy = { id: 'policy-a', projectId: 'project-a', title: 'Policy A', content: 'Content', relatedMilestones: [], tags: [], createdAt: 1, updatedAt: 1 }
const entry = { id: 'entry-a', projectId: 'project-a', term: 'Term A', definition: 'Definition', relatedSteps: [], tags: [], createdAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  beginProjectScope('project-a')
  useTeamsStore.setState({ teams: [], currentProjectId: 'project-a', isLoading: false })
  useSystemsStore.setState({ systems: [], currentProjectId: 'project-a', isLoading: false })
  useStepsStore.setState({ steps: [], milestones: [], currentProjectId: 'project-a', currentStep: null, isLoading: false })
  useGapsStore.setState({ gaps: [], currentProjectId: 'project-a', currentGap: null, isLoading: false })
  usePoliciesStore.setState({ policies: [], currentProjectId: 'project-a', isLoading: false })
  useGlossaryStore.setState({ entries: [], currentProjectId: 'project-a', isLoading: false })
})

describe('mutation project-scope isolation', () => {
  it('does not start a stale team refresh after the route changes', async () => {
    const create = deferred<string>()
    mocks.createTeam.mockReturnValue(create.promise)
    const add = useTeamsStore.getState().addTeam({ projectId: 'project-a', name: 'Team A', color: '#000' })
    beginProjectScope('project-b')
    create.resolve('team-a')
    await add
    expect(mocks.listTeams).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('does not toast a stale mutation failure after the route changes', async () => {
    const update = deferred<void>()
    mocks.updateTeam.mockReturnValue(update.promise)
    useTeamsStore.setState({ teams: [
      { id: 'team-a', projectId: 'project-a', name: 'Team A', color: '#000', order: 1, tags: [], createdAt: 1 },
    ] })
    const mutation = useTeamsStore.getState().updateTeam('team-a', { name: 'Updated' })
    beginProjectScope('project-b')
    update.reject(new Error('stale failure'))
    await mutation
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps loading active while current B work remains after stale A finishes', async () => {
    const create = deferred<string>(); mocks.createTeam.mockReturnValue(create.promise)
    const loadB = deferred<never[]>(); mocks.listTeams.mockReturnValue(loadB.promise)
    const add = useTeamsStore.getState().addTeam({ projectId: 'project-a', name: 'Team A', color: '#000' })
    beginProjectScope('project-b')
    const load = useTeamsStore.getState().loadTeams('project-b')
    create.resolve('team-a')
    await add
    expect(useTeamsStore.getState().isLoading).toBe(true)
    loadB.resolve([])
    await load
    expect(useTeamsStore.getState().isLoading).toBe(false)
  })

  it('rejects an explicit project mismatch before any database write', async () => {
    beginProjectScope('project-b')
    const team = { id: 'team-b', projectId: 'project-b', name: 'Team B', color: '#000', order: 1, tags: [], createdAt: 1, updatedAt: 1 }
    const system = { id: 'system-b', projectId: 'project-b', name: 'System B', tags: [], createdAt: 1, updatedAt: 1 }
    const projectBStep = { ...step, id: 'step-b', projectId: 'project-b' }
    const projectBGap = { ...gap, id: 'gap-b', projectId: 'project-b' }
    const projectBPolicy = { ...policy, id: 'policy-b', projectId: 'project-b' }
    const projectBEntry = { ...entry, id: 'entry-b', projectId: 'project-b' }
    const milestone = { id: 'milestone-b', projectId: 'project-b', name: 'Milestone B', order: 1, relatedPolicies: [], createdAt: 1, updatedAt: 1 }

    useTeamsStore.setState({ teams: [team], currentProjectId: 'project-b' })
    useSystemsStore.setState({ systems: [system], currentProjectId: 'project-b' })
    useStepsStore.setState({ steps: [projectBStep], milestones: [milestone], currentProjectId: 'project-b' })
    useGapsStore.setState({ gaps: [projectBGap], currentProjectId: 'project-b' })
    usePoliciesStore.setState({ policies: [projectBPolicy], currentProjectId: 'project-b' })
    useGlossaryStore.setState({ entries: [projectBEntry], currentProjectId: 'project-b' })
    mocks.updateTeam.mockResolvedValue(undefined)
    mocks.updateSystem.mockResolvedValue(undefined)
    mocks.updateStep.mockResolvedValue(undefined)
    mocks.updateMilestone.mockResolvedValue(undefined)
    mocks.updateGap.mockResolvedValue(projectBGap)
    mocks.updatePolicy.mockResolvedValue(undefined)
    mocks.updateGlossaryEntry.mockResolvedValue(undefined)

    await useTeamsStore.getState().updateTeam('team-b', { name: 'Wrong' }, 'project-a')
    await useSystemsStore.getState().updateSystem('system-b', { name: 'Wrong' }, 'project-a')
    await useStepsStore.getState().updateStep('step-b', { label: 'Wrong' }, 'project-a')
    await useStepsStore.getState().updateMilestone('milestone-b', { name: 'Wrong' }, 'project-a')
    await useGapsStore.getState().updateGap('gap-b', { observed: 'Wrong' }, 'project-a')
    await usePoliciesStore.getState().updatePolicy('policy-b', { title: 'Wrong' }, 'project-a')
    await useGlossaryStore.getState().updateGlossaryEntry('entry-b', { term: 'Wrong' }, 'project-a')

    expect(mocks.updateTeam).not.toHaveBeenCalled()
    expect(mocks.updateSystem).not.toHaveBeenCalled()
    expect(mocks.updateStep).not.toHaveBeenCalled()
    expect(mocks.updateMilestone).not.toHaveBeenCalled()
    expect(mocks.updateGap).not.toHaveBeenCalled()
    expect(mocks.updatePolicy).not.toHaveBeenCalled()
    expect(mocks.updateGlossaryEntry).not.toHaveBeenCalled()
  })

  it('reconciles overlapping same-project team mutations independently', async () => {
    const createA = deferred<string>()
    const createB = deferred<string>()
    mocks.createTeam.mockReturnValueOnce(createA.promise).mockReturnValueOnce(createB.promise)
    const teams = [
      { id: 'team-a', projectId: 'project-a', name: 'Team A', color: '#000', order: 1, tags: [], createdAt: 1 },
      { id: 'team-b', projectId: 'project-a', name: 'Team B', color: '#111', order: 2, tags: [], createdAt: 1 },
    ]
    mocks.listTeams.mockResolvedValue(teams)

    const addA = useTeamsStore.getState().addTeam({ projectId: 'project-a', name: 'Team A', color: '#000' })
    const addB = useTeamsStore.getState().addTeam({ projectId: 'project-a', name: 'Team B', color: '#111' })
    createA.resolve('team-a')
    createB.resolve('team-b')

    const [resultA, resultB] = await Promise.all([addA, addB])

    expect(resultA?.id).toBe('team-a')
    expect(resultB?.id).toBe('team-b')
    expect(mocks.listTeams).toHaveBeenCalledTimes(2)
    expect(useTeamsStore.getState().isLoading).toBe(false)
  })

  it('does not commit stale systems, steps, gaps, policies, or glossary writes', async () => {
    const systemCreate = deferred<string>(); mocks.createSystem.mockReturnValue(systemCreate.promise)
    const systemAdd = useSystemsStore.getState().addSystem({ projectId: 'project-a', name: 'System A' })
    beginProjectScope('project-b'); systemCreate.resolve('system-a'); await systemAdd
    expect(mocks.listSystems).not.toHaveBeenCalled()

    beginProjectScope('project-a')
    const stepCreate = deferred<string>(); mocks.createStep.mockReturnValue(stepCreate.promise)
    const stepAdd = useStepsStore.getState().addStep(step)
    beginProjectScope('project-b'); stepCreate.resolve('step-a'); await stepAdd
    expect(mocks.getStep).not.toHaveBeenCalled()

    beginProjectScope('project-a')
    const gapCreate = deferred<string>(); mocks.createGap.mockReturnValue(gapCreate.promise)
    const gapAdd = useGapsStore.getState().addGap(gap)
    beginProjectScope('project-b'); gapCreate.resolve('gap-a'); await gapAdd
    expect(mocks.getGap).not.toHaveBeenCalled()

    beginProjectScope('project-a')
    const policyCreate = deferred<string>(); mocks.createPolicy.mockReturnValue(policyCreate.promise)
    const policyAdd = usePoliciesStore.getState().addPolicy(policy)
    beginProjectScope('project-b'); policyCreate.resolve('policy-a'); await policyAdd
    expect(mocks.listPolicies).not.toHaveBeenCalled()

    beginProjectScope('project-a')
    const entryCreate = deferred<string>(); mocks.createGlossaryEntry.mockReturnValue(entryCreate.promise)
    const entryAdd = useGlossaryStore.getState().addGlossaryEntry(entry)
    beginProjectScope('project-b'); entryCreate.resolve('entry-a'); await entryAdd
    expect(mocks.listGlossaryEntries).not.toHaveBeenCalled()
  })
})
