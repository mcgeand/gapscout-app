/**
 * Unit tests for the Mermaid export service (issue #151, PRD 4.12.4).
 *
 * The builder is pure and its output is pasted into the Mermaid Live Editor,
 * Confluence or a README, so the text itself is the contract: the pinned string
 * below is what a reader gets, id scheme and indentation included. The other
 * cases cover what the fixture cannot show at once — the things that make
 * Mermaid reject a file (raw ids, unquoted labels, the `end` keyword) — and the
 * empty project.
 */

import { describe, expect, it } from 'vitest'
import {
  buildMermaid,
  buildMermaidFilename,
  mermaidToBytes,
} from '../services/exportMermaid'
import type { Milestone, Project, Step, Team } from '../data/types'

const CREATED = Date.UTC(2026, 0, 15, 9, 30, 0)
const GENERATED = new Date(Date.UTC(2026, 8, 2, 12, 0, 0))

const project: Project = {
  id: 'p1',
  name: 'Procure to Pay',
  description: 'How a purchase request becomes a paid invoice.',
  createdAt: CREATED,
  updatedAt: CREATED,
}

function team(id: string, name: string, order: number): Team {
  return { id, projectId: 'p1', name, color: '#F59E0B', order, tags: [], createdAt: CREATED }
}

function milestone(id: string, name: string, order: number): Milestone {
  return { id, projectId: 'p1', name, order, relatedPolicies: [], createdAt: CREATED, updatedAt: CREATED }
}

function step(overrides: Partial<Step> & Pick<Step, 'id' | 'label' | 'teamId' | 'milestoneId' | 'order'>): Step {
  return {
    projectId: 'p1',
    suppliers: [],
    inputs: [],
    outputs: [],
    customers: [],
    systems: [],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  }
}

const teams = [team('t-sales', 'Sales', 0), team('t-finance', 'Finance', 1)]
const milestones = [milestone('m-request', 'Request', 0), milestone('m-approval', 'Approval', 1)]

/**
 * One of everything the acceptance criteria name: two team subgraphs, a decision
 * node with a branch that loops back, a labelled hand-off, a bare SIPOC edge, and
 * a Process End terminus fed by two steps. The third step's label carries the
 * two characters Mermaid cannot take raw inside a node.
 */
const steps: Step[] = [
  step({
    id: '-s1',
    label: 'Create request',
    teamId: 't-sales',
    milestoneId: 'm-request',
    order: 1,
    outputs: ['Request'],
    customers: ['Finance'],
  }),
  step({
    id: 's2',
    label: 'Approve request?',
    teamId: 't-finance',
    milestoneId: 'm-approval',
    order: 1,
    decision: true,
    suppliers: ['Finance'],
    inputs: ['Request'],
    outputs: ['Approved request'],
    customers: ['Vendor'],
    branches: [{ when: 'Rejected', toStepId: '-s1', label: 'No' }],
  }),
  step({
    id: 's3',
    label: 'Pay "vendor" | close',
    teamId: 't-finance',
    milestoneId: 'm-approval',
    order: 2,
    suppliers: ['Approver'],
    inputs: ['Approved request'],
    outputs: ['Payment'],
    customers: ['Vendor'],
  }),
]

function build(overrides: Partial<Parameters<typeof buildMermaid>[0]> = {}): string {
  return buildMermaid({
    project,
    steps,
    gaps: [],
    teams,
    milestones,
    systems: [],
    generatedAt: GENERATED,
    ...overrides,
  })
}

describe('buildMermaid', () => {
  it('draws the process as a flowchart with one subgraph per lane', () => {
    expect(build()).toBe(
      [
        '%% Procure to Pay (GapScout, 2026-09-02T12:00:00.000Z)',
        'flowchart LR',
        '  subgraph L_team_t_sales["Sales"]',
        '    S__s1["Create request"]',
        '  end',
        '  subgraph L_team_t_finance["Finance"]',
        '    D_s2{"Approve request?"}',
        '    S_s3["Pay #quot;vendor#quot; #124; close"]',
        '  end',
        '  subgraph L_name_Vendor["Vendor"]',
        '    E_Vendor(["Vendor"])',
        '  end',
        '  D_s2 -.->|"No"| S__s1',
        '  S__s1 -->|"Request"| D_s2',
        '  D_s2 -->|"Approved request"| S_s3',
        '  D_s2 -.->|"Approved request"| E_Vendor',
        '  S_s3 -.->|"Payment"| E_Vendor',
        '',
      ].join('\n')
    )
  })

  it('never emits a raw step or terminus id', () => {
    // A nanoid can start with `-`, a terminus id carries the customer's name
    // with its spaces, and `end` is a Mermaid keyword; any of them would stop
    // the file parsing.
    const mermaid = build()
    expect(mermaid).not.toMatch(/-s1|end-Vendor/)
    expect(mermaid).not.toMatch(/^\s*end[-\w]/m)
  })

  it('keeps ids stable when a node is added, so wiki styling keeps pointing at the same box', () => {
    const before = build()
    const extra = step({
      id: 's0',
      label: 'Raise need',
      teamId: 't-sales',
      milestoneId: 'm-request',
      order: 0,
    })
    const after = build({ steps: [extra, ...steps] })
    for (const id of ['S__s1', 'D_s2', 'S_s3', 'E_Vendor', 'L_team_t_finance']) {
      expect(before).toContain(id)
      expect(after).toContain(id)
    }
    expect(after).toContain('S_s0["Raise need"]')
  })

  it('keys subgraphs on the team id, so two teams with one name stay two lanes (#244)', () => {
    // Mermaid merges subgraphs that share an id; keyed on the name these would
    // collapse into one lane, which is the defect #244 fixed on the canvas.
    const twoOps = [team('t-sales', 'Ops', 0), team('t-finance', 'Ops', 1)]
    const mermaid = build({ teams: twoOps })
    expect(mermaid).toContain('subgraph L_team_t_sales["Ops"]')
    expect(mermaid).toContain('subgraph L_team_t_finance["Ops"]')
  })

  it('suffixes two keys that fold to the same id rather than merging them', () => {
    const clashing = steps.map((entry) =>
      entry.id === 's2' ? { ...entry, customers: ['Vendor Inc'] } : entry
    ).map((entry) => (entry.id === 's3' ? { ...entry, customers: ['Vendor-Inc'] } : entry))
    const mermaid = build({ steps: clashing })
    expect(mermaid).toContain('E_Vendor_Inc(["Vendor Inc"])')
    expect(mermaid).toContain('E_Vendor_Inc_2(["Vendor-Inc"])')
  })

  it('orders parallel steps by id, so a store reload cannot reorder the file', () => {
    const parallel = steps.map((entry) =>
      entry.id === 's3' ? { ...entry, order: 1 } : entry
    )
    expect(build({ steps: [...parallel].reverse() })).toBe(build({ steps: parallel }))
  })

  it('orders lanes by team position and puts lanes with no team last', () => {
    const reversed = [team('t-sales', 'Sales', 5), team('t-finance', 'Finance', 0)]
    const lanes = build({ teams: reversed }).match(/subgraph \w+\["([^"]+)"\]/g)
    expect(lanes).toEqual([
      'subgraph L_team_t_finance["Finance"]',
      'subgraph L_team_t_sales["Sales"]',
      'subgraph L_name_Vendor["Vendor"]',
    ])
  })

  it('is independent of the order the steps arrive in', () => {
    expect(build({ steps: [...steps].reverse() })).toBe(build())
  })

  it('draws a bare edge when the SIPOC names nothing flowing', () => {
    const noFlow = steps.map((entry) =>
      entry.id === 's2' ? { ...entry, inputs: [] } : entry
    )
    expect(build({ steps: noFlow })).toContain('  S__s1 --> D_s2\n')
  })

  it('writes an empty flowchart rather than throwing for a project with no steps', () => {
    expect(build({ steps: [] })).toBe(
      [
        '%% Procure to Pay (GapScout, 2026-09-02T12:00:00.000Z)',
        'flowchart LR',
        '  %% No steps to draw',
        '',
      ].join('\n')
    )
  })

  it('keeps a literal hash from being read as an entity code', () => {
    // Mermaid decodes `#123;` in any label, so "ticket #123; closed" would lose
    // the number and gain a `{` unless the hash itself is escaped first.
    const hashed = steps.map((entry) =>
      entry.id === 's3' ? { ...entry, label: 'Close ticket #123; done' } : entry
    )
    expect(build({ steps: hashed })).toContain('S_s3["Close ticket #35;123; done"]')
  })

  it('escapes what Mermaid would otherwise strip or restyle', () => {
    // Angle brackets are parsed as HTML tags and removed, an ampersand starts an
    // entity, and a label wrapped in backticks is read as markdown.
    const tricky = steps.map((entry) =>
      entry.id === 's3' ? { ...entry, label: '`Send <PO> & invoice`' } : entry
    )
    expect(build({ steps: tricky })).toContain(
      'S_s3["#96;Send #lt;PO#gt; #amp; invoice#96;"]'
    )
  })

  it('never emits an empty quoted label, which Mermaid rejects outright', () => {
    const blank = steps.map((entry) =>
      entry.id === 's3' ? { ...entry, label: '   ', outputs: [' '] } : entry
    )
    const mermaid = build({ steps: blank, teams: [team('t-sales', ' ', 0), teams[1]] })
    expect(mermaid).not.toContain('""')
    expect(mermaid).toContain('S_s3["S_s3"]')
    expect(mermaid).toContain('subgraph L_team_t_sales["L_team_t_sales"]')
    // The terminus edge carried the blank output as its label; it draws bare.
    expect(mermaid).toContain('  S_s3 -.-> E_Vendor\n')
  })

  it('notes a branch whose target step no longer exists instead of dropping it', () => {
    const dangling = steps.map((entry) =>
      entry.id === 's2'
        ? { ...entry, branches: [{ when: 'Escalated', toStepId: 'deleted-step' }] }
        : entry
    )
    expect(build({ steps: dangling })).toContain(
      '  %% skipped: branch "Escalated" from D_s2 points at a step not in this graph\n'
    )
  })

  it('quotes a quote in a lane title as well as in a node', () => {
    const quoted = [team('t-sales', 'Sales "EMEA"', 0), team('t-finance', 'Finance', 1)]
    expect(build({ teams: quoted })).toContain('subgraph L_team_t_sales["Sales #quot;EMEA#quot;"]')
  })
})

describe('mermaidToBytes', () => {
  it('encodes UTF-8 with no byte-order mark', () => {
    const bytes = mermaidToBytes('flowchart LR\n')
    expect(bytes[0]).toBe('f'.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe('flowchart LR\n')
  })
})

describe('buildMermaidFilename', () => {
  it('names the file beside the diagram images, with the .mmd extension', () => {
    expect(buildMermaidFilename('Procure to Pay', new Date(2026, 8, 2))).toBe(
      'procure-to-pay_diagram_2026-09-02.mmd'
    )
  })
})
