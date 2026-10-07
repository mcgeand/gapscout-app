import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SearchBar from '../components/shared/SearchBar'

const navigateMock = vi.fn()
const selectStepMock = vi.fn(async () => {})
const selectGapMock = vi.fn(async () => {})
const searchMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('../services/searchService', () => ({
  search: (...args: unknown[]) => searchMock(...args),
}))

vi.mock('../state/stepsStore', () => ({
  useStepsStore: { getState: () => ({ selectStep: selectStepMock }) },
}))

vi.mock('../state/gapsStore', () => ({
  useGapsStore: { getState: () => ({ selectGap: selectGapMock }) },
}))

function renderWithProject(projectId: string | null) {
  const initialEntries = projectId ? [`/projects/${projectId}`] : ['/projects']
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/projects/:projectId" element={<SearchBar />} />
        <Route path="/projects" element={<SearchBar />} />
      </Routes>
    </MemoryRouter>
  )
}

// Real timers + waitFor with a generous timeout absorbs the 300ms debounce.
const WAIT_TIMEOUT = 2000

describe('SearchBar (ZIP-106)', () => {
  beforeEach(() => {
    cleanup()
    navigateMock.mockReset()
    selectStepMock.mockClear()
    selectGapMock.mockClear()
    searchMock.mockReset()
  })

  it('disables the input when no project is open', () => {
    renderWithProject(null)
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toMatch(/open a project/i)
  })

  it('enables the input when a project is open', () => {
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    expect(input.disabled).toBe(false)
    // #208 moved the shortcut out of the placeholder and onto a visible key
    // hint, so it survives typing instead of vanishing with the first keystroke.
    expect(screen.getByText('⌘F')).toBeInTheDocument()
  })

  it('Cmd+F focuses the input when a project is open', () => {
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(document.activeElement).toBe(input)
  })

  it('Cmd+F does nothing when no project is open', () => {
    renderWithProject(null)
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(document.activeElement).not.toBe(input)
  })

  it('renders grouped results after debounced search', async () => {
    searchMock.mockResolvedValue([
      { entityType: 'step', entityId: 's1', projectId: 'proj-1', content: 'Receive PO', rank: -1.5 },
      { entityType: 'step', entityId: 's2', projectId: 'proj-1', content: 'Approve PO', rank: -1.2 },
      { entityType: 'gap', entityId: 'g1', projectId: 'proj-1', content: 'PO not approved within SLA', rank: -1.0 },
    ])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'PO' } })
    await waitFor(
      () => expect(searchMock).toHaveBeenCalledWith('PO', 'proj-1'),
      { timeout: WAIT_TIMEOUT }
    )
    await waitFor(() => {
      expect(screen.getByText('Steps')).toBeInTheDocument()
      expect(screen.getByText('Gaps')).toBeInTheDocument()
      expect(screen.getByText('Receive PO')).toBeInTheDocument()
      expect(screen.getByText('PO not approved within SLA')).toBeInTheDocument()
    })
  })

  it('Escape closes the dropdown', async () => {
    searchMock.mockResolvedValue([
      { entityType: 'step', entityId: 's1', projectId: 'proj-1', content: 'Receive PO', rank: -1.5 },
    ])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'PO' } })
    await waitFor(() => expect(screen.getByText('Receive PO')).toBeInTheDocument(), {
      timeout: WAIT_TIMEOUT,
    })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByText('Receive PO')).not.toBeInTheDocument()
  })

  it('clicking a step result calls selectStep and stays on the same project', async () => {
    searchMock.mockResolvedValue([
      { entityType: 'step', entityId: 's42', projectId: 'proj-1', content: 'Receive PO', rank: -1.5 },
    ])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'PO' } })
    await waitFor(() => expect(screen.getByText('Receive PO')).toBeInTheDocument(), {
      timeout: WAIT_TIMEOUT,
    })
    fireEvent.click(screen.getByText('Receive PO'))
    await waitFor(() => expect(selectStepMock).toHaveBeenCalledWith('s42'))
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('filters out cross-project results from the dropdown (stale-project race guard)', async () => {
    // Race condition: if the debounced search captured an old projectId
    // (because the user navigated mid-typing), its results would arrive with
    // the wrong projectId. The dropdown filters on the current projectId so
    // those stale results never display.
    searchMock.mockResolvedValue([
      { entityType: 'step', entityId: 's99', projectId: 'proj-2', content: 'Step in other project', rank: -1.5 },
    ])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'other' } })
    await waitFor(() => expect(searchMock).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT })
    await waitFor(() => expect(screen.getByText(/No results for/)).toBeInTheDocument())
    expect(screen.queryByText('Step in other project')).not.toBeInTheDocument()
  })

  it('clicking a gap result calls selectGap', async () => {
    searchMock.mockResolvedValue([
      { entityType: 'gap', entityId: 'g7', projectId: 'proj-1', content: 'Missing approval', rank: -1.0 },
    ])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'approval' } })
    await waitFor(() => expect(screen.getByText('Missing approval')).toBeInTheDocument(), {
      timeout: WAIT_TIMEOUT,
    })
    fireEvent.click(screen.getByText('Missing approval'))
    await waitFor(() => expect(selectGapMock).toHaveBeenCalledWith('g7'))
  })

  it('gives every result label a title so a CSS-truncated one is readable (#264)', async () => {
    // The row keeps its single-line ellipsis by design; `title` is the only way
    // to read a label the dropdown width cuts off.
    const content = 'Procure to Pay End to End Current State Process Map v3 Draft'
    searchMock.mockResolvedValue([
      { entityType: 'step', entityId: 's1', projectId: 'proj-1', content, rank: -1.5 },
    ])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Procure' } })
    await waitFor(() => expect(screen.getByText(content)).toBeInTheDocument(), {
      timeout: WAIT_TIMEOUT,
    })
    expect(screen.getByText(content)).toHaveAttribute('title', content)
  })

  it('titles the row with the untruncated content, not the ellipsised label (#264)', async () => {
    // `formatLabel` cuts at 80 characters and `formatSnippet` drops a remainder
    // under 20, so for content of 81-99 characters the tail renders nowhere.
    // Titling the row with `label` would leave it unreadable, which is the bug.
    const content = `${'Approve the purchase order raised by the requesting cost centre owner'.padEnd(85, ' x')}`
    expect(content.length).toBeGreaterThan(80)
    expect(content.length).toBeLessThan(100)
    searchMock.mockResolvedValue([
      { entityType: 'step', entityId: 's1', projectId: 'proj-1', content, rank: -1.5 },
    ])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Approve' } })
    const label = await screen.findByText(/^Approve the purchase order/, {}, { timeout: WAIT_TIMEOUT })
    expect(label.textContent).not.toBe(content)
    expect(label).toHaveAttribute('title', content.trim())
  })

  it('shows empty state when search returns no results', async () => {
    searchMock.mockResolvedValue([])
    renderWithProject('proj-1')
    const input = screen.getByLabelText('Global search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'nonexistent' } })
    await waitFor(() => expect(searchMock).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT })
    await waitFor(() => expect(screen.getByText(/No results for/)).toBeInTheDocument())
  })
})
