type RequestMode = 'latest' | 'operation'

type RequestRecord = {
  projectId: string | null
  mode: RequestMode
}

export function createRequestGuard() {
  let latestRequest = 0
  const latestByKey = new Map<string, number>()
  const activeRequests = new Map<number, RequestRecord>()

  const isCurrent = (requestId: number, projectId?: string, key = 'default'): boolean => {
    const latestId = latestByKey.get(key)
    const request = activeRequests.get(requestId)
    return request !== undefined &&
      (request.mode === 'operation' || latestId === requestId) &&
      (projectId === undefined || request.projectId === projectId)
  }

  return {
    begin(projectId?: string, key = 'default', mode: RequestMode = 'latest'): number {
      for (const [requestId, request] of activeRequests) {
        if (projectId !== undefined && request.projectId !== null && request.projectId !== projectId) {
          activeRequests.delete(requestId)
        }
      }

      if (mode === 'latest') {
        const previousId = latestByKey.get(key)
        if (previousId !== undefined) activeRequests.delete(previousId)
      }

      const requestId = ++latestRequest
      if (mode === 'latest') latestByKey.set(key, requestId)
      activeRequests.set(requestId, { projectId: projectId ?? null, mode })
      return requestId
    },
    isCurrent,
    finish(requestId: number, projectId?: string, key = 'default'): boolean {
      const isLatest = isCurrent(requestId, projectId, key)
      activeRequests.delete(requestId)
      return isLatest && activeRequests.size === 0
    },
    invalidate(): void {
      latestRequest += 1
      latestByKey.clear()
      activeRequests.clear()
    },
  }
}
