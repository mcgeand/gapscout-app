/**
 * Tests for getTeamUsageCount — verifies the SQL-based pre-check used by
 * `teamsStore.deleteTeam` to turn a raw `FOREIGN KEY constraint failed`
 * into a friendly "team used by N steps" toast.
 *
 * Coverage caveat: as with the sibling getSystemUsageCount tests, these
 * assert the SQL string and parameters passed to the adapter mock; they do
 * NOT execute against a real SQLite engine. End-to-end behaviour is left
 * to the proposed integration-test follow-up.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
}))

vi.mock('../services/db/sqlJsAdapter', () => ({
  SqlJsAdapter: class {
    initialize = vi.fn().mockResolvedValue(undefined)
    execute = mockExecute
    select = mockSelect
    close = vi.fn()
  },
}))

import { initDB, getTeamUsageCount, getTeamReferenceCount } from '../services/db'

describe('getTeamUsageCount', () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    mockSelect.mockClear()
  })

  it('returns 0 when no steps reference the team', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 0 }])

    const count = await getTeamUsageCount('team-unused', 'proj-1')

    expect(count).toBe(0)
  })

  it('returns the count for a single matching step', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 1 }])

    const count = await getTeamUsageCount('team-finance', 'proj-1')

    expect(count).toBe(1)
  })

  it('returns the count for multiple matching steps', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 12 }])

    const count = await getTeamUsageCount('team-ops', 'proj-1')

    expect(count).toBe(12)
  })

  it('issues exactly one SELECT scoped by project_id with FK equality on team_id', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 3 }])

    await getTeamUsageCount('team-abc', 'proj-1')

    expect(mockSelect).toHaveBeenCalledTimes(1)

    const [sql, params] = mockSelect.mock.calls[0]
    expect(sql).toMatch(/SELECT COUNT\(\*\)/i)
    expect(sql).toMatch(/project_id = \$1/)
    expect(sql).toMatch(/team_id = \$2/)
    expect(params).toEqual(['proj-1', 'team-abc'])
  })

  it('throws when the adapter returns no row (COUNT(*) should always return one)', async () => {
    mockSelect.mockResolvedValueOnce([])

    await expect(getTeamUsageCount('team-x', 'proj-1')).rejects.toThrow(
      /COUNT\(\*\) returned no row/
    )
  })
})

/**
 * The sibling reference count (#173), which asks a different question: which
 * steps merely NAME the team in their suppliers or customers.
 *
 * Only the shape is asserted here — that it is one SELECT over both JSON
 * columns with the name bound twice, because the adapter rewrites `$N` to
 * positional `?` and a reused parameter would leave `customers` matching NULL.
 * Whether the predicate actually matches the right rows is
 * `db.getTeamReferenceCount.real.test.ts`, on the real engine.
 */
describe('getTeamReferenceCount', () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    mockSelect.mockClear()
  })

  it('returns the count the adapter reports', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 2 }])

    expect(await getTeamReferenceCount('Finance', 'proj-1')).toBe(2)
  })

  it('issues one SELECT over suppliers and customers with the name bound twice', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 0 }])

    await getTeamReferenceCount('Finance', 'proj-1')

    expect(mockSelect).toHaveBeenCalledTimes(1)

    const [sql, params] = mockSelect.mock.calls[0]
    expect(sql).toMatch(/SELECT COUNT\(\*\)/i)
    expect(sql).toMatch(/project_id = \$1/)
    expect(sql).toMatch(/instr\(suppliers, '"' \|\| \$2 \|\| '"'\) > 0/)
    expect(sql).toMatch(/instr\(customers, '"' \|\| \$3 \|\| '"'\) > 0/)
    expect(params).toEqual(['proj-1', 'Finance', 'Finance'])
  })

  it('throws when the adapter returns no row (COUNT(*) should always return one)', async () => {
    mockSelect.mockResolvedValueOnce([])

    await expect(getTeamReferenceCount('Finance', 'proj-1')).rejects.toThrow(
      /COUNT\(\*\) returned no row/
    )
  })
})
