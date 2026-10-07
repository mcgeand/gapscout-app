/**
 * The display half of #299, swept in one pass (#345).
 *
 * `steps."order"` numbers a step inside its milestone, so in any project with a
 * second milestone the stored value names a row the reader cannot find: four
 * different steps all print "Step 1". The grid's `#` column has shown a running
 * process position since #333; these are the surfaces that had not caught up.
 *
 * The fixture is deliberately the smallest one that can tell the two scales
 * apart — two milestones, each numbering its steps from 1 — because a
 * single-milestone project makes the bug invisible. Where a number appears more
 * than once on a screen the assertion counts the occurrences rather than merely
 * finding one: the failure mode this sweep is guarding against is a converted
 * site sitting above an unconverted sibling, which a presence check passes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useStepsStore } from '../state/stepsStore'
import { useGapsStore, defaultFilters } from '../state/gapsStore'
import { useTeamsStore } from '../state/teamsStore'
import type { Gap, Milestone, Step } from '../data/types'

// The barrel both surfaces reach for GapForm. Mocking it keeps the modal out of
// the way; GapsPanel is imported by path, so it is the real component.
vi.mock('../components/Gaps', () => ({
  GapForm: () => null,
  GapFilters: () => null,
  GapsPanel: () => null,
}))

import RightPanel from '../app/layout/RightPanel'
import GapsPanel from '../components/Gaps/GapsPanel'

const milestone = (id: string, name: string, order: number): Milestone => ({
  id,
  projectId: 'project-1',
  name,
  order,
  relatedPolicies: [],
  createdAt: 1,
  updatedAt: 1,
})

const step = (id: string, label: string, milestoneId: string, order: number): Step => ({
  id,
  projectId: 'project-1',
  label,
  teamId: 'team-1',
  milestoneId,
  order,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 1,
  updatedAt: 1,
})

const MILESTONES = [milestone('m-intake', 'Intake', 0), milestone('m-approve', 'Approval', 1)]

// Both milestones start at order 1, so the stored value cannot distinguish
// "Log request" from "Senior Manager Approval" — the pair the 09-03 QA run hit.
const STEPS = [
  step('s-log', 'Log request', 'm-intake', 1),
  step('s-triage', 'Triage request', 'm-intake', 2),
  step('s-approve', 'Senior Manager Approval', 'm-approve', 1),
  step('s-notify', 'Notify requester', 'm-approve', 2),
]

const gapOnApproval: Gap = {
  id: 'gap-approval',
  projectId: 'project-1',
  stepId: 's-approve',
  observed: 'No approval threshold recorded',
  expected: 'Threshold recorded',
  severity: 'M',
  status: 'Open',
  links: [],
  createdAt: 1,
  updatedAt: 1,
}

const seedStores = (gaps: Gap[]) => {
  useStepsStore.setState({ steps: STEPS, milestones: MILESTONES })
  useTeamsStore.setState({ teams: [] })
  useGapsStore.setState({
    gaps,
    currentProjectId: 'project-1',
    isLoading: false,
    filters: defaultFilters,
    loadGaps: vi.fn(),
  })
}

describe('the gap drawer names the position the grid shows', () => {
  beforeEach(() => {
    seedStores([gapOnApproval])
    useStepsStore.setState({ currentStep: STEPS[2] })
  })

  it('heads the drawer with the running position, not the stored order', () => {
    render(<RightPanel />)

    // "Senior Manager Approval" is stored as order 1 in its milestone and sits
    // third in the process.
    expect(screen.getByText('Step 3: Senior Manager Approval')).toBeInTheDocument()
    expect(screen.queryByText('Step 1: Senior Manager Approval')).not.toBeInTheDocument()
  })
})

describe('the gaps table names the position the grid shows', () => {
  it('labels a step gap by its running position', () => {
    seedStores([gapOnApproval])

    render(<GapsPanel projectId="project-1" />)

    expect(screen.getByText('Step 3: Senior Manager Approval')).toBeInTheDocument()
    expect(screen.queryByText('Step 1: Senior Manager Approval')).not.toBeInTheDocument()
  })

  it('labels a process gap by its running position', () => {
    // Stored order 3 in the second milestone. It ranks alongside nothing at that
    // order, so it lands fifth in the process — a number the stored value gives
    // no way to reach.
    const processGap: Gap = {
      ...gapOnApproval,
      id: 'gap-process',
      stepId: undefined,
      order: 3,
      milestoneId: 'm-approve',
      observed: 'Nobody owns the handover',
    }
    seedStores([processGap])

    render(<GapsPanel projectId="project-1" />)

    expect(screen.getByText('Order 5: Nobody owns the handover')).toBeInTheDocument()
    expect(screen.queryByText('Order 3: Nobody owns the handover')).not.toBeInTheDocument()
  })
})

describe('the gaps table sorts by the position the grid shows', () => {
  // A step gap in the second milestone, a step gap in the first, and a process
  // gap between them. The stored numbers run 1, 2, 3 in that order; the process
  // positions run 4, 2, 3 — so the two scales disagree about which row is first
  // as well as what it is called.
  const gapOnTriage: Gap = {
    ...gapOnApproval,
    id: 'gap-triage',
    stepId: 's-triage',
    observed: 'Triage has no SLA',
  }

  const gapBetween: Gap = {
    ...gapOnApproval,
    id: 'gap-between',
    stepId: undefined,
    order: 3,
    milestoneId: 'm-intake',
    observed: 'Nobody owns the handover',
  }

  it('orders the rows by process position, not by the stored order', () => {
    seedStores([gapOnApproval, gapOnTriage, gapBetween])
    // Set the sort outright rather than clicking to it from whatever the store
    // happens to default to: the header toggles direction, so a test added
    // above this one that seeds `step` would silently turn this into `desc` and
    // fail for a reason that has nothing to do with the numbering.
    useGapsStore.setState({ sort: { column: 'step', direction: 'asc' } })

    render(<GapsPanel projectId="project-1" />)

    // Sorting on the stored value ranked "Senior Manager Approval" (order 1 in
    // the second milestone) ahead of "Triage request" (order 2 in the first),
    // so the column read 4, 2, 3 top to bottom.
    const rows = screen
      .getAllByTestId(/^gap-row-/)
      .map((row) => row.querySelector('p')?.textContent)

    expect(rows).toEqual([
      'Step 2: Triage request',
      'Order 3: Nobody owns the handover',
      'Step 4: Senior Manager Approval',
    ])
  })
})
