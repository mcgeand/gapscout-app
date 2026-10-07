/**
 * #265 — the state control in the two places a project is named.
 *
 * The create wizard always sends a state (`current` unless told otherwise);
 * the edit form must not invent one for a project that predates the field, so
 * an unset project shows nothing selected and saves `undefined`, which the
 * update path reads as "no change" and leaves the column NULL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const UNSET_PROJECT = {
  id: 'proj-unset',
  name: 'Legacy map',
  description: '',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  stepCount: 0,
  openGapCount: 0,
}

const CURRENT_PROJECT = {
  ...UNSET_PROJECT,
  id: 'proj-current',
  name: 'Classified map',
  state: 'current' as const,
}

const createProject = vi.fn(async () => ({ ...UNSET_PROJECT, id: 'new-proj' }))
const updateProject = vi.fn(async () => {})
const loadProjects = vi.fn(async () => {})

const projectState = {
  projects: [UNSET_PROJECT, CURRENT_PROJECT],
  isLoading: false,
  isInitialized: true,
  createProject,
  updateProject,
  loadProjects,
}

vi.mock('../state/projectStore', () => ({
  useProjectStore: (selector?: (state: typeof projectState) => unknown) =>
    selector ? selector(projectState) : projectState,
}))

vi.mock('../state/teamsStore', () => ({
  useTeamsStore: () => ({ addTeam: vi.fn() }),
}))

vi.mock('../state/systemsStore', () => ({
  useSystemsStore: () => ({ addSystem: vi.fn() }),
}))

vi.mock('../services/db', () => ({
  createMilestone: vi.fn(),
}))

import ProjectList from '../pages/ProjectList'

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <ProjectList />
    </MemoryRouter>
  )
}

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

/** The edit button is icon-only and identified by its title attribute. */
function openEditFor(name: string) {
  const card = screen.getByRole('article', { name })
  fireEvent.click(card.querySelector('[title="Edit project"]') as HTMLElement)
}

/** Steps 2 and 3 arrive pre-filled with defaults, so Next carries straight through. */
function advanceToReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

describe('create wizard state control (#265)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to current, and creates the project with it', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /New Project/i }))

    expect(radio('Current')).toBeChecked()
    expect(radio('Future')).not.toBeChecked()

    fireEvent.change(screen.getByPlaceholderText(/Customer Onboarding Process/i), {
      target: { value: 'Order to Cash' },
    })
    advanceToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Order to Cash', state: 'current' }),
        { silent: true }
      )
    )
  })

  it('creates the project as future when future is chosen', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /New Project/i }))

    fireEvent.change(screen.getByPlaceholderText(/Customer Onboarding Process/i), {
      target: { value: 'Target design' },
    })
    fireEvent.click(radio('Future'))
    expect(radio('Future')).toBeChecked()
    expect(radio('Current')).not.toBeChecked()

    advanceToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Target design', state: 'future' }),
        { silent: true }
      )
    )
  })

  it('echoes the chosen state on the review step', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /New Project/i }))

    fireEvent.change(screen.getByPlaceholderText(/Customer Onboarding Process/i), {
      target: { value: 'Target design' },
    })
    fireEvent.click(radio('Future'))
    advanceToReview()

    // Nothing else in the app draws the state yet, so the review step is the
    // only confirmation a user gets before the project is written.
    expect(screen.getByText('Future state')).toBeInTheDocument()
  })
})

describe('edit form state control (#265)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows no option selected for a project nobody has classified', () => {
    renderList()
    openEditFor('Legacy map')

    expect(radio('Current')).not.toBeChecked()
    expect(radio('Future')).not.toBeChecked()
  })

  it('leaves state undefined when the control is not touched', async () => {
    renderList()
    openEditFor('Legacy map')
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateProject).toHaveBeenCalled())
    expect(updateProject).toHaveBeenCalledWith(
      'proj-unset',
      expect.objectContaining({ state: undefined })
    )
  })

  it('preselects the state a project already carries', () => {
    renderList()
    openEditFor('Classified map')

    expect(radio('Current')).toBeChecked()
    expect(radio('Future')).not.toBeChecked()
  })

  it('saves a state the user picks on a previously unset project', async () => {
    renderList()
    openEditFor('Legacy map')
    fireEvent.click(radio('Future'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateProject).toHaveBeenCalled())
    expect(updateProject).toHaveBeenCalledWith(
      'proj-unset',
      expect.objectContaining({ state: 'future' })
    )
  })

  it('exposes the options as a labelled group of native radios', () => {
    renderList()
    openEditFor('Legacy map')

    // jsdom does not implement the browser's own arrow-key navigation within a
    // radio group, so what is asserted is the structure that navigation comes
    // from: real `input[type=radio]`s sharing one `name`, inside a `radiogroup`
    // that has an accessible name. Keyboard reachability itself is checked in
    // the app (see the PR's verification notes).
    const group = screen.getByRole('radiogroup', { name: 'Project state' })
    const radios = Array.from(group.querySelectorAll('input[type="radio"]'))
    expect(radios).toHaveLength(2)
    expect(new Set(radios.map((r) => (r as HTMLInputElement).name)).size).toBe(1)
    // Visually hidden, not removed: `display: none` would take them out of the
    // tab order and the group would stop being reachable at all.
    radios.forEach((r) => expect(r).toHaveClass('sr-only'))
    // Selection and focus are drawn by the `.seg-face` immediately after each
    // input, so the CSS never needs `:has()`. Losing the sibling silently
    // costs the selected option its highlight.
    radios.forEach((r) => expect(r.nextElementSibling).toHaveClass('seg-face'))
  })
})
