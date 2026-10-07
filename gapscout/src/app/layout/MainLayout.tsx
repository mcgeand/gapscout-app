import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import toast from 'react-hot-toast'
import Sidebar from './Sidebar'
import Toolbar from './Toolbar'
import RightPanel from './RightPanel'
import { Modal } from '../../components/shared/Modal'
import {
  buildFeedbackIssueUrl,
  collectDiagnostics,
  FEEDBACK_ISSUES_PUBLIC,
  formatDiagnosticsMarkdown,
  openExternalUrl,
  type Diagnostics,
} from '../../lib/diagnostics'

interface MainLayoutProps {
  children: ReactNode
  showSidebar?: boolean
  showToolbar?: boolean
}

/**
 * MainLayout - Complete application layout shell
 * 
 * Combines sidebar, toolbar, main content area, and right panel.
 * Responsive layout with collapsible panels.
 * Minimum resolution: 1024x768
 */
export default function MainLayout({ 
  children, 
  showSidebar = true,
  showToolbar = true 
}: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [databasePath, setDatabasePath] = useState('…')
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)

  // Cmd+B and Cmd+/. Escape is deliberately not here: `Modal` owns it, keeps a
  // mount-order stack so the key reaches only the topmost dialog, and listens on
  // `document`, which a real keypress reaches by bubbling. Closing Help from
  // this handler as well was redundant and wrong — it shut Help even when
  // another dialog stood above it. Anything added here needs a row in the Help
  // dialog below, and the reverse: the drift guard in MainLayout.help.test.tsx
  // reads this file and fails on a row nothing binds.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+B or Ctrl+B to toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarCollapsed(!sidebarCollapsed)
      }
      // Cmd+/ or Ctrl+/ to open Help & About
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShowHelp(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarCollapsed])

  // Resolve diagnostics (including DB path) when Help opens so Windows stops
  // seeing the Unix spelling (#120 / #241). Cheap enough to refresh each open.
  useEffect(() => {
    if (!showHelp) return
    let cancelled = false
    void (async () => {
      const diag = await collectDiagnostics()
      if (cancelled) return
      setDiagnostics(diag)
      setDatabasePath(diag.databasePath)
    })()
    return () => {
      cancelled = true
    }
  }, [showHelp])

  async function copyDiagnostics() {
    const diag = diagnostics ?? (await collectDiagnostics())
    setDiagnostics(diag)
    const markdown = formatDiagnosticsMarkdown(diag)
    try {
      await navigator.clipboard.writeText(markdown)
      toast.success('Diagnostics copied')
    } catch {
      toast.error('Could not copy diagnostics')
    }
  }

  async function sendFeedback() {
    if (!FEEDBACK_ISSUES_PUBLIC) return
    const diag = diagnostics ?? (await collectDiagnostics())
    setDiagnostics(diag)
    const markdown = formatDiagnosticsMarkdown(diag)
    try {
      await navigator.clipboard.writeText(markdown)
    } catch {
      // Still open the issue form; the page body already embeds the block.
    }
    const url = buildFeedbackIssueUrl(diag)
    try {
      await openExternalUrl(url)
    } catch {
      toast.error('Could not open the feedback page')
    }
  }

  return (
    <div className="flex h-screen bg-gs-bg w-full overflow-hidden">
      {/* Sidebar */}
      {showSidebar && (
        <Sidebar 
          isCollapsed={sidebarCollapsed} 
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
        />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 w-full">
        {/* Toolbar */}
        {showToolbar && (
          <Toolbar onShowHelp={() => setShowHelp(true)} />
        )}

        {/* Page Content */}
        <main className="flex-1 overflow-auto w-full">
          {children}
        </main>
      </div>

      {/* Right Panel */}
      <RightPanel />

      {/* Help & About */}
      {showHelp && (
        <Modal
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
          title="Help & About"
          size="lg"
          footer={
            <>
              <button
                type="button"
                className={FEEDBACK_ISSUES_PUBLIC ? 'btn-secondary' : 'btn-primary'}
                onClick={() => void copyDiagnostics()}
              >
                Copy diagnostics
              </button>
              {FEEDBACK_ISSUES_PUBLIC ? (
                <button type="button" className="btn-primary" onClick={() => void sendFeedback()}>
                  Send feedback
                </button>
              ) : null}
            </>
          }
        >
          <div className="flex flex-col gap-gs-6">
            <section>
              <h3 className="text-sm font-semibold text-gs-ink-muted uppercase tracking-wide mb-gs-3">
                Keyboard shortcuts
              </h3>
              {/* Every row here is bound somewhere. The list used to advertise
                  nine and implement three (#215) — a shortcut that does nothing
                  is the same defect as a button that does nothing. Two files
                  own these: ⌘B, ⌘/ and Esc are the handler above; ⌘F is
                  SearchBar's own listener. Add a row only alongside a binding. */}
              <div className="flex flex-col">
                <ShortcutRow keys={['⌘', 'B']} description="Toggle sidebar" />
                <ShortcutRow keys={['⌘', 'F']} description="Search this project" />
                <ShortcutRow keys={['⌘', '/']} description="Open this dialog" />
                <ShortcutRow keys={['Esc']} description="Close a dialog" />
              </div>
              <p className="mt-gs-2 text-xs text-gs-ink-muted">
                ⌘F needs an open project. On Windows and Linux, use Ctrl.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gs-ink-muted uppercase tracking-wide mb-gs-3">
                About GapScout
              </h3>
              <dl className="flex flex-col">
                <AboutRow term="Version" detail={__APP_VERSION__} />
                {/* Path from Rust get_db_path via invoke — keep in sync when #123
                    adds a location override; do not rebuild homeDir + .gapscout. */}
                <AboutRow term="Your data" detail={databasePath} />
                <AboutRow
                  term="Schema"
                  detail={
                    diagnostics?.schemaVersion === null || diagnostics?.schemaVersion === undefined
                      ? '…'
                      : String(diagnostics.schemaVersion)
                  }
                />
                <AboutRow term="Licence" detail="MIT" />
              </dl>
              <p className="mt-gs-3 text-xs text-gs-ink-muted">
                {FEEDBACK_ISSUES_PUBLIC
                  ? 'Copy diagnostics for a Markdown block ready to paste. Send feedback opens a GitHub issue with that block filled in — nothing is uploaded from the app itself.'
                  : 'Copy diagnostics for a Markdown block ready to paste into a bug report — nothing is uploaded from the app itself.'}
              </p>
            </section>
          </div>
        </Modal>
      )}
    </div>
  )
}

// One shortcut, its description left and its keys right.
function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between py-gs-2 border-b border-gs-rule-faint last:border-b-0">
      <span className="text-sm text-gs-ink">{description}</span>
      <div className="flex items-center gap-gs-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="px-gs-2 py-0.5 text-xs font-medium text-gs-ink bg-gs-bg border border-gs-rule"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  )
}

// One About fact, on the same ruled grid as the shortcuts above it.
function AboutRow({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-gs-4 py-gs-2 border-b border-gs-rule-faint last:border-b-0">
      <dt className="text-sm text-gs-ink">{term}</dt>
      <dd className="text-sm text-gs-ink-muted font-mono break-all text-right">{detail}</dd>
    </div>
  )
}
