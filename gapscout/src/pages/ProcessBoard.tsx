import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { Link, Outlet, useMatches, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronDown, Download } from 'lucide-react'
import MainLayout from '../app/layout/MainLayout'
import { useDismissOnOutside } from '../hooks/useDismissOnOutside'
import { useProjectStore } from '../state/projectStore'
import { useTeamsStore } from '../state/teamsStore'
import { useStepsStore } from '../state/stepsStore'
import { useGapsStore } from '../state/gapsStore'
import { useSystemsStore } from '../state/systemsStore'
import { usePoliciesStore } from '../state/policiesStore'
import { useGlossaryStore } from '../state/glossaryStore'
import SipocWizard, {
  type SipocConfirmPlan,
  type SipocData,
  type SipocPreview,
  type SipocSaveResult,
} from '../components/Sipoc/SipocWizard'
import SipocView from '../components/Sipoc/SipocView'
import DiscoveryGrid from '../components/Discovery/DiscoveryGrid'
import DiagramCanvas from '../components/Diagram/DiagramCanvas'
import TeamsManager from '../components/Teams/TeamsManager'
import SystemsManager from '../components/Systems/SystemsManager'
import PolicyManager from '../components/Policies/PolicyManager'
import GlossaryManager from '../components/Glossary/GlossaryManager'
import { GapsPanel } from '../components/Gaps'
import { ExportModal } from '../components/Export'
import type { Gap, Milestone, ProjectState, SIPOC, Step } from '../data/types'
import { DEFAULT_COLORS, UNASSIGNED_TEAM_COLOR } from '../data/constants'
import { parseSipocData, parsedStepToStep } from '../lib/sipocParser'
import { createStep, getSipoc, initDB, listGaps, listMilestones, listSteps, listTeams, upsertSipoc } from '../services/db'
import { isProcessGap, processPositions } from '../lib/stepSequence'
import { beginProjectScope, captureProjectScope, clearProjectScope, isProjectScopeCurrent } from '../state/workspaceScope'

type TabView =
  | 'discovery'
  | 'sipoc'
  | 'diagram'
  | 'gaps'
  | 'teams'
  | 'systems'
  | 'policies'
  | 'glossary'

/**
 * Tab order is the bar's left-to-right order; `id` is also the URL segment.
 *
 * The four registries used to have three different mounting stories — Teams and
 * Policies opened from a header button, Systems and Glossary had a header button
 * *and* an emoji placeholder tab whose only content reopened the same dialog.
 * They are all destinations now, which is what `group` separates: working views
 * left of the rule, registries right of it.
 */
interface TabSpec {
  id: TabView
  label: string
  group: 'work' | 'registry'
}

const TABS: ReadonlyArray<TabSpec> = [
  { id: 'discovery', label: 'Discovery', group: 'work' },
  { id: 'sipoc', label: 'SIPOC', group: 'work' },
  { id: 'diagram', label: 'Diagram', group: 'work' },
  { id: 'gaps', label: 'Gaps', group: 'work' },
  { id: 'teams', label: 'Teams', group: 'registry' },
  { id: 'systems', label: 'Systems', group: 'registry' },
  { id: 'policies', label: 'Policies', group: 'registry' },
  { id: 'glossary', label: 'Glossary', group: 'registry' },
]

const WORK_TABS = TABS.filter(tab => tab.group === 'work')
const REGISTRY_TABS = TABS.filter(tab => tab.group === 'registry')

const DEFAULT_TAB: TabView = 'discovery'

function isTabView(value: unknown): value is TabView {
  return TABS.some(tab => tab.id === value)
}

function isRegistryTab(tab: TabView): boolean {
  return REGISTRY_TABS.some(registry => registry.id === tab)
}

/** `undefined` means nobody has said, and it draws nothing (#263). */
const STATE_TAG: Record<ProjectState, { label: string; className: string }> = {
  current: { label: 'Current', className: 'project-state-current' },
  future: { label: 'Future', className: 'project-state-future' },
}

/**
 * Where the process currently ends, as the number the Discovery grid shows.
 *
 * `steps."order"` is scoped to its milestone, so the last stored order is not
 * the last position in the process. The wizard's "appended after step N" and
 * "Steps N–M" both name a row the user can see, so both go through
 * `processPositions` rather than through an `order`.
 */
function lastProcessPosition(
  steps: Step[],
  processGaps: Gap[],
  milestones: Milestone[]
): { position: number; label?: string } {
  const positions = processPositions(steps, processGaps, milestones)

  let position = 0
  let label: string | undefined
  for (const step of steps) {
    const at = positions.get(step.id)
    if (at !== undefined && at > position) {
      position = at
      label = step.label
    }
  }
  // A process gap can hold the last position without being a step, in which
  // case there is a number to append after but no label to name.
  for (const gap of processGaps) {
    const at = positions.get(gap.id)
    if (at !== undefined && at > position) {
      position = at
      label = undefined
    }
  }

  return { position, label }
}

/** The persisted row carries `projectId`; the wizard's form shape does not. */
function sipocToWizardData(sipoc: SIPOC): SipocData {
  return {
    suppliers: sipoc.suppliers,
    inputs: sipoc.inputs,
    process: sipoc.process,
    outputs: sipoc.outputs,
    customers: sipoc.customers,
  }
}

/**
 * ProcessBoard - Main workspace for viewing and editing a project's process map
 * 
 * Integrates SIPOC Wizard → Parser → Step Generation → Views
 */
function ProcessBoardWorkspace({ projectId }: { projectId: string }) {
  const { currentProject, selectProject, clearSelection, isLoading } = useProjectStore()
  const { teams, loadTeams, addTeam, clearTeams } = useTeamsStore()
  const { steps, milestones, loadSteps, loadMilestones, clearSteps } = useStepsStore()
  const { gaps, loadGaps, clearGaps, addGap } = useGapsStore()
  const { systems, loadSystems, clearSystems } = useSystemsStore()
  const { policies, loadPolicies, clearPolicies } = usePoliciesStore()
  const { entries: glossary, loadGlossary, clearGlossary } = useGlossaryStore()
  const isCurrentProject = currentProject?.id === projectId
  const [showSipocWizard, setShowSipocWizard] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  const [showRegistries, setShowRegistries] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)
  const registriesRef = useRef<HTMLDivElement>(null)
  const closeOverflow = useCallback(() => setShowOverflow(false), [])
  const closeRegistries = useCallback(() => setShowRegistries(false), [])
  // The tab is a child URL segment, so it survives refresh, deep-links, and
  // answers to back/forward. `useParams` here would only see the parent's
  // params, so the child's `:tab` is read from the last match instead.
  const matches = useMatches()
  const navigate = useNavigate()
  const tabParam = (matches[matches.length - 1]?.params as { tab?: string } | undefined)?.tab
  const activeTab: TabView = isTabView(tabParam) ? tabParam : DEFAULT_TAB
  const setActiveTab = useCallback(
    (tab: TabView) => {
      // Compare against the raw segment, not `activeTab`. At
      // '/projects/:id/not-a-tab' the derived tab is already 'discovery', so
      // guarding on it would make clicking Discovery a no-op and leave the bad
      // URL uncorrected. Re-clicking the active tab used to be a no-op under
      // useState; without this it would push a duplicate history entry.
      if (tab === tabParam) return
      navigate(`/projects/${projectId}/${tab}`)
    },
    [navigate, projectId, tabParam],
  )
  // Every count in the tab bar comes from the stores loaded centrally below, so
  // they stay right while you are on another tab. They used to be computed
  // inside each manager and shown only in its modal footer, which meant the
  // only way to see how many teams a project had was to open the teams dialog.
  const openGapCount = useMemo(
    () => gaps.filter(gap => gap.status === 'Open').length,
    [gaps]
  )
  const tabCounts = useMemo<Partial<Record<TabView, number>>>(
    () => ({
      discovery: steps.length,
      gaps: openGapCount,
      teams: teams.length,
      systems: systems.length,
      policies: policies.length,
      glossary: glossary.length,
    }),
    [steps.length, openGapCount, teams.length, systems.length, policies.length, glossary.length]
  )
  const registryCount =
    teams.length + systems.length + policies.length + glossary.length

  // Read from the stores rather than the database, so the header can say what
  // the wizard will do before the wizard is opened (#379).
  const existingWork = useMemo(
    () => ({ steps: steps.length, gaps: gaps.filter(isProcessGap).length }),
    [steps, gaps]
  )
  const hasProcessRows = existingWork.steps > 0 || existingWork.gaps > 0

  // The header's `title`. A two-line clamp can cut either the tail of a long
  // name or the state tag after it, so both live here rather than the name
  // alone — there is nowhere else to read them.
  const headerTitle = useMemo(() => {
    const name = currentProject?.name || 'Project'
    const state = currentProject?.state
    return state ? `${name} — ${STATE_TAG[state].label}` : name
  }, [currentProject?.name, currentProject?.state])

  useDismissOnOutside(showOverflow, overflowRef, closeOverflow)
  useDismissOnOutside(showRegistries, registriesRef, closeRegistries)

  const [sipocData, setSipocData] = useState<SipocData | null>(null)
  // The Markdown pack renders a SIPOC section, and the diagram toolbar owns the
  // export modal, so the persisted summary has to reach it from here.
  const sipoc = useMemo<SIPOC | null>(
    () => (sipocData ? { projectId, ...sipocData } : null),
    [projectId, sipocData]
  )

  useEffect(() => {
    beginProjectScope(projectId)
    clearSelection()
    clearTeams()
    clearSteps()
    clearGaps()
    clearSystems()
    clearPolicies()
    clearGlossary()

    let cancelled = false
    void (async () => {
      try {
        await initDB()
        if (cancelled) return
        const [persistedSipoc] = await Promise.all([
          getSipoc(projectId),
          selectProject(projectId),
          loadSteps(projectId),
          loadMilestones(projectId),
          loadGaps(projectId),
          loadTeams(projectId),
          loadSystems(projectId),
          loadPolicies(projectId),
          loadGlossary(projectId),
        ])
        if (cancelled) return
        setSipocData(persistedSipoc ? sipocToWizardData(persistedSipoc) : null)
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load project workspace:', error)
          toast.error('Unable to load project workspace. Retry from the projects page.')
        }
      }
    })()

    return () => {
      cancelled = true
      clearProjectScope()
    }
  }, [
    projectId,
    clearSelection,
    clearTeams,
    clearSteps,
    clearGaps,
    clearSystems,
    clearPolicies,
    clearGlossary,
    selectProject,
    loadSteps,
    loadMilestones,
    loadGaps,
    loadTeams,
    loadSystems,
    loadPolicies,
    loadGlossary,
  ])

  /**
   * Everything the wizard's Review step needs, and not one write.
   *
   * The split is the point of #220. The old `handleSaveSipoc` read, parsed and
   * wrote in one pass, so the parser's cap, its team guesses and the sentences
   * it could not read were all settled before the user saw any of them — and
   * the sentinel "Unassigned" team was created *ahead* of the parse, so
   * abandoning the wizard still left a team behind.
   *
   * Reads live here rather than in the wizard because the project-scope guards
   * do: a route change between any two awaits must abandon the answer rather
   * than let it land on the next project (`ProcessBoard.lifecycle`).
   */
  const handlePreviewSipoc = async (sipocData: SipocData): Promise<SipocPreview | null> => {
    if (!projectId) {
      toast.error('No project selected')
      return null
    }

    const scope = captureProjectScope(projectId)
    if (!scope) return null

    try {
      // Re-running the wizard edits the summary; it does not rebuild the flow.
      // Steps carry no origin marker, so regenerating would delete work done by
      // hand in Discovery. Existing steps mean this is an edit, not a first run.
      //
      // Process gaps count as existing work too. The guard used to check steps
      // alone, so a project whose flow was mapped as gaps first — no steps yet —
      // had `1..n` inserted straight over the orders those gaps were holding,
      // and every pair read as a parallel branch (#353, addendum A).
      //
      // What changed with #379 is only *when* the user is told. The guard fired
      // after five pages of interview and reported itself as a green success
      // toast, which on a template-seeded project happened every single time.
      // It is now an answer Review renders, and the header names it before the
      // interview starts.
      const existingSteps = await listSteps(projectId)
      if (!isProjectScopeCurrent(scope)) return null
      const existingGaps = (await listGaps(projectId)).filter(isProcessGap)
      if (!isProjectScopeCurrent(scope)) return null

      if (existingSteps.length > 0 || existingGaps.length > 0) {
        return {
          kind: 'summary-only',
          reason: 'existing-rows',
          steps: existingSteps.length,
          gaps: existingGaps.length,
        }
      }

      // The milestone the generated steps land in.
      //
      // "Main Flow" is what the setup wizard names its single milestone, so it
      // is preferred where it exists — but it is a default, not a contract.
      // Requiring the name refused the wizard outright on any project whose
      // milestones are named something else (#371). `listMilestones` is
      // `ORDER BY "order" ASC`, so `[0]` is the first milestone of the process,
      // which is where a first run belongs.
      //
      // Unlike the Discovery grid (#168), nothing is created when there are
      // none: the grid's caller is "+ Add First Step" on a project with no
      // milestones at all, whereas a project reaching here has phases already,
      // and adding one beside them would be wrong.
      const projectMilestones = await listMilestones(projectId)
      if (!isProjectScopeCurrent(scope)) return null
      const mainMilestone =
        projectMilestones.find(m => m.name === 'Main Flow') ?? projectMilestones[0]

      if (!mainMilestone) {
        return { kind: 'summary-only', reason: 'no-milestone', steps: 0, gaps: 0 }
      }

      // The store is the fast path; the table is the authority. A project loaded
      // a moment ago can have teams the store has not seen, and the parse that
      // Review is built from must match what the confirm will write against.
      let effectiveTeams = teams
      if (effectiveTeams.length === 0) {
        effectiveTeams = await listTeams(projectId)
        if (!isProjectScopeCurrent(scope)) return null
      }

      const parseResult = parseSipocData(
        {
          suppliers: sipocData.suppliers,
          inputs: sipocData.inputs,
          processDescription: sipocData.process,
          outputs: sipocData.outputs,
          customers: sipocData.customers,
        },
        effectiveTeams
      )

      if (parseResult.steps.length === 0) {
        toast.error('Could not read any process steps from that description')
        return null
      }

      const rows = parseResult.steps.map(step => ({
        id: nanoid(),
        label: step.label,
        teamId: step.teamId,
        ownerHint: step.ownerHint,
        source: step.source,
        suppliers: step.suppliers,
        inputs: step.inputs,
        outputs: step.outputs,
        customers: step.customers,
      }))

      const { position, label } = lastProcessPosition(existingSteps, existingGaps, projectMilestones)

      return {
        kind: 'plan',
        rows,
        gaps: parseResult.gaps.map(gap => ({
          description: gap.description,
          stepIndex: gap.relatedSteps[0],
        })),
        unparsed: parseResult.unparsed,
        warnings: parseResult.warnings,
        teams: effectiveTeams,
        milestoneName: mainMilestone.name,
        appendAfterPosition: position + 1,
        appendAfterLabel: label,
      }
    } catch (error) {
      if (!isProjectScopeCurrent(scope)) return null
      console.error('Failed to read the project for the SIPOC review:', error)
      toast.error('Could not read this project. Try again from the projects page.')
      return null
    }
  }

  /**
   * Every write the wizard makes, and the only place it makes one.
   *
   * The order is recoverable rather than atomic, because a real transaction is
   * not available here: @tauri-apps/plugin-sql runs every statement on a pooled
   * connection, so `BEGIN` and `COMMIT` can land on different ones and the
   * COMMIT fails with "cannot commit - no transaction is active" (observed
   * 2026-09-02 against the desktop build).
   *
   * So the summary goes first and on its own — it is what the user typed, and
   * every guard below can bail out. What changed with #220 is what happens
   * *before* this function: nothing. The whole set is confirmed against a table
   * the user has already read, so a partial write is no longer also a surprise.
   * A partial set still is not self-healing, and fixing that needs a real
   * transaction.
   */
  const handleConfirmSipoc = async (
    plan: SipocConfirmPlan
  ): Promise<SipocSaveResult | null> => {
    if (!projectId) {
      toast.error('No project selected')
      return null
    }

    const scope = captureProjectScope(projectId)
    if (!scope) return null

    try {
      await upsertSipoc({ projectId, ...plan.data })
    } catch (error) {
      console.error('Failed to save SIPOC summary:', error)
      toast.error('Failed to save the SIPOC summary')
      return null
    }
    if (!isProjectScopeCurrent(scope)) return null
    setSipocData(plan.data)

    if (plan.summaryOnly) {
      return {
        stepsCreated: 0,
        gapsCreated: 0,
        teamsCreated: 0,
        firstPosition: 0,
        lastPosition: 0,
        milestoneName: '',
        needsDetail: 0,
        summaryOnly: true,
      }
    }

    try {
      const existingSteps = await listSteps(projectId)
      if (!isProjectScopeCurrent(scope)) return null
      const existingGaps = (await listGaps(projectId)).filter(isProcessGap)
      if (!isProjectScopeCurrent(scope)) return null
      const projectMilestones = await listMilestones(projectId)
      if (!isProjectScopeCurrent(scope)) return null

      const mainMilestone =
        projectMilestones.find(m => m.name === 'Main Flow') ?? projectMilestones[0]
      if (!mainMilestone) {
        toast.error(
          'This project has no milestones yet. Add one in Discovery, then run the wizard again.'
        )
        return null
      }

      // Teams the review asked for, created once each and keyed by the name the
      // row carries. Nothing here ran until the user pressed the button — the
      // sentinel below included, which used to be written before parsing began
      // and survived a cancel.
      const teamIdByName = new Map<string, string>()
      let teamsCreated = 0
      for (const name of new Set(
        plan.rows.map(row => row.newTeamName).filter((name): name is string => !!name)
      )) {
        // A colour each, cycled: team colour is what the diagram draws its
        // swimlanes with, so three new teams sharing one grey would be three
        // lanes nobody can tell apart.
        const created = await addTeam(
          {
            projectId,
            name,
            color: DEFAULT_COLORS[teamsCreated % DEFAULT_COLORS.length],
          },
          { silent: true }
        )
        if (!isProjectScopeCurrent(scope)) return null
        if (!created) {
          toast.error(`Could not create the team "${name}". No steps were written.`)
          return null
        }
        teamIdByName.set(name, created.id)
        teamsCreated += 1
      }

      // A row with no owner at all still needs a valid teamId to satisfy the FK
      // and Zod row validation (ZIP-381), so the sentinel is resolved here.
      //
      // Always "Unassigned", never whichever team happens to be first. Review
      // says in as many words that unowned steps are filed under a team called
      // Unassigned, so falling back to `teams[0]` here would put steps under a
      // team the panel never named.
      let sentinelTeamId: string | undefined
      if (plan.rows.some(row => !row.teamId && !row.newTeamName)) {
        let available = teams
        if (available.length === 0) {
          available = await listTeams(projectId)
          if (!isProjectScopeCurrent(scope)) return null
        }
        const existing = available.find(team => team.name === 'Unassigned')
        if (existing) {
          sentinelTeamId = existing.id
        } else {
          // Grey on purpose: the sentinel is the absence of an owner, and a
          // lane colour would give it a presence in the diagram it has not
          // earned.
          const unassigned = await addTeam(
            { projectId, name: 'Unassigned', color: UNASSIGNED_TEAM_COLOR },
            { silent: true }
          )
          if (!isProjectScopeCurrent(scope)) return null
          if (!unassigned) {
            toast.error('Could not create a default team. No steps were written.')
            return null
          }
          sentinelTeamId = unassigned.id
          teamsCreated += 1
        }
      }

      // Rebased at confirm-time, in the order the review table ended up in: the
      // parser's `order` is stale the moment a row is moved, added or removed.
      // 1-based per milestone, matching every other writer of `steps."order"`.
      const maxOrder = existingSteps
        .filter(step => step.milestoneId === mainMilestone.id)
        .reduce((highest, step) => Math.max(highest, step.order), 0)

      // The scope is checked once here rather than between writes: without a
      // transaction, stopping half way through the loop is what leaves the
      // partial step sets this replaces. Once the first row is written the set
      // is finished, and only what the user would see is skipped after a move.
      if (!isProjectScopeCurrent(scope)) return null

      const stepIdByRowId = new Map<string, string>()
      for (const [index, row] of plan.rows.entries()) {
        const stepData = parsedStepToStep(
          {
            label: row.label.trim(),
            suppliers: row.suppliers,
            inputs: row.inputs,
            outputs: row.outputs,
            customers: row.customers,
            teamId:
              row.teamId ??
              (row.newTeamName ? teamIdByName.get(row.newTeamName) : undefined) ??
              sentinelTeamId,
            order: maxOrder + 1 + index,
          },
          projectId,
          mainMilestone.id
        )
        stepIdByRowId.set(row.id, await createStep(stepData))
      }

      // Only the gaps the user ticked. The parser notices several per run, and
      // opening them uninvited is what makes a gap register worthless.
      let gapsCreated = 0
      for (const gap of plan.gaps) {
        if (!gap.create) continue
        const stepId = gap.rowId ? stepIdByRowId.get(gap.rowId) : undefined
        if (!stepId) continue
        const created = await addGap(
          {
            projectId,
            stepId,
            observed: gap.description,
            expected: 'The step describes this part of the flow.',
            severity: 'M',
            status: 'Open',
            links: [],
          },
          { silent: true }
        )
        if (created) gapsCreated += 1
      }

      // Let the rest of the workspace see the new rows without a reload.
      await loadSteps(projectId)
      if (!isProjectScopeCurrent(scope)) return null
      if (gapsCreated > 0) {
        await loadGaps(projectId)
        if (!isProjectScopeCurrent(scope)) return null
      }
      await loadTeams(projectId)
      if (!isProjectScopeCurrent(scope)) return null

      const { position, label } = lastProcessPosition(
        existingSteps,
        existingGaps,
        projectMilestones
      )

      return {
        stepsCreated: plan.rows.length,
        gapsCreated,
        teamsCreated,
        firstPosition: position + 1,
        lastPosition: position + plan.rows.length,
        milestoneName: mainMilestone.name,
        appendAfterLabel: label,
        needsDetail: plan.rows.filter(
          row => row.inputs.length === 0 || row.outputs.length === 0
        ).length,
        summaryOnly: false,
      }
    } catch (error) {
      if (!isProjectScopeCurrent(scope)) return null
      console.error('Failed to write the SIPOC steps:', error)
      toast.error('Failed to create process steps')
      return null
    }
  }

  const handleEditSipoc = () => {
    setShowSipocWizard(true)
  }

  return (
    <MainLayout>
      {/* `flex flex-col h-full` is what gives the content area a definite
          height, so the diagram can size itself with `flex-1 min-h-0`
          instead of the old hardcoded `calc(100vh - 160px)`, which was
          pinned to today's header and tab-bar heights. */}
      <div className="flex flex-col h-full">
      {/* Board chrome — identity on its own line, then the tab bar.
          `container: board / inline-size` (globals.css) is what 12b's narrow
          collapse measures: minWidth is 1024, but the 256px sidebar and the
          320px right panel can leave this element at ~448px, so a viewport
          media query would never fire where the collapse is needed. */}
      <div className="board-chrome bg-gs-surface border-b-2 border-gs-rule-strong w-full">
        <div className="px-gs-8 pt-gs-4 w-full">
          {/* Line one: identity, full bleed. It used to share this row with
              four `Manage …` buttons and the primary action, which is what made
              any name over ~22 characters unreadable. Nothing else goes in
              here — that is the whole point of the line. */}
          <div className="board-identity">
            <p className="board-eyebrow">
              <Link to="/projects" className="board-crumb">
                GapScout / Projects
              </Link>
            </p>
            {isLoading || !isCurrentProject ? (
              <h1 className="board-title text-gs-ink-faint mt-gs-1">Loading…</h1>
            ) : (
              <h1 className="board-title mt-gs-1" title={headerTitle}>
                {currentProject?.name || 'Project'}
                {/* Inline, inside the clamp, so it reads as part of the title
                    rather than a badge on the end (12a). A name long enough to
                    fill both lines can push the tag past the clamp, which is why
                    `title` carries the state too — the same way #264 made a
                    clipped name recoverable. Undefined draws nothing. */}
                {currentProject?.state && (
                  <span className={`project-state ${STATE_TAG[currentProject.state].className}`}>
                    {STATE_TAG[currentProject.state].label}
                  </span>
                )}
              </h1>
            )}
          </div>

          {/* Line two: what this project is on the left, what you can do to it
              on the right. The two never compete for the same space again. */}
          <div className="flex items-start justify-between gap-gs-6 mt-gs-2">
            <div className="min-w-0 flex-1">
              {currentProject?.description && (
                <p className="board-meta line-clamp-2" title={currentProject.description}>
                  {currentProject.description}
                </p>
              )}
              {isCurrentProject && (
                <p className="board-meta mt-gs-1">
                  {steps.length} step{steps.length !== 1 ? 's' : ''} · {openGapCount} open gap
                  {openGapCount !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {isCurrentProject && (
              <div className="flex flex-shrink-0 items-center gap-gs-2">
                <button
                  className="btn-secondary brd-wide items-center gap-gs-2"
                  onClick={() => setShowExportModal(true)}
                  title="Export the steps or gaps register. The diagram formats need the live canvas — export those from the Diagram tab."
                >
                  <Download size={16} strokeWidth={2} />
                  Export
                </button>

                {/* Under 900px Export folds into an overflow beside the primary
                    action, so the primary never gets pushed off the row. */}
                <div className="relative brd-narrow" ref={overflowRef}>
                  <button
                    className="btn-secondary"
                    aria-label="More project actions"
                    aria-expanded={showOverflow}
                    aria-haspopup="menu"
                    onClick={() => setShowOverflow(open => !open)}
                  >
                    ···
                  </button>
                  {showOverflow && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-gs-1 w-48 bg-gs-surface border-2 border-gs-ink z-[var(--gs-z-popover)]"
                    >
                      <button
                        role="menuitem"
                        className="btn-ghost w-full flex items-center gap-gs-2"
                        onClick={() => {
                          setShowOverflow(false)
                          setShowExportModal(true)
                        }}
                      >
                        <Download size={16} strokeWidth={2} />
                        Export
                      </button>
                    </div>
                  )}
                </div>

                {/* #379: on a project that already has rows the wizard can only
                    edit the summary — the existing-work guard has always been
                    right, but it used to decline *after* five pages of
                    interview, and reported itself as a green success toast. The
                    label is the earliest honest place to say so. */}
                <button
                  className="btn-primary"
                  onClick={() => setShowSipocWizard(true)}
                  title={
                    hasProcessRows
                      ? 'This project already has process rows, so the interview updates the SIPOC summary and leaves them alone.'
                      : undefined
                  }
                >
                  {hasProcessRows ? 'Edit SIPOC summary' : 'Run SIPOC Wizard'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tab bar: working views, a rule, then the registries. Tabs sit at
            their natural width — `flex-1` used to stretch six of them to ~260px
            each at 1600px. */}
        {/* No `overflow-x-auto` here: `overflow-x` implies an `overflow-y`
            scroll context, which clipped the Registries menu to the height of
            the bar. The narrow collapse is what stops the tabs overflowing;
            `flex-wrap` is the fallback if they ever still do. */}
        <div className="px-gs-8 w-full">
          <nav className="flex flex-wrap items-stretch" aria-label="Board views">
            {WORK_TABS.map(tab => (
              <BoardTab
                key={tab.id}
                tab={tab}
                isActive={activeTab === tab.id}
                count={tabCounts[tab.id]}
                onSelect={setActiveTab}
              />
            ))}

            <span className="tab-divide" aria-hidden="true" />

            {REGISTRY_TABS.map(tab => (
              <BoardTab
                key={tab.id}
                tab={tab}
                isActive={activeTab === tab.id}
                count={tabCounts[tab.id]}
                onSelect={setActiveTab}
                className="brd-wide"
              />
            ))}

            {/* The same four destinations below 900px, behind one chip. It has
                to be a menu rather than a link: collapsing four tabs into a
                button that only ever opened Teams would put three registries
                out of reach at exactly the width 12b was drawn for. */}
            <div className="relative brd-narrow" ref={registriesRef}>
              <button
                type="button"
                onClick={() => setShowRegistries(open => !open)}
                className="tab"
                aria-haspopup="menu"
                aria-expanded={showRegistries}
                aria-current={isRegistryTab(activeTab) ? 'page' : undefined}
              >
                Registries{' '}
                <span className="tab-count">{registryCount}</span>
                <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              {showRegistries && (
                <div
                  role="menu"
                  className="absolute left-0 mt-gs-1 w-48 bg-gs-surface border-2 border-gs-ink z-[var(--gs-z-popover)]"
                >
                  {REGISTRY_TABS.map(tab => (
                    <button
                      key={tab.id}
                      role="menuitem"
                      className="btn-ghost w-full flex items-center justify-between gap-gs-2"
                      aria-current={activeTab === tab.id ? 'page' : undefined}
                      onClick={() => {
                        setShowRegistries(false)
                        setActiveTab(tab.id)
                      }}
                    >
                      {tab.label}
                      <span className="tab-count">{tabCounts[tab.id]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-auto">
        {/* Diagram Tab - Full Width (no padding, no max-width) */}
        {activeTab === 'diagram' && isCurrentProject && (
          <div className="w-full flex-1 min-h-0">
            <DiagramCanvas projectId={projectId} sipoc={sipoc} />
          </div>
        )}

        {/* Other Tabs - Constrained Width with Padding */}
        {activeTab !== 'diagram' && (
          <div className="p-6 sm:p-8">
            <div className="w-full max-w-6xl mx-auto">
              {/* Discovery Tab */}
              {activeTab === 'discovery' && isCurrentProject && (
                <DiscoveryGrid projectId={projectId} />
              )}

              {/* SIPOC Tab */}
              {activeTab === 'sipoc' && isCurrentProject && (
                <SipocView
                  sipocData={sipocData}
                  onEdit={handleEditSipoc}
                  relatedPolicies={[]}
                />
              )}

              {/* Gaps Tab */}
              {activeTab === 'gaps' && isCurrentProject && (
                <GapsPanel projectId={projectId} />
              )}

              {/* The four registries. They are destinations now, not dialogs
                  opened from a header button — the two emoji placeholder tabs
                  that used to sit here only reopened the same modal. */}
              {activeTab === 'teams' && isCurrentProject && (
                <TeamsManager projectId={projectId} />
              )}

              {activeTab === 'systems' && isCurrentProject && (
                <SystemsManager projectId={projectId} />
              )}

              {activeTab === 'policies' && isCurrentProject && (
                <PolicyManager projectId={projectId} />
              )}

              {activeTab === 'glossary' && isCurrentProject && (
                <GlossaryManager projectId={projectId} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* The child routes render no UI of their own — the panels above are
          keyed off the URL segment. The Outlet still has to be here, because
          it is what mounts the index route's <Navigate> that turns a bare
          '/projects/:id' into '/projects/:id/discovery'. */}
      <Outlet />
      </div>

      {/* SIPOC Wizard Modal — mounted only while open so `initialData` is read
          fresh each time. The wizard seeds its form state with `useState`, which
          ignores later prop changes, so a persistent mount would open blank
          after the first run. */}
      {isCurrentProject && showSipocWizard && (
        <SipocWizard
          isOpen={showSipocWizard}
          onClose={() => setShowSipocWizard(false)}
          projectName={currentProject?.name || 'this project'}
          initialData={sipocData ?? undefined}
          existingWork={existingWork}
          onPreview={handlePreviewSipoc}
          onConfirm={handleConfirmSipoc}
          onOpenDiscovery={() => setActiveTab('discovery')}
          onOpenDiagram={() => setActiveTab('diagram')}
        />
      )}

      {/* Export (PRD 4.12, #150). #207 asked for an Export in the header and
          assumed it would be a stub; #150 has since shipped, so it is wired.
          `hasDiagram={false}` is not a placeholder: the three image formats
          rasterise the live `.react-flow__viewport`, which only exists while
          the Diagram tab is mounted, so the canvas keeps its own control and
          the modal disables those three here and says why. */}
      {isCurrentProject && (
        <ExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          project={currentProject}
          steps={steps}
          gaps={gaps}
          teams={teams}
          milestones={milestones}
          systems={systems}
          policies={policies}
          glossary={glossary}
          sipoc={sipoc}
          getViewport={() => null}
          nodes={[]}
          swimlanes={[]}
          hasDiagram={false}
          diagramUnavailableHint="Open the Diagram tab and generate the diagram first"
        />
      )}

    </MainLayout>
  )
}

/**
 * One tab. `aria-current="page"` carries the active state so the 3px accent
 * underline lives in the stylesheet rather than in a className ternary.
 */
function BoardTab({
  tab,
  isActive,
  count,
  onSelect,
  className = '',
}: {
  tab: TabSpec
  isActive: boolean
  count?: number
  onSelect: (tab: TabView) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tab.id)}
      className={`tab ${className}`}
      aria-current={isActive ? 'page' : undefined}
    >
      {tab.label}
      {/* The space is load-bearing: JSX strips the newline between these two,
          and without it the accessible name is "Gaps9". */}
      {count !== undefined && (
        <>
          {' '}
          <span className="tab-count">{count}</span>
        </>
      )}
    </button>
  )
}

export default function ProcessBoard() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return null
  return <ProcessBoardWorkspace key={projectId} projectId={projectId} />
}

