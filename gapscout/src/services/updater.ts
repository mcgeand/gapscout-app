import { logger } from '../lib/logger'
import { isTauriEnvironment } from './saveFile'

/**
 * In-app updates via tauri-plugin-updater (#92).
 *
 * Endpoint (must match `plugins.updater.endpoints` in tauri.conf.json): the
 * public repo's `releases/latest`, which the release workflow mirrors each
 * build into. The private dev repo cannot serve it — the updater fetches
 * unauthenticated. See docs/releasing.md.
 */
export const UPDATER_LATEST_JSON_URL =
  'https://github.com/mcgeand/gapscout-app/releases/latest/download/latest.json'

export interface AvailableUpdate {
  version: string
  notes: string
  /** Download, install, and relaunch. Rejects on signature failure. */
  install: () => Promise<void>
  /** Drop the update resource without installing. */
  dismiss: () => Promise<void>
}

/**
 * Production builds check on launch. `tauri dev` skips unless
 * `VITE_FORCE_UPDATER=1` is set in the environment Vite sees.
 */
export function shouldCheckForUpdates(): boolean {
  if (import.meta.env.PROD) return true
  return import.meta.env.VITE_FORCE_UPDATER === '1'
}

/**
 * Returns an available update, or null when none / not applicable / check failed.
 * Failures are logged and swallowed so a dead endpoint never blocks launch.
 */
export async function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (!shouldCheckForUpdates() || !isTauriEnvironment()) return null

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return null

    return {
      version: update.version,
      notes: (update.body ?? '').trim(),
      install: async () => {
        await update.downloadAndInstall()
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      },
      dismiss: () => update.close(),
    }
  } catch (err) {
    logger.error('Update check failed', err)
    return null
  }
}
