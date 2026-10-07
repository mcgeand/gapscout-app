/**
 * Tests for getMilestoneUsageCount — verifies the SQL-based pre-check used by
 * `stepsStore.deleteMilestone`. Replaced an in-memory `.filter` that depended
 * on `get().steps` being loaded for the current project.
 *
 * Coverage caveat: assertions are at the SQL-string level (parameters and
 * shape), not against a real SQLite engine. See db.getSystemUsageCount tests
 * for the same caveat — covered by the proposed integration-test follow-up.
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

import { initDB, getMilestoneUsageCount } from '../services/db'

describe('getMilestoneUsageCount', () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    mockSelect.mockClear()
  })

  it('returns 0 when no steps reference the milestone', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 0 }])

    const count = await getMilestoneUsageCount('ms-unused', 'proj-1')

    expect(count).toBe(0)
  })

  it('returns the count for a single matching step', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 1 }])

    const count = await getMilestoneUsageCount('ms-intake', 'proj-1')

    expect(count).toBe(1)
  })

  it('returns the count for multiple matching steps', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 5 }])

    const count = await getMilestoneUsageCount('ms-review', 'proj-1')

    expect(count).toBe(5)
  })

  it('issues exactly one SELECT scoped by project_id with FK equality on milestone_id', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 4 }])

    await getMilestoneUsageCount('ms-abc', 'proj-1')

    expect(mockSelect).toHaveBeenCalledTimes(1)

    const [sql, params] = mockSelect.mock.calls[0]
    expect(sql).toMatch(/SELECT COUNT\(\*\)/i)
    expect(sql).toMatch(/project_id = \$1/)
    expect(sql).toMatch(/milestone_id = \$2/)
    expect(params).toEqual(['proj-1', 'ms-abc'])
  })

  it('throws when the adapter returns no row (COUNT(*) should always return one)', async () => {
    mockSelect.mockResolvedValueOnce([])

    await expect(getMilestoneUsageCount('ms-x', 'proj-1')).rejects.toThrow(
      /COUNT\(\*\) returned no row/
    )
  })
})
