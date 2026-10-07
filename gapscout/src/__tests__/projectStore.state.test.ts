/**
 * `state` through the store, in both directions (#319, #318).
 *
 * `db.createProject` has accepted and persisted `state` since #263, but the
 * store narrowed its own parameter to name and description, so nothing in the
 * app could set it at creation. The mirror gap on the update path is that
 * `Partial<Project>` has no expressible value for "return it to NULL".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Project, ProjectChanges, ProjectState } from '../data/types'

type CreateArg = { name: string; description?: string; state?: ProjectState }

const dbCreateProject = vi.fn<(data: CreateArg) => Promise<string>>(async () => 'proj-1')
const dbUpdateProject = vi.fn<(id: string, changes: ProjectChanges) => Promise<void>>(
  async () => {}
)
const getProject = vi.fn<(id: string) => Promise<Project | null>>(async () => null)
const listProjects = vi.fn<() => Promise<Project[]>>(async () => [])

vi.mock('../services/db', () => ({
  initDB: vi.fn(async () => {}),
  listProjects: () => listProjects(),
  getProject: (id: string) => getProject(id),
  createProject: (data: CreateArg) => dbCreateProject(data),
  updateProject: (id: string, changes: ProjectChanges) => dbUpdateProject(id, changes),
  deleteProject: vi.fn(async () => {}),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

import { useProjectStore } from '../state/projectStore'

describe('projectStore state plumbing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards a chosen state to the database on create (#319)', async () => {
    await useProjectStore.getState().createProject({ name: 'Order to Cash', state: 'future' })

    expect(dbCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Order to Cash', state: 'future' })
    )
  })

  it('leaves state unset when the caller names none (#263)', async () => {
    await useProjectStore.getState().createProject({ name: 'my process' })

    expect(dbCreateProject.mock.calls[0][0]).toMatchObject({ state: undefined })
  })

  it('carries a null state through to the database on update (#318)', async () => {
    await useProjectStore.getState().updateProject('proj-1', { state: null })

    expect(dbUpdateProject).toHaveBeenCalledWith('proj-1', { state: null })
  })
  it('trims a renamed project name so whitespace is not a rename (#265)', async () => {
    // The db layer clears `legacy_name` on a real rename. An untrimmed name
    // differing only by whitespace must not count as one.
    await useProjectStore.getState().updateProject('proj-1', { name: '  P2P - Acme Corp  ' })

    expect(dbUpdateProject).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ name: 'P2P - Acme Corp' })
    )
  })

  it('leaves an omitted name omitted rather than trimming undefined', async () => {
    await useProjectStore.getState().updateProject('proj-1', { description: 'Only this' })

    const changes = dbUpdateProject.mock.calls[0][1]
    expect('name' in changes).toBe(false)
  })
})
