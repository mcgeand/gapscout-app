import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, SquarePen, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useProjectStore } from '../state/projectStore'
import { useTeamsStore } from '../state/teamsStore'
import { useSystemsStore } from '../state/systemsStore'
import ProjectSetupWizard, { type ProjectSetupData } from '../components/Setup/ProjectSetupWizard'
import { createMilestone, resetProjectUpdatedAt } from '../services/db'
import { applyTemplate } from '../services/templateService'
import { Modal } from '../components/shared/Modal'
import { ConfirmModal } from '../components/shared/ConfirmModal'
import { ProjectStateControl } from '../components/shared/ProjectStateControl'
import { EmptyState } from '../components/shared/EmptyState'
import type { ProjectState, ProjectSummary } from '../data/types'

/** The fields the edit modal can change. `state` is absent until someone says. */
type EditableProject = {
  id: string
  name: string
  description?: string
  state?: ProjectState
}

/** The tag each state draws, matching the board header's (#263). */
const STATE_TAG: Record<ProjectState, { label: string; className: string }> = {
  current: { label: 'Current', className: 'project-state-current' },
  future: { label: 'Future', className: 'project-state-future' },
}

/**
 * ProjectList — the project home.
 *
 * Every card used to carry a `badge-orange` reading "Active" and a footer line
 * reading "Ready for mapping", both literal strings on every project ever
 * created. A status that is always the same value is not a status, so both are
 * gone and the card carries what the project actually holds instead (#213).
 */
export default function ProjectList() {
  const navigate = useNavigate()
  const {
    projects,
    isLoading,
    isInitialized,
    createProject,
    updateProject,
    deleteProject,
    loadProjects,
  } = useProjectStore()
  const { addTeam } = useTeamsStore()
  const { addSystem } = useSystemsStore()
  const [showCreateWizard, setShowCreateWizard] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingProject, setEditingProject] = useState<EditableProject | null>(null)
  /** The project the delete confirm is asking about, or null when it is closed. */
  const [deletingProject, setDeletingProject] = useState<{ id: string; name: string } | null>(null)

  // The counts on the cards are a snapshot of the last read, and the list is
  // otherwise read once, at App mount. Without this, adding five steps and
  // clicking the board's "Projects" crumb shows the count from before the
  // visit. The grid stays on screen while this runs — the loading panel is for
  // a first load only, or every return here would blink through an empty page.
  //
  // Gated on `isInitialized`, not fired bare: this page is the app's landing
  // route, so on a cold start it mounts while `App`'s `initialize()` is still
  // awaiting `initDB()`. `getDB()` throws until that resolves, and the store
  // turns the throw into a "Failed to load projects" toast and an empty list —
  // so an ungated refresh would greet every launch with an error and a flash of
  // "No projects yet". Once initialised, the flag is stable, so this fires once
  // per visit.
  useEffect(() => {
    if (!isInitialized) return
    void loadProjects()
  }, [isInitialized, loadProjects])

  const handleCompleteSetup = async (setupData: ProjectSetupData) => {
    try {
      // A template supplies every entity the manual path collects, including its
      // own milestones — so it must not also get the "Main Flow" milestone below,
      // which would sit at order 0 tied with the template's first phase and fold
      // two milestones into shared diagram columns (#146).
      if (setupData.template) {
        const projectId = await applyTemplate(setupData.template, {
          name: setupData.projectName,
          description: setupData.projectDescription,
          state: setupData.projectState,
        })

        await loadProjects()
        toast.success(
          `Project "${setupData.projectName}" created from the ${setupData.template.name} template`
        )
        setShowCreateWizard(false)
        navigate(`/projects/${projectId}`)
        return
      }

      // Step 1: Create the project
      const project = await createProject(
        {
          name: setupData.projectName,
          description: setupData.projectDescription,
          state: setupData.projectState,
        },
        { silent: true }
      )

      if (!project) {
        toast.error('Failed to create project')
        return
      }

      // Step 2: Create teams
      for (const teamData of setupData.teams) {
        await addTeam(
          {
            projectId: project.id,
            name: teamData.name,
            color: teamData.color,
            description: teamData.description,
            tags: [],
          },
          { silent: true }
        )
      }

      // Step 3: Create systems
      for (const systemData of setupData.systems) {
        await addSystem(
          {
            projectId: project.id,
            name: systemData.name,
            description: systemData.description,
            tags: [],
          },
          { silent: true }
        )
      }

      // Step 4: Create default "Main Flow" milestone
      await createMilestone({
        projectId: project.id,
        name: 'Main Flow',
        order: 0,
        description: 'Primary process flow',
        relatedPolicies: [],
      })

      // Step 5: put `updated_at` back where creation found it.
      //
      // Every seed write above moves it (#395), so a project would reach the
      // grid already reading "Edited" and the card's "Created" would be a
      // branch nothing could ever take. Last, after the milestone, so there is
      // no touch left to come.
      await resetProjectUpdatedAt(project.id)

      // Success!
      const teamCount = setupData.teams.length
      const systemCount = setupData.systems.length
      const teamLabel = teamCount === 1 ? 'team' : 'teams'
      const systemLabel = systemCount === 1 ? 'system' : 'systems'
      toast.success(
        `Project "${setupData.projectName}" created — ${teamCount} ${teamLabel}, ${systemCount} ${systemLabel}`
      )

      // Close wizard
      setShowCreateWizard(false)

      // Navigate to the project
      navigate(`/projects/${project.id}`)
    } catch (error) {
      console.error('Failed to complete project setup:', error)
      toast.error('Failed to complete project setup')
    }
  }

  const handleOpenProject = (projectId: string) => {
    navigate(`/projects/${projectId}`)
  }

  const handleEditProject = (project: EditableProject) => {
    setEditingProject(project)
    setShowEditModal(true)
  }

  const handleDeleteProject = (project: { id: string; name: string }) => {
    setDeletingProject(project)
  }

  const handleConfirmDelete = async () => {
    if (!deletingProject) return
    // The store reports its own failure and clears the selection when the
    // deleted project was the current one, so there is nothing to route away
    // from — this page is already the list.
    await deleteProject(deletingProject.id)
    setDeletingProject(null)
  }

  const handleSaveEdit = async () => {
    if (!editingProject) return

    await updateProject(editingProject.id, {
      name: editingProject.name,
      description: editingProject.description,
      // Undefined on an untouched control, which the update path reads as "no
      // change" — so a project nobody has classified stays NULL (#263).
      state: editingProject.state,
    })

    setShowEditModal(false)
    setEditingProject(null)
  }

  return (
    <div className="home">
      {/* Identity and the one action, on the board's 32px gutter. The page used
          to run its own `max-w-7xl` centred column at `px-4 sm:px-6 lg:px-8`,
          a third page padding in an app that already had two. */}
      <header className="home-head">
        <div className="flex items-start justify-between gap-gs-6">
          <div className="min-w-0">
            <h1 className="board-title">GapScout</h1>
            <p className="board-meta mt-gs-1">Find gaps. Fix flows.</p>
          </div>
          <button
            className="btn-primary inline-flex flex-shrink-0 items-center gap-gs-2"
            onClick={() => setShowCreateWizard(true)}
          >
            <Plus size={16} strokeWidth={2} />
            New Project
          </button>
        </div>
      </header>

      <main className="home-body">
        <div className="mb-gs-6">
          <h2 className="text-lg font-bold text-gs-ink">Your Projects</h2>
          <p className="board-meta mt-gs-1">
            Select a project to start mapping processes and identifying gaps
          </p>
        </div>

        {/* First load only. A refresh on returning from a board keeps the grid
            on screen, so the counts update in place. */}
        {isLoading && projects.length === 0 && (
          <EmptyState
            kind="loading"
            title="Opening GapScout"
            message="Reading your projects from the local database."
          />
        )}

        {!isLoading && projects.length === 0 && (
          <EmptyState
            title="No projects yet"
            message="A project holds one process: its steps, the gaps you find in them, and the registries they draw on. Create the first one to start mapping."
            action={
              <button
                className="btn-primary inline-flex items-center gap-gs-2"
                onClick={() => setShowCreateWizard(true)}
              >
                <Plus size={16} strokeWidth={2} />
                Create Your First Project
              </button>
            }
          />
        )}

        {/* The trailing dashed "Create New Project" tile is gone with the grid
            it sat in: a `text-4xl +` duplicating the header's button, on a card
            that was not a project. One action, in the header, on every state of
            this page. */}
        {projects.length > 0 && (
          <div className="grid grid-cols-1 gap-gs-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={handleOpenProject}
                onEdit={handleEditProject}
                onDelete={handleDeleteProject}
              />
            ))}
          </div>
        )}

        {/* Project Setup Wizard */}
        <ProjectSetupWizard
          isOpen={showCreateWizard}
          onClose={() => setShowCreateWizard(false)}
          onComplete={handleCompleteSetup}
        />

        {/* Delete Project Confirmation */}
        {deletingProject && (
          <ConfirmModal
            isOpen={!!deletingProject}
            onClose={() => setDeletingProject(null)}
            title="Delete Project?"
            description={
              <>
                <p>
                  Delete <strong>"{deletingProject.name}"</strong> and everything in it — steps,
                  gaps, teams, systems, milestones, policies and glossary entries?
                </p>
                <p className="mt-gs-3">This is permanent and cannot be undone.</p>
              </>
            }
            confirmAction={{
              label: 'Delete Project',
              onClick: handleConfirmDelete,
              style: 'danger',
            }}
          />
        )}

        {/* Edit Project Modal */}
        {showEditModal && editingProject && (
          <Modal
            isOpen={showEditModal}
            onClose={() => setShowEditModal(false)}
            title="Edit Project"
            size="sm"
            footer={
              <>
                <button className="btn-secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSaveEdit}
                  disabled={!editingProject.name.trim()}
                >
                  Save Changes
                </button>
              </>
            }
          >
            <div className="flex flex-col gap-gs-4">
              <div>
                <label className="label-field">Project Name *</label>
                <input
                  type="text"
                  className="input-field w-full"
                  placeholder="e.g., Customer Onboarding"
                  value={editingProject.name}
                  onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                  autoFocus
                />
              </div>
              <ProjectStateControl
                name="edit-project-state"
                value={editingProject.state}
                onChange={(state) => setEditingProject({ ...editingProject, state })}
              />
              <div>
                <label className="label-field">Description (Optional)</label>
                <textarea
                  className="textarea-field w-full"
                  rows={3}
                  placeholder="Brief description of what you'll be analyzing..."
                  value={editingProject.description || ''}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, description: e.target.value })
                  }
                />
              </div>
            </div>
          </Modal>
        )}
      </main>
    </div>
  )
}

/** Relative for the first month, then the date. */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const diffDays = Math.floor(Math.abs(Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return date.toLocaleDateString()
}

interface ProjectCardProps {
  project: ProjectSummary
  onOpen: (projectId: string) => void
  onEdit: (project: EditableProject) => void
  onDelete: (project: { id: string; name: string }) => void
}

/**
 * One project, per section 12c of the design: the state tag and the date on
 * line one so the tag and the name scan down the column as a pair, then the
 * name, the description, and a ruled footer carrying what the project holds.
 *
 * The whole card opens the project, but the click target is the name's button
 * stretched over the card by a `::after` rather than an `onClick` on the
 * wrapper — so it is reachable by Tab and answers Enter and Space, which the
 * old `div` never did.
 */
function ProjectCard({ project, onOpen, onEdit, onDelete }: ProjectCardProps) {
  const tag = project.state ? STATE_TAG[project.state] : null

  return (
    <article className="proj" aria-label={project.name}>
      {/* Opening the project is a real button stretched over the whole card,
          rather than an `onClick` on the wrapper: the old card was a `div`, so
          it had no tab stop and answered neither Enter nor Space. It is first
          in the DOM so the card's tab order reads open, edit, delete. */}
      {/* The overlay covers the card, so it is the only element the pointer ever
          reaches — which is why it repeats the heading's `title`. Without that,
          #264's tooltip would never be shown here and a clipped name would go
          back to being unreadable, the exact defect that issue exists to fix. */}
      <button
        className="proj-open"
        onClick={() => onOpen(project.id)}
        aria-label={`Open ${project.name}`}
        title={project.name}
      />

      {/* Edit and delete. Above that overlay, or it would swallow both clicks
          and open the project instead. */}
      <div className="proj-tray">
        <button
          onClick={() => onEdit(project)}
          className="btn-ghost p-gs-1"
          title="Edit project"
          aria-label={`Edit ${project.name}`}
        >
          <SquarePen size={16} strokeWidth={2} />
        </button>
        <button
          onClick={() => onDelete(project)}
          className="btn-ghost p-gs-1"
          title="Delete project"
          aria-label={`Delete ${project.name}`}
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      </div>

      <p className="proj-eyebrow">
        {tag && <span className={`project-state ${tag.className}`}>{tag.label}</span>}
        {/* `updated_at` moves on every write a project owns since #395, so this
            line can say when the project was last worked on rather than when it
            was filed — which is also the column `listProjects` sorts by, so the
            date now explains the order of the grid. A project nobody has opened
            since creation keeps "Created": its two timestamps are equal there,
            and "Edited" would claim an edit that never happened. */}
        {project.updatedAt > project.createdAt ? (
          <span>Edited {formatDate(project.updatedAt)}</span>
        ) : (
          <span>Created {formatDate(project.createdAt)}</span>
        )}
      </p>

      {/* `title` and the two-line clamp are #264's: there is nowhere else to
          read a name this card clips. The name stays plain text — wrapping it
          in the open button would put a button between `-webkit-line-clamp`
          and the text it counts lines of, and the clamp would quietly stop
          applying with nothing to catch it. */}
      <h3 className="proj-name line-clamp-2" title={project.name}>
        {project.name}
      </h3>

      {/* No `title` here: the open overlay is what the pointer hits, so one
          would never be shown. A clamped description is read by opening the
          project — #264 is about the name, which the overlay carries. */}
      {project.description && <p className="proj-description">{project.description}</p>}

      {/* What the project holds, replacing the literal "Ready for mapping".
          Open gaps rather than all of them, matching the board header — a card
          reading "3 gaps" beside a header reading "2 open gaps" for the same
          project would be a page disagreeing with itself. */}
      <p className="proj-foot">
        <strong>{project.stepCount}</strong> step{project.stepCount !== 1 ? 's' : ''} ·{' '}
        <strong>{project.openGapCount}</strong> open gap
        {project.openGapCount !== 1 ? 's' : ''}
      </p>
    </article>
  )
}
