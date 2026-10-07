import { useNavigate } from 'react-router-dom'
import { FallbackPanel } from '../components/shared/FallbackPanel'
import { fallbackStyles } from '../components/shared/fallbackStyles'

/**
 * NotFound - 404 error page for invalid routes.
 *
 * Shares one design with `RouteFallbacks.ProjectNotFound` (#205); the app used
 * to ship two unrelated 404s, one carded with a 🔍 and one hand-written in
 * inline styles.
 */
export default function NotFound() {
  const navigate = useNavigate()

  return (
    <FallbackPanel
      title="Page Not Found"
      message="Nothing lives at this URL (404). It doesn't exist, or it may have moved."
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={fallbackStyles.secondaryButton}
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            style={fallbackStyles.primaryButton}
          >
            Go to Projects
          </button>
        </>
      }
    />
  )
}
