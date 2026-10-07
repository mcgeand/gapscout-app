/**
 * Tests for `teamsStore.deleteTeam` pre-check guard.
 *
 * Replaces a previous TODO that allowed raw `FOREIGN KEY constraint failed`
 * errors to surface when deleting a team still in use. Now the store calls
 * `getTeamUsageCount` first and bails with a friendly toast if usage > 0.
 *
 * Tests mock the db.ts module surface so they exercise only the store's
 * decision logic — they do NOT touch SQLite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Team } from '../data/types'

const {
  mockGetTeamUsageCount,
  mockGetTeamReferenceCount,
  mockDbDeleteTeam,
  mockListTeams,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockGetTeamUsageCount: vi.fn(),
  mockGetTeamReferenceCount: vi.fn(),
  mockDbDeleteTeam: vi.fn().mockResolvedValue(undefined),
  mockListTeams: vi.fn().mockResolvedValue([]),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('../services/db', () => ({
  createTeam: vi.fn(),
  listTeams: mockListTeams,
  updateTeam: vi.fn(),
  deleteTeam: mockDbDeleteTeam,
  getTeamUsageCount: mockGetTeamUsageCount,
  getTeamReferenceCount: mockGetTeamReferenceCount,
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}))

import { useTeamsStore } from '../state/teamsStore'

const seedTeam: Team = {
  id: 'team-1',
  projectId: 'proj-1',
  name: 'Finance',
  color: '#1E3A8A',
  order: 0,
  tags: [],
  createdAt: 0,
}

describe('teamsStore.deleteTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListTeams.mockResolvedValue([])
    mockDbDeleteTeam.mockResolvedValue(undefined)
    // Explicit 0 rather than a bare vi.fn(): `undefined > 0` is false, so a
    // missing default would let a broken reference path pass unnoticed.
    mockGetTeamReferenceCount.mockResolvedValue(0)

    useTeamsStore.setState({
      teams: [seedTeam],
      currentProjectId: 'proj-1',
      isLoading: false,
    })
  })

  it('blocks deletion and toasts a friendly error when steps still use the team', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(3)

    await useTeamsStore.getState().deleteTeam('team-1')

    expect(mockGetTeamUsageCount).toHaveBeenCalledWith('team-1', 'proj-1')
    expect(mockDbDeleteTeam).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastError.mock.calls[0][0]).toMatch(/Cannot delete team "Finance" — used by 3 steps$/)
  })

  it('uses singular "step" when exactly one step references the team', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(1)

    await useTeamsStore.getState().deleteTeam('team-1')

    expect(mockDbDeleteTeam).not.toHaveBeenCalled()
    expect(mockToastError.mock.calls[0][0]).toMatch(/used by 1 step$/)
  })

  it('proceeds with deletion and toasts success when usage is 0', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(0)

    await useTeamsStore.getState().deleteTeam('team-1')

    expect(mockDbDeleteTeam).toHaveBeenCalledWith('team-1', 'proj-1')
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess.mock.calls[0][0]).toMatch(/Team "Finance" deleted/)
    // Locks in: post-delete reload targets the team's projectId (typed-narrowed
    // local), not get().currentProjectId — important if the user deleted a
    // team from a non-current project.
    expect(mockListTeams).toHaveBeenCalledWith('proj-1')
  })

  it('deletes anyway when the team is only named as a supplier or customer, and says so', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(0)
    mockGetTeamReferenceCount.mockResolvedValueOnce(2)

    await useTeamsStore.getState().deleteTeam('team-1')

    // The reference count is by NAME, not by id: supplier/customer chips store
    // the team's name, which is what survives the delete (#173).
    expect(mockGetTeamReferenceCount).toHaveBeenCalledWith('Finance', 'proj-1')
    expect(mockDbDeleteTeam).toHaveBeenCalledWith('team-1', 'proj-1')
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess.mock.calls[0][0]).toBe(
      'Team "Finance" deleted — still named as supplier or customer on 2 steps'
    )
  })

  it('uses singular "step" in the reference-only success toast', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(0)
    mockGetTeamReferenceCount.mockResolvedValueOnce(1)

    await useTeamsStore.getState().deleteTeam('team-1')

    expect(mockDbDeleteTeam).toHaveBeenCalledWith('team-1', 'proj-1')
    expect(mockToastSuccess.mock.calls[0][0]).toBe(
      'Team "Finance" deleted — still named as supplier or customer on 1 step'
    )
  })

  it('never asks for the reference count when owners already block the delete', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(3)

    await useTeamsStore.getState().deleteTeam('team-1')

    expect(mockGetTeamReferenceCount).not.toHaveBeenCalled()
    expect(mockDbDeleteTeam).not.toHaveBeenCalled()
  })

  it('deletes anyway when the reference count lookup rejects, without naming leftovers', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(0)
    mockGetTeamReferenceCount.mockRejectedValueOnce(new Error('boom'))

    await useTeamsStore.getState().deleteTeam('team-1')

    // The reference count is advisory: a rejection must not block a delete
    // the owner check already cleared.
    expect(mockDbDeleteTeam).toHaveBeenCalledWith('team-1', 'proj-1')
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess.mock.calls[0][0]).toBe('Team "Finance" deleted')
  })

  it('bails with a friendly toast when no projectId is available', async () => {
    useTeamsStore.setState({
      teams: [{ ...seedTeam, projectId: '' }],
      currentProjectId: null,
      isLoading: false,
    })

    await useTeamsStore.getState().deleteTeam('team-1')

    expect(mockGetTeamUsageCount).not.toHaveBeenCalled()
    expect(mockDbDeleteTeam).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('Cannot delete team: no project selected')
  })

  it('falls back to a domain error if a constraint failure still escapes the pre-check', async () => {
    mockGetTeamUsageCount.mockResolvedValueOnce(0)
    mockDbDeleteTeam.mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'))

    await useTeamsStore.getState().deleteTeam('team-1')

    expect(mockToastError).toHaveBeenCalledWith('Cannot delete team: steps are still assigned to it')
  })
})
