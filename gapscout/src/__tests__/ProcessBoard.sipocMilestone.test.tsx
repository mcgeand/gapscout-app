import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Navigate, RouterProvider } from 'react-router-dom'

/**
 * Which milestone the SIPOC wizard generates into (#371).
 *
 * The board used to demand a milestone named exactly "Main Flow" and refuse the
 * wizard without one, so a project whose milestones are named anything else was
 * told to go and create a project it had already created.
 *
 * Every case here sets up the state that actually reaches the milestone lookup:
 * milestones present, no steps and no process gaps. An intact template project
 * has 20 seeded steps and returns at the existing-work guard long before this,
 * which is why the reproduction is a template project whose steps were cleared.
 */

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
/** What the wizard was handed back, so a test can read the preview it drives. */
const wizard = vi.hoisted(() => ({ preview: null as unknown }))
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
vi.mock('../components/Discovery/DiscoveryGrid', () => ({ default: () => <div>Discovery</div> }))
vi.mock('../components/Diagram/DiagramCanvas', () => ({ default: () => <div>Diagram</div> }))
vi.mock('../components/Sipoc/SipocView', () => ({ default: () => <div>SIPOC content</div> }))
// The real wizard reviews before it saves, so the stand-in does both halves in
// one click: `onPreview` for every read, `onConfirm` for every write.
vi.mock('../components/Sipoc/SipocWizard', () => ({
  default: ({
    onPreview,
    onConfirm,
  }: {
    onPreview: (data: typeof WIZARD_OUTPUT) => Promise<{ kind: string; rows?: unknown[] } | null>
    onConfirm: (plan: unknown) => Promise<unknown>
  }) => (
    <button
      onClick={async () => {
        const preview = await onPreview(WIZARD_OUTPUT)
        wizard.preview = preview
        if (!preview) return
        await onConfirm({
          data: WIZARD_OUTPUT,
          rows: preview.kind === 'plan' ? preview.rows : [],
          gaps: [],
          summaryOnly: preview.kind === 'summary-only',
        })
      }}
    >
      Save SIPOC
    </button>
  ),
}))
vi.mock('../components/Teams/TeamsManager', () => ({ default: () => <div>Teams registry</div> }))
vi.mock('../components/Systems/SystemsManager', () => ({ default: () => <div>Systems registry</div> }))
vi.mock('../components/Policies/PolicyManager', () => ({ default: () => <div>Policies registry</div> }))
vi.mock('../components/Glossary/GlossaryManager', () => ({ default: () => <div>Glossary registry</div> }))
vi.mock('../components/Gaps', () => ({ GapsPanel: () => <div>Gaps panel</div> }))
vi.mock('../components/Export', () => ({ ExportModal: () => null }))

import ProcessBoard from '../pages/ProcessBoard'

function milestone(id: string, name: string, order: number) {
  return { id, projectId: 'project-a', name, order, relatedPolicies: [], createdAt: 1, updatedAt: 1 }
}

const ROUTE_TEAM = {
  id: 'route-team', projectId: 'project-a', name: 'Route Team',
  color: '#000', order: 1, tags: [], createdAt: 1,
}
/** Confirm files unowned wizard rows under Unassigned; seed it so addTeam is not required. */
const UNASSIGNED_TEAM = {
  id: 'unassigned-team', projectId: 'project-a', name: 'Unassigned',
  color: '#6B7280', order: 2, tags: [], createdAt: 1,
}

function renderBoard() {
  const router = createMemoryRouter(
    [
      {
        path: '/projects/:projectId',
        element: <ProcessBoard />,
        children: [
          { index: true, element: <Navigate to="discovery" replace /> },
          { path: ':tab', element: null },
        ],
      },
    ],
    { initialEntries: ['/projects/project-a/discovery'] },
  )
  return { ...render(<RouterProvider router={router} />), router }
}

function runWizard() {
  fireEvent.click(screen.getByRole('button', { name: 'Run SIPOC Wizard' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save SIPOC' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  wizard.preview = null
  initDB.mockResolvedValue(undefined)
  listMilestones.mockResolvedValue([])
  listTeams.mockResolvedValue([ROUTE_TEAM, UNASSIGNED_TEAM])
  createStep.mockResolvedValue('step-id')
  listSteps.mockResolvedValue([])
  listGaps.mockResolvedValue([])
  getSipoc.mockResolvedValue(null)
  upsertSipoc.mockResolvedValue(undefined)
  projectStore.mockReturnValue({
    currentProject: { id: 'project-a', name: 'project-a' },
    selectProject: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
    isLoading: false,
  })
  teamsStore.mockReturnValue({
    teams: [ROUTE_TEAM, UNASSIGNED_TEAM],
    loadTeams: vi.fn().mockResolvedValue(undefined),
    addTeam: vi.fn(),
    clearTeams: vi.fn(),
  })
  stepsStore.mockReturnValue({ steps: [], milestones: [], loadSteps: vi.fn().mockResolvedValue(undefined), loadMilestones: vi.fn().mockResolvedValue(undefined), clearSteps: vi.fn() })
  gapsStore.mockReturnValue({ gaps: [], loadGaps: vi.fn().mockResolvedValue(undefined), clearGaps: vi.fn() })
  systemsStore.mockReturnValue({ systems: [], loadSystems: vi.fn().mockResolvedValue(undefined), clearSystems: vi.fn() })
  policiesStore.mockReturnValue({ policies: [], loadPolicies: vi.fn().mockResolvedValue(undefined), clearPolicies: vi.fn() })
  glossaryStore.mockReturnValue({ entries: [], loadGlossary: vi.fn().mockResolvedValue(undefined), clearGlossary: vi.fn() })
})

describe('SIPOC wizard milestone selection', () => {
  it('generates into the first milestone when none is named Main Flow', async () => {
    // The P2P template's four phases, in order, and no "Main Flow" among them.
    listMilestones.mockResolvedValue([
      milestone('m-req', 'Requisition', 0),
      milestone('m-app', 'Approval', 1),
      milestone('m-po', 'Purchase Order', 2),
      milestone('m-pay', 'Payment', 3),
    ])

    renderBoard()
    runWizard()

    await waitFor(() => expect(createStep).toHaveBeenCalled())
    for (const [step] of createStep.mock.calls) {
      expect(step.milestoneId).toBe('m-req')
    }
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still prefers Main Flow when the setup wizard made one', async () => {
    // `listMilestones` is ORDER BY "order" ASC, so a lower-ordered milestone
    // sorts ahead of "Main Flow" — the name still wins where it exists.
    listMilestones.mockResolvedValue([
      milestone('m-other', 'Intake', 0),
      milestone('m-main', 'Main Flow', 1),
    ])

    renderBoard()
    runWizard()

    await waitFor(() => expect(createStep).toHaveBeenCalled())
    for (const [step] of createStep.mock.calls) {
      expect(step.milestoneId).toBe('m-main')
    }
  })

  it('answers a project with no milestones before anything is written', async () => {
    // This used to be a toast fired after the interview and after the summary
    // had been saved. It is a Review answer now (#220): the wizard renders the
    // reason, and the summary is still saved because the user typed it.
    listMilestones.mockResolvedValue([])

    renderBoard()
    runWizard()

    await waitFor(() =>
      expect(wizard.preview).toEqual({ kind: 'summary-only', reason: 'no-milestone', steps: 0, gaps: 0 })
    )
    expect(createStep).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(upsertSipoc).toHaveBeenCalledWith({ projectId: 'project-a', ...WIZARD_OUTPUT })
    )
  })
})
