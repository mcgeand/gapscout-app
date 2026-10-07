import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildFeedbackIssueUrl,
  collectDiagnostics,
  FEEDBACK_ISSUES_PUBLIC,
  FEEDBACK_REPO,
  formatDiagnosticsMarkdown,
  resolveDatabasePath,
  type Diagnostics,
} from '../lib/diagnostics'

vi.mock('../services/db', () => ({
  initDB: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/db/connection', () => ({
  getDB: vi.fn(() => ({
    select: vi.fn().mockResolvedValue([{ version: 8 }]),
  })),
}))

vi.mock('../services/saveFile', () => ({
  isTauriEnvironment: vi.fn(() => false),
}))

const sample: Diagnostics = {
  appVersion: '0.9.0',
  os: 'Windows',
  userAgent: 'Mozilla/5.0 Test',
  databasePath: 'C:\\Users\\me\\.gapscout\\gapscout.db',
  schemaVersion: 8,
  tauri: true,
}

describe('diagnostics (#120)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formats a Markdown block ready to paste into an issue', () => {
    const md = formatDiagnosticsMarkdown(sample)
    expect(md).toContain('## GapScout diagnostics')
    expect(md).toContain('| App version | 0.9.0 |')
    expect(md).toContain('| OS | Windows |')
    expect(md).toContain('C:\\Users\\me\\.gapscout\\gapscout.db')
    expect(md).toContain('| Schema version | 8 |')
  })

  it('builds a GitHub new-issue URL on the feedback repo', () => {
    const url = buildFeedbackIssueUrl(sample)
    expect(url.startsWith(`https://github.com/${FEEDBACK_REPO}/issues/new?`)).toBe(true)
    expect(url).toContain('title=')
    expect(url).toContain('body=')
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('GapScout diagnostics')
    expect(decoded).not.toContain('Paste the Markdown from Help')
  })

  it('sends feedback to the public repo, never the private dev repo', () => {
    // The private repo 404s for every shipped-build user; Send feedback is only
    // on because FEEDBACK_REPO names the public one.
    expect(FEEDBACK_REPO).toBe('mcgeand/gapscout-app')
    expect(FEEDBACK_ISSUES_PUBLIC).toBe(true)
  })

  it('falls back to the Unix spelling outside Tauri', async () => {
    await expect(resolveDatabasePath()).resolves.toBe('~/.gapscout/gapscout.db')
  })

  it('collects version and schema when the database is ready', async () => {
    const d = await collectDiagnostics()
    expect(d.appVersion).toBeTruthy()
    expect(d.schemaVersion).toBe(8)
    expect(d.databasePath).toBe('~/.gapscout/gapscout.db')
  })
})
