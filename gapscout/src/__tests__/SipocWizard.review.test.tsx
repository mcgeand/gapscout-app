/**
 * The Review step, which is the whole point of #220.
 *
 * Everything the parser used to decide in silence is a control here, and none of
 * it reaches SQLite until the button at the bottom is pressed. The wizard is
 * given a preview and hands back a plan; `ProcessBoard` owns both ends, so these
 * tests assert what the user can do to the plan and what comes out the other
 * side.
 */

import { describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Team } from '../data/types'

const teamsStore = vi.hoisted(() => vi.fn())
const systemsStore = vi.hoisted(() => vi.fn())

vi.mock('../state/teamsStore', () => ({ useTeamsStore: teamsStore }))
vi.mock('../state/systemsStore', () => ({ useSystemsStore: systemsStore }))

import SipocWizard, {
  type SipocConfirmPlan,
  type SipocPreview,
  type SipocSaveResult,
} from '../components/Sipoc/SipocWizard'

const OPERATIONS: Team = {
  id: 't-ops',
  projectId: 'p-1',
  name: 'Operations',
  color: '#6B7280',
  order: 1,
  tags: [],
  createdAt: 1,
}

const PROCUREMENT: Team = { ...OPERATIONS, id: 't-proc', name: 'Procurement', order: 2 }

const PLAN: SipocPreview = {
  kind: 'plan',
  rows: [
    {
      id: 'row-1',
      label: 'Reviews the coding',
      teamId: 't-proc',
      suppliers: ['Requester'],
      inputs: ['Business need'],
      outputs: [],
      customers: [],
    },
    {
      id: 'row-2',
      label: 'Approves the spend',
      ownerHint: 'budget holder',
      source: 'The budget holder approves the spend',
      suppliers: [],
      inputs: [],
      outputs: ['Approved requisition'],
      customers: ['Finance'],
    },
  ],
  gaps: [{ description: 'Step 2 ("Approves the spend") has no team assigned', stepIndex: 1 }],
  unparsed: ['Everything is logged in the shared drive'],
  warnings: [],
  teams: [OPERATIONS, PROCUREMENT],
  milestoneName: 'Main Flow',
  appendAfterPosition: 1,
}

function renderWizard(
  overrides: {
    preview?: SipocPreview
    onPreview?: Mock
    onConfirm?: Mock
    onClose?: Mock
  } = {}
) {
  teamsStore.mockReturnValue({ teams: [OPERATIONS, PROCUREMENT] })
  systemsStore.mockReturnValue({ systems: [] })

  const onPreview: Mock =
    overrides.onPreview ?? vi.fn().mockResolvedValue(overrides.preview ?? PLAN)
  const onConfirm: Mock = overrides.onConfirm ?? vi.fn().mockResolvedValue(null)
  const onClose: Mock = overrides.onClose ?? vi.fn()

  const view = render(
    <SipocWizard
      isOpen
      onClose={onClose}
      projectName="Purchase-to-Pay"
      existingWork={{ steps: 0, gaps: 0 }}
      onPreview={onPreview}
      onConfirm={onConfirm}
      onOpenDiscovery={vi.fn()}
      onOpenDiagram={vi.fn()}
    />
  )

  return { ...view, onPreview, onConfirm, onClose }
}

async function reachReview(description = 'Procurement reviews the coding.') {
  const handles = renderWizard()
  fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
    target: { value: description },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Review / }))
  await screen.findByRole('columnheader', { name: 'Step label' })
  return handles
}

/** The label cells, in the order the table currently shows them. */
function labelsInOrder() {
  return screen
    .getAllByRole('textbox', { name: /^Step \d+ label$/ })
    .map(input => (input as HTMLInputElement).value)
}

describe('SIPOC wizard — Capture', () => {
  it('reads the description as it is typed, before anything is submitted', () => {
    renderWizard()

    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding. Finance sends the payment.' },
    })

    expect(screen.getByText(/2 sentences · 2 steps detected/)).toBeInTheDocument()
    expect(screen.getByText('Reviews the coding')).toBeInTheDocument()
    expect(screen.getByText('Sends the payment')).toBeInTheDocument()
  })

  it('names an owner it matched and says when it has none', () => {
    renderWizard()

    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding. The budget holder approves the spend.' },
    })

    expect(screen.getByText('01 · PROCUREMENT')).toBeInTheDocument()
    expect(screen.getByText('02 · NO OWNER')).toBeInTheDocument()
  })

  it('agrees with itself about one step', () => {
    // Only visible by running the app: every other count in the wizard picks a
    // singular, and this one said "Review 1 steps".
    renderWizard()

    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding.' },
    })

    expect(screen.getByRole('button', { name: 'Review 1 step' })).toBeInTheDocument()
    expect(screen.getByText(/1 sentence · 1 step detected/)).toBeInTheDocument()
  })

  it('agrees with itself about one gap on the landing panel', async () => {
    // The same defect, the other end of the flow: "1 GAPS OPENED".
    const onConfirm = vi.fn().mockResolvedValue({
      stepsCreated: 1,
      gapsCreated: 1,
      teamsCreated: 1,
      firstPosition: 1,
      lastPosition: 1,
      milestoneName: 'Main Flow',
      needsDetail: 1,
      summaryOnly: false,
    } satisfies SipocSaveResult)
    renderWizard({ onConfirm })

    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Review / }))
    await screen.findByRole('columnheader', { name: 'Step label' })
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 steps' }))

    expect(await screen.findByText('gap opened')).toBeInTheDocument()
    expect(screen.getByText('step created')).toBeInTheDocument()
    expect(screen.getByText('team created')).toBeInTheDocument()
    expect(screen.getByText('needs SIPOC detail')).toBeInTheDocument()
  })

  it('counts what is unresolved instead of opening a dialog over the dialog', () => {
    renderWizard()

    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding.' },
    })

    // Suppliers, inputs, outputs and customers are all empty here.
    expect(screen.getByText('4 TO RESOLVE')).toBeInTheDocument()
    expect(screen.getByText(/no customers yet/)).toBeInTheDocument()
  })
})

describe('SIPOC wizard — Review', () => {
  it('renders the parsed steps before anything is written', async () => {
    await reachReview()

    expect(labelsInOrder()).toEqual(['Reviews the coding', 'Approves the spend'])
    expect(screen.getByText('steps to create')).toBeInTheDocument()
  })

  it('offers to create the team an unmatched owner named, quoting the sentence', async () => {
    const { onConfirm } = await reachReview()

    expect(
      screen.getByText(/From “The budget holder approves the spend” —/)
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create it as a team' }))
    expect(screen.getByText('Budget Holder will be created.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create 2 steps' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const plan = onConfirm.mock.calls[0][0] as SipocConfirmPlan
    expect(plan.rows[1].newTeamName).toBe('Budget Holder')
    expect(plan.rows[1].teamId).toBeUndefined()
  })

  it('maps an unmatched owner onto a team that already exists', async () => {
    const { onConfirm } = await reachReview()

    fireEvent.change(screen.getByLabelText('Owner team for step 2'), {
      target: { value: 't-ops' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 steps' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const plan = onConfirm.mock.calls[0][0] as SipocConfirmPlan
    expect(plan.rows[1].teamId).toBe('t-ops')
  })

  it('shows a sentence it could not read as a row that can become a step', async () => {
    const { onConfirm } = await reachReview()

    expect(screen.getByText('NOT PARSED')).toBeInTheDocument()
    expect(
      screen.getByText('“Everything is logged in the shared drive”')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Make it a step' }))

    expect(labelsInOrder()).toEqual([
      'Reviews the coding',
      'Approves the spend',
      'Everything is logged in the shared drive',
    ])
    expect(screen.queryByText('NOT PARSED')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create 3 steps' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const plan = onConfirm.mock.calls[0][0] as SipocConfirmPlan
    expect(plan.rows).toHaveLength(3)
  })

  it('lets an unparsed sentence be ignored without becoming a step', async () => {
    await reachReview()

    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))

    expect(screen.queryByText('NOT PARSED')).not.toBeInTheDocument()
    expect(labelsInOrder()).toHaveLength(2)
  })

  it('adds, edits, removes and reorders rows', async () => {
    const { onConfirm } = await reachReview()

    fireEvent.click(screen.getByRole('button', { name: 'Add a step' }))
    fireEvent.change(screen.getByLabelText('Step 3 label'), {
      target: { value: 'Releases the payment run' },
    })
    expect(labelsInOrder()).toHaveLength(3)

    // Down on the first row, so the order the user leaves is the order saved.
    fireEvent.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Down' }))
    expect(labelsInOrder()).toEqual([
      'Approves the spend',
      'Reviews the coding',
      'Releases the payment run',
    ])

    fireEvent.click(within(screen.getAllByRole('row')[2]).getByRole('button', { name: 'Remove' }))
    expect(labelsInOrder()).toEqual(['Approves the spend', 'Releases the payment run'])

    fireEvent.click(screen.getByRole('button', { name: 'Create 2 steps' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const plan = onConfirm.mock.calls[0][0] as SipocConfirmPlan
    expect(plan.rows.map(row => row.label)).toEqual([
      'Approves the spend',
      'Releases the payment run',
    ])
  })

  it('splits a row into two editable rows', async () => {
    await reachReview()

    fireEvent.click(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Split' }))

    // A crude cut down the middle, because both halves are editable: refusing
    // to cut a row the parser packed two actions into is the worse answer.
    expect(labelsInOrder()).toEqual([
      'Reviews the',
      'coding',
      'Approves the spend',
    ])
  })

  it('previews a gap without creating it, and creates it only when asked', async () => {
    const { onConfirm } = await reachReview()

    const gap = screen.getByLabelText(/Create as an open gap/)
    expect(gap).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Create 2 steps' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect((onConfirm.mock.calls[0][0] as SipocConfirmPlan).gaps[0].create).toBe(false)
  })

  it('carries a ticked gap through with the row it belongs to', async () => {
    const { onConfirm } = await reachReview()

    fireEvent.click(screen.getByLabelText(/Create as an open gap/))
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 steps' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const plan = onConfirm.mock.calls[0][0] as SipocConfirmPlan
    expect(plan.gaps[0]).toMatchObject({ create: true, rowId: 'row-2' })
  })

  it('drops a gap whose step was removed', async () => {
    const { onConfirm } = await reachReview()

    fireEvent.click(screen.getByLabelText(/Create as an open gap/))
    fireEvent.click(within(screen.getAllByRole('row')[2]).getByRole('button', { name: 'Remove' }))

    expect(screen.queryByLabelText(/Create as an open gap/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create 1 step' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect((onConfirm.mock.calls[0][0] as SipocConfirmPlan).gaps).toEqual([])
  })

  it('writes nothing when the wizard is closed at Review', async () => {
    const { onConfirm, onClose } = await reachReview()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the description' }))
    expect(screen.getByLabelText('One sentence per action, in order')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('says the interview will only edit the summary, and offers exactly that', async () => {
    const summaryOnly: SipocPreview = {
      kind: 'summary-only',
      reason: 'existing-rows',
      steps: 20,
      gaps: 0,
    }
    const onConfirm = vi.fn().mockResolvedValue(null)
    renderWizard({ preview: summaryOnly, onConfirm })

    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Review / }))

    expect(await screen.findByText('The process is already mapped')).toBeInTheDocument()
    expect(screen.getByText(/has 20 steps and 0 process gaps already/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save summary' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect((onConfirm.mock.calls[0][0] as SipocConfirmPlan).summaryOnly).toBe(true)
  })

  it('explains a project with no milestone without blaming its creation', async () => {
    renderWizard({
      preview: { kind: 'summary-only', reason: 'no-milestone', steps: 0, gaps: 0 },
    })

    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Review / }))

    const panel = await screen.findByText('This project has no milestone yet')
    expect(panel).toBeInTheDocument()
    expect(screen.getByText(/Add a milestone in Discovery/)).toBeInTheDocument()
    expect(screen.queryByText(/create a project/i)).not.toBeInTheDocument()
  })
})

describe('SIPOC wizard — Landing', () => {
  it('says what changed instead of stacking toasts', async () => {
    const onConfirm = vi.fn().mockResolvedValue({
      stepsCreated: 2,
      gapsCreated: 1,
      teamsCreated: 1,
      firstPosition: 9,
      lastPosition: 10,
      milestoneName: 'Main Flow',
      appendAfterLabel: 'Receipt goods against PO',
      needsDetail: 1,
      summaryOnly: false,
    } satisfies SipocSaveResult)

    renderWizard({ onConfirm })
    fireEvent.change(screen.getByLabelText('One sentence per action, in order'), {
      target: { value: 'Procurement reviews the coding.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Review / }))
    await screen.findByRole('columnheader', { name: 'Step label' })
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 steps' }))

    expect(
      await screen.findByText('2 steps and 1 gap added to Purchase-to-Pay')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Steps 9–10, appended after “Receipt goods against PO”/)
    ).toBeInTheDocument()
    expect(screen.getByText('needs SIPOC detail')).toBeInTheDocument()
    // The four toasts and the silent tab switch are gone; the panel is where the
    // user goes next from.
    expect(screen.getByRole('button', { name: 'Open the Discovery grid' })).toBeInTheDocument()
  })
})
