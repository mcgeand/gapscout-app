/**
 * The diagram clipboard envelope (#155).
 *
 * Two halves that have to agree: the buffer the paste modal actually reads, and
 * the JSON that travels through the OS clipboard. The parse is the interesting
 * one — it is fed text from outside the app, so it has to reject rather than
 * repair, and it has to do it without throwing: every caller is a paste handler
 * with a user in front of it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Step } from '../data/types'
import {
  parseClipboard,
  serializeClipboard,
  useDiagramClipboard,
  type StepClipboard,
} from '../state/diagramClipboard'

const makeStep = (overrides: Partial<Step> = {}): Step => ({
  id: 'step-1',
  projectId: 'project-1',
  label: 'Draft request',
  teamId: 'team-1',
  milestoneId: 'milestone-1',
  order: 1,
  suppliers: ['Requester'],
  inputs: ['Request form'],
  outputs: ['Draft'],
  customers: ['Buyer'],
  systems: ['system-1'],
  trigger: 'A request arrives',
  result: 'A draft exists',
  kpi: 'Time to draft',
  notes: 'Watch the SLA',
  decision: false,
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

const validEnvelope = (): StepClipboard => ({
  kind: 'gapscout/steps',
  version: 1,
  sourceProjectId: 'project-1',
  steps: [
    {
      id: 'step-1',
      label: 'Draft request',
      teamId: 'team-1',
      milestoneId: 'milestone-1',
      suppliers: [],
      inputs: [],
      outputs: [],
      customers: [],
      systems: [],
    },
  ],
})

describe('useDiagramClipboard.copy', () => {
  beforeEach(() => {
    useDiagramClipboard.setState({ clipboard: null })
  })

  it('stores the steps in the order given and returns the envelope', () => {
    const first = makeStep({ id: 'step-a', label: 'First' })
    const second = makeStep({ id: 'step-b', label: 'Second' })

    const returned = useDiagramClipboard.getState().copy([second, first], 'project-7')

    expect(returned).toMatchObject({
      kind: 'gapscout/steps',
      version: 1,
      sourceProjectId: 'project-7',
    })
    expect(returned.steps.map(step => step.id)).toEqual(['step-b', 'step-a'])
    expect(useDiagramClipboard.getState().clipboard).toEqual(returned)
  })

  it('carries the SIPOC and decision fields, and nothing the paste must not inherit', () => {
    const step = makeStep({
      decision: true,
      branches: [{ when: 'Approved', toStepId: 'step-2' }],
      gapIds: ['gap-1'],
      diagramPosition: { x: 10, y: 20 },
    })

    const [copied] = useDiagramClipboard.getState().copy([step], 'project-1').steps

    expect(copied).toMatchObject({
      suppliers: ['Requester'],
      inputs: ['Request form'],
      outputs: ['Draft'],
      customers: ['Buyer'],
      systems: ['system-1'],
      trigger: 'A request arrives',
      result: 'A draft exists',
      kpi: 'Time to draft',
      notes: 'Watch the SLA',
      decision: true,
      branches: [{ when: 'Approved', toStepId: 'step-2' }],
    })
    expect(copied).not.toHaveProperty('gapIds')
    expect(copied).not.toHaveProperty('diagramPosition')
    expect(copied).not.toHaveProperty('order')
  })

  it('clears the buffer', () => {
    useDiagramClipboard.getState().copy([makeStep()], 'project-1')
    useDiagramClipboard.getState().clear()
    expect(useDiagramClipboard.getState().clipboard).toBeNull()
  })
})

describe('serializeClipboard / parseClipboard', () => {
  it('round-trips an envelope through the OS clipboard text', () => {
    const clipboard = useDiagramClipboard
      .getState()
      .copy(
        [
          makeStep({ id: 'step-a', label: 'First' }),
          makeStep({
            id: 'step-b',
            label: 'Second',
            decision: true,
            branches: [{ when: 'Approved', toStepId: 'step-a', label: 'Yes' }],
          }),
        ],
        'project-1'
      )

    const text = serializeClipboard(clipboard)

    expect(text).toContain('\n  ')
    expect(parseClipboard(text)).toEqual(clipboard)
  })
})

describe('parseClipboard rejects anything that is not the envelope', () => {
  const rejects = (label: string, text: string) => {
    it(`returns null for ${label}, without throwing`, () => {
      let result: StepClipboard | null | undefined
      expect(() => {
        result = parseClipboard(text)
      }).not.toThrow()
      expect(result).toBeNull()
    })
  }

  rejects('invalid JSON', '{ not json at all')
  rejects('a bare JSON string', '"gapscout/steps"')
  rejects('null', 'null')
  rejects(
    'the wrong kind',
    JSON.stringify({ ...validEnvelope(), kind: 'gapscout/gaps' })
  )
  rejects('the wrong version', JSON.stringify({ ...validEnvelope(), version: 2 }))
  rejects(
    'a version that is only string-equal',
    JSON.stringify({ ...validEnvelope(), version: '1' })
  )
  rejects(
    'a non-string sourceProjectId',
    JSON.stringify({ ...validEnvelope(), sourceProjectId: 7 })
  )
  rejects('a non-array steps', JSON.stringify({ ...validEnvelope(), steps: { id: 'step-1' } }))
  // `typeof null === 'object'`, so a null entry is the one shape a bare object
  // check waves through — and a paste would read `.label` off it.
  rejects('a null in the steps array', JSON.stringify({ ...validEnvelope(), steps: [null] }))
  // Valid JSON and an object by `typeof`, with no `kind` to read.
  rejects('a top-level JSON array', JSON.stringify([validEnvelope()]))
  rejects(
    'a step missing label',
    JSON.stringify({
      ...validEnvelope(),
      steps: [(() => {
        const step = { ...validEnvelope().steps[0] } as Record<string, unknown>
        delete step.label
        return step
      })()],
    })
  )
  rejects(
    'a step whose suppliers are not all strings',
    JSON.stringify({
      ...validEnvelope(),
      steps: [{ ...validEnvelope().steps[0], suppliers: ['a', 3] }],
    })
  )

  it('accepts the envelope those cases were built from', () => {
    expect(parseClipboard(JSON.stringify(validEnvelope()))).toEqual(validEnvelope())
  })
})
