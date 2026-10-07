import { describe, expect, it } from 'vitest'
import { UPDATER_LATEST_JSON_URL, shouldCheckForUpdates } from '../services/updater'

describe('updater', () => {
  it('points the manifest at releases/latest on the public repo', () => {
    expect(UPDATER_LATEST_JSON_URL).toBe(
      'https://github.com/mcgeand/gapscout-app/releases/latest/download/latest.json',
    )
  })

  it('does not check for updates under vitest (non-PROD, no force flag)', () => {
    expect(import.meta.env.PROD).toBe(false)
    expect(import.meta.env.VITE_FORCE_UPDATER).toBeUndefined()
    expect(shouldCheckForUpdates()).toBe(false)
  })
})
