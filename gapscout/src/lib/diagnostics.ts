/**
 * Help → About diagnostics (#120).
 *
 * Local-first feedback surface: a Markdown block the user can paste into a
 * GitHub issue. No telemetry — the only network hop is the browser the user
 * opens themselves (via the opener plugin under Tauri).
 */

import { initDB } from '../services/db'
import { getDB } from '../services/db/connection'
import { isTauriEnvironment } from '../services/saveFile'

/**
 * The public repo: releases, `latest.json` and tester feedback live here, while
 * development stays in the private repo. The updater endpoint in
 * `tauri.conf.json`, `UPDATER_LATEST_JSON_URL`, the opener URL scope and
 * `PUBLIC_REPO` in `release.yml` all name the same repo — move them together.
 */
export const FEEDBACK_REPO = 'mcgeand/gapscout-app'

/**
 * Send feedback is shown only when FEEDBACK_REPO is public. It was hidden while
 * feedback pointed at the private repo, where the link 404s for everyone who is
 * not a collaborator — every user of a shipped build.
 */
export const FEEDBACK_ISSUES_PUBLIC = true

export interface Diagnostics {
  appVersion: string
  os: string
  userAgent: string
  databasePath: string
  schemaVersion: number | null
  tauri: boolean
}

/**
 * OS-native path to gapscout.db.
 *
 * Prefers the Rust `get_db_path` command so Help → About cannot drift from the
 * backend (see #123 for a configurable override). Falls back to homeDir join
 * only if the command is unavailable. Tauri modules are imported lazily so
 * jsdom tests never pull them in.
 */
export async function resolveDatabasePath(): Promise<string> {
  if (!isTauriEnvironment()) {
    return '~/.gapscout/gapscout.db'
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('get_db_path')
  } catch {
    // Fallback if the command is missing from an old build; keep #123 in mind —
    // this JS rebuild will lie again the moment the DB path is configurable.
    try {
      const { homeDir, join } = await import('@tauri-apps/api/path')
      return await join(await homeDir(), '.gapscout', 'gapscout.db')
    } catch {
      return '~/.gapscout/gapscout.db'
    }
  }
}

async function readSchemaVersion(): Promise<number | null> {
  try {
    await initDB()
    const rows = await getDB().select<Array<{ version: number | null }>>(
      'SELECT MAX(version) AS version FROM schema_version',
    )
    const version = rows[0]?.version
    return typeof version === 'number' ? version : null
  } catch {
    return null
  }
}

function describeOs(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'unknown'
}

export async function collectDiagnostics(): Promise<Diagnostics> {
  const [databasePath, schemaVersion] = await Promise.all([
    resolveDatabasePath(),
    readSchemaVersion(),
  ])
  return {
    appVersion: __APP_VERSION__,
    os: describeOs(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    databasePath,
    schemaVersion,
    tauri: isTauriEnvironment(),
  }
}

export function formatDiagnosticsMarkdown(d: Diagnostics): string {
  const schema =
    d.schemaVersion === null ? 'unknown (database not ready)' : String(d.schemaVersion)
  return [
    '## GapScout diagnostics',
    '',
    `| | |`,
    `| --- | --- |`,
    `| App version | ${d.appVersion} |`,
    `| OS | ${d.os} |`,
    `| Runtime | ${d.tauri ? 'Tauri desktop' : 'browser / web'} |`,
    `| Database | \`${d.databasePath}\` |`,
    `| Schema version | ${schema} |`,
    '',
    `<details><summary>User agent</summary>`,
    '',
    '```',
    d.userAgent,
    '```',
    '',
    '</details>',
    '',
  ].join('\n')
}

/** Pre-filled new-issue URL. Body is short so the link stays under common URL limits. */
export function buildFeedbackIssueUrl(d: Diagnostics): string {
  const title = encodeURIComponent(`Feedback: GapScout ${d.appVersion} (${d.os})`)
  const body = encodeURIComponent(
    [
      '## What happened',
      '',
      '',
      '## Expected',
      '',
      '',
      formatDiagnosticsMarkdown(d),
    ].join('\n'),
  )
  return `https://github.com/${FEEDBACK_REPO}/issues/new?title=${title}&body=${body}`
}

/**
 * Open a URL in the system browser. Tauri webviews do not honour window.open
 * for external links without the opener plugin; fall back only outside Tauri.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
