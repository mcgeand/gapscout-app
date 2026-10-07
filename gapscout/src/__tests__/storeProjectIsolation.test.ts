import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

const {
  listProjects,
  getProject,
  listTeams,
  listSystems,
  getSystemUsageCount,
  listSteps,
  listMilestones,
  listGaps,
  listGapsByStep,
  listPolicies,
  listGlossaryEntries,
  initDB,
} = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  listTeams: vi.fn(),
  listSystems: vi.fn(),
  getSystemUsageCount: vi.fn(),
  listSteps: vi.fn(),
  listMilestones: vi.fn(),
  listGaps: vi.fn(),
  listGapsByStep: vi.fn(),
  listPolicies: vi.fn(),
  listGlossaryEntries: vi.fn(),
  initDB: vi.fn(),
}))

vi.mock('../services/db', () => ({
  initDB,
  listProjects,
  getProject,
  listTeams,
  listSystems,
  getSystemUsageCount,
  listSteps,
  listMilestones,
  listGaps,
  listGapsByStep,
  listPolicies,
  listGlossaryEntries,
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  createSystem: vi.fn(),
  updateSystem: vi.fn(),
  deleteSystem: vi.fn(),
  getTeamUsageCount: vi.fn(),
  getStep: vi.fn(),
  createStep: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  getMilestone: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneUsageCount: vi.fn(),
  getGap: vi.fn(),
  createGap: vi.fn(),
  updateGap: vi.fn(),
  deleteGap: vi.fn(),
  closeGap: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  deletePolicy: vi.fn(),
  createGlossaryEntry: vi.fn(),
  updateGlossaryEntry: vi.fn(),
  deleteGlossaryEntry: vi.fn(),
  dbCreateProject: vi.fn(),
  dbUpdateProject: vi.fn(),
  dbDeleteProject: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: toast }))

import { useProjectStore } from '../state/projectStore'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import { useStepsStore } from '../state/stepsStore'
import { useGapsStore } from '../state/gapsStore'
import { usePoliciesStore } from '../state/policiesStore'
import { useGlossaryStore } from '../state/glossaryStore'
import { beginProjectScope, clearProjectScope } from '../state/workspaceScope'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const project = (id: string) => ({ id, name: id, createdAt: 1, updatedAt: 1 })
const team = (projectId: string) => ({ id: `team-${projectId}`, projectId, name: projectId, color: '#000', order: 1, tags: [], createdAt: 1 })
const system = (projectId: string) => ({ id: `system-${projectId}`, projectId, name: projectId, tags: [], createdAt: 1 })
const step = (projectId: string) => ({ id: `step-${projectId}`, projectId, label: projectId, teamId: 'team', milestoneId: 'milestone', order: 1, suppliers: [], inputs: [], outputs: [], customers: [], systems: [], comments: [], links: [], gapIds: [], createdAt: 1, updatedAt: 1 })
const milestone = (projectId: string) => ({ id: `milestone-${projectId}`, projectId, name: projectId, order: 1, relatedPolicies: [], createdAt: 1, updatedAt: 1 })
const gap = (projectId: string) => ({ id: `gap-${projectId}`, projectId, observed: projectId, expected: projectId, severity: 'M' as const, status: 'Open' as const, links: [], createdAt: 1, updatedAt: 1 })
const policy = (projectId: string) => ({ id: `policy-${projectId}`, projectId, title: projectId, content: projectId, relatedMilestones: [], tags: [], createdAt: 1, updatedAt: 1 })
const entry = (projectId: string) => ({ id: `entry-${projectId}`, projectId, term: projectId, definition: projectId, relatedSteps: [], tags: [], createdAt: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  clearProjectScope()
  useProjectStore.setState({ projects: [], currentProject: null, isLoading: false, isInitialized: false })
  useTeamsStore.setState({ teams: [], currentProjectId: null, isLoading: false })
  useSystemsStore.setState({ systems: [], currentProjectId: null, isLoading: false })
  useStepsStore.setState({ steps: [], milestones: [], currentProjectId: null, currentStep: null, isLoading: false })
  useGapsStore.setState({ gaps: [], currentProjectId: null, currentGap: null, isLoading: false })
  usePoliciesStore.setState({ policies: [], currentProjectId: null, isLoading: false })
  useGlossaryStore.setState({ entries: [], currentProjectId: null, isLoading: false })
})

describe('project-scoped loader isolation', () => {
  it('project selection commits only the latest project and keeps the current load active', async () => {
    const a = deferred<ReturnType<typeof project> | null>()
    const b = deferred<ReturnType<typeof project> | null>()
    getProject.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)

    const loadA = useProjectStore.getState().selectProject('a')
    const loadB = useProjectStore.getState().selectProject('b')
    a.resolve(project('a'))
    await loadA
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useProjectStore.getState().isLoading).toBe(true)
    b.resolve(project('b'))
    await loadB
    expect(useProjectStore.getState().currentProject).toEqual(project('b'))
    expect(useProjectStore.getState().isLoading).toBe(false)
  })

  it('clears the selected project when the latest selection fails', async () => {
    useProjectStore.setState({ currentProject: project('old') })
    getProject.mockRejectedValueOnce(new Error('failed'))

    await useProjectStore.getState().selectProject('new')

    expect(useProjectStore.getState().currentProject).toBeNull()
  })

  it('teams load A→B ignores stale A and clears failed B', async () => {
    const a = deferred<ReturnType<typeof team>[]>(); const b = deferred<ReturnType<typeof team>[]>()
    listTeams.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)
    useTeamsStore.setState({ teams: [team('old')] })
    const loadA = useTeamsStore.getState().loadTeams('a')
    const loadB = useTeamsStore.getState().loadTeams('b')
    b.resolve([team('b')]); await loadB
    expect(useTeamsStore.getState().teams).toEqual([team('b')])
    expect(useTeamsStore.getState().isLoading).toBe(false)
    a.resolve([team('a')]); await loadA
    expect(useTeamsStore.getState().teams).toEqual([team('b')])

    listTeams.mockRejectedValueOnce(new Error('failed'))
    await useTeamsStore.getState().loadTeams('failed')
    expect(useTeamsStore.getState().teams).toEqual([])
  })

  it('systems list and usage loaders keep the latest result isolated', async () => {
    const a = deferred<ReturnType<typeof system>[]>(); const b = deferred<ReturnType<typeof system>[]>()
    listSystems.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)
    getSystemUsageCount.mockResolvedValue(3)
    const loadA = useSystemsStore.getState().loadSystems('a')
    const loadB = useSystemsStore.getState().loadSystemsWithUsage('b')
    b.resolve([system('b')]); await loadB
    expect(useSystemsStore.getState().systems).toEqual([{ ...system('b'), usageCount: 3 }])
    a.resolve([system('a')]); await loadA
    expect(useSystemsStore.getState().systems).toEqual([{ ...system('b'), usageCount: 3 }])

    listSystems.mockRejectedValueOnce(new Error('failed'))
    await useSystemsStore.getState().loadSystems('failed')
    expect(useSystemsStore.getState().systems).toEqual([])
  })

  it('steps and milestones each ignore stale project responses and clear failures', async () => {
    const stepsA = deferred<ReturnType<typeof step>[]>(); const stepsB = deferred<ReturnType<typeof step>[]>()
    listSteps.mockImplementation((id: string) => id === 'a' ? stepsA.promise : stepsB.promise)
    const loadA = useStepsStore.getState().loadSteps('a')
    const loadB = useStepsStore.getState().loadSteps('b')
    stepsB.resolve([step('b')]); await loadB
    stepsA.resolve([step('a')]); await loadA
    expect(useStepsStore.getState().steps).toEqual([step('b')])

    const milestonesA = deferred<ReturnType<typeof milestone>[]>(); const milestonesB = deferred<ReturnType<typeof milestone>[]>()
    listMilestones.mockImplementation((id: string) => id === 'a' ? milestonesA.promise : milestonesB.promise)
    const milestoneLoadA = useStepsStore.getState().loadMilestones('a')
    const milestoneLoadB = useStepsStore.getState().loadMilestones('b')
    milestonesB.resolve([milestone('b')]); await milestoneLoadB
    milestonesA.resolve([milestone('a')]); await milestoneLoadA
    expect(useStepsStore.getState().milestones).toEqual([milestone('b')])

    listSteps.mockRejectedValueOnce(new Error('failed'))
    await useStepsStore.getState().loadSteps('failed')
    expect(useStepsStore.getState().steps).toEqual([])
    listMilestones.mockRejectedValueOnce(new Error('failed'))
    await useStepsStore.getState().loadMilestones('failed')
    expect(useStepsStore.getState().milestones).toEqual([])
  })

  it('gaps project and by-step loaders ignore stale responses and clear latest failures', async () => {
    const a = deferred<ReturnType<typeof gap>[]>(); const b = deferred<ReturnType<typeof gap>[]>()
    listGaps.mockImplementation((id: string) => id === 'a' ? a.promise : b.promise)
    const loadA = useGapsStore.getState().loadGaps('a')
    const loadB = useGapsStore.getState().loadGaps('b')
    b.resolve([gap('b')]); await loadB
    a.resolve([gap('a')]); await loadA
    expect(useGapsStore.getState().gaps).toEqual([gap('b')])

    const byStepA = deferred<ReturnType<typeof gap>[]>(); const byStepB = deferred<ReturnType<typeof gap>[]>()
    listGapsByStep.mockImplementation((id: string) => id === 'step-a' ? byStepA.promise : byStepB.promise)
    const byStepLoadA = useGapsStore.getState().loadGapsByStep('step-a', 'a')
    const byStepLoadB = useGapsStore.getState().loadGapsByStep('step-b', 'b')
    byStepB.resolve([gap('step-b')]); await byStepLoadB
    byStepA.resolve([gap('step-a')]); await byStepLoadA
    expect(useGapsStore.getState().gaps).toEqual([gap('step-b')])

    listGaps.mockRejectedValueOnce(new Error('failed'))
    await useGapsStore.getState().loadGaps('failed')
    expect(useGapsStore.getState().gaps).toEqual([])
    listGapsByStep.mockRejectedValueOnce(new Error('failed'))
    await useGapsStore.getState().loadGapsByStep('failed-step', 'failed')
    expect(useGapsStore.getState().gaps).toEqual([])
  })

  it('ignores a stale by-step rejection after the next project succeeds', async () => {
    const a = deferred<ReturnType<typeof gap>[]>()
    const b = deferred<ReturnType<typeof gap>[]>()
    listGapsByStep.mockImplementation((stepId: string) => stepId === 'step-a' ? a.promise : b.promise)

    beginProjectScope('project-a')
    const loadA = useGapsStore.getState().loadGapsByStep('step-a', 'project-a')
    beginProjectScope('project-b')
    const loadB = useGapsStore.getState().loadGapsByStep('step-b', 'project-b')

    b.resolve([gap('project-b')])
    await loadB
    a.reject(new Error('stale A failure'))
    await loadA

    expect(useGapsStore.getState().gaps).toEqual([gap('project-b')])
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load gaps for step')
    expect(useGapsStore.getState().isLoading).toBe(false)
  })

  it('policies and glossary ignore stale project responses and clear failures', async () => {
    const policiesA = deferred<ReturnType<typeof policy>[]>(); const policiesB = deferred<ReturnType<typeof policy>[]>()
    listPolicies.mockImplementation((id: string) => id === 'a' ? policiesA.promise : policiesB.promise)
    const policyLoadA = usePoliciesStore.getState().loadPolicies('a')
    const policyLoadB = usePoliciesStore.getState().loadPolicies('b')
    policiesB.resolve([policy('b')]); await policyLoadB
    policiesA.resolve([policy('a')]); await policyLoadA
    expect(usePoliciesStore.getState().policies).toEqual([policy('b')])

    const entriesA = deferred<ReturnType<typeof entry>[]>(); const entriesB = deferred<ReturnType<typeof entry>[]>()
    listGlossaryEntries.mockImplementation((id: string) => id === 'a' ? entriesA.promise : entriesB.promise)
    const entryLoadA = useGlossaryStore.getState().loadGlossary('a')
    const entryLoadB = useGlossaryStore.getState().loadGlossary('b')
    entriesB.resolve([entry('b')]); await entryLoadB
    entriesA.resolve([entry('a')]); await entryLoadA
    expect(useGlossaryStore.getState().entries).toEqual([entry('b')])

    listPolicies.mockRejectedValueOnce(new Error('failed'))
    await usePoliciesStore.getState().loadPolicies('failed')
    expect(usePoliciesStore.getState().policies).toEqual([])
    listGlossaryEntries.mockRejectedValueOnce(new Error('failed'))
    await useGlossaryStore.getState().loadGlossary('failed')
    expect(useGlossaryStore.getState().entries).toEqual([])
  })
})
