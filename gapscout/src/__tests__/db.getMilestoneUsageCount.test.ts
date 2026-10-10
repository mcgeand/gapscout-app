/**
 * Tests for getMilestoneUsageCount — verifies the SQL-based pre-check used by
 * `stepsStore.deleteMilestone`. It returns steps and process gaps separately
 * (a process gap's milestone FK is SET NULL, so a delete would strand it). Replaced an in-memory `.filter` that depended
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

  it('returns zero for both when nothing references the milestone', async () => {
    mockSelect.mockResolvedValueOnce([{ steps: 0, process_gaps: 0 }])

    const usage = await getMilestoneUsageCount('ms-unused', 'proj-1')

    expect(usage).toEqual({ steps: 0, processGaps: 0 })
  })

  it('returns the step count', async () => {
    mockSelect.mockResolvedValueOnce([{ steps: 5, process_gaps: 0 }])

    const usage = await getMilestoneUsageCount('ms-review', 'proj-1')

    expect(usage).toEqual({ steps: 5, processGaps: 0 })
  })

  it('returns the process-gap count separately from the step count', async () => {
    mockSelect.mockResolvedValueOnce([{ steps: 0, process_gaps: 3 }])

    const usage = await getMilestoneUsageCount('ms-gaps', 'proj-1')

    expect(usage).toEqual({ steps: 0, processGaps: 3 })
  })

  it('issues exactly one SELECT scoped by project and milestone, counting only process gaps', async () => {
    mockSelect.mockResolvedValueOnce([{ steps: 4, process_gaps: 1 }])

    await getMilestoneUsageCount('ms-abc', 'proj-1')

    expect(mockSelect).toHaveBeenCalledTimes(1)

    const [sql, params] = mockSelect.mock.calls[0]
    expect(sql).toMatch(/FROM steps/i)
    expect(sql).toMatch(/FROM gaps/i)
    expect(sql).toMatch(/project_id = \$1/)
    expect(sql).toMatch(/milestone_id = \$2/)
    expect(sql).toMatch(/project_id = \$3/)
    expect(sql).toMatch(/milestone_id = \$4/)
    expect(sql).toMatch(/order_num IS NOT NULL/)
    // Positional, one value per placeholder: sql.js turns `` into `?`.
    expect(params).toEqual(['proj-1', 'ms-abc', 'proj-1', 'ms-abc'])
  })

  it('throws when the adapter returns no row (the aggregate should always return one)', async () => {
    mockSelect.mockResolvedValueOnce([])

    await expect(getMilestoneUsageCount('ms-x', 'proj-1')).rejects.toThrow(
      /COUNT\(\*\) returned no row/
    )
  })
})