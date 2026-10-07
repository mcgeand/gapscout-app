/**
 * The project card (#213).
 *
 * Every card carried a `badge-orange` reading "Active" and a footer reading
 * "Ready for mapping". Neither reflected anything: they were literal strings
 * rendered identically on every project ever created, so the card looked like
 * it was reporting status while reporting nothing. These tests pin the
 * replacement — counts that differ per project, and a state tag that is absent
 * when nobody has said — and pin the absence of the two strings, because a
 * removal is exactly the kind of change that quietly comes back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProjectSummary } from '../data/types'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}))

const loadProjects = vi.fn(async () => {})
/** Mutable so one test can render the page as a cold start leaves it. */
let isInitialized = true

const PROJECTS: ProjectSummary[] = [
  {
    id: 'proj-current',
    name: 'Order to Cash',
    description: 'How an order becomes money',
    state: 'current',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    stepCount: 12,
    openGapCount: 3,
  },
  {
    id: 'proj-future',
    name: 'Order to Cash, redesigned',
    state: 'future',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    stepCount: 1,
    openGapCount: 1,
  },
  {
    id: 'proj-unset',
    name: 'Legacy map',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    stepCount: 0,
    openGapCount: 0,
  },
  {
    id: 'proj-edited',
    name: 'Claims intake',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_086_400_000,
    stepCount: 4,
    openGapCount: 2,
  },
]

vi.mock('../state/projectStore', () => ({
  useProjectStore: () => ({
    projects: PROJECTS,
    isLoading: false,
    isInitialized,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    loadProjects,
  }),
}))

vi.mock('../state/teamsStore', () => ({ useTeamsStore: () => ({ addTeam: vi.fn() }) }))
vi.mock('../state/systemsStore', () => ({ useSystemsStore: () => ({ addSystem: vi.fn() }) }))
vi.mock('../services/db', () => ({ createMilestone: vi.fn(), resetProjectUpdatedAt: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import ProjectList from '../pages/ProjectList'

const cardFor = (name: string) => screen.getByRole('article', { name })

/**
 * The footer's counts are wrapped in `<strong>`, so the text is split across
 * elements and no single node carries the whole sentence. Read the line.
 */
const footerOf = (name: string) => cardFor(name).querySelector('.proj-foot')?.textContent

/** The eyebrow carries the state tag and then the date, in that order. */
const eyebrowOf = (name: string) => cardFor(name).querySelector('.proj-eyebrow')?.textContent

describe('project card (#213)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    render(<ProjectList />)
  })

  it('says what each project holds, and the numbers differ per project', () => {
    expect(footerOf('Order to Cash')).toBe('12 steps · 3 open gaps')
    expect(footerOf('Legacy map')).toBe('0 steps · 0 open gaps')
  })

  it('says "step" and "open gap" in the singular for a count of one', () => {
    expect(footerOf('Order to Cash, redesigned')).toBe('1 step · 1 open gap')
  })

  it('no longer claims a status it does not have', () => {
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready for mapping')).not.toBeInTheDocument()
  })

  it('draws the state tag a project carries', () => {
    expect(
      cardFor('Order to Cash').querySelector('.project-state')?.className
    ).toContain('project-state-current')
    expect(
      cardFor('Order to Cash, redesigned').querySelector('.project-state')?.className
    ).toContain('project-state-future')
  })

  it('draws no tag for a project nobody has classified', () => {
    // NULL means nobody has said, which is not the same as "current" (#263).
    expect(cardFor('Legacy map').querySelector('.project-state')).toBeNull()
  })

  it('opens the project from a real button, not a click handler on a div', () => {
    // The old card was a `div` with an `onClick`: no tab stop, no Enter, no
    // Space. An empty button stretched over the card carries the click now.
    fireEvent.click(screen.getByRole('button', { name: 'Open Order to Cash' }))

    expect(navigate).toHaveBeenCalledWith('/projects/proj-current')
  })

  it('puts the full name where the pointer can actually reach it', () => {
    // #264's tooltip is on the heading, but the open overlay paints above every
    // static child, so the heading is never hovered. The overlay has to carry
    // the name too or a clipped name is unreadable again.
    expect(screen.getByRole('button', { name: 'Open Order to Cash' })).toHaveAttribute(
      'title',
      'Order to Cash'
    )
  })

  it('says a project was edited when something it owns has been written since (#395)', () => {
    // The prefix only, never the formatted date: `formatDate` falls through to
    // `toLocaleDateString()` past thirty days, and the fixture is years old, so
    // pinning the whole string would pin the runner's locale.
    expect(eyebrowOf('Claims intake')).toMatch(/^Edited /)
    expect(eyebrowOf('Claims intake')).not.toContain('Created')
  })

  it('still says created for a project nobody has touched since', () => {
    // Equal timestamps are what a project looks like the moment it is made.
    // "Edited" there would claim an edit that never happened.
    expect(eyebrowOf('Legacy map')).toMatch(/^Created /)
  })

  it('refreshes the list on mount, so the counts are not last visit’s', () => {
    // Projects are otherwise read once, at App mount — without this, adding
    // steps and coming back here shows the count from before the visit.
    expect(loadProjects).toHaveBeenCalled()
  })
})

describe('project home on a cold start (#213)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('does not read the database before it is open', () => {
    // This page is the landing route, so it mounts while App is still awaiting
    // `initDB()`. `getDB()` throws until that resolves and the store turns the
    // throw into a "Failed to load projects" toast, so an ungated refresh would
    // greet every launch with an error and a flash of "No projects yet".
    isInitialized = false
    render(<ProjectList />)
    expect(loadProjects).not.toHaveBeenCalled()
    isInitialized = true
  })
})

describe('project home chrome (#213)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    render(<ProjectList />)
  })

  it('offers exactly one way to create a project', () => {
    // The grid used to end in a dashed tile whose `text-4xl +` duplicated the
    // header button on a card that was not a project.
    expect(screen.getAllByRole('button', { name: /New Project/ })).toHaveLength(1)
    expect(screen.queryByText('Create New Project')).not.toBeInTheDocument()
  })
})
