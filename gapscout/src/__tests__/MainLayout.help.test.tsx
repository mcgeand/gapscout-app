import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Help & About (#215 / #120).
 *
 * The dialog used to advertise nine shortcuts and implement three. The point of
 * these tests is not that a particular list renders — it is that the list and
 * the handlers cannot drift apart again, so the last test reads both source
 * files and asserts every advertised key is actually bound. A test that only
 * checked the rendered rows would have passed happily on the nine-row version.
 */

vi.mock('../app/layout/Sidebar', () => ({ default: () => <div>Sidebar</div> }))
vi.mock('../app/layout/RightPanel', () => ({ default: () => <div>Right panel</div> }))
vi.mock('../components/shared/SearchBar', () => ({ default: () => <div>Search</div> }))
vi.mock('../lib/diagnostics', async () => {
  const actual = await vi.importActual<typeof import('../lib/diagnostics')>('../lib/diagnostics')
  return {
    ...actual,
    collectDiagnostics: vi.fn().mockResolvedValue({
      appVersion: '0.9.0',
      os: 'unknown',
      userAgent: 'test',
      databasePath: '/mock/home/.gapscout/gapscout.db',
      schemaVersion: 8,
      tauri: false,
    }),
  }
})

import MainLayout from '../app/layout/MainLayout'
import { formatDiagnosticsMarkdown } from '../lib/diagnostics'

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

const SRC = resolve(__dirname, '..')
const read = (relative: string) => readFileSync(resolve(SRC, relative), 'utf-8')

function openHelp() {
  render(<MainLayout><div>Page</div></MainLayout>)
  fireEvent.click(screen.getByRole('button', { name: 'Help and about' }))
  return screen.getByRole('dialog')
}

describe('Help & About', () => {
  it('opens from the toolbar control that names it', () => {
    const dialog = openHelp()
    expect(within(dialog).getByText('Help & About')).toBeInTheDocument()
  })

  it('opens on Cmd+/ and closes on Escape', () => {
    render(<MainLayout><div>Page</div></MainLayout>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: '/', metaKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Dispatched on the body, not on `window`. `Modal` owns Escape and listens
    // on `document`; an event dispatched at `window` has a path of `[window]`
    // alone and never reaches it, so a window-dispatched Escape would prove
    // nothing about the key a real user presses.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the version, the resolved database location and the licence', async () => {
    const dialog = openHelp()
    const version = JSON.parse(
      readFileSync(resolve(SRC, '../package.json'), 'utf-8'),
    ).version

    expect(within(dialog).getByText('Version')).toBeInTheDocument()
    expect(within(dialog).getByText(version)).toBeInTheDocument()
    await waitFor(() => {
      expect(within(dialog).getByText('/mock/home/.gapscout/gapscout.db')).toBeInTheDocument()
    })
    expect(within(dialog).getByText('MIT')).toBeInTheDocument()
  })

  it('copies diagnostics Markdown and offers Send feedback', async () => {
    const dialog = openHelp()
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Copy diagnostics' })).toBeEnabled()
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy diagnostics' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const pasted = writeText.mock.calls[0][0] as string
    expect(pasted).toContain('## GapScout diagnostics')
    expect(pasted).toEqual(
      formatDiagnosticsMarkdown({
        appVersion: '0.9.0',
        os: 'unknown',
        userAgent: 'test',
        databasePath: '/mock/home/.gapscout/gapscout.db',
        schemaVersion: 8,
        tauri: false,
      }),
    )

    // Shown because FEEDBACK_REPO is the public repo; while it named the private
    // one the button was hidden, since it 404s for every shipped-build user.
    expect(within(dialog).getByRole('button', { name: 'Send feedback' })).toBeInTheDocument()
  })

  it('opens a new issue on the public repo from Send feedback', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const dialog = openHelp()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send feedback' }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    const url = open.mock.calls[0][0] as string
    // The public repo, not the private one — that 404s for testers.
    expect(url.startsWith('https://github.com/mcgeand/gapscout-app/issues/new?')).toBe(true)
    expect(decodeURIComponent(url)).toContain('## GapScout diagnostics')
    open.mockRestore()
  })

  it('lists no shortcut that nothing binds', () => {
    const dialog = openHelp()

    // Collect the <kbd> elements rather than matching their text: a regex over
    // key names silently skips anything it did not anticipate, and the first
    // version of this test skipped `/` — the very row it exists to protect.
    // Modifiers carry no binding of their own; Esc is covered by the behaviour
    // test above, since `Modal` owns it and this file is not where it lives.
    const keys = Array.from(dialog.querySelectorAll('kbd'))
      .map((el) => el.textContent ?? '')
      .filter((k) => k !== '⌘' && k !== '⇧' && k !== 'Esc')

    // ⌘B, ⌘F and ⌘/ — if a row is ever dropped, this is what notices.
    expect(keys).toEqual(['B', 'F', '/'])

    const handlers = read('app/layout/MainLayout.tsx') + read('components/shared/SearchBar.tsx')
    for (const key of keys) {
      const k = key.toLowerCase()
      const bound =
        handlers.includes(`e.key === '${k}'`) ||
        handlers.includes(`e.key.toLowerCase() === '${k}'`)
      expect(bound, `${key} is listed in Help but nothing binds it`).toBe(true)
    }
  })

  it('does not advertise the six shortcuts that were never implemented', () => {
    const dialog = openHelp()
    for (const gone of ['Go to projects', 'New project', 'Export current view', 'Save changes', 'Undo', 'Redo']) {
      expect(within(dialog).queryByText(gone)).not.toBeInTheDocument()
    }
  })
})
