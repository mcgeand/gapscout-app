/**
 * #345: GapForm names the position its caller is showing.
 *
 * The form opens from the Discovery grid (where a milestone tab deliberately
 * shows the stored per-milestone `order`) and from three project-wide surfaces
 * — the drawer, the gaps table and the diagram — where only the running process
 * position identifies a row. It cannot pick a scale for itself, so the caller
 * hands it `displayNumbers` and every number it prints goes through that map.
 *
 * Mocks db.ts at the module boundary; the real stores and the real form run,
 * same pattern as GapForm.orderConflict.milestone.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../services/db', () => ({
  createGap: vi.fn().mockResolvedValue('gap-new'),
  getGap: vi.fn().mockResolvedValue(null),
  updateGap: vi.fn().mockResolvedValue(undefined),
  updateStep: vi.fn().mockResolvedValue(undefined),
  deleteGap: vi.fn().mockResolvedValue(undefined),
  listGaps: vi.fn().mockResolvedValue([]),
  listGapsByStep: vi.fn().mockResolvedValue([]),
  listSteps: vi.fn().mockResolvedValue([]),
  listTeams: vi.fn().mockResolvedValue([]),
  listMilestones: vi.fn().mockResolvedValue([]),
}))

import GapForm from '../components/Gaps/GapForm'
import { useStepsStore } from '../state/stepsStore'
import { useTeamsStore } from '../state/teamsStore'
import { processPositions } from '../lib/stepSequence'
import type { Gap, Milestone, Step } from '../data/types'

const milestone = (id: string, order: number): Milestone => ({
  id,
  projectId: 'project-1',
  name: id,
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

const MILESTONES = [milestone('m-intake', 0), milestone('m-approve', 1)]
const STEPS = [
  step('s-log', 'Log request', 'm-intake', 1),
  step('s-triage', 'Triage request', 'm-intake', 2),
  step('s-approve', 'Senior Manager Approval', 'm-approve', 1),
]

const processGap: Gap = {
  id: 'gap-process',
  projectId: 'project-1',
  observed: 'Nobody owns the handover',
  expected: 'An owner is named',
  severity: 'M',
  status: 'Open',
  // Sits after the one step in the second milestone, so its stored order (3)
  // and its process position (4) are different numbers.
  order: 3,
  milestoneId: 'm-approve',
  links: [],
  createdAt: 1,
  updatedAt: 1,
}

describe('GapForm process positions (#345)', () => {
  beforeEach(() => {
    useStepsStore.setState({ steps: STEPS, milestones: MILESTONES })
    useTeamsStore.setState({ teams: [] })
  })

  const positions = () => processPositions(STEPS, [processGap], MILESTONES)

  it('names the selected step by its process position', () => {
    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        projectId="project-1"
        mode="create"
        prefilledStepId="s-approve"
        displayNumbers={positions()}
      />
    )

    // Twice: the modal subtitle and the step dropdown's selected option. Both
    // are counted, because the failure this sweep exists to catch is one site
    // converted and its sibling left on the stored order.
    expect(screen.getAllByText('Step 3: Senior Manager Approval')).toHaveLength(2)
    expect(screen.queryByText('Step 1: Senior Manager Approval')).not.toBeInTheDocument()
  })

  it('falls back to the stored order when the caller shows one', () => {
    // A milestone tab passes null: there the `#` column is the stored order and
    // is also its own editor, so the form has to agree with it.
    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        projectId="project-1"
        mode="create"
        prefilledStepId="s-approve"
        displayNumbers={null}
      />
    )

    expect(screen.getAllByText('Step 1: Senior Manager Approval')).toHaveLength(2)
    expect(screen.queryByText('Step 3: Senior Manager Approval')).not.toBeInTheDocument()
  })

  it('gives every step in the dropdown a distinct number, in process order', () => {
    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        projectId="project-1"
        mode="create"
        prefilledStepId={null}
        displayNumbers={positions()}
      />
    )

    const options = screen
      .getAllByRole('option')
      .map((option) => option.textContent)
      .filter((text) => text?.startsWith('Step '))

    // Sorting on the stored `order` alone put "Senior Manager Approval" (order 1)
    // level with "Log request" and ahead of "Triage request".
    expect(options).toEqual([
      'Step 1: Log request',
      'Step 2: Triage request',
      'Step 3: Senior Manager Approval',
    ])
  })

  it('shows the same position everywhere it names a process gap being edited', () => {
    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        projectId="project-1"
        mode="edit"
        gap={processGap}
        displayNumbers={positions()}
      />
    )

    // The subtitle and the blue panel print this string separately, and #333
    // shipped with one converted and the other not — two different numbers
    // stacked two lines apart. Count, do not merely find.
    expect(screen.getAllByText('Process gap at position 4')).toHaveLength(2)
    expect(screen.queryByText('Process gap at position 3')).not.toBeInTheDocument()
  })

  it('cites the same position in the delete confirmation', () => {
    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        projectId="project-1"
        mode="edit"
        gap={processGap}
        displayNumbers={positions()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    // No later rows in m-approve, so the confirm does not promise a shift —
    // it still names the position the grid showed (#357).
    expect(
      screen.getByText('This will permanently delete the gap at position 4.')
    ).toBeInTheDocument()
  })

  it('promises a shift when later rows share the milestone', () => {
    const earlierGap: Gap = {
      ...processGap,
      id: 'gap-early',
      order: 1,
      observed: 'Handover is blank',
    }
    // A step after the gap in the same milestone is what makes the confirm
    // promise a shift; the count comes from live store data, not from order > 0.
    useStepsStore.setState({
      steps: [...STEPS, step('s-after', 'File the pack', 'm-approve', 2)],
      milestones: MILESTONES,
    })

    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        projectId="project-1"
        mode="edit"
        gap={earlierGap}
        displayNumbers={processPositions(
          [...STEPS, step('s-after', 'File the pack', 'm-approve', 2)],
          [earlierGap],
          MILESTONES,
        )}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    expect(
      screen.getByText(
        'This will permanently delete the gap at position 3 and shift later rows down by 1.',
      )
    ).toBeInTheDocument()
  })

  it('cites the position for a gap stored at order 0, and still promises no shift', () => {
    // Order 0 is the slot before the first step of its milestone, and
    // `handleDeleteGap` shifts nothing there — its guard is `gap.order > 0`. So
    // the branch has to stay on the stored value while the number it prints
    // comes from the map: in the second milestone those are 0 and 3.
    const gapBeforeApproval: Gap = {
      ...processGap,
      id: 'gap-zero',
      order: 0,
      observed: 'Nothing hands the request over',
    }

    render(
      <GapForm
        isOpen
        onClose={vi.fn()}
        projectId="project-1"
        mode="edit"
        gap={gapBeforeApproval}
        displayNumbers={processPositions(STEPS, [gapBeforeApproval], MILESTONES)}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    expect(
      screen.getByText('This will permanently delete the gap at position 3.')
    ).toBeInTheDocument()
    // Branching on the printed position instead would read 3, not 0, and
    // promise a renumbering that never happens.
    expect(screen.queryByText(/shift all subsequent rows down by 1/)).not.toBeInTheDocument()
  })
})
