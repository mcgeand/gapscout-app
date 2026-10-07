/**
 * Choosing a template collapses the wizard from four steps to two (#146).
 *
 * The Teams and Systems steps exist to collect what a template already carries,
 * so leaving them in would ask for entities that get thrown away — and worse,
 * show a Review listing four teams the project will not have.
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import ProjectSetupWizard from '../components/Setup/ProjectSetupWizard'
import { loadTemplate, parseTemplate } from '../services/templateService'

// jsdom has no static server to fetch `/templates/p2p.json` from, so the file is
// read off disk and handed back through the same parse the service uses.
const p2p = parseTemplate(
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/templates/p2p.json'), 'utf-8')),
)

vi.mock('../services/templateService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/templateService')>()
  return {
    ...actual,
    loadTemplate: vi.fn(async (id: string) => {
      if (id === 'p2p') return p2p
      throw new Error(`Unknown template "${id}"`)
    }),
  }
})

function renderWizard(
  onComplete = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn()
) {
  render(<ProjectSetupWizard isOpen onClose={onClose} onComplete={onComplete} />)
  fireEvent.change(screen.getByPlaceholderText(/Customer Onboarding Process/), {
    target: { value: 'P2P audit' },
  })
  return onComplete
}

async function chooseP2P() {
  fireEvent.change(screen.getByLabelText(/Start from a Template/), { target: { value: 'p2p' } })
  await waitFor(() => expect(screen.getByText(/Teams and systems come from/)).toBeInTheDocument())
}

describe('ProjectSetupWizard — template selection', () => {
  it('goes Project → Teams → Systems → Review with no template', () => {
    renderWizard()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Define Teams')).toBeInTheDocument()
  })

  it('goes straight from Project to Review once a template is chosen', async () => {
    renderWizard()
    await chooseP2P()

    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Review & Create')).toBeInTheDocument()
    expect(screen.queryByText('Define Teams')).not.toBeInTheDocument()
  })

  it('reviews what the template seeds instead of collected teams and systems', async () => {
    renderWizard()
    await chooseP2P()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(
      screen.getByText(
        new RegExp(`Seeds ${p2p.teams.length} teams, ${p2p.systems.length} systems`),
      ),
    ).toBeInTheDocument()
    // The custom path's summaries would name teams this project will never have.
    expect(screen.queryByText(/^Teams \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Systems \(/)).not.toBeInTheDocument()
  })

  it('returns to step 1 from the template Review', async () => {
    renderWizard()
    await chooseP2P()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(screen.getByLabelText(/Start from a Template/)).toHaveValue('p2p')
  })

  it('hands the loaded template to onComplete, with no collected teams or systems', async () => {
    const onComplete = renderWizard()
    await chooseP2P()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete).toHaveBeenCalledWith({
      projectName: 'P2P audit',
      projectDescription: '',
      projectState: 'current',
      template: p2p,
      teams: [],
      systems: [],
    })
  })

  it('restores the four-step flow when the template is cleared', async () => {
    renderWizard()
    await chooseP2P()

    fireEvent.change(screen.getByLabelText(/Start from a Template/), { target: { value: '' } })
    await waitFor(() => expect(screen.getByText('Step 1 of 4')).toBeInTheDocument())
  })
})

describe('ProjectSetupWizard — a template load the user cancelled (#372)', () => {
  /** A load the test finishes by hand, so a cancel can land in the middle of it. */
  function deferredLoad() {
    let finish!: () => void
    vi.mocked(loadTemplate).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = () => resolve(p2p)
        })
    )
    return () => finish()
  }

  it('discards a template that arrives after the wizard was cancelled', async () => {
    // `handleSelectTemplate` awaits the fetch and then writes `template`. Cancel
    // first and `resetWizard` runs first, so the pending write used to land on a
    // wizard that had already been reset: reopening showed two steps and the
    // blurb while the select read "None (custom)", and Create seeded the project
    // from the template the user had just cancelled.
    const finishLoad = deferredLoad()
    const onComplete = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    renderWizard(onComplete, onClose)

    fireEvent.change(screen.getByLabelText(/Start from a Template/), {
      target: { value: 'p2p' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()

    finishLoad()
    await waitFor(() =>
      expect(screen.queryByText(/Teams and systems come from/)).not.toBeInTheDocument()
    )

    // The reset wizard is the four-step custom flow again, and the select is
    // usable: `isLoadingTemplate` was never cleared by the old reset either, so
    // the control stayed disabled until the abandoned fetch happened to land.
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByLabelText(/Start from a Template/)).toHaveValue('')
    expect(screen.getByLabelText(/Start from a Template/)).toBeEnabled()
  })

  it('does not seed a project from the template that was cancelled', async () => {
    const finishLoad = deferredLoad()
    const onComplete = vi.fn().mockResolvedValue(undefined)
    renderWizard(onComplete)

    fireEvent.change(screen.getByLabelText(/Start from a Template/), {
      target: { value: 'p2p' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    finishLoad()
    await waitFor(() => expect(screen.getByText('Step 1 of 4')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText(/Customer Onboarding Process/), {
      target: { value: 'Custom map' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(onComplete.mock.calls[0][0].template).toBeNull()
  })
})
