/**
 * The SIPOC badge is derived state, not a stored snapshot.
 *
 * Regression cover for #176: `validation_status` was persisted on some write
 * paths and read in preference to a live check, so a step fixed through the
 * Diagram modal (or a neighbour edit that repaired a chain rule) kept showing
 * the old warning until an inline grid edit happened to touch the row.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepRow } from '../components/Discovery/StepRow'
import type { EditableStep } from '../components/Discovery/types'

const makeStep = (overrides: Partial<EditableStep> = {}): EditableStep => ({
  id: 'step-1',
  projectId: 'project-1',
  label: 'Test Step',
  teamId: 'team-1',
  milestoneId: 'milestone-1',
  order: 1,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  trigger: undefined,
  result: undefined,
  kpi: undefined,
  decision: false,
  branches: undefined,
  notes: undefined,
  comments: [],
  links: [],
  gapIds: [],
  diagramPosition: undefined,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

/**
 * A row carrying a legacy `validation_status` payload. The field is no longer
 * part of `Step`, so this deliberately widens the fixture: the point is that a
 * value in that shape can never influence what the badge renders.
 */
const withStaleStoredValidation = (
  step: EditableStep,
  stored: { isValid: boolean; missingFields: string[]; issues: string[] }
): EditableStep => ({ ...step, validationStatus: stored }) as EditableStep

const renderRow = (
  step: EditableStep,
  allSteps: EditableStep[],
  validationSteps: EditableStep[] = allSteps
) =>
  render(
    <table>
      <tbody>
        <StepRow
          step={step}
          index={allSteps.findIndex(s => s.id === step.id)}
          allSteps={allSteps}
          displayNumber={null}
          previousDisplayNumber={
            allSteps[allSteps.findIndex(s => s.id === step.id) - 1]?.order ?? null
          }
          validationSteps={validationSteps}
          milestones={[]}
          teams={[]}
          systems={[]}
          isSelected={false}
          onToggleSelect={vi.fn()}
          onUpdate={vi.fn().mockResolvedValue(undefined)}
        />
      </tbody>
    </table>
  )

describe('StepRow — SIPOC badge', () => {
  it('reflects the step as it is now, not a stored validation snapshot', () => {
    // Issue example 1: step 4 was missing its supplier, the modal added one,
    // and the stored status was never recomputed.
    const first = makeStep({ id: 'step-1', order: 1, outputs: ['Request'], customers: ['Procurement'] })
    const fixed = withStaleStoredValidation(
      makeStep({
        id: 'step-2',
        order: 2,
        label: 'Raise PO',
        suppliers: ['Procurement'],
        inputs: ['Request'],
      }),
      { isValid: false, missingFields: ['supplier'], issues: ['Supplier is required (who provides the inputs)'] }
    )

    renderRow(fixed, [first, fixed])

    expect(screen.getByTitle('All SIPOC fields complete')).toBeInTheDocument()
    expect(screen.queryByText('Supplier is required (who provides the inputs)')).not.toBeInTheDocument()
  })

  it('re-evaluates cross-step rules when a neighbour changes', () => {
    // Issue example 2: step 3's "Customer(s) not matched" survived step 4
    // gaining the matching supplier, and survived an app restart.
    const stale = withStaleStoredValidation(
      makeStep({ id: 'step-1', order: 1, outputs: ['Request'], customers: ['Procurement'] }),
      {
        isValid: false,
        missingFields: ['customer'],
        issues: ['Customer(s) not matched in next step: Procurement'],
      }
    )
    const neighbour = makeStep({
      id: 'step-2',
      order: 2,
      label: 'Raise PO',
      suppliers: ['Procurement'],
      inputs: ['Request'],
    })

    renderRow(stale, [stale, neighbour])

    expect(screen.getByTitle('All SIPOC fields complete')).toBeInTheDocument()
    expect(
      screen.queryByText('Customer(s) not matched in next step: Procurement')
    ).not.toBeInTheDocument()
  })

  it('keeps the chain column reading the same list as the badge under a filter', () => {
    // validateStepChain walks by array position. Handed only the visible rows,
    // it would read the wrong neighbour and contradict the badge — two
    // indicators in one row disagreeing is worse than both being wrong.
    const visible = makeStep({ id: 'step-1', order: 1, outputs: ['Request'], customers: ['Procurement'] })
    const hiddenNeighbour = makeStep({
      id: 'step-2',
      order: 2,
      label: 'Raise PO',
      suppliers: ['Procurement'],
      inputs: ['Request'],
    })

    renderRow(visible, [visible], [visible, hiddenNeighbour])

    expect(screen.getByTitle('All SIPOC fields complete')).toBeInTheDocument()
    // Sees the hidden neighbour take delivery. Handed only the visible row it
    // would read "First and only step" and skip the chain rules entirely.
    expect(screen.getByTitle('Entry point ready')).toBeInTheDocument()
    expect(screen.queryByTitle('First and only step')).not.toBeInTheDocument()
  })

  it('validates against every step, not just the rows a filter left visible', () => {
    // Chain rules read the next step. With only the visible row in hand, a
    // filtered step looks like the last one in its milestone and every
    // output/customer rule is skipped.
    const visible = makeStep({ id: 'step-1', order: 1, outputs: ['Request'], customers: ['Procurement'] })
    const hidden = makeStep({
      id: 'step-2',
      order: 2,
      label: 'Unrelated',
      suppliers: ['Facilities'],
      inputs: ['Ticket'],
    })

    renderRow(visible, [visible], [visible, hidden])

    expect(screen.queryByTitle('All SIPOC fields complete')).not.toBeInTheDocument()
    expect(screen.getByText('Customer(s) not matched in next step: Procurement')).toBeInTheDocument()
  })
})
