import { useRef, useState } from 'react'
import { Modal } from '../shared/Modal'
import { WizardRail } from '../shared/WizardRail'
import { ProjectStateControl } from '../shared/ProjectStateControl'
import { DEFAULT_COLORS } from '../../data/constants'
import { TEMPLATE_CATALOG, loadTemplate } from '../../services/templateService'
import type { ProcessTemplate } from '../../data/templateSchema'
import type { ProjectState } from '../../data/types'

/**
 * ProjectSetupWizard - Multi-step wizard for setting up a new project
 *
 * Steps: Project → Teams → Systems → Review.
 *
 * Choosing a template collapses that to Project → Review (#146): the template
 * already carries teams, systems, milestones, steps, policies, gaps and a
 * glossary, so the two collection steps have nothing left to ask. The template
 * is fetched the moment it is picked rather than at Create, so a file that will
 * not parse is reported while the choice is still on screen.
 */

interface TeamSetup {
  name: string
  color: string
  description: string
}

interface SystemSetup {
  name: string
  description: string
  type?: string
}

interface ProjectSetupWizardProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (data: ProjectSetupData) => Promise<void>
}

export interface ProjectSetupData {
  projectName: string
  projectDescription: string
  /** Always set from here: the wizard defaults to `current` (#265). */
  projectState: ProjectState
  /** Non-null when a template was chosen, in which case it supplies the entities. */
  template: ProcessTemplate | null
  /** Collected only on the custom path; empty when `template` is set. */
  teams: TeamSetup[]
  systems: SystemSetup[]
}

const DEFAULT_TEAMS: TeamSetup[] = [
  { name: 'General', color: '#6B7280', description: 'Default team for unassigned steps' },
  { name: 'Sales', color: '#3B82F6', description: 'Sales team activities' },
  { name: 'Operations', color: '#F59E0B', description: 'Operations and fulfillment' },
  { name: 'Support', color: '#10B981', description: 'Customer support activities' },
]

const DEFAULT_SYSTEMS: SystemSetup[] = [
  { name: 'CRM', description: 'Customer Relationship Management' },
  { name: 'ERP', description: 'Enterprise Resource Planning' },
  { name: 'Email', description: 'Email system' },
  { name: 'Spreadsheet', description: 'Excel/Google Sheets' },
]

export default function ProjectSetupWizard({ isOpen, onClose, onComplete }: ProjectSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [isSaving, setIsSaving] = useState(false)

  // Step 1: Project details. Most maps start as the process you have, so
  // `current` is the default rather than an unset third state (#265).
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [projectState, setProjectState] = useState<ProjectState>('current')

  // Step 2: Teams
  const [teams, setTeams] = useState<TeamSetup[]>(DEFAULT_TEAMS)

  // Step 3: Systems  
  const [systems, setSystems] = useState<SystemSetup[]>(DEFAULT_SYSTEMS)
  const [newSystemName, setNewSystemName] = useState('')

  // Template selection (PRD 4.1). '' is "None (custom)".
  const [templateId, setTemplateId] = useState('')
  const [template, setTemplate] = useState<ProcessTemplate | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false)
  /**
   * Which template load is the current one (#372).
   *
   * `handleSelectTemplate` awaits a fetch and then writes `template`. Cancel the
   * wizard while that is in flight and `resetWizard` runs first, so the pending
   * write lands afterwards on a wizard that has been reset: reopening showed two
   * steps and the template blurb while the select read "None (custom)", and
   * Create seeded the project from the template the user had cancelled.
   *
   * A ref rather than state: the check has to see the value the *current* render
   * of the handler closed over against the newest one, and it must not itself
   * cause a render.
   */
  const templateRequest = useRef(0)

  if (!isOpen) return null

  // `as const` so a typo in one of the `activeStep === '…'` guards below is a
  // type error rather than a step that silently renders nothing.
  const stepNames = template
    ? (['Project', 'Review'] as const)
    : (['Project', 'Teams', 'Systems', 'Review'] as const)
  const totalSteps = stepNames.length
  const activeStep = stepNames[currentStep - 1]

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const resetWizard = () => {
    // Anything already in flight is no longer wanted. Without this the awaited
    // `setTemplate` below would land after the reset (#372), and
    // `isLoadingTemplate` would stay true until it did — leaving the select
    // disabled on the reopened wizard with nothing loading.
    templateRequest.current += 1
    setIsLoadingTemplate(false)
    setCurrentStep(1)
    setProjectName('')
    setProjectDescription('')
    setProjectState('current')
    setTeams(DEFAULT_TEAMS)
    setSystems(DEFAULT_SYSTEMS)
    setTemplateId('')
    setTemplate(null)
    setTemplateError(null)
  }

  const handleSelectTemplate = async (id: string) => {
    const request = (templateRequest.current += 1)
    const isCurrent = () => templateRequest.current === request

    setTemplateId(id)
    setTemplateError(null)

    if (!id) {
      // Cleared here too, so the counter is self-contained: an in-flight load
      // whose `finally` is skipped by the guard must not leave the select
      // disabled with nothing loading.
      setIsLoadingTemplate(false)
      setTemplate(null)
      return
    }

    try {
      setIsLoadingTemplate(true)
      const loaded = await loadTemplate(id)
      if (!isCurrent()) return
      setTemplate(loaded)
    } catch (error) {
      console.error('Failed to load template:', error)
      if (!isCurrent()) return
      // The select keeps the chosen id so the message names something on screen;
      // `canProceedStep1` blocks Next until it is cleared or a template loads.
      setTemplate(null)
      setTemplateError(error instanceof Error ? error.message : 'Could not load that template')
    } finally {
      // The reset already cleared this, and a stale load must not re-enable a
      // control the current state may want disabled.
      if (isCurrent()) setIsLoadingTemplate(false)
    }
  }

  const handleComplete = async () => {
    try {
      setIsSaving(true)

      await onComplete({
        projectName,
        projectDescription,
        projectState,
        template,
        teams: template ? [] : teams,
        systems: template ? [] : systems,
      })

      resetWizard()
    } catch (error) {
      console.error('Failed to complete project setup:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    resetWizard()
    onClose()
  }

  const addTeam = () => {
    const newColor = DEFAULT_COLORS[(teams.length) % DEFAULT_COLORS.length]
    setTeams([...teams, { name: '', color: newColor, description: '' }])
  }

  const removeTeam = (index: number) => {
    setTeams(teams.filter((_, i) => i !== index))
  }

  const updateTeam = (index: number, updates: Partial<TeamSetup>) => {
    setTeams(teams.map((team, i) => i === index ? { ...team, ...updates } : team))
  }

  const addSystem = () => {
    if (!newSystemName.trim()) return
    setSystems([...systems, { name: newSystemName.trim(), description: '' }])
    setNewSystemName('')
  }

  const removeSystem = (index: number) => {
    setSystems(systems.filter((_, i) => i !== index))
  }

  const canProceedStep1 =
    projectName.trim().length > 0 && !isLoadingTemplate && templateError === null
  const canProceedStep2 = teams.length > 0 && teams.every(t => t.name.trim().length > 0)

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Create New Project"
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <button className="btn-secondary" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </button>
          <div className="flex gap-gs-2">
            {currentStep > 1 && (
              <button className="btn-secondary" onClick={handleBack} disabled={isSaving}>
                Back
              </button>
            )}
            {currentStep < totalSteps ? (
              <button
                className="btn-primary"
                onClick={handleNext}
                disabled={
                  (activeStep === 'Project' && !canProceedStep1) ||
                  (activeStep === 'Teams' && !canProceedStep2) ||
                  isSaving
                }
              >
                Next
              </button>
            ) : (
              <button className="btn-primary" onClick={handleComplete} disabled={isSaving}>
                {isSaving ? 'Creating Project...' : 'Create Project'}
              </button>
            )}
          </div>
        </div>
      }
    >
          <div className="mb-gs-6">
            <WizardRail steps={stepNames} current={currentStep} compactLabels />
            <p className="mt-gs-2 text-[12px] text-gs-ink-muted">
              Step {currentStep} of {totalSteps}
            </p>
          </div>

          <div>
            {/* Step 1: Project Details */}
            {activeStep === 'Project' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gs-ink">
                    Project Information
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Give your project a name and brief description.
                  </p>
                </div>

                <div>
                  <label className="label-field">Project Name *</label>
                  <input 
                    type="text"
                    className="input-field w-full"
                    placeholder="e.g., Customer Onboarding Process"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    autoFocus
                  />
                </div>

                <ProjectStateControl
                  name="new-project-state"
                  value={projectState}
                  onChange={setProjectState}
                />

                <div>
                  <label className="label-field">Description (Optional)</label>
                  <textarea
                    className="textarea-field w-full"
                    rows={4}
                    placeholder="Brief description of what you'll be analyzing..."
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label-field" htmlFor="project-template">
                    Start from a Template (Optional)
                  </label>
                  <select
                    id="project-template"
                    className="select-field w-full"
                    value={templateId}
                    onChange={(e) => void handleSelectTemplate(e.target.value)}
                    // Load-bearing, not cosmetic: `handleSelectTemplate` awaits a
                    // fetch and then writes `template`, so a second choice made
                    // mid-flight would let the slower load win and leave the
                    // select naming one template while another is loaded. Keep
                    // the control disabled for the duration rather than swapping
                    // this for a spinner beside an enabled select.
                    disabled={isLoadingTemplate}
                  >
                    <option value="">None (custom)</option>
                    {TEMPLATE_CATALOG.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                  {templateError !== null && (
                    <p className="mt-gs-1 text-sm text-gs-accent-ink">{templateError}</p>
                  )}
                  {template && (
                    <p className="mt-gs-1 text-sm text-gray-600">
                      {template.description} Teams and systems come from the template, so those
                      steps are skipped.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Teams */}
            {activeStep === 'Teams' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gs-ink">
                    Define Teams
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Who will be involved in this process? Define teams that own different steps.
                  </p>
                </div>

                <div className="space-y-3">
                  {teams.map((team, index) => (
                    <div key={index} className="card p-4">
                      <div className="flex items-start gap-3">
                        {/* Color Picker */}
                        <div className="flex-shrink-0">
                          <input
                            type="color"
                            value={team.color}
                            onChange={(e) => updateTeam(index, { color: e.target.value })}
                            className="w-10 h-10 rounded cursor-pointer border border-gray-300"
                          />
                        </div>

                        {/* Team Details */}
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            className="input-field w-full"
                            placeholder="Team name *"
                            value={team.name}
                            onChange={(e) => updateTeam(index, { name: e.target.value })}
                          />
                          <input
                            type="text"
                            className="input-field w-full"
                            placeholder="Description (optional)"
                            value={team.description}
                            onChange={(e) => updateTeam(index, { description: e.target.value })}
                          />
                        </div>

                        {/* Remove Button */}
                        {teams.length > 1 && (
                          <button
                            onClick={() => removeTeam(index)}
                            className="flex-shrink-0 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Remove team"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {teams.length < 10 && (
                    <button
                      onClick={addTeam}
                      className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="text-xl">+</span>
                      Add Team
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Systems */}
            {activeStep === 'Systems' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gs-ink">
                    Define Systems (Optional)
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    What tools or software are used in this process? You can skip this step and add systems later.
                  </p>
                </div>

                {/* Add System */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input-field flex-1"
                    placeholder="e.g., Salesforce, SAP, Gmail..."
                    value={newSystemName}
                    onChange={(e) => setNewSystemName(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addSystem()
                      }
                    }}
                  />
                  <button
                    className="btn-primary"
                    onClick={addSystem}
                    disabled={!newSystemName.trim()}
                  >
                    Add
                  </button>
                </div>

                {/* Systems List */}
                {systems.length > 0 && (
                  <div className="space-y-2">
                    {systems.map((system, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{system.name}</p>
                          {system.description && (
                            <p className="text-xs text-gray-500">{system.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => removeSystem(index)}
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {systems.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <p className="text-sm">No systems added yet</p>
                    <p className="text-xs mt-1">Add systems used in your process, or skip this step</p>
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Review */}
            {activeStep === 'Review' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gs-ink">
                    Review & Create
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Review your project setup before creating.
                  </p>
                </div>

                {/* Project Summary */}
                <div className="card">
                  <h4 className="font-semibold mb-2 text-gs-ink">
                    Project
                  </h4>
                  <p className="text-lg font-medium">{projectName}</p>
                  {/* Plain text, not the state tag: nothing draws that yet, and
                      the tag belongs to #207 / #208 / #213. A review step that
                      omits a field it collected is a review step you cannot
                      review with. */}
                  <p className="text-sm text-gray-600 mt-1">
                    {projectState === 'current' ? 'Current state' : 'Future state'}
                  </p>
                  {projectDescription && (
                    <p className="text-sm text-gray-600 mt-1">{projectDescription}</p>
                  )}
                </div>

                {template && (
                  <div className="card">
                    <h4 className="font-semibold mb-3">Template</h4>
                    <p className="text-sm font-medium">{template.name}</p>
                    <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                    <p className="text-sm text-gray-600 mt-gs-2">
                      Seeds {template.teams.length} teams, {template.systems.length} systems,{' '}
                      {template.milestones.length} milestones, {template.steps.length} steps,{' '}
                      {template.policies.length} policies, {template.gaps.length} gaps and{' '}
                      {template.glossary.length} glossary entries.
                    </p>
                  </div>
                )}

                {/* Teams Summary */}
                {!template && (
                <div className="card">
                  <h4 className="font-semibold mb-3 text-gs-ink">
                    Teams ({teams.length})
                  </h4>
                  <div className="space-y-2">
                    {teams.map((team, index) => (
                      <div key={index} className="flex items-center gap-3">
                        <div 
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: team.color }}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{team.name}</p>
                          {team.description && (
                            <p className="text-xs text-gray-500">{team.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                )}

                {/* Systems Summary */}
                {!template && systems.length > 0 && (
                  <div className="card">
                    <h4 className="font-semibold mb-3 text-gs-ink">
                      Systems ({systems.length})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {systems.map((system, index) => (
                        <span key={index} className="badge-blue">
                          {system.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

    </Modal>
  )
}
