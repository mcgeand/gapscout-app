/**
 * Behaviour tests for the export modal (issue #150, PRD 4.12).
 *
 * These cover the four acceptance criteria — multi-select, one Export writing
 * every selected file, a progress indicator while it runs, and a success message
 * afterwards — plus the two routing rules a user would only notice by losing a
 * file: one file goes through the save dialog, several go through the folder
 * picker, and the slow diagram render happens once when both consumers agree.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExportModal from '../components/Export/ExportModal'
import type { Gap, Project, Step, Team } from '../data/types'
import { beginProjectScope, clearProjectScope } from '../state/workspaceScope'

const renderDiagramImage = vi.fn()
const saveFile = vi.fn()
const saveFilePack = vi.fn()

// jsdom cannot rasterise, so the capture is mocked exactly as exportDiagram's
// own tests do; what is asserted here is how often it is called and with what.
vi.mock('../services/exportDiagram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/exportDiagram')>()),
  renderDiagramImage: (...args: unknown[]) => renderDiagramImage(...args),
}))

vi.mock('../services/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/saveFile')>()),
  saveFile: (...args: unknown[]) => saveFile(...args),
  saveFilePack: (...args: unknown[]) => saveFilePack(...args),
}))

const CREATED = Date.UTC(2026, 0, 15, 9, 30, 0)

const project: Project = {
  id: 'p1',
  name: 'Procure to Pay',
  description: 'How a purchase request becomes a paid invoice.',
  createdAt: CREATED,
  updatedAt: CREATED,
}

const team: Team = {
  id: 't1',
  projectId: 'p1',
  name: 'Finance',
  color: '#F59E0B',
  order: 0,
  tags: [],
  createdAt: CREATED,
}

const step: Step = {
  id: 's1',
  projectId: 'p1',
  label: 'Review purchase request',
  teamId: 't1',
  milestoneId: 'm1',
  order: 0,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: CREATED,
  updatedAt: CREATED,
}

const gap: Gap = {
  id: 'g1',
  projectId: 'p1',
  stepId: 's1',
  observed: 'Approvals sit unread',
  expected: 'Approved within 2 days',
  severity: 'H',
  status: 'Open',
  links: [],
  createdAt: CREATED,
  updatedAt: CREATED,
}

function setup(overrides: Partial<React.ComponentProps<typeof ExportModal>> = {}) {
  const onClose = vi.fn()
  const viewport = document.createElement('div')

  const view = render(
    <ExportModal
      isOpen
      onClose={onClose}
      project={project}
      steps={[step]}
      gaps={[gap]}
      teams={[team]}
      milestones={[
        { id: 'm1', projectId: 'p1', name: 'Approval', order: 0, relatedPolicies: [], createdAt: CREATED, updatedAt: CREATED },
      ]}
      systems={[]}
      policies={[]}
      glossary={[]}
      sipoc={null}
      getViewport={() => viewport}
      nodes={[{ id: 's1', position: { x: 0, y: 0 }, data: {} }]}
      swimlanes={[]}
      hasDiagram
      {...overrides}
    />
  )

  return { onClose, ...view }
}

/** The checkbox for a format row, found by its visible label. */
function checkboxFor(label: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: new RegExp(label) })
}

function exportButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Export/ })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Module-level scope state leaks between tests otherwise.
  clearProjectScope()
  renderDiagramImage.mockResolvedValue({
    dataUrl: 'data:image/png;base64,QUJD',
    width: 100,
    height: 100,
    clamped: false,
  })
  saveFile.mockResolvedValue('/tmp/procure-to-pay_gaps_2026-09-02.csv')
  saveFilePack.mockResolvedValue('/tmp/exports')
})

describe('ExportModal', () => {
  it('lets several formats be selected at once', () => {
    setup()

    // Opens on the diagram PNG plus the Markdown pack.
    expect(checkboxFor('Diagram PNG').checked).toBe(true)
    expect(checkboxFor('Markdown pack').checked).toBe(true)

    fireEvent.click(checkboxFor('Steps CSV'))
    fireEvent.click(checkboxFor('Gaps CSV'))

    expect(checkboxFor('Steps CSV').checked).toBe(true)
    expect(checkboxFor('Gaps CSV').checked).toBe(true)
  })

  it('writes every selected file in one pass and reports them on completion', async () => {
    setup()
    fireEvent.click(checkboxFor('Steps CSV'))
    fireEvent.click(exportButton())

    await waitFor(() => expect(saveFilePack).toHaveBeenCalledTimes(1))

    const written = saveFilePack.mock.calls[0][0].files.map((file: { name: string }) => file.name)
    expect(written).toEqual([
      expect.stringMatching(/_diagram_.*\.png$/),
      expect.stringMatching(/_process_doc_.*\.md$/),
      expect.stringMatching(/_steps_.*\.csv$/),
    ])

    // Success message: the file list and where it landed, in the modal itself.
    expect(await screen.findByText('Exported 3 files')).toBeInTheDocument()
    expect(screen.getByText('/tmp/exports')).toBeInTheDocument()
    for (const name of written) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('shows determinate progress while the export runs', async () => {
    let releaseRender: (value: unknown) => void = () => {}
    renderDiagramImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRender = resolve
        })
    )

    setup()
    fireEvent.click(exportButton())

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Rendering diagram PNG/)
    expect(status).toHaveTextContent(/0 of 2/)
    // The export button is held while it runs, so a second run cannot overlap.
    expect(exportButton()).toBeDisabled()

    releaseRender({ dataUrl: 'data:image/png;base64,QUJD', width: 10, height: 10, clamped: false })
    await waitFor(() => expect(saveFilePack).toHaveBeenCalled())
  })

  it('uses the save dialog rather than the folder picker for a single file', async () => {
    setup()
    fireEvent.click(checkboxFor('Diagram PNG'))
    fireEvent.click(checkboxFor('Markdown pack'))
    fireEvent.click(checkboxFor('Gaps CSV'))

    fireEvent.click(exportButton())

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(saveFilePack).not.toHaveBeenCalled()
    expect(saveFile.mock.calls[0][0].defaultName).toMatch(/_gaps_.*\.csv$/)
    expect(renderDiagramImage).not.toHaveBeenCalled()
  })

  it('renders the diagram once when the PNG and the pack share an image', async () => {
    setup()
    fireEvent.click(exportButton())

    await waitFor(() => expect(saveFilePack).toHaveBeenCalled())
    expect(renderDiagramImage).toHaveBeenCalledTimes(1)
    expect(saveFilePack.mock.calls[0][0].files).toHaveLength(2)
  })

  it('renders twice and writes both images when the PNG is transparent', async () => {
    setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /White background/ }))
    fireEvent.click(exportButton())

    await waitFor(() => expect(saveFilePack).toHaveBeenCalled())
    expect(renderDiagramImage).toHaveBeenCalledTimes(2)

    const written = saveFilePack.mock.calls[0][0].files.map((file: { name: string }) => file.name)
    expect(new Set(written).size).toBe(3)
    expect(written).toContainEqual(expect.stringMatching(/_process_doc_diagram_.*\.png$/))
  })

  it('names the Diagram tab when opened without a generated diagram (#327)', () => {
    setup({
      hasDiagram: false,
      diagramUnavailableHint: 'Open the Diagram tab and generate the diagram first',
    })

    expect(
      screen.getAllByText('Open the Diagram tab and generate the diagram first').length
    ).toBeGreaterThan(0)
  })

  it('disables the diagram formats until a diagram has been generated', () => {
    setup({ hasDiagram: false })

    expect(checkboxFor('Diagram PNG')).toBeDisabled()
    expect(checkboxFor('Markdown pack')).toBeDisabled()
    // Built from step data, so it stays available before Generate (#151).
    expect(checkboxFor('Diagram Mermaid')).not.toBeDisabled()
    expect(checkboxFor('Steps CSV')).not.toBeDisabled()
    // Nothing selectable is selected, so Export has nothing to do.
    expect(exportButton()).toBeDisabled()
  })

  it('exports the CSV registers with no diagram generated', async () => {
    setup({ hasDiagram: false })

    fireEvent.click(checkboxFor('Gaps CSV'))
    fireEvent.click(exportButton())

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(saveFile.mock.calls[0][0].defaultName).toMatch(/_gaps_.*\.csv$/)
    expect(renderDiagramImage).not.toHaveBeenCalled()
  })

  it('exports the Mermaid flowchart with no diagram generated (#151)', async () => {
    setup({ hasDiagram: false })

    fireEvent.click(checkboxFor('Diagram Mermaid'))
    fireEvent.click(exportButton())

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(saveFile.mock.calls[0][0].defaultName).toMatch(/_diagram_.*\.mmd$/)
    expect(new TextDecoder().decode(saveFile.mock.calls[0][0].contents)).toContain('flowchart LR')
    expect(renderDiagramImage).not.toHaveBeenCalled()
  })

  it('names the reduced size when the render was clamped', async () => {
    renderDiagramImage.mockResolvedValue({
      dataUrl: 'data:image/png;base64,QUJD',
      width: 16384,
      height: 5040,
      clamped: true,
    })
    setup()

    fireEvent.click(exportButton())

    expect(await screen.findByText(/16384x5040/)).toBeInTheDocument()
  })

  it('says the project is still loading rather than exporting nothing', async () => {
    setup({ project: null })

    fireEvent.click(exportButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/still loading/)
    expect(saveFilePack).not.toHaveBeenCalled()
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('reports a failed render instead of closing silently', async () => {
    renderDiagramImage.mockRejectedValue(new Error('Diagram is empty'))
    setup()

    fireEvent.click(exportButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Diagram is empty')
    expect(saveFilePack).not.toHaveBeenCalled()
  })

  it('abandons the write when the user switches project mid-render', async () => {
    let releaseRender: (value: unknown) => void = () => {}
    renderDiagramImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRender = resolve
        })
    )

    beginProjectScope('p1')
    setup()
    fireEvent.click(exportButton())
    await screen.findByRole('status')

    // The workspace moves on while the capture is still in flight.
    beginProjectScope('p2')
    releaseRender({ dataUrl: 'data:image/png;base64,QUJD', width: 10, height: 10, clamped: false })

    await waitFor(() => expect(exportButton()).not.toBeDisabled())
    expect(saveFilePack).not.toHaveBeenCalled()
    expect(saveFile).not.toHaveBeenCalled()
    expect(screen.queryByText(/^Exported /)).not.toBeInTheDocument()
  })

  it('treats a dismissed save dialog as a cancellation, not a failure', async () => {
    saveFilePack.mockResolvedValue(null)
    setup()

    fireEvent.click(exportButton())

    await waitFor(() => expect(saveFilePack).toHaveBeenCalled())
    await waitFor(() => expect(exportButton()).not.toBeDisabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Exported /)).not.toBeInTheDocument()
  })
})
