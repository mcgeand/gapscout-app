/**
 * Unit tests for the CSV export service (issue #153, PRD 4.12.2).
 *
 * The builders are pure, so these assert the parts a spreadsheet actually
 * depends on: the verbatim header contract, UTF-8 BOM bytes, RFC 4180 quoting
 * of free text, and the lookups that must degrade to an empty cell rather than
 * throw when a team or milestone has been deleted.
 */

import { describe, expect, it } from 'vitest'
import {
  GAPS_CSV_COLUMNS,
  STEPS_CSV_COLUMNS,
  buildCsvFilename,
  buildGapsCsv,
  buildStepsCsv,
  csvToBytes,
} from '../services/exportCSV'
import type { Gap, Link, Milestone, Step, System, Team } from '../data/types'

const CREATED = Date.UTC(2026, 0, 15, 9, 30, 0)

function team(id: string, name: string): Team {
  return { id, projectId: 'p1', name, color: '#F59E0B', order: 0, tags: [], createdAt: CREATED }
}

function milestone(id: string, name: string, order: number): Milestone {
  return {
    id,
    projectId: 'p1',
    name,
    order,
    relatedPolicies: [],
    createdAt: CREATED,
    updatedAt: CREATED,
  }
}

function system(id: string, name: string): System {
  return { id, projectId: 'p1', name, tags: [], createdAt: CREATED }
}

function step(overrides: Partial<Step> = {}): Step {
  return {
    id: 's1',
    projectId: 'p1',
    label: 'Review purchase request',
    teamId: 't1',
    milestoneId: 'm1',
    order: 0,
    suppliers: ['Requestor'],
    inputs: ['Request form'],
    outputs: ['Approved request'],
    customers: ['Finance'],
    systems: ['sys1'],
    comments: [],
    links: [],
    gapIds: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  }
}

function gap(overrides: Partial<Gap> = {}): Gap {
  return {
    id: 'g1',
    projectId: 'p1',
    stepId: 's1',
    observed: 'Approvals take 5 days',
    expected: 'Approvals within 1 day',
    severity: 'H',
    status: 'Open',
    links: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  }
}

function link(overrides: Partial<Link> = {}): Link {
  return {
    id: 'l1',
    url: 'https://example.atlassian.net/browse/PROJ-123',
    label: 'PROJ-123',
    type: 'jira',
    createdAt: CREATED,
    ...overrides,
  }
}

/** Rows are CRLF-delimited per RFC 4180; a quoted newline stays inside its cell. */
function headerOf(csv: string): string {
  return csv.split('\r\n')[0]
}

function stepsCsv(overrides: Partial<Parameters<typeof buildStepsCsv>[0]> = {}): string {
  return buildStepsCsv({
    steps: [step()],
    gaps: [],
    teams: [team('t1', 'Approver')],
    milestones: [milestone('m1', 'Approval', 0)],
    systems: [system('sys1', 'SAP')],
    ...overrides,
  })
}

function gapsCsv(overrides: Partial<Parameters<typeof buildGapsCsv>[0]> = {}): string {
  return buildGapsCsv({
    gaps: [gap()],
    steps: [step()],
    teams: [team('t1', 'Approver')],
    ...overrides,
  })
}

describe('header contract', () => {
  it('emits the PRD 4.12.2 steps columns verbatim', () => {
    expect(headerOf(stepsCsv())).toBe(
      'Milestone,Milestone Order,Team,Step ID,Step Label,Order,Suppliers,Inputs,Outputs,Customers,Systems,Trigger,Result,KPI,Gap Count,Created At'
    )
    expect(STEPS_CSV_COLUMNS).toHaveLength(16)
  })

  it('emits the PRD 4.12.2 gaps columns verbatim', () => {
    expect(headerOf(gapsCsv())).toBe(
      'Gap ID,Step ID,Step Label,Team,Severity,Priority,Status,Root Cause,Observed,Expected,Fix Idea,Time to Fix,Jira Tickets,Created At,Closed At'
    )
    expect(GAPS_CSV_COLUMNS).toHaveLength(15)
  })

  it('writes a header-only file when there is nothing to export', () => {
    // Papa terminates the header row when no data follows it, so an empty
    // export is one header line — not a zero-byte file a spreadsheet rejects.
    expect(stepsCsv({ steps: [] })).toBe(`${headerOf(stepsCsv())}\r\n`)
    expect(gapsCsv({ gaps: [] })).toBe(`${headerOf(gapsCsv())}\r\n`)
  })
})

describe('steps CSV', () => {
  it('resolves milestone, team and system names and joins list cells with "; "', () => {
    const csv = stepsCsv({
      steps: [step({ suppliers: ['Requestor', 'Vendor'], systems: ['sys1', 'Legacy tracker'] })],
    })

    const row = csv.split('\r\n')[1]
    expect(row).toContain('Approval,0,Approver,s1,Review purchase request,0')
    expect(row).toContain('Requestor; Vendor')
    expect(row).toContain('SAP; Legacy tracker')
  })

  it('counts gaps from the gaps array rather than step.gapIds', () => {
    const csv = stepsCsv({
      // gapIds deliberately disagrees: it is a back-reference, not the source of truth.
      steps: [step({ gapIds: ['stale-1', 'stale-2', 'stale-3'] })],
      gaps: [gap({ id: 'g1' }), gap({ id: 'g2' }), gap({ id: 'g3', stepId: 'other' }), gap({ id: 'g4', stepId: undefined })],
    })

    expect(csv.split('\r\n')[1]).toContain(',2,2026-01-15T09:30:00.000Z')
  })

  it('leaves an empty cell when the milestone or team has been deleted', () => {
    const csv = stepsCsv({ teams: [], milestones: [] })

    // Milestone name, milestone order and team are all blank; the step still exports.
    expect(csv.split('\r\n')[1]).toBe(
      ',,,s1,Review purchase request,0,Requestor,Request form,Approved request,Finance,SAP,,,,0,2026-01-15T09:30:00.000Z'
    )
  })

  it('orders rows by milestone order then step order', () => {
    const csv = stepsCsv({
      steps: [
        step({ id: 'late', milestoneId: 'm2', order: 0 }),
        step({ id: 'second', milestoneId: 'm1', order: 1 }),
        step({ id: 'first', milestoneId: 'm1', order: 0 }),
        step({ id: 'orphan', milestoneId: 'gone', order: 0 }),
      ],
      milestones: [milestone('m1', 'Approval', 0), milestone('m2', 'Fulfilment', 1)],
    })

    const ids = csv
      .split('\r\n')
      .slice(1)
      .map((row) => row.split(',')[3])
    expect(ids).toEqual(['first', 'second', 'late', 'orphan'])
  })

  it('quotes free text containing commas, quotes and newlines', () => {
    const csv = stepsCsv({
      steps: [
        step({
          label: 'Review, then approve',
          notes: 'ignored',
          trigger: 'Request marked "urgent"',
          result: 'Approved\n→ Step 2 if rejected',
        }),
      ],
    })

    expect(csv).toContain('"Review, then approve"')
    expect(csv).toContain('"Request marked ""urgent"""')
    expect(csv).toContain('"Approved\n→ Step 2 if rejected"')
  })
})

describe('gaps CSV', () => {
  it('renders enums through the shared label maps and keeps priority numeric', () => {
    const csv = gapsCsv({
      gaps: [
        gap({
          priority: 2,
          severity: 'M',
          status: 'Review',
          rootCause: 'Policy',
          timeToFix: 'qwin',
          fixIdea: 'Add an approval SLA',
          closedAt: Date.UTC(2026, 1, 1, 12, 0, 0),
        }),
      ],
    })

    const row = csv.split('\r\n')[1]
    expect(row).toContain('Medium,2,In Review,Policy Gap')
    expect(row).toContain('Quick Win (< 1 week)')
    expect(row).toContain('2026-02-01T12:00:00.000Z')
  })

  it('leaves optional cells empty rather than writing undefined', () => {
    const csv = gapsCsv({ gaps: [gap()] })

    expect(csv.split('\r\n')[1]).toBe(
      'g1,s1,Review purchase request,,High,,Open,,Approvals take 5 days,Approvals within 1 day,,,,2026-01-15T09:30:00.000Z,'
    )
  })

  it('uses the owning team, and blanks step columns for a process gap', () => {
    const csv = gapsCsv({
      gaps: [gap({ id: 'pg1', stepId: undefined, ownerTeamId: 't1' })],
    })

    expect(csv.split('\r\n')[1]).toContain('pg1,,,Approver,')
  })

  it('exports only jira link labels', () => {
    const csv = gapsCsv({
      gaps: [
        gap({
          links: [
            link({ id: 'l1', label: 'PROJ-123' }),
            link({ id: 'l2', label: 'Spec doc', type: 'gdrive' }),
            link({ id: 'l3', label: 'PROJ-456' }),
          ],
        }),
      ],
    })

    expect(csv.split('\r\n')[1]).toContain('PROJ-123; PROJ-456')
    expect(csv).not.toContain('Spec doc')
  })

  it('writes dash-led free text verbatim, with no formula-escape prefix', () => {
    // Excel's importer renders this cell as #NAME?, but papaparse's escapeFormulae
    // is worse: Excel shows the apostrophe it inserts, and the prefix ends up in
    // the bytes every other tool reads. Verified in Excel — do not flip the flag.
    const csv = gapsCsv({ gaps: [gap({ observed: '- late invoices, every month' })] })

    expect(csv).toContain('"- late invoices, every month"')
    expect(csv).not.toContain("'-")
  })

  it('orders rows by creation time', () => {
    const csv = gapsCsv({
      gaps: [
        gap({ id: 'newer', createdAt: CREATED + 1000 }),
        gap({ id: 'older', createdAt: CREATED }),
      ],
    })

    const ids = csv
      .split('\r\n')
      .slice(1)
      .map((row) => row.split(',')[0])
    expect(ids).toEqual(['older', 'newer'])
  })
})

describe('csvToBytes', () => {
  it('prefixes a UTF-8 BOM so Excel does not fall back to ANSI', () => {
    const bytes = csvToBytes('Term\r\nCafé')

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('round-trips non-ASCII content', () => {
    const csv = 'Result\r\n"Approved → Café"'
    const decoded = new TextDecoder('utf-8').decode(csvToBytes(csv))

    // TextDecoder strips the leading BOM, leaving the original document.
    expect(decoded).toBe(csv)
  })
})

describe('buildCsvFilename', () => {
  it('matches [project-slug]_[kind]_[YYYY-MM-DD].csv', () => {
    const date = new Date(2026, 8, 2)

    expect(buildCsvFilename('Procure to Pay', 'steps', date)).toBe('procure-to-pay_steps_2026-09-02.csv')
    expect(buildCsvFilename('Procure to Pay', 'gaps', date)).toBe('procure-to-pay_gaps_2026-09-02.csv')
  })

  it('falls back to "project" when the name has no usable characters', () => {
    expect(buildCsvFilename('///', 'steps', new Date(2026, 8, 2))).toBe('project_steps_2026-09-02.csv')
  })
})
