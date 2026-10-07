export interface ProjectScopeToken {
  projectId: string
  generation: number
}

let generation = 0
let activeProjectId: string | null = null

export function beginProjectScope(projectId: string): number {
  generation += 1
  activeProjectId = projectId
  return generation
}

export function clearProjectScope(): void {
  generation += 1
  activeProjectId = null
}

export function captureProjectScope(projectId: string): ProjectScopeToken | null {
  if (activeProjectId !== null && activeProjectId !== projectId) return null
  return { projectId, generation }
}

export function resolveProjectId(
  explicitProjectId: string | undefined,
  entityProjectId: string | undefined,
  currentProjectId: string | null,
): string | null {
  if (explicitProjectId !== undefined && entityProjectId !== undefined && explicitProjectId !== entityProjectId) {
    return null
  }
  return explicitProjectId ?? entityProjectId ?? currentProjectId
}

export function isProjectScopeCurrent(token: ProjectScopeToken): boolean {
  return token.generation === generation &&
    (activeProjectId === null || activeProjectId === token.projectId)
}
