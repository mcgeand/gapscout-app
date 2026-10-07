/**
 * Route-level fallback components: Suspense loader + 404 panel.
 * Kept separate from routes.tsx so that file can stay component-free
 * for Vite fast-refresh.
 *
 * These render before or around the app shell, so they keep inline styles
 * (#205) — the grammar and the tokens come from FallbackPanel/fallbackStyles.
 */

import { FallbackPanel } from '../components/shared/FallbackPanel'
import { fallbackStyles } from '../components/shared/fallbackStyles'

export function PageLoader() {
  return (
    <FallbackPanel
      title="Opening GapScout"
      message="Reading your projects from the local database."
    />
  )
}

export function ProjectLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <FallbackPanel
      title="Project unavailable"
      message="GapScout could not initialize or load the database. Check the desktop app and try again."
      actions={
        <button type="button" onClick={onRetry} style={fallbackStyles.primaryButton}>
          Retry
        </button>
      }
    />
  )
}

export function ProjectNotFound() {
  return (
    <FallbackPanel
      title="Project Not Found"
      message="No project lives at this URL (404). It doesn't exist, or it may have been deleted."
      actions={
        <a href="/projects" style={fallbackStyles.primaryButton}>
          Back to Projects
        </a>
      }
    />
  )
}
