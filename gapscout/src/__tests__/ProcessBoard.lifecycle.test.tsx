import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Navigate, RouterProvider } from 'react-router-dom'

const state = vi.hoisted(() => ({ projectId: 'project-a' }))
const projectStore = vi.hoisted(() => vi.fn())
const teamsStore = vi.hoisted(() => vi.fn())
const stepsStore = vi.hoisted(() => vi.fn())
const gapsStore = vi.hoisted(() => vi.fn())
const systemsStore = vi.hoisted(() => vi.fn())
const policiesStore = vi.hoisted(() => vi.fn())
const glossaryStore = vi.hoisted(() => vi.fn())
const listMilestones = vi.hoisted(() => vi.fn())
const listTeams = vi.hoisted(() => vi.fn())
const createStep = vi.hoisted(() => vi.fn())
const listSteps = vi.hoisted(() => vi.fn())
const listGaps = vi.hoisted(() => vi.fn())
const getSipoc = vi.hoisted(() => vi.fn())
const upsertSipoc = vi.hoisted(() => vi.fn())
const initDB = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
/**
 * What the board handed the wizard back. The flow has two halves now, and the
 * interesting answers — "the process is already mapped", "nothing was written
 * because the route changed" — are values rather than toasts (#220).
 */
const wizard = vi.hoisted(() => ({
  preview: null as unknown,
  confirmResult: undefined as unknown,
  /** Overrides the description the stand-in submits, for one test. */
  process: null as string | null,
  /** Sends every row to confirm unowned, the way an unresolved Review would. */
  stripOwners: false,
  /** Ticks every previewed gap, the way a user asking for them would. */
  tickGaps: false,
}))
const WIZARD_OUTPUT = vi.hoisted(() => ({
  suppliers: ['Supplier'],
  inputs: ['Input'],
  process: 'Review request. Approve result.',
  outputs: ['Output'],
  customers: ['Customer'],
}))

vi.mock('../state/projectStore', () => ({ useProjectStore: projectStore }))
vi.mock('../state/teamsStore', () => ({ useTeamsStore: teamsStore }))
vi.mock('../state/stepsStore', () => ({ useStepsStore: stepsStore }))
vi.mock('../state/gapsStore', () => ({ useGapsStore: gapsStore }))
vi.mock('../state/systemsStore', () => ({ useSystemsStore: systemsStore }))
vi.mock('../state/policiesStore', () => ({ usePoliciesStore: policiesStore }))
vi.mock('../state/glossaryStore', () => ({ useGlossaryStore: glossaryStore }))
vi.mock('../services/db', () => ({ initDB, listMilestones, listTeams, createStep, listSteps, listGaps, getSipoc, upsertSipoc }))
vi.mock('react-hot-toast', () => ({ default: toast }))
vi.mock('../app/layout/MainLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('../components/Discovery/DiscoveryGrid', () => ({ default: ({ projectId }: { projectId: string }) => <div>Discovery {projectId}</div> }))
vi.mock('../components/Diagram/DiagramCanvas', () => ({ default: () => <div>Diagram</div> }))
vi.mock('../components/Sipoc/SipocView', () => ({ default: () => <div>SIPOC content</div> }))
// The stand-in drives both halves in one click, in the order the real wizard
// does: `onPreview` for every read, then `onConfirm` for every write.
vi.mock('../components/Sipoc/SipocWizard', () => ({
  default: ({
    onPreview,
    onConfirm,
    initialData,
    existingWork,
  }: {
    onPreview: (data: typeof WIZARD_OUTPUT) => Promise<{
      kind: string
      rows?: Array<{ id: string; teamId?: string }>
      gaps?: Array<{ description: string; stepIndex?: number }>
    } | null>
    onConfirm: (plan: unknown) => Promise<unknown>
    initialData?: typeof WIZARD_OUTPUT
    existingWork: { steps: number; gaps: number }
  }) => (
    <>
      <div data-testid="wizard-initial">{initialData ? initialData.process : 'blank'}</div>
      <div data-testid="wizard-existing">{`${existingWork.steps}/${existingWork.gaps}`}</div>
      <button
        onClick={async () => {
          const preview = await onPreview(
            wizard.process === null ? WIZARD_OUTPUT : { ...WIZARD_OUTPUT, process: wizard.process }
          )
          wizard.preview = preview
          if (!preview) return
          wizard.confirmResult = await onConfirm({
            data: WIZARD_OUTPUT,
            rows:
              preview.kind === 'plan'
                ? (preview.rows ?? []).map(row =>
                    wizard.stripOwners ? { ...row, teamId: undefined } : row
                  )
                : [],
            gaps:
              preview.kind === 'plan'
                ? (preview.gaps ?? []).map((gap, index) => ({
                    id: `gap-${index}`,
                    description: gap.description,
                    rowId: gap.stepIndex === undefined ? undefined : preview.rows?.[gap.stepIndex]?.id,
                    create: wizard.tickGaps,
                  }))
                : [],
            summaryOnly: preview.kind === 'summary-only',
          })
        }}
      >
        Save SIPOC
      </button>
      <button
        onClick={async () => {
          wizard.preview = await onPreview(
            wizard.process === null ? WIZARD_OUTPUT : { ...WIZARD_OUTPUT, process: wizard.process }
          )
        }}
      >
        Review SIPOC
      </button>
      <button
        onClick={async () => {
          const preview = wizard.preview as { kind: string; rows?: unknown[] } | null
          wizard.confirmResult = await onConfirm({
            data: WIZARD_OUTPUT,
            rows: preview?.kind === 'plan' ? preview.rows : [],
            gaps: [],
            summaryOnly: preview?.kind === 'summary-only',
          })
        }}
      >
        Confirm SIPOC
      </button>
    </>
  ),
}))
// The four registries are tab panels now, not dialogs mounted permanently
// beside the board, so each mock renders something the tab test can see.
vi.mock('../components/Teams/TeamsManager', () => ({ default: () => <div>Teams registry</div> }))
vi.mock('../components/Systems/SystemsManager', () => ({ default: () => <div>Systems registry</div> }))
vi.mock('../components/Policies/PolicyManager', () => ({ default: () => <div>Policies registry</div> }))
vi.mock('../components/Glossary/GlossaryManager', () => ({ default: () => <div>Glossary registry</div> }))
vi.mock('../components/Gaps', () => ({ GapsPanel: () => <div>Gaps panel</div> }))
vi.mock('../components/Export', () => ({ ExportModal: () => null }))

import ProcessBoard from '../pages/ProcessBoard'
import { beginProjectScope } from '../state/workspaceScope'

/**
 * The board reads its tab from a child URL segment, so these tests drive a real
 * router rather than mocking `react-router-dom`. The route shape mirrors
 * `app/routes.tsx`: the parent owns `:projectId` and the loader, the child owns
 * `:tab`, and an index route redirects the bare project path to Discovery.
 */
function renderBoard(
  path = `/projects/${state.projectId}/discovery`,
  loader?: () => unknown,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/projects/:projectId',
        element: <ProcessBoard />,
        ...(loader ? { loader } : {}),
        children: [
          { index: true, element: <Navigate to="discovery" replace /> },
          { path: ':tab', element: null },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  return { ...render(<RouterProvider router={router} />), router }
}

beforeEach(() => {
  vi.clearAllMocks()
  initDB.mockResolvedValue(undefined)
  listMilestones.mockResolvedValue([])
  listTeams.mockResolvedValue([])
  wizard.preview = null
  wizard.confirmResult = undefined
  wizard.process = null
  wizard.stripOwners = false
  wizard.tickGaps = false
  createStep.mockResolvedValue('step-id')
  listSteps.mockResolvedValue([])
  listGaps.mockResolvedValue([])
  getSipoc.mockResolvedValue(null)
  upsertSipoc.mockResolvedValue(undefined)
  state.projectId = 'project-a'
  projectStore.mockReturnValue({
    currentProject: { id: state.projectId, name: state.projectId },
    selectProject: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
    isLoading: false,
  })
  // Every store now yields its collection as well as its actions: the tab bar
  // reads all six counts centrally rather than each manager computing its own.
  teamsStore.mockReturnValue({ teams: [], loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })
  stepsStore.mockReturnValue({ steps: [], milestones: [], loadSteps: vi.fn().mockResolvedValue(undefined), loadMilestones: vi.fn().mockResolvedValue(undefined), clearSteps: vi.fn() })
  gapsStore.mockReturnValue({ gaps: [], loadGaps: vi.fn().mockResolvedValue(undefined), clearGaps: vi.fn(), addGap: vi.fn().mockResolvedValue({ id: 'gap-id' }) })
  systemsStore.mockReturnValue({ systems: [], loadSystems: vi.fn().mockResolvedValue(undefined), clearSystems: vi.fn() })
  policiesStore.mockReturnValue({ policies: [], loadPolicies: vi.fn().mockResolvedValue(undefined), clearPolicies: vi.fn() })
  glossaryStore.mockReturnValue({ entries: [], loadGlossary: vi.fn().mockResolvedValue(undefined), clearGlossary: vi.fn() })
})

/**
 * A tab's accessible name now carries its live count — "Gaps 9", not "Gaps" —
 * because the counts moved out of each manager's modal footer and into the bar
 * (#207). Anchor on the label so the query does not depend on the number.
 */
function tabButton(label: string) {
  return screen.getByRole('button', { name: new RegExp(`^${label}\\b`) })
}

/**
 * The wizard mounts only while open (so it re-reads `initialData`), so the
 * mocked Save button does not exist until the toolbar button is clicked.
 */
function openWizard() {
  fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save SIPOC' }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

type WizardTeam = {
  id: string
  projectId: string
  name: string
  color: string
  order: number
  tags: string[]
  createdAt: number
}

/** Wizard output names no owner; confirm needs an Unassigned team in the store. */
function withUnassignedSentinel(routeTeam: WizardTeam): WizardTeam[] {
  return [routeTeam, { ...routeTeam, id: 'unassigned-team', name: 'Unassigned' }]
}

describe('ProcessBoard route workspace lifecycle', () => {
  it('waits for database readiness before starting scoped loaders', async () => {
    let resolveInit!: () => void
    initDB.mockReturnValueOnce(new Promise<void>((resolve) => { resolveInit = resolve }))
    const loadSteps = vi.fn().mockResolvedValue(undefined)
    stepsStore.mockReturnValue({ steps: [], milestones: [], loadSteps, loadMilestones: vi.fn(), clearSteps: vi.fn() })

    renderBoard()
    expect(loadSteps).not.toHaveBeenCalled()
    resolveInit()
    await waitFor(() => expect(loadSteps).toHaveBeenCalledWith('project-a'))
  })

  it('remounts local workspace state when the route projectId changes', async () => {
    // Landing on Discovery is no longer evidence of the remount — the index
    // redirect alone does that now the tab lives in the URL. What still needs
    // `key={projectId}` is the *local* state: without it an open wizard and a
    // stale project-A summary survive into project B.
    const { router } = renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    expect(screen.getByRole('button', { name: 'Save SIPOC' })).toBeInTheDocument()

    projectStore.mockReturnValue({
      currentProject: { id: 'project-b', name: 'project-b' },
      selectProject: vi.fn().mockResolvedValue(undefined),
      clearSelection: vi.fn(),
      isLoading: false,
    })
    await router.navigate('/projects/project-b')

    await waitFor(() => expect(screen.getByText('Discovery project-b')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save SIPOC' })).not.toBeInTheDocument()
  })

  it('owns each route workspace load centrally and does not reload when a tab opens', async () => {
    const loads = {
      teams: vi.fn().mockResolvedValue(undefined),
      steps: vi.fn().mockResolvedValue(undefined),
      milestones: vi.fn().mockResolvedValue(undefined),
      gaps: vi.fn().mockResolvedValue(undefined),
      systems: vi.fn().mockResolvedValue(undefined),
      policies: vi.fn().mockResolvedValue(undefined),
      glossary: vi.fn().mockResolvedValue(undefined),
    }
    teamsStore.mockReturnValue({ teams: [], loadTeams: loads.teams, addTeam: vi.fn(), clearTeams: vi.fn() })
    stepsStore.mockReturnValue({ steps: [], milestones: [], loadSteps: loads.steps, loadMilestones: loads.milestones, clearSteps: vi.fn() })
    gapsStore.mockReturnValue({ gaps: [], loadGaps: loads.gaps, clearGaps: vi.fn() })
    systemsStore.mockReturnValue({ systems: [], loadSystems: loads.systems, clearSystems: vi.fn() })
    policiesStore.mockReturnValue({ policies: [], loadPolicies: loads.policies, clearPolicies: vi.fn() })
    glossaryStore.mockReturnValue({ entries: [], loadGlossary: loads.glossary, clearGlossary: vi.fn() })

    renderBoard()
    await waitFor(() => expect(loads.glossary).toHaveBeenCalledOnce())
    fireEvent.click(tabButton('Gaps'))
    fireEvent.click(tabButton('Discovery'))

    for (const load of Object.values(loads)) expect(load).toHaveBeenCalledOnce()
  })

  it('rechecks teams before creating the Unassigned sentinel', async () => {
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    const unassigned = { ...routeTeam, id: 'unassigned-team', name: 'Unassigned' }
    // Preview and confirm both reload teams when the store is empty (#387).
    listTeams.mockResolvedValue([routeTeam, unassigned])
    const addTeam = vi.fn()
    teamsStore.mockReturnValue({ teams: [], loadTeams: vi.fn().mockResolvedValue(undefined), addTeam, clearTeams: vi.fn() })
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])

    renderBoard()
    openWizard()

    await waitFor(() => expect(listTeams).toHaveBeenCalledWith('project-a'))
    await waitFor(() => expect(createStep).toHaveBeenCalled())
    expect(addTeam).not.toHaveBeenCalled()
    expect(createStep.mock.calls.every(([step]) => step.teamId === 'unassigned-team')).toBe(true)
  })

  it('writes nothing when the route changes between the review and the save', async () => {
    // The window the split opened (#220): the user reads the table while the
    // board is still on project A, and the route moves before they press the
    // button. `handleConfirmSipoc` captures its own scope, so it refuses
    // outright — the summary included.
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    teamsStore.mockReturnValue({ teams: withUnassignedSentinel(routeTeam), loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })

    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review SIPOC' }))
    await waitFor(() => expect(wizard.preview).not.toBeNull())

    beginProjectScope('project-b')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm SIPOC' }))

    await waitFor(() => expect(wizard.confirmResult).toBeNull())
    expect(upsertSipoc).not.toHaveBeenCalled()
    expect(createStep).not.toHaveBeenCalled()
  })

  it('finishes the step set it started rather than leaving a partial flow', async () => {
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    const firstWrite = deferred<string>()
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    teamsStore.mockReturnValue({ teams: withUnassignedSentinel(routeTeam), loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })
    createStep.mockReturnValueOnce(firstWrite.promise)
    renderBoard()
    openWizard()
    await waitFor(() => expect(createStep).toHaveBeenCalled())
    beginProjectScope('project-b')
    firstWrite.resolve('step-id')

    // Two sentences in the mocked wizard output, so two steps — both written,
    // even though the route changed after the first one was in flight.
    // Abandoning the loop half way is what used to leave orphan steps, and
    // there is no transaction to roll one back.
    await waitFor(() => expect(createStep).toHaveBeenCalledTimes(2))
    // What the route change does stop is everything the user would see: the
    // wizard never reaches its landing panel.
    await waitFor(() => expect(wizard.confirmResult).toBeNull())
  })

  it('writes generated steps with the route projectId when currentProject is stale', async () => {
    const currentProject = { id: 'route-project', name: 'route-project' }
    projectStore.mockReturnValue({
      currentProject,
      selectProject: vi.fn().mockResolvedValue(undefined),
      clearSelection: vi.fn(),
      isLoading: false,
    })
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'route-project', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    const routeTeam = { id: 'route-team', projectId: 'route-project', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    const unassigned = { ...routeTeam, id: 'unassigned-team', name: 'Unassigned' }
    const addTeam = vi.fn().mockImplementation(async (data: { name: string }) =>
      data.name === 'Unassigned' ? unassigned : routeTeam
    )
    teamsStore.mockReturnValue({ teams: [], loadTeams: vi.fn().mockResolvedValue(undefined), addTeam, clearTeams: vi.fn() })

    renderBoard('/projects/route-project/discovery')
    // Open before going stale: the wizard mounts under `isCurrentProject`, and
    // the point of the test is the save path, not the mount guard.
    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    currentProject.id = 'different-project'
    fireEvent.click(screen.getByRole('button', { name: 'Save SIPOC' }))

    await waitFor(() => expect(createStep).toHaveBeenCalled())
    expect(createStep.mock.calls.every(([data]) => data.projectId === 'route-project')).toBe(true)
    expect(addTeam).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'route-project' }),
      { silent: true }
    )
  })
})

describe('ProcessBoard tab routing (#206)', () => {
  it('deep-links straight to a tab from the URL', async () => {
    renderBoard('/projects/project-a/gaps')

    expect(screen.getByText('Gaps panel')).toBeInTheDocument()
    expect(screen.queryByText('Discovery project-a')).not.toBeInTheDocument()
  })

  it('redirects the bare project path to discovery', async () => {
    const { router } = renderBoard('/projects/project-a')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/project-a/discovery'))
    expect(screen.getByText('Discovery project-a')).toBeInTheDocument()
  })

  it('puts the tab in the URL when one is clicked', async () => {
    const { router } = renderBoard()

    fireEvent.click(tabButton('Systems'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/project-a/systems'))
  })

  it('moves between tabs on browser back and forward', async () => {
    const { router } = renderBoard()

    fireEvent.click(tabButton('Gaps'))
    await waitFor(() => expect(screen.getByText('Gaps panel')).toBeInTheDocument())

    await router.navigate(-1)
    await waitFor(() => expect(screen.getByText('Discovery project-a')).toBeInTheDocument())

    await router.navigate(1)
    await waitFor(() => expect(screen.getByText('Gaps panel')).toBeInTheDocument())
  })

  it('does not re-run the project loader when only the tab changes', async () => {
    // The whole reason the tab is a child segment rather than `?tab=` or a
    // sibling route: the parent's own match.pathname never changes, so
    // react-router does not revalidate it. `?tab=` would revalidate on every
    // click and re-run initDB + getProject.
    const loader = vi.fn(() => ({ projectId: 'project-a' }))
    renderBoard('/projects/project-a/discovery', loader)

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    // The loader being *called* is not the board being on screen: react-router
    // defers the route element until the loader resolves, which is a tick later
    // even for this synchronous one. Waiting on the panel instead of the spy is
    // what makes the click below deterministic.
    await screen.findByText('Discovery project-a')
    fireEvent.click(tabButton('Gaps'))
    await waitFor(() => expect(screen.getByText('Gaps panel')).toBeInTheDocument())
    fireEvent.click(tabButton('Systems'))
    await waitFor(() => expect(screen.getByText('Systems registry')).toBeInTheDocument())

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('does not stack history entries when the active tab is re-clicked', async () => {
    const { router } = renderBoard()

    fireEvent.click(tabButton('Gaps'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/project-a/gaps'))
    fireEvent.click(tabButton('Gaps'))
    fireEvent.click(tabButton('Gaps'))

    // One back should reach Discovery. Re-clicking the active tab was a no-op
    // under useState; an unguarded navigate() would push each click and strand
    // the user three backs from where they started.
    await router.navigate(-1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/project-a/discovery'))
  })

  it('still repairs an unknown tab segment when its fallback tab is clicked', async () => {
    // Guarding on the derived tab instead of the raw segment would break this:
    // activeTab is already 'discovery' here, so the click would be swallowed
    // and the bad URL would never be corrected.
    const { router } = renderBoard('/projects/project-a/not-a-tab')

    fireEvent.click(tabButton('Discovery'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/project-a/discovery'))
  })

  it('falls back to Discovery for an unknown tab segment', async () => {
    renderBoard('/projects/project-a/not-a-tab')

    expect(screen.getByText('Discovery project-a')).toBeInTheDocument()
  })
})

describe('ProcessBoard SIPOC persistence (#93)', () => {
  const persisted = {
    projectId: 'project-a',
    suppliers: ['Warehouse'],
    inputs: ['Pick list'],
    process: 'Pick the order. Pack the order.',
    outputs: ['Packed carton'],
    customers: ['Courier'],
  }

  it('loads the persisted summary on mount and reopens the wizard with it', async () => {
    getSipoc.mockResolvedValue(persisted)

    renderBoard()
    await waitFor(() => expect(getSipoc).toHaveBeenCalledWith('project-a'))

    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    expect(screen.getByTestId('wizard-initial')).toHaveTextContent(persisted.process)
  })

  it('opens the wizard blank when the project has no saved summary', async () => {
    renderBoard()
    await waitFor(() => expect(getSipoc).toHaveBeenCalledWith('project-a'))

    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    expect(screen.getByTestId('wizard-initial')).toHaveTextContent('blank')
  })

  it('writes the typed summary before anything that can bail out', async () => {
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    teamsStore.mockReturnValue({ teams: withUnassignedSentinel(routeTeam), loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })

    renderBoard()
    openWizard()

    await waitFor(() => expect(createStep).toHaveBeenCalled())
    // The summary is the user's typed input and every later guard can return,
    // so it is the first thing the confirm writes — losing it to a milestone
    // that disappeared between Review and Save would discard the whole
    // interview.
    expect(upsertSipoc).toHaveBeenCalledWith({ projectId: 'project-a', ...WIZARD_OUTPUT })
    expect(upsertSipoc.mock.invocationCallOrder[0]).toBeLessThan(createStep.mock.invocationCallOrder[0])
  })

  it('refreshes the steps store so Discovery and Diagram see the generated rows', async () => {
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    teamsStore.mockReturnValue({ teams: withUnassignedSentinel(routeTeam), loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })
    const loadSteps = vi.fn().mockResolvedValue(undefined)
    stepsStore.mockReturnValue({ steps: [], milestones: [], loadSteps, loadMilestones: vi.fn().mockResolvedValue(undefined), clearSteps: vi.fn() })

    renderBoard()
    await waitFor(() => expect(loadSteps).toHaveBeenCalledTimes(1))
    openWizard()

    await waitFor(() => expect(loadSteps).toHaveBeenCalledTimes(2))
  })

  it('re-running on a project that already has steps updates the summary and generates nothing', async () => {
    // The answer used to arrive as a green "SIPOC updated" toast at the end of
    // the interview, which on a template-seeded project fired every time and
    // read as a bug (#379). It is a Review answer now, and it names the rows it
    // is protecting.
    listSteps.mockResolvedValue([{ id: 'existing-step' }])
    getSipoc.mockResolvedValue(persisted)

    renderBoard()
    openWizard()

    await waitFor(() => expect(upsertSipoc).toHaveBeenCalledWith({ projectId: 'project-a', ...WIZARD_OUTPUT }))
    expect(wizard.preview).toEqual({
      kind: 'summary-only',
      reason: 'existing-rows',
      steps: 1,
      gaps: 0,
    })
    expect(createStep).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the typed summary when step generation fails', async () => {
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    teamsStore.mockReturnValue({ teams: withUnassignedSentinel(routeTeam), loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })
    createStep.mockRejectedValue(new Error('disk full'))

    renderBoard()
    openWizard()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create process steps'))
    expect(toast.success).not.toHaveBeenCalled()
    // Summary saved, steps not: the recoverable half. Reopening the wizard
    // offers the same answers back so generation can be retried.
    expect(upsertSipoc).toHaveBeenCalledWith({ projectId: 'project-a', ...WIZARD_OUTPUT })
  })
  it('keeps the summary when the project has no milestone at all', async () => {
    // A project created outside the setup wizard has no milestone, so step
    // generation cannot run. The pages the user just filled in must still be
    // saved rather than thrown away with the modal.
    //
    // "no milestone at all" is the guard since #371 — it used to be "no
    // milestone named Main Flow", which refused a template project that had
    // four. Which milestone gets picked is covered in
    // ProcessBoard.sipocMilestone.test.tsx; this test is about the summary.
    listMilestones.mockResolvedValue([])

    renderBoard()
    openWizard()

    await waitFor(() => expect(upsertSipoc).toHaveBeenCalledWith({ projectId: 'project-a', ...WIZARD_OUTPUT }))
    expect(wizard.preview).toEqual({ kind: 'summary-only', reason: 'no-milestone', steps: 0, gaps: 0 })
    expect(createStep).not.toHaveBeenCalled()
  })

  it('hands Review the owner a sentence named that no team matches', async () => {
    // The parser keeps the subject in front of the verb now, and leaves
    // `teamId` undefined rather than filing the step under whichever team
    // happened to be first — which is what makes "create it as a team" possible
    // at all (#220).
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    teamsStore.mockReturnValue({ teams: withUnassignedSentinel(routeTeam), loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })

    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review SIPOC' }))

    await waitFor(() => expect(wizard.preview).not.toBeNull())
    // WIZARD_OUTPUT is "Review request. Approve result." — neither sentence
    // names an owner, and "Route Team" matches no verb-category keyword, so
    // both rows arrive at Review unowned.
    const preview = wizard.preview as { kind: string; rows: Array<{ label: string; teamId?: string; ownerHint?: string }> }
    expect(preview.kind).toBe('plan')
    expect(preview.rows.map(row => row.label)).toEqual(['Review request', 'Approve result'])
    expect(preview.rows.every(row => row.teamId === undefined)).toBe(true)
    expect(preview.rows.every(row => row.ownerHint === undefined)).toBe(true)
  })

  it('leaves an owner it cannot match unresolved, with the sentence to quote', async () => {
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    teamsStore.mockReturnValue({ teams: withUnassignedSentinel(routeTeam), loadTeams: vi.fn().mockResolvedValue(undefined), addTeam: vi.fn(), clearTeams: vi.fn() })
    wizard.process = 'The budget holder approves the spend.'

    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review SIPOC' }))

    await waitFor(() => expect(wizard.preview).not.toBeNull())
    const preview = wizard.preview as { rows: Array<{ teamId?: string; ownerHint?: string; source?: string }> }
    expect(preview.rows[0].teamId).toBeUndefined()
    expect(preview.rows[0].ownerHint).toBe('budget holder')
    expect(preview.rows[0].source).toBe('The budget holder approves the spend')
  })

  it('files an unowned row under Unassigned, not under whichever team is first', async () => {
    // "N steps have no owner and will be filed under a team called Unassigned"
    // is what Review says, so a fall back to `teams[0]` here would put the step
    // under a team the panel never named.
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    const unassigned = { ...routeTeam, id: 'unassigned-team', name: 'Unassigned' }
    const addTeam = vi.fn().mockResolvedValue(unassigned)
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    teamsStore.mockReturnValue({ teams: [routeTeam], loadTeams: vi.fn().mockResolvedValue(undefined), addTeam, clearTeams: vi.fn() })
    wizard.stripOwners = true

    renderBoard()
    openWizard()

    await waitFor(() => expect(createStep).toHaveBeenCalled())
    expect(addTeam).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-a', name: 'Unassigned' }),
      { silent: true }
    )
    expect(createStep.mock.calls.every(([step]) => step.teamId === 'unassigned-team')).toBe(true)
  })

  it('does not stack a toast per write over the panel that reports them', async () => {
    // The landing panel exists to replace the toast stack, so a confirm that
    // creates a team and opens a gap must not put one back (#220). Both writes
    // go through store actions that toast on success by default.
    const routeTeam = { id: 'route-team', projectId: 'project-a', name: 'Route Team', color: '#000', order: 1, tags: [], createdAt: 1 }
    const unassigned = { ...routeTeam, id: 'unassigned-team', name: 'Unassigned' }
    const addTeam = vi.fn().mockResolvedValue(unassigned)
    const addGap = vi.fn().mockResolvedValue({ id: 'gap-id' })
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    teamsStore.mockReturnValue({ teams: [routeTeam], loadTeams: vi.fn().mockResolvedValue(undefined), addTeam, clearTeams: vi.fn() })
    gapsStore.mockReturnValue({ gaps: [], loadGaps: vi.fn().mockResolvedValue(undefined), clearGaps: vi.fn(), addGap })
    wizard.stripOwners = true
    wizard.tickGaps = true

    renderBoard()
    openWizard()

    await waitFor(() => expect(wizard.confirmResult).not.toBeUndefined())
    // Both writes happened, so the assertions below are not vacuous.
    expect(addTeam).toHaveBeenCalled()
    expect(addGap).toHaveBeenCalled()
    // The store actions toast on success by default; `silent` is what stops
    // them. The stores are mocked here, so this is the only place the intent is
    // observable — `toast` below only covers the board's own calls.
    expect(addTeam.mock.calls.every(([, options]) => options?.silent === true)).toBe(true)
    expect(addGap.mock.calls.every(([, options]) => options?.silent === true)).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('writes nothing at all when the wizard is abandoned at Review', async () => {
    // The acceptance criterion of #220, and the one the old flow could not meet
    // on any path: `handleSaveSipoc` wrote the summary before it parsed, and
    // created the sentinel "Unassigned" team before that. Reviewing and walking
    // away had already changed the project.
    const addTeam = vi.fn()
    listMilestones.mockResolvedValue([{
      id: 'main-milestone', projectId: 'project-a', name: 'Main Flow', order: 1,
      relatedPolicies: [], createdAt: 1, updatedAt: 1,
    }])
    // No teams anywhere — the state that used to force the sentinel write.
    listTeams.mockResolvedValue([])
    teamsStore.mockReturnValue({ teams: [], loadTeams: vi.fn().mockResolvedValue(undefined), addTeam, clearTeams: vi.fn() })

    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review SIPOC' }))

    await waitFor(() => expect(wizard.preview).not.toBeNull())
    expect(upsertSipoc).not.toHaveBeenCalled()
    expect(createStep).not.toHaveBeenCalled()
    expect(addTeam).not.toHaveBeenCalled()
  })

  it('names the summary write when it is the write that failed', async () => {
    upsertSipoc.mockRejectedValue(new Error('disk full'))

    renderBoard()
    openWizard()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save the SIPOC summary'))
    // The reads happen at Review, so `listSteps` has run by now. What must not
    // have happened is any write past the one that failed.
    expect(createStep).not.toHaveBeenCalled()
  })
})

describe('ProcessBoard SIPOC control on a mapped project (#379)', () => {
  it('offers to run the wizard while the project has no process rows', async () => {
    renderBoard()

    expect(screen.getByRole('button', { name: 'Run SIPOC Wizard' })).toBeInTheDocument()
  })

  it('says it will only edit the summary once the project has steps', async () => {
    // The guard that declines has always been right; what was wrong was
    // learning about it after five pages of interview and reading it as a
    // success. The label is the earliest place the board can be honest.
    stepsStore.mockReturnValue({
      steps: [{ id: 'seeded-step', order: 1, milestoneId: 'm-1' }],
      milestones: [],
      loadSteps: vi.fn().mockResolvedValue(undefined),
      loadMilestones: vi.fn().mockResolvedValue(undefined),
      clearSteps: vi.fn(),
    })

    renderBoard()

    expect(screen.getByRole('button', { name: 'Edit SIPOC summary' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run SIPOC Wizard' })).not.toBeInTheDocument()
  })

  it('counts a process gap as existing work and tells the wizard so', async () => {
    gapsStore.mockReturnValue({
      gaps: [{ id: 'process-gap', order: 2, status: 'Open' }],
      loadGaps: vi.fn().mockResolvedValue(undefined),
      clearGaps: vi.fn(),
    })

    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit SIPOC summary' }))

    expect(screen.getByTestId('wizard-existing')).toHaveTextContent('0/1')
  })
})

describe('ProcessBoard project identity (#264)', () => {
  // 60 characters, the length the issue's acceptance criterion names.
  const LONG_NAME = 'Procure to Pay End to End Current State Process Map v3 Draft'

  beforeEach(() => {
    projectStore.mockReturnValue({
      currentProject: { id: 'project-a', name: LONG_NAME },
      selectProject: vi.fn().mockResolvedValue(undefined),
      clearSelection: vi.fn(),
      isLoading: false,
    })
  })

  it('carries the full project name in a title attribute', async () => {
    renderBoard()
    const heading = await screen.findByRole('heading', { level: 1, name: LONG_NAME })
    expect(heading).toHaveAttribute('title', LONG_NAME)
  })

  it('gives identity a line of its own instead of a 12rem slice of the toolbar row', async () => {
    // #264 kept a `min-w-[12rem]` floor so the action cluster would wrap off the
    // header row, because identity and five buttons shared it. #207 stops them
    // sharing: line one is identity and nothing else, which is what lets the
    // name run the full width before it clamps.
    renderBoard()
    const heading = await screen.findByRole('heading', { level: 1, name: LONG_NAME })
    const identityLine = heading.parentElement as HTMLElement
    expect(identityLine.className).toContain('board-identity')
    expect(identityLine.querySelectorAll('button')).toHaveLength(0)
    expect(heading.className).toContain('board-title')
  })

  it('draws the state tag inline in the title, and repeats it in the tooltip', async () => {
    // The tag sits inside a two-line clamp (12a), so a name long enough to fill
    // both lines can push it out of view. `title` is where it stays readable —
    // the same fallback #264 gave the name itself.
    projectStore.mockReturnValue({
      currentProject: { id: 'project-a', name: LONG_NAME, state: 'current' },
      selectProject: vi.fn().mockResolvedValue(undefined),
      clearSelection: vi.fn(),
      isLoading: false,
    })
    renderBoard()
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Current')
    expect(heading.querySelector('.project-state')?.className).toContain(
      'project-state-current',
    )
    expect(heading).toHaveAttribute('title', `${LONG_NAME} — Current`)
  })

  it('draws no state tag for a project whose state nobody has set', async () => {
    // `state` is nullable on purpose (#263): NULL means nobody has said, and a
    // tag that guessed would be another literal pretending to be status.
    renderBoard()
    await screen.findByRole('heading', { level: 1, name: LONG_NAME })
    expect(document.querySelector('.project-state')).toBeNull()
  })
})

describe('ProcessBoard project description (#320)', () => {
  const LONG_DESCRIPTION =
    'End-to-end procure-to-pay map covering intake, approval, fulfillment, and invoice reconciliation for the finance transformation programme.'

  beforeEach(() => {
    projectStore.mockReturnValue({
      currentProject: {
        id: 'project-a',
        name: 'Procure to Pay',
        description: LONG_DESCRIPTION,
      },
      selectProject: vi.fn().mockResolvedValue(undefined),
      clearSelection: vi.fn(),
      isLoading: false,
    })
  })

  it('carries the full description in a title attribute when the header clamps it', async () => {
    renderBoard()
    const description = await screen.findByText(LONG_DESCRIPTION)
    expect(description).toHaveAttribute('title', LONG_DESCRIPTION)
    expect(description.className).toContain('line-clamp-2')
  })
})
