import { describe, expect, it } from 'vitest'
import type { Step } from '../data/types'
import { detectFilledSipocFields } from '../lib/gapAutoStatus'

const step = (overrides: Partial<Step> = {}): Step => ({
  id: 'step-1',
  projectId: 'project-1',
  label: 'Review request',
  teamId: 'team-1',
  milestoneId: 'milestone-1',
  order: 1,
  suppliers: [],
  inputs: [],
  outputs: [],
  customers: [],
  systems: [],
  comments: [],
  links: [],
  gapIds: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

describe('detectFilledSipocFields', () => {
  it('reports a field that went from empty to filled', () => {
    expect(detectFilledSipocFields(step(), { inputs: ['Purchase request'] })).toEqual(['input'])
  })

  it('treats a blank-string array as empty, matching the SIPOC validator', () => {
    const previous = step({ outputs: ['', '   '] })

    expect(detectFilledSipocFields(previous, { outputs: ['Approved order'] })).toEqual(['output'])
  })

  it('ignores a field that already had a value', () => {
    const previous = step({ inputs: ['Purchase request'] })

    expect(detectFilledSipocFields(previous, { inputs: ['Purchase request', 'Budget code'] })).toEqual([])
  })

  it('ignores a field the patch does not carry', () => {
    expect(detectFilledSipocFields(step(), { label: 'Renamed' })).toEqual([])
  })

  it('ignores a field cleared to blank strings', () => {
    const previous = step({ customers: ['Finance'] })

    expect(detectFilledSipocFields(previous, { customers: [''] })).toEqual([])
  })

  it('reports every field filled by one patch, in SIPOC order', () => {
    const filled = detectFilledSipocFields(step(), {
      customers: ['Finance'],
      suppliers: ['Requester'],
      outputs: ['Approved order'],
      inputs: ['Purchase request'],
    })

    expect(filled).toEqual(['supplier', 'input', 'output', 'customer'])
  })

  it('ignores non-SIPOC array fields', () => {
    expect(detectFilledSipocFields(step(), { systems: ['SAP'] })).toEqual([])
  })
})
