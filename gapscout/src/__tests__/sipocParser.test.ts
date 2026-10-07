/**
 * Tests for the SIPOC parser's phrase extraction (#216).
 *
 * Four defects in the path from a typed process description to rows in SQLite:
 * the newline rule was dead code, numbered lists were shredded into stray
 * digits, verb selection ranked by position in `ALL_VERBS` rather than position
 * in the sentence, and the five-step cap discarded work silently.
 *
 * The fifth — a 0-based `order` that disagreed with `sipocValidator` — was
 * fixed by #299. It is covered here anyway, end to end through
 * `parsedStepToStep` into `validateStep`, so the two files cannot drift apart
 * again without a red test.
 */

import { describe, it, expect } from 'vitest'
import { parseSipocData, parsedStepToStep } from '../lib/sipocParser'
import { validateStep } from '../lib/sipocValidator'
import { milestonesById } from '../lib/stepSequence'
import type { Step, Team } from '../data/types'

const teams: Team[] = [
  {
    id: 'team-1',
    projectId: 'proj-1',
    name: 'Operations',
    color: '#6B7280',
    order: 1,
    tags: [],
    createdAt: 0,
  },
]

function parse(processDescription: string) {
  return parseSipocData(
    {
      suppliers: ['Procurement'],
      inputs: ['request'],
      processDescription,
      outputs: ['approval'],
      customers: ['Finance'],
    },
    teams
  )
}

function labelsOf(processDescription: string): string[] {
  return parse(processDescription).steps.map(step => step.label)
}

describe('SIPOC parser — newline splitting', () => {
  it('splits multi-line input into one step per line', () => {
    expect(
      labelsOf('Receive the order\nReview the order\nSend the invoice')
    ).toEqual(['Receive the order', 'Review the order', 'Send the invoice'])
  })

  it('treats a blank line between steps as a single break', () => {
    expect(labelsOf('Receive the order\n\n\nSend the invoice')).toEqual([
      'Receive the order',
      'Send the invoice',
    ])
  })

  it('still splits single-line prose on sentence terminators', () => {
    expect(labelsOf('Receive the order. Send the invoice!')).toEqual([
      'Receive the order',
      'Send the invoice',
    ])
  })
})

describe('SIPOC parser — numbered lists', () => {
  it('splits "1. Do X 2. Do Y 3. Do Z" into three labels with no stray digits', () => {
    const labels = labelsOf(
      '1. Receive the order 2. Review the order 3. Send the invoice'
    )

    expect(labels).toEqual([
      'Receive the order',
      'Review the order',
      'Send the invoice',
    ])
    for (const label of labels) {
      expect(label).not.toMatch(/\d/)
    }
  })

  it('handles ")" and "Step N:" markers, and one item per line', () => {
    expect(labelsOf('1) Receive the order\n2) Send the invoice')).toEqual([
      'Receive the order',
      'Send the invoice',
    ])
    expect(
      labelsOf('Step 1: Receive the order Step 2: Send the invoice')
    ).toEqual(['Receive the order', 'Send the invoice'])
  })

  it('drops a colon lead-in but keeps real prose written before the list', () => {
    expect(
      labelsOf('The process is as follows: 1. Receive the order 2. Send the invoice')
    ).toEqual(['Receive the order', 'Send the invoice'])

    expect(
      labelsOf('Receive the order. Then: 1. Review the order 2. Send the invoice')
    ).toEqual(['Receive the order', 'Review the order', 'Send the invoice'])
  })

  it('leaves a number that is not an enumeration inside its sentence', () => {
    // Markers must read 1, 2, 3, … in order; "50." is prose, so the sentence
    // split runs instead and the number survives in the label.
    expect(
      labelsOf('Approve invoices over 50. Then archive the file.')
    ).toEqual(['Approve invoices over 50', 'Archive the file'])
  })

  it('does not read a long embedded number as a marker', () => {
    expect(labelsOf('Send form 1099. Then file it.')).toEqual([
      'Send form 1099',
      'File it',
    ])
  })

  it('does not read a number followed by another number as a marker', () => {
    // `\s*(?!\d)` after the punctuation backtracks to zero width and matches
    // the space itself, so the lookahead has to sit before the whitespace.
    expect(labelsOf('Meet at 1: 30 pm. Then review the notes.')).toEqual([
      'Meet at 1: 30 pm',
      'Review the notes',
    ])
    expect(
      labelsOf('Send form 1. 5 copies go out, then archive the rest.')
    ).toEqual(['Send form 1', 'Archive the rest'])
  })

  it('does not split ordinal prose that happens to count up', () => {
    // Tier 1 / tier 2 reads 1, 2 in order but is not a list — no line break,
    // colon or sentence end introduces it.
    expect(
      labelsOf('Review tier 1. Escalate to tier 2. Close the case.')
    ).toEqual(['Review tier 1', 'Escalate to tier 2', 'Close the case'])
  })

  it('splits a list introduced by a finished sentence', () => {
    // The lead-in stays as prose rather than being discarded — only a colon
    // clause is dropped — so it is parsed like any other sentence and the list
    // items behind it still split cleanly.
    expect(
      labelsOf('Here is the process. 1. Receive the order 2. Send the invoice')
    ).toEqual(['Process', 'Receive the order', 'Send the invoice'])
  })
})

describe('SIPOC parser — verb selection', () => {
  it('starts the label at the earliest verb in the sentence, not the first in the verb list', () => {
    // `review` sits in the operations list, ahead of `send` in the general
    // list, so the old scan started this label at "review it".
    expect(labelsOf('Send the invoice after we review it')).toEqual([
      'Send the invoice after we review it',
    ])
  })

  it('matches a multi-word verb', () => {
    expect(labelsOf('The manager will follow up with the customer')).toEqual([
      'Follow up with the customer',
    ])
  })

  it('matches a verb that carries trailing punctuation', () => {
    expect(labelsOf('We review, then send, the invoice')).toEqual([
      'Review, then send, the invoice',
    ])
  })
})

describe('SIPOC parser — the five-step cap is gone (#220)', () => {
  // The cap existed because the parse went straight to SQLite: five was a guess
  // at how much silent over-extraction a user could tolerate. Review shows the
  // whole list with its count before anything is written, so every phrase is a
  // step now and the count is the user's to change.
  const eightSteps =
    'Receive the order. Review the order. Approve the order. ' +
    'Send the invoice. Record the payment. Notify the customer. ' +
    'Archive the file. Close the case.'

  it('creates a step for every sentence of inferred prose', () => {
    const result = parse(eightSteps)

    expect(result.steps).toHaveLength(8)
    expect(result.steps.map(step => step.label)).toContain('Close the case')
    expect(result.warnings.some(w => w.includes('left out'))).toBe(false)
  })

  it('numbers a long prose description 1..n', () => {
    const many = Array.from(
      { length: 12 },
      (_, i) => `Review document number ${i + 1}.`
    ).join(' ')

    const result = parse(many)

    expect(result.steps).toHaveLength(12)
    expect(result.steps.map(step => step.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    expect(result.warnings.some(w => w.includes('left out'))).toBe(false)
  })

  it('does not cap a list the user enumerated', () => {
    // Same eight steps, numbered. The user drew these boundaries, so the count
    // is theirs and nothing is left out (#313).
    const result = parse(
      '1. Receive the order 2. Review the order 3. Approve the order ' +
        '4. Send the invoice 5. Record the payment 6. Notify the customer ' +
        '7. Archive the file 8. Close the case'
    )

    expect(result.steps).toHaveLength(8)
    expect(result.warnings.some(w => w.includes('left out'))).toBe(false)
  })

  it('does not cap steps written one per line', () => {
    const result = parse(
      [
        'Receive the order',
        'Review the order',
        'Approve the order',
        'Send the invoice',
        'Record the payment',
        'Notify the customer',
      ].join('\n')
    )

    expect(result.steps).toHaveLength(6)
    expect(result.warnings.some(w => w.includes('left out'))).toBe(false)
  })
})

describe('SIPOC parser — steps outside the verb vocabulary (#313)', () => {
  // The exact QA repro from #313, newline included. Six items in, four steps
  // out: `approval` is not `approve`, and `pay` is in no category at all.
  const repro =
    '1. Create Purchase Requisition 2. Submit for Budget Check 3. Validate Budget\n' +
    '4. Manager Approval 5. Create PO 6. Pay Invoice'

  it('keeps all six items of the repro list', () => {
    expect(labelsOf(repro)).toEqual([
      'Create purchase requisition',
      'Submit for budget check',
      'Validate budget',
      'Manager approval',
      'Create po',
      'Pay invoice',
    ])
  })

  it('numbers them 1..6 and warns about nothing', () => {
    const result = parse(repro)

    expect(result.steps.map(step => step.order)).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.warnings.some(w => w.includes('left out'))).toBe(false)
  })

  it('keeps a verbless line in newline-delimited input', () => {
    expect(labelsOf('Manager Approval\nPay Invoice')).toEqual([
      'Manager approval',
      'Pay invoice',
    ])
  })

  it('keeps both halves of a declared item that contains a full stop', () => {
    // The boundary the user drew is the item, so a period inside it is no
    // licence to discard half of what they typed.
    expect(labelsOf('1. Create PO. Pay invoice 2. Manager approval')).toEqual([
      'Create po',
      'Pay invoice',
      'Manager approval',
    ])
  })

  it('still trims a declared item down to its verb when it has one', () => {
    expect(labelsOf('1. The manager will follow up 2. Manager approval')).toEqual([
      'Follow up',
      'Manager approval',
    ])
  })

  it('does not turn prose written ahead of a list into a step, and says so', () => {
    // The preamble is the parser's inference, not the user's boundary, so the
    // verb filter still governs it — and it has no verb. It is still text the
    // user typed that produced no step, so it comes back whole for Review to
    // offer as a row rather than being dropped (#220).
    const result = parse('Our P2P flow.\n1. Create PO 2. Pay invoice')

    expect(result.steps.map(step => step.label)).toEqual([
      'Create po',
      'Pay invoice',
    ])

    expect(result.unparsed).toEqual(['Our p2p flow'])
  })

  it('keeps every sentence of a mixed prose-and-list description', () => {
    const result = parse(
      'Receive the order. Review the order. Approve the order. Send the invoice. ' +
        'Record the payment. Notify the customer. Archive the file. ' +
        'Then: 1. Create PO 2. Pay invoice'
    )

    expect(result.steps.map(step => step.label)).toEqual([
      'Receive the order',
      'Review the order',
      'Approve the order',
      'Send the invoice',
      'Record the payment',
      'Notify the customer',
      'Archive the file',
      'Create po',
      'Pay invoice',
    ])

    expect(result.warnings.some(w => w.includes('left out'))).toBe(false)
  })
})

describe('SIPOC parser — prose the verb filter cannot read', () => {
  it('returns what it could not read instead of dropping it in silence', () => {
    const result = parse('Receive the order. Manager approval.')

    expect(result.steps.map(step => step.label)).toEqual(['Receive the order'])
    expect(result.unparsed).toEqual(['Manager approval'])
  })

  it('carries every unread sentence whole, not a summary of them', () => {
    // The old report named three and counted the rest, because it had to fit in
    // a five-second toast. Review renders a row per sentence, and a row the user
    // can promote to a step has to carry the sentence itself.
    const result = parse(
      'Manager approval. Budget sign-off. Vendor onboarding paperwork. ' +
        'Quarterly reconciliation. Annual audit.'
    )

    expect(result.unparsed).toEqual([
      'Manager approval',
      'Budget sign-off',
      'Vendor onboarding paperwork',
      'Quarterly reconciliation',
      'Annual audit',
    ])
  })

  it('reports the sentence even when nothing survived and the fallback step is used', () => {
    const result = parse('Manager approval.')

    expect(result.warnings.some(w => w.includes('No clear action steps'))).toBe(true)
    expect(result.unparsed).toEqual(['Manager approval'])
  })

  it('leaves the no-action-phrases fallback step unowned', () => {
    // Prose with no action verbs yields one generic step. It must not inherit
    // teams[0] — Review shows it unowned and confirm resolves Unassigned.
    const result = parse('foo bar baz qux')

    expect(result.warnings.some(w => w.includes('No clear action steps'))).toBe(true)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].teamId).toBeUndefined()
    expect(result.steps[0].ownerHint).toBeUndefined()
  })

  it('treats wrapped paragraphs as prose, not as one step per line', () => {
    // Two lines of ordinary prose are still prose: a line carrying a sentence
    // break inside it is not a list item, so the cap and the dropped report both
    // stay in force. Exempting on "contains a newline" alone silenced both.
    const result = parse(
      'We receive the order. Manager approval. The invoice is filed.\n' +
        'Budget sign-off happens next. Vendor onboarding paperwork. ' +
        'We send the invoice to the customer.'
    )

    expect(result.unparsed).toEqual([
      'Manager approval',
      'The invoice is filed',
      'Budget sign-off happens next',
      'Vendor onboarding paperwork',
    ])
    expect(result.steps.map(step => step.label)).toEqual([
      'Receive the order',
      'Send the invoice to the customer',
    ])
  })

  it('does not let a decimal in one line demote its siblings to prose', () => {
    // A sentence break has to be followed by whitespace. Reading `1.5` as one
    // turns the whole paste into prose, and the verb filter then drops the two
    // lines either side of it — #313 all over again, by a side door.
    const result = parse(
      'Manager approval\nSend form 1.5 to procurement\nPay invoice'
    )

    expect(result.steps.map(step => step.label)).toEqual([
      'Manager approval',
      'Send form 1.5 to procurement',
      'Pay invoice',
    ])
    expect(result.unparsed).toEqual([])
  })

  it('says nothing when every sentence was read', () => {
    const result = parse('Receive the order. Send the invoice.')

    expect(result.unparsed).toEqual([])
  })
})

describe('SIPOC parser — who the sentence said does the work (#220)', () => {
  const procurement: Team = {
    id: 'team-2',
    projectId: 'proj-1',
    name: 'Procurement',
    color: '#6B7280',
    order: 2,
    tags: [],
    createdAt: 0,
  }

  function parseWith(processDescription: string, available: Team[]) {
    return parseSipocData(
      {
        suppliers: [],
        inputs: [],
        processDescription,
        outputs: [],
        customers: [],
      },
      available
    )
  }

  it('resolves an owner the project already has a team for', () => {
    const result = parseWith('Procurement validates the coding.', [...teams, procurement])

    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].label).toBe('Validates the coding')
    expect(result.steps[0].teamId).toBe('team-2')
    expect(result.steps[0].ownerHint).toBeUndefined()
  })

  it('leaves an unmatched owner unresolved rather than filing it under the first team', () => {
    // The whole point: `teams[0]` used to swallow this silently, so nothing
    // downstream could offer to create the team or map it to another one.
    const result = parseWith('The budget holder approves the spend.', teams)

    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].teamId).toBeUndefined()
    expect(result.steps[0].ownerHint).toBe('budget holder')
    expect(result.steps[0].source).toBe('The budget holder approves the spend')
  })

  it('does not read a pronoun as an owner', () => {
    const result = parseWith('We receive the order.', teams)

    expect(result.steps[0].ownerHint).toBeUndefined()
    expect(result.steps[0].teamId).toBeUndefined()
  })

  it('assigns a verb category only when a team name matches', () => {
    const sales: Team = { ...teams[0], id: 'team-sales', name: 'Sales' }
    const result = parseWith('We receive the order.', [...teams, sales])

    expect(result.steps[0].teamId).toBe('team-sales')
  })

  it('matches an owner against a team name in either direction', () => {
    const holders: Team = { ...procurement, id: 'team-3', name: 'Budget Holders' }
    const result = parseWith('The budget holder approves the spend.', [...teams, holders])

    expect(result.steps[0].teamId).toBe('team-3')
    expect(result.steps[0].ownerHint).toBeUndefined()
  })
})

describe('SIPOC parser — order agrees with the validator', () => {
  it('numbers steps from 1, and only the first is exempt from the supplier requirement', () => {
    const result = parse('Receive the request. Approve the request.')

    expect(result.steps.map(step => step.order)).toEqual([1, 2])

    const steps: Step[] = result.steps.map(parsed => ({
      ...parsedStepToStep(
        { ...parsed, teamId: parsed.teamId ?? teams[0].id },
        'proj-1',
        'ms-1'
      ),
      id: `step-${parsed.order}`,
    }))

    // The validator exempts the step that opens the PROCESS (#344) — with one
    // milestone, that is the lowest `order`. A 0-based parser exempted the wrong
    // row: step 1 was flagged and step 2 was let off.
    const milestoneById = milestonesById([
      { id: 'ms-1', projectId: 'proj-1', name: 'M1', order: 1, relatedPolicies: [], createdAt: 0, updatedAt: 0 },
    ])
    expect(validateStep(steps[0], steps, milestoneById).missingFields).not.toContain('supplier')
    expect(validateStep(steps[1], steps, milestoneById).missingFields).toContain('supplier')
  })
})
