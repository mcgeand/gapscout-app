import { isRouteErrorResponse, useRevalidator, useRouteError } from 'react-router-dom'
import { ProjectLoadError, ProjectNotFound } from './RouteFallbacks'

export default function ProjectRouteError() {
  const error = useRouteError()
  const revalidator = useRevalidator()

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <ProjectNotFound />
  }

  return <ProjectLoadError onRetry={() => revalidator.revalidate()} />
}
