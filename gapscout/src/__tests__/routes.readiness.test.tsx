import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initDB, getProject } = vi.hoisted(() => ({
  initDB: vi.fn(),
  getProject: vi.fn(),
}))

vi.mock('../services/db', () => ({ initDB, getProject }))

import { router } from '../app/routes'

function projectRouteLoader() {
  const route = router.routes.find((candidate) => candidate.path === '/projects/:projectId')
  if (typeof route?.loader !== 'function') throw new Error('project route loader missing')
  return route.loader({ params: { projectId: 'project-b' } } as never)
}

describe('project route database readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProject.mockResolvedValue({ id: 'project-b' })
  })

  it('waits for database initialization before loading a cold project', async () => {
    let resolveInit!: () => void
    const initPromise = new Promise<void>((resolve) => { resolveInit = resolve })
    initDB.mockReturnValue(initPromise)

    const load = projectRouteLoader()
    expect(getProject).not.toHaveBeenCalled()
    resolveInit()
    await load

    expect(initDB).toHaveBeenCalledOnce()
    expect(getProject).toHaveBeenCalledWith('project-b')
  })

  it('propagates database initialization failures instead of treating them as not found', async () => {
    initDB.mockRejectedValue(new Error('database unavailable'))

    await expect(projectRouteLoader()).rejects.toThrow('database unavailable')
    expect(getProject).not.toHaveBeenCalled()
  })
})
