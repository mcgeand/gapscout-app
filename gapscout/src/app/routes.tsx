import { Suspense } from 'react'
import {
  createBrowserRouter,
  Navigate,
  type LoaderFunctionArgs,
} from 'react-router-dom'
import { getProject, initDB } from '../services/db'
import { PageLoader } from './RouteFallbacks'
import ProjectRouteError from './ProjectRouteError'
import { ProjectList, ProcessBoard, NotFound } from './lazyPages'

function withSuspense(Component: React.LazyExoticComponent<React.ComponentType>) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  )
}

/**
 * Route loader for project validation.
 * Throws 404 response if project doesn't exist.
 *
 * @param params - Route parameters containing projectId
 * @throws Response with 404 status if project not found
 */
async function projectLoader({ params }: LoaderFunctionArgs): Promise<{ projectId: string }> {
  const { projectId } = params

  if (!projectId) {
    throw new Response('Project ID is required', { status: 400 })
  }

  await initDB()
  const project = await getProject(projectId)

  if (!project) {
    throw new Response('Project not found', { status: 404 })
  }

  return { projectId }
}

/**
 * GapScout Application Routes
 *
 * Route Structure:
 * - / → redirects to /projects
 * - /projects → Project list view
 * - /projects/:projectId → redirects to the Discovery tab
 * - /projects/:projectId/:tab → Process board workspace, tab in the URL
 * - * → 404 Not Found
 *
 * Features:
 * - Lazy loading for all page components (code splitting)
 * - Route guards with loaders for project validation
 * - Custom error boundaries for each route
 *
 * Reference: PRD Section 5 - UX Navigation
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/projects" replace />,
  },
  {
    path: '/projects',
    element: withSuspense(ProjectList),
  },
  {
    // The path string stays literally '/projects/:projectId'. The board's tab
    // lives in a *child* segment so the parent's own match.pathname never
    // changes when the tab does — that is what keeps `projectLoader` from
    // re-running on every tab click. A sibling '/projects/:projectId/:tab'
    // route would revalidate each time, and '?tab=' trips react-router's
    // `currentUrl.search !== nextUrl.search` branch. Children carry no loader.
    path: '/projects/:projectId',
    element: withSuspense(ProcessBoard),
    loader: projectLoader,
    errorElement: <ProjectRouteError />,
    children: [
      // Sidebar navigates to the bare '/projects/:id'; without this the board
      // renders with no tab selected.
      { index: true, element: <Navigate to="discovery" replace /> },
      // A marker only: ProcessBoard reads the segment and renders the panel
      // itself. `element: null` rather than no element at all — react-router
      // warns on a matched leaf whose `element === undefined`, and that fires
      // on every board load and every tab click.
      { path: ':tab', element: null },
    ],
  },
  {
    path: '*',
    element: withSuspense(NotFound),
  },
])

