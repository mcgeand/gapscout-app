import { describe, expect, it } from 'vitest'
import { graphBuilderDemoSteps } from '../lib/graphBuilder.demo'
import { validateSteps } from '../lib/sipocValidator'
import { milestonesById } from '../lib/stepSequence'
import type { Milestone } from '../data/types'

const demoMilestones: Milestone[] = [
  {
    id: 'M1',
    projectId: 'P1',
    name: 'Request Phase',
    order: 0,
    relatedPolicies: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'M2',
    projectId: 'P1',
    name: 'Fulfillment Phase',
    order: 1,
    relatedPolicies: [],
    createdAt: 0,
    updatedAt: 0,
  },
]

describe('graphBuilder.demo fixture (#364)', () => {
  it('satisfies sipocValidator chain rules within each milestone', () => {
    const results = validateSteps(graphBuilderDemoSteps, milestonesById(demoMilestones))
    for (const [stepId, result] of results) {
      expect(result.issues, stepId).not.toContainEqual(
        expect.stringMatching(/Customer\(s\) not matched/)
      )
      expect(result.issues, stepId).not.toContainEqual(
        expect.stringMatching(/Output.*not used as input/)
      )
    }
  })
})
