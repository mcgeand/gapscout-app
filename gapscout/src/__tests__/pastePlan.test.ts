/**
 * The paste plan (#155).
 *
 * `planPaste` is the whole of what a paste means: fresh ids, the target's
 * project and milestone, sequential orders, and branches that survive only
 * inside the copied set. It is pure, so every rule is checked here rather than
 * through the modal — and the last case checks the thing the modal cannot,
 * which is that what it plans would actually be accepted by `StepSchema`.
 */

import { describe, expect, it } from 'vitest'
import { planPaste, type PasteOptions } from '../lib/pastePlan'
import { StepSchema } from '../data/schemas'
import { MAX_LENGTH } from '../data/constants'
import type { CopiedStep, StepClipboard } from '../state/diagramClipboard'

const copiedStep = (overrides: Partial<CopiedStep> = {}): CopiedStep => ({
  id: 'src-1',
  label: 'Draft request',
  teamId: 'team-source',
  milestoneId: 'milestone-source',
  suppliers: ['Requester'],
  inputs: ['Request form'],
  outputs: ['Draft'],
  customers: ['Buyer'],
  systems: ['system-1'],
  ...overrides,
})

const clipboardOf = (...steps: CopiedStep[]): StepClipboard => ({
  kind: 'gapscout/steps',
  version: 1,
  sourceProjectId: 'project-source',
  steps,
})

/** A mint that names the ids after the order they were asked for. */
const countingMint = () => {
  let n = 0
  return () => `fresh-${++n}`
}

const options = (overrides: Partial<PasteOptions> = {}): PasteOptions => ({
  targetProjectId: 'project-target',
  targetMilestoneId: 'milestone-target',
  teamId: 'team-target',
  keepBranches: true,
  firstOrder: 3,
  existingLabels: new Set<string>(),
  mintId: countingMint(),
  ...overrides,
})

describe('planPaste assigns fresh identity and the target placement', () => {
  it('mints one id per step, in order, and never reuses a source id', () => {
    const planned = planPaste(
      clipboardOf(copiedStep({ id: 'src-1' }), copiedStep({ id: 'src-2' })),
      options()
    )

    expect(planned.map(step => step.id)).toEqual(['fresh-1', 'fresh-2'])
    expect(new Set(planned.map(step => step.id)).size).toBe(2)
  })

  it('puts every step in the target project and milestone, numbered from firstOrder', () => {
    const planned = planPaste(
      clipboardOf(copiedStep({ id: 'src-1' }), copiedStep({ id: 'src-2' }), copiedStep({ id: 'src-3' })),
      options({ firstOrder: 5 })
    )

    expect(planned.map(step => step.projectId)).toEqual(Array(3).fill('project-target'))
    expect(planned.map(step => step.milestoneId)).toEqual(Array(3).fill('milestone-target'))
    expect(planned.map(step => step.order)).toEqual([5, 6, 7])
  })

  it('drops the source rows history and position', () => {
    const [planned] = planPaste(
      clipboardOf(copiedStep({ notes: 'Watch the SLA', decision: true })),
      options()
    )

    expect(planned.comments).toEqual([])
    expect(planned.links).toEqual([])
    expect(planned.gapIds).toEqual([])
    expect(planned.diagramPosition).toBeUndefined()
    expect(planned.notes).toBe('Watch the SLA')
    expect(planned.decision).toBe(true)
  })
})

describe('planPaste and the owner team', () => {
  it("carries each step's own team on 'keep'", () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1', teamId: 'team-a' }),
        copiedStep({ id: 'src-2', teamId: 'team-b' })
      ),
      options({ teamId: 'keep' })
    )

    expect(planned.map(step => step.teamId)).toEqual(['team-a', 'team-b'])
  })

  it('overrides every team with a fixed id', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1', teamId: 'team-a' }),
        copiedStep({ id: 'src-2', teamId: 'team-b' })
      ),
      options({ teamId: 'team-target' })
    )

    expect(planned.map(step => step.teamId)).toEqual(['team-target', 'team-target'])
  })
})

describe('planPaste and the connections', () => {
  it('remaps a branch onto the fresh id of a step inside the copied set', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1' }),
        copiedStep({
          id: 'src-2',
          decision: true,
          branches: [{ when: 'Rejected', toStepId: 'src-1', label: 'Back' }],
        })
      ),
      options()
    )

    expect(planned[1].branches).toEqual([
      { when: 'Rejected', toStepId: 'fresh-1', label: 'Back' },
    ])
  })

  it('drops a branch whose target was not copied', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({
          id: 'src-1',
          branches: [
            { when: 'Inside', toStepId: 'src-2' },
            { when: 'Outside', toStepId: 'src-never-copied' },
          ],
        }),
        copiedStep({ id: 'src-2' })
      ),
      options()
    )

    expect(planned[0].branches).toEqual([{ when: 'Inside', toStepId: 'fresh-2' }])
  })

  it('drops a branch that would point at the pasting step itself after the remap', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({
          id: 'src-1',
          branches: [
            { when: 'Loop', toStepId: 'src-1' },
            { when: 'On', toStepId: 'src-2' },
          ],
        }),
        copiedStep({ id: 'src-2' })
      ),
      options()
    )

    expect(planned[0].branches).toEqual([{ when: 'On', toStepId: 'fresh-2' }])
  })

  it('gives every step an empty branch list when connections are not kept', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1', branches: [{ when: 'Inside', toStepId: 'src-2' }] }),
        copiedStep({ id: 'src-2' })
      ),
      options({ keepBranches: false })
    )

    expect(planned.map(step => step.branches)).toEqual([[], []])
  })

  it('keeps `decision` even when the branches are dropped', () => {
    const [planned] = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1', decision: true, branches: [{ when: 'Inside', toStepId: 'src-2' }] })
      ),
      options({ keepBranches: false })
    )

    expect(planned.decision).toBe(true)
    expect(planned.branches).toEqual([])
  })
})

describe('planPaste and the "(copy)" suffix', () => {
  it('suffixes only the labels the target project already holds', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1', label: 'Draft request' }),
        copiedStep({ id: 'src-2', label: 'Check budget' })
      ),
      options({ existingLabels: new Set(['Draft request']) })
    )

    expect(planned.map(step => step.label)).toEqual(['Draft request (copy)', 'Check budget'])
  })

  it('matches exactly and case-sensitively', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1', label: 'draft request' }),
        copiedStep({ id: 'src-2', label: 'Draft request ' })
      ),
      options({ existingLabels: new Set(['Draft request']) })
    )

    expect(planned.map(step => step.label)).toEqual(['draft request', 'Draft request '])
  })

  it('does not suffix the second copy of a label this same paste is adding', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({ id: 'src-1', label: 'Draft request' }),
        copiedStep({ id: 'src-2', label: 'Draft request' })
      ),
      options()
    )

    expect(planned.map(step => step.label)).toEqual(['Draft request', 'Draft request'])
  })

  it('trims the base label so a suffixed one still fits the cap', () => {
    // A label already at the cap: appending would plan a row `StepSchema`
    // rejects, and the paste would fail at the write with nothing said why.
    const atTheCap = 'x'.repeat(MAX_LENGTH.STEP_LABEL)

    const [planned] = planPaste(
      clipboardOf(copiedStep({ label: atTheCap })),
      options({ existingLabels: new Set([atTheCap]) })
    )

    expect(planned.label).toHaveLength(MAX_LENGTH.STEP_LABEL)
    expect(planned.label.endsWith(' (copy)')).toBe(true)
    expect(planned.label.startsWith('x'.repeat(MAX_LENGTH.STEP_LABEL - ' (copy)'.length))).toBe(true)
    expect(StepSchema.safeParse({ ...planned, createdAt: 1, updatedAt: 2 }).success).toBe(true)
  })

  it('leaves a label the suffix still fits alone', () => {
    const room = 'y'.repeat(MAX_LENGTH.STEP_LABEL - ' (copy)'.length)

    const [planned] = planPaste(
      clipboardOf(copiedStep({ label: room })),
      options({ existingLabels: new Set([room]) })
    )

    expect(planned.label).toBe(`${room} (copy)`)
    expect(planned.label).toHaveLength(MAX_LENGTH.STEP_LABEL)
  })
})

describe('what planPaste plans is a step the schema accepts', () => {
  it('passes StepSchema once the timestamps are stamped', () => {
    const planned = planPaste(
      clipboardOf(
        copiedStep({
          id: 'src-1',
          trigger: 'A request arrives',
          result: 'A draft exists',
          kpi: 'Time to draft',
          notes: 'Watch the SLA',
          decision: true,
          branches: [{ when: 'Rejected', toStepId: 'src-2', label: 'Back' }],
        }),
        copiedStep({ id: 'src-2', label: 'Check budget' })
      ),
      options({ existingLabels: new Set(['Check budget']) })
    )

    for (const step of planned) {
      const result = StepSchema.safeParse({ ...step, createdAt: 1, updatedAt: 2 })
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
    }
  })
})
