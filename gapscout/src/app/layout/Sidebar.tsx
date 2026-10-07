import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../state/projectStore'
import { IDENTITY, initialsOf } from '../identity'
import type { ProjectState } from '../../data/types'

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
}

/**
 * Sidebar - project navigation and the app's identity block.
 *
 * The row has no horizontal room to give (12d), so state is a one-letter mark
 * in a fixed-width column rather than a word, and the name keeps the two-line
 * clamp and `title` that #264 gave it. The `Ready` line that used to sit under
 * every name was a literal string pretending to be status, and is gone.
 */

/** `undefined` means nobody has said, and it draws nothing (#263). */
const STATE_MARK: Record<ProjectState, { letter: string; className: string; label: string }> = {
  current: { letter: 'C', className: 'side-state-current', label: 'Current state' },
  future: { letter: 'F', className: 'side-state-future', label: 'Future state' },
}

export default function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const projects = useProjectStore((state) => state.projects)

  const isProjectActive = (projectId: string) => {
    return location.pathname.includes(`/projects/${projectId}`)
  }

  if (isCollapsed) {
    return (
      <aside className="w-16 bg-gs-surface border-r-2 border-gs-rule-strong flex flex-col">
        <div className="p-gs-4 border-b border-gs-rule">
          <button
            onClick={onToggle}
            className="btn-ghost w-full flex items-center justify-center p-gs-1"
            title="Expand sidebar (⌘B)"
            aria-label="Expand sidebar"
          >
            <ChevronRight size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-gs-2">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className={`w-full p-gs-3 flex items-center justify-center transition-colors ${
                isProjectActive(project.id) ? 'bg-gs-accent-tint' : 'hover:bg-gs-sunken'
              }`}
              title={project.name}
            >
              <div
                className={`w-8 h-8 flex items-center justify-center text-gs-on-accent text-sm font-medium ${
                  isProjectActive(project.id) ? 'bg-gs-accent' : 'bg-gs-ink-muted'
                }`}
              >
                {project.name.charAt(0)}
              </div>
            </button>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-64 bg-gs-surface border-r-2 border-gs-rule-strong flex flex-col">
      {/* The mark is the one place Scout Orange survives in the app: it is
          identity, never a control and never a status. */}
      <div className="p-gs-4 border-b border-gs-rule flex items-center justify-between">
        <div className="flex items-center gap-gs-2">
          <div className="w-8 h-8 flex items-center justify-center bg-gs-brand text-gs-ink font-bold text-sm">
            G
          </div>
          <h2 className="font-bold text-lg text-gs-ink">GapScout</h2>
        </div>
        <button
          onClick={onToggle}
          className="btn-ghost p-gs-1"
          title="Collapse sidebar (⌘B)"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-gs-4">
          <div className="flex items-center justify-between mb-gs-3">
            <h3 className="side-label">Projects</h3>
            <button
              onClick={() => navigate('/projects')}
              className="btn-ghost p-0 text-xs font-medium text-gs-accent-ink hover:underline"
            >
              View All
            </button>
          </div>

          <div className="flex flex-col gap-gs-1">
            {projects.map((project) => {
              const mark = project.state ? STATE_MARK[project.state] : null
              return (
                <button
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="side-row"
                  aria-current={isProjectActive(project.id) ? 'page' : undefined}
                >
                  <div className="flex items-start gap-gs-2">
                    {/* `role="img"` is load-bearing: `aria-label` is dropped on
                        the implicit generic role, so without it a screen reader
                        reads the bare letter and never the word it stands for. */}
                    <span
                      className={`side-state ${mark ? mark.className : ''}`}
                      {...(mark ? { role: 'img', title: mark.label, 'aria-label': mark.label } : {})}
                    >
                      {mark ? mark.letter : ''}
                    </span>
                    <p
                      className={`flex-1 min-w-0 text-sm line-clamp-2 ${
                        isProjectActive(project.id)
                          ? 'font-semibold text-gs-accent-ink'
                          : 'font-medium text-gs-ink'
                      }`}
                      title={project.name}
                    >
                      {project.name}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-gs-rule p-gs-4 flex flex-col gap-gs-4">
        <button onClick={() => navigate('/projects')} className="w-full btn-primary">
          + New Project
        </button>

        {/* Identity lives here rather than in a toolbar avatar menu whose other
            three items were dead. One source, in `app/identity.ts`. */}
        <div className="flex items-center gap-gs-2">
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center bg-gs-ink text-gs-on-ink text-xs font-medium">
            {initialsOf(IDENTITY.name)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gs-ink truncate" title={IDENTITY.name}>
              {IDENTITY.name}
            </p>
            <p className="text-xs text-gs-ink-muted truncate">{IDENTITY.workspace}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
