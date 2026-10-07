/**
 * #218: the right-click menu is four flat rows — the artboard's "Insert a step
 * after" waits on a diagram-side create path — and its shortcut hints are wired
 * rather than drawn. #155 adds a fifth, "Paste N steps after", which appears
 * only while the in-app clipboard holds steps.
 *
 * The keyboard assertions fire at `document` on purpose — that is where the menu
 * listens while it is open, which is what makes ⏎ / ⌘C / ⌘V / ⌫ honest without
 * the pointer ever touching a row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import NodeContextMenu from '../components/Diagram/NodeContextMenu'
import { useDiagramClipboard, type StepClipboard } from '../state/diagramClipboard'
import type { Step } from '../data/types'

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('react-hot-toast', () => ({ default: toast }))

const step: Step = {
  id: 'step-a',
  projectId: 'project-1',
  label: 'Raise purchase requisition',
  teamId: 'team-ops',
  milestoneId: 'milestone-1',
  order: 1,
  suppliers: ['Requester'],
  inputs: ['Need'],
  outputs: ['Requisition'],
  customers: ['Finance'],
  systems: ['SAP'],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 1,
  updatedAt: 1,
}

const writeText = vi.fn<(text: string) => Promise<void>>()

const otherStep = (id: string, label: string): Step => ({ ...step, id, label })

/** The envelope as `copy` writes it, built by hand so the test owns its shape. */
const envelope = (ids: string[]): StepClipboard => ({
  kind: 'gapscout/steps',
  version: 1,
  sourceProjectId: 'project-1',
  steps: ids.map(id => ({
    id,
    label: id,
    teamId: 'team-ops',
    milestoneId: 'milestone-1',
    suppliers: [],
    inputs: [],
    outputs: [],
    customers: [],
    systems: [],
  })),
})

function renderMenu(overrides: Partial<Parameters<typeof NodeContextMenu>[0]> = {}) {
  const props = {
    step,
    position: { x: 120, y: 80 },
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAddGap: vi.fn(),
    ...overrides,
  }
  const result = render(<NodeContextMenu {...props} />)
  return { ...result, props }
}

beforeEach(() => {
  vi.clearAllMocks()
  useDiagramClipboard.setState({ clipboard: null })
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
})

afterEach(cleanup)

describe('NodeContextMenu — artboard 7b', () => {
  it('draws four rows in order when the buffer is empty, with their shortcut hints', () => {
    renderMenu()

    const menu = screen.getByRole('menu', { name: 'Step actions' })
    const items = screen.getAllByRole('menuitem')
    expect(menu).toBeInTheDocument()
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent(/^Edit step/)
    expect(items[1]).toHaveTextContent(/^Add a gap here$/)
    expect(items[2]).toHaveTextContent(/^Copy as JSON/)
    expect(items[3]).toHaveTextContent(/^Delete step/)

    expect(screen.getByText('⏎')).toBeInTheDocument()
    expect(screen.getByText('⌘C')).toBeInTheDocument()
    expect(screen.getByText('⌫')).toBeInTheDocument()
    expect(screen.queryByText('⌘V')).not.toBeInTheDocument()
  })

  it('draws a fifth paste row between Copy and the separator when the buffer holds steps', () => {
    useDiagramClipboard.setState({ clipboard: envelope(['step-b', 'step-c']) })
    renderMenu()

    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(5)
    expect(items[2]).toHaveTextContent(/^Copy as JSON/)
    expect(items[3]).toHaveTextContent(/^Paste 2 steps after/)
    expect(items[4]).toHaveTextContent(/^Delete step/)
    expect(screen.getByText('⌘V')).toBeInTheDocument()
    expect(items[3]).toHaveAttribute('aria-keyshortcuts', 'Meta+V Control+V')
  })

  it('counts one copied step in the singular', () => {
    useDiagramClipboard.setState({ clipboard: envelope(['step-b']) })
    renderMenu()

    expect(screen.getAllByRole('menuitem')[3]).toHaveTextContent(/^Paste 1 step after/)
  })

  it('pastes after this step on Cmd+V, then closes', () => {
    useDiagramClipboard.setState({ clipboard: envelope(['step-b']) })
    const { props } = renderMenu({ onPaste: vi.fn() })

    fireEvent.keyDown(document, { key: 'v', metaKey: true })

    expect(props.onPaste).toHaveBeenCalledWith(step)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('ignores Cmd+V while the buffer is empty, rather than closing on nothing', () => {
    const { props } = renderMenu({ onPaste: vi.fn() })

    fireEvent.keyDown(document, { key: 'v', metaKey: true })

    expect(props.onPaste).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('gives Delete the accent as text and leaves the other rows ink', () => {
    renderMenu()
    const items = screen.getAllByRole('menuitem')

    expect(items[3].className).toContain('text-gs-accent-ink')
    expect(items[0].className).toContain('text-gs-ink')
    // The accent bar is the hover/focus mark, and it is a border, not a hue swap.
    expect(items[0].className).toContain('border-gs-accent')
    expect(items[0].className).toContain('bg-gs-sunken')
  })

  it('focuses the first row on open so ⏎ has somewhere to land', () => {
    renderMenu()
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus()
  })

  it('runs Edit on Enter', () => {
    const { props } = renderMenu()

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(props.onEdit).toHaveBeenCalledWith(step)
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('runs Delete on Backspace', () => {
    const { props } = renderMenu()

    fireEvent.keyDown(document, { key: 'Backspace' })

    expect(props.onDelete).toHaveBeenCalledWith(step)
    expect(props.onEdit).not.toHaveBeenCalled()
  })

  it('opts out of React Flow\'s own Backspace handler with the nokey class', () => {
    renderMenu()

    // @reactflow/core deletes the selected node on Backspace unless the event
    // target is inside `.nokey`; without this the menu's ⌫ and the canvas race.
    expect(screen.getByRole('menu', { name: 'Step actions' })).toHaveClass('nokey')
  })

  it('copies the envelope on Cmd+C and touches nothing else', async () => {
    const { props } = renderMenu()

    fireEvent.keyDown(document, { key: 'c', metaKey: true })

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const written = JSON.parse(writeText.mock.calls[0][0])
    expect(written).toMatchObject({ kind: 'gapscout/steps', version: 1, sourceProjectId: 'project-1' })
    expect(written.steps).toHaveLength(1)
    expect(written.steps[0]).toMatchObject({ id: 'step-a', label: 'Raise purchase requisition' })
    expect(toast.success).toHaveBeenCalledWith('Step copied as JSON')
    expect(props.onEdit).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(props.onAddGap).not.toHaveBeenCalled()
  })

  it('copies the whole selection, in the order it was given, and counts it', async () => {
    const selectedSteps = [step, otherStep('step-b', 'Approve'), otherStep('step-c', 'Raise PO')]
    renderMenu({ selectedSteps })

    expect(screen.getAllByRole('menuitem')[2]).toHaveTextContent(/^Copy 3 steps as JSON/)
    fireEvent.keyDown(document, { key: 'c', metaKey: true })

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const written = JSON.parse(writeText.mock.calls[0][0])
    expect(written.kind).toBe('gapscout/steps')
    expect(written.version).toBe(1)
    expect(written.steps).toHaveLength(3)
    expect(written.steps.map((one: { id: string }) => one.id)).toEqual([
      'step-a',
      'step-b',
      'step-c',
    ])
    expect(toast.success).toHaveBeenCalledWith('Copied 3 steps as JSON')
    // The buffer is what paste reads, so it carries the selection too.
    expect(useDiagramClipboard.getState().clipboard?.steps.map(one => one.id)).toEqual([
      'step-a',
      'step-b',
      'step-c',
    ])
  })

  it('still reports a copy when the OS clipboard refuses, because the buffer took it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeText.mockRejectedValue(new Error('not allowed'))
    renderMenu()

    fireEvent.keyDown(document, { key: 'c', metaKey: true })

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Step copied as JSON'))
    expect(toast.error).not.toHaveBeenCalled()
    expect(useDiagramClipboard.getState().clipboard?.steps[0].id).toBe('step-a')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('walks the rows with ArrowDown', () => {
    renderMenu()
    const items = screen.getAllByRole('menuitem')

    fireEvent.keyDown(document, { key: 'ArrowDown' })

    expect(items[1]).toHaveFocus()
  })

  it('closes on Escape', () => {
    const { props } = renderMenu()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalled()
  })

  it('closes on Tab, because focus leaving a menu closes it', () => {
    const { props } = renderMenu()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(props.onClose).toHaveBeenCalled()
    expect(props.onEdit).not.toHaveBeenCalled()
  })

  it('draws no emoji and no icon in the rows', () => {
    const { container } = renderMenu()

    // Same call the node ink test makes: the menu is words, not pictures.
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(container.querySelectorAll('[role="menuitem"] svg')).toHaveLength(0)
  })
})
