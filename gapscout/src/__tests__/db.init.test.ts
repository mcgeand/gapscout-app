import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  initializeCalls: 0,
  shouldFail: false,
  failOrphanSweep: false,
  /**
   * When set, `sqlite_master` probes report tables present and
   * `MAX(version)` returns this value so migrations can be skipped while the
   * every-launch orphan sweep still runs.
   */
  readySchemaVersion: null as number | null,
}))

vi.mock('../services/db/sqlJsAdapter', () => ({
  SqlJsAdapter: class {
    async initialize() {
      state.initializeCalls += 1
      if (state.shouldFail) throw new Error('initialization failed')
    }
    async close() {}
    async execute(sql: string) {
      if (
        state.failOrphanSweep &&
        /DELETE\s+FROM\s+search_index/i.test(sql) &&
        /NOT EXISTS/i.test(sql)
      ) {
        throw new Error('FTS5 shadow table corrupted')
      }
      return { rowsAffected: 0 }
    }
    async select<T>(sql: string) {
      if (state.readySchemaVersion != null) {
        if (/sqlite_master/i.test(sql)) {
          return [{ count: 1 }] as T
        }
        if (/MAX\s*\(\s*version\s*\)/i.test(sql) || /schema_version/i.test(sql)) {
          return [{ version: state.readySchemaVersion }] as T
        }
      }
      return [{ version: 4 }] as T
    }
  },
}))

describe('initDB readiness', () => {
  beforeEach(() => {
    vi.resetModules()
    state.initializeCalls = 0
    state.shouldFail = false
    state.failOrphanSweep = false
    state.readySchemaVersion = null
  })

  it('shares one initialization promise across concurrent callers and is idempotent after success', async () => {
    const { initDB } = await import('../services/db')

    const first = initDB()
    const second = initDB()
    expect(first).toBe(second)
    await Promise.all([first, second])
    await initDB()

    expect(state.initializeCalls).toBe(1)
  })

  it('clears the failed flight so a later call can retry', async () => {
    const { initDB } = await import('../services/db')
    state.shouldFail = true
    await expect(initDB()).rejects.toThrow('initialization failed')

    state.shouldFail = false
    await expect(initDB()).resolves.toBeUndefined()
    expect(state.initializeCalls).toBe(2)
  })

  it('continues startup when the every-launch orphan sweep fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    state.readySchemaVersion = 10
    state.failOrphanSweep = true

    const { initDB } = await import('../services/db')
    await expect(initDB()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(
      'Orphaned search_index sweep failed; continuing startup',
      expect.any(Error),
    )
    warn.mockRestore()
  })
})
