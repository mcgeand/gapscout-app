/**
 * Tests for getSystemUsageCount — verifies the SQL-based implementation
 * counts uses of a system across a project's steps in a single round-trip.
 *
 * Coverage caveat: these tests assert the SQL string and parameters passed
 * to the adapter mock; they do NOT execute against a real SQLite engine.
 * That means the false-match safety of `LIKE '%"' || $2 || '"%'` (e.g.
 * `sys-ab` not matching `["sys-abc"]`) is asserted at the source-string
 * level, not at runtime — a tautology against my own implementation.
 *
 * The behavioral check is deferred to a proposed follow-up:
 *   "[Test] Integration test for getSystemUsageCount with real sqlite"
 *   — small better-sqlite3 (or sql.js in-memory) harness covering the
 *   substring/false-match case end-to-end.
 * `/merge` will offer to file this follow-up after the PR lands.
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

import { initDB, getSystemUsageCount } from '../services/db'

describe('getSystemUsageCount', () => {
  beforeEach(async () => {
    // Migration code reads existing rows; a safe default keeps initDB happy.
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    // Forget initDB's setup calls so per-test assertions count only the SUT.
    mockSelect.mockClear()
  })

  it('returns 0 when no steps reference the system', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 0 }])

    const count = await getSystemUsageCount('sys-unused', 'proj-1')

    expect(count).toBe(0)
  })

  it('returns the count for a single matching step', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 1 }])

    const count = await getSystemUsageCount('sys-erp', 'proj-1')

    expect(count).toBe(1)
  })

  it('returns the count for multiple matching steps', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 7 }])

    const count = await getSystemUsageCount('sys-crm', 'proj-1')

    expect(count).toBe(7)
  })

  it('issues exactly one SELECT, scoped by project_id, with a quote-wrapped LIKE pattern', async () => {
    mockSelect.mockResolvedValueOnce([{ count: 3 }])

    await getSystemUsageCount('sys-abc', 'proj-1')

    // The function under test should be the only `select` call after initDB resets the mocks.
    expect(mockSelect).toHaveBeenCalledTimes(1)

    const [sql, params] = mockSelect.mock.calls[0]
    // Quote-wrapping prevents 'sys-ab' from matching 'sys-abc' or vice-versa.
    expect(sql).toMatch(/SELECT COUNT\(\*\)/i)
    expect(sql).toMatch(/project_id = \$1/)
    expect(sql).toMatch(/systems LIKE '%"' \|\| \$2 \|\| '"%'/)
    expect(params).toEqual(['proj-1', 'sys-abc'])
  })

  it('throws when the adapter returns no row (COUNT(*) should always return one)', async () => {
    mockSelect.mockResolvedValueOnce([])

    await expect(getSystemUsageCount('sys-x', 'proj-1')).rejects.toThrow(
      /COUNT\(\*\) returned no row/
    )
  })
})
