/**
 * exportCSV - Steps and gaps as spreadsheet-ready CSV
 *
 * Reference: PRD Section 4.12.2 - CSV Exports
 * Issue: #153
 *
 * Pure builders only, mirroring services/exportDiagram.ts: this module turns
 * store data into bytes, and the caller owns the save dialog (services/saveFile).
 *
 * Column names and order are fixed by the PRD and asserted verbatim in the
 * tests — downstream spreadsheets and pivot tables key off them, so treat the
 * header rows as a contract rather than a formatting detail.
 */

import Papa from 'papaparse'
import {
  GAP_STATUS_LABELS,
  ROOT_CAUSE_LABELS,
  SEVERITY_LABELS,
  TIME_TO_FIX_LABELS,
} from '../data/constants'
import type { Gap, Milestone, Step, System, Team } from '../data/types'
import { buildExportFilename } from './exportFilename'

export type CsvExportKind = 'steps' | 'gaps'

/** PRD 4.12.2, Steps CSV. */
export const STEPS_CSV_COLUMNS = [
  'Milestone',
  'Milestone Order',
  'Team',
  'Step ID',
  'Step Label',
  'Order',
  'Suppliers',
  'Inputs',
  'Outputs',
  'Customers',
  'Systems',
  'Trigger',
  'Result',
  'KPI',
  'Gap Count',
  'Created At',
] as const

/** PRD 4.12.2, Gaps CSV. */
export const GAPS_CSV_COLUMNS = [
  'Gap ID',
  'Step ID',
  'Step Label',
  'Team',
  'Severity',
  'Priority',
  'Status',
  'Root Cause',
  'Observed',
  'Expected',
  'Fix Idea',
  'Time to Fix',
  'Jira Tickets',
  'Created At',
  'Closed At',
] as const

/**
 * Multi-value cells use `; ` because a comma is the field delimiter — a joined
 * list would otherwise have to be quoted and would read as one blob anyway.
 */
const LIST_SEPARATOR = '; '

/** Sorts anything with no milestone (or an orphaned one) to the end. */
const UNORDERED = Number.MAX_SAFE_INTEGER

function joinList(values: string[] | undefined): string {
  if (!values) return ''
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(LIST_SEPARATOR)
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

/** ISO-8601 so spreadsheets parse it; locale strings do not round-trip. */
function formatTimestamp(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined) return ''
  return new Date(timestamp).toISOString()
}

function nameById<T extends { id: string; name: string }>(entities: T[]): Map<string, string> {
  return new Map(entities.map((entity) => [entity.id, entity.name]))
}

/**
 * `Step.systems` holds system *names* as written in the grid, but an id can end
 * up there too. Resolve what matches an id and pass anything else through, so a
 * hand-typed system is exported rather than silently dropped.
 */
function formatSystems(values: string[], systemNames: Map<string, string>): string {
  return joinList(values.map((value) => systemNames.get(value) ?? value))
}

function toCsv(fields: readonly string[], rows: string[][]): string {
  // Papa defaults to RFC 4180: CRLF rows, quotes only where a value needs them.
  //
  // Free text opening with a dash ("- late invoices") is read as a formula by
  // Excel's CSV importer and renders #NAME?. Papa's `escapeFormulae` was tried
  // and rejected: Excel treats the apostrophe it inserts as literal text rather
  // than a text marker, so the cell still reads wrong *and* the prefix is now in
  // the file for every other consumer. Cells stay exactly as the user typed them.
  return Papa.unparse({ fields: [...fields], data: rows })
}

export interface StepsCsvInput {
  steps: Step[]
  /** Source of truth for Gap Count; `Step.gapIds` is only a filtering hint. */
  gaps: Gap[]
  teams: Team[]
  milestones: Milestone[]
  systems: System[]
}

/**
 * Rows run in process order — milestone order, then step order — so two exports
 * of unchanged data diff cleanly.
 */
export function buildStepsCsv({
  steps,
  gaps,
  teams,
  milestones,
  systems,
}: StepsCsvInput): string {
  const teamNames = nameById(teams)
  const systemNames = nameById(systems)
  const milestoneById = new Map(milestones.map((milestone) => [milestone.id, milestone]))

  const gapCounts = new Map<string, number>()
  for (const gap of gaps) {
    if (!gap.stepId) continue
    gapCounts.set(gap.stepId, (gapCounts.get(gap.stepId) ?? 0) + 1)
  }

  const ordered = [...steps].sort((a, b) => {
    const aMilestone = milestoneById.get(a.milestoneId)?.order ?? UNORDERED
    const bMilestone = milestoneById.get(b.milestoneId)?.order ?? UNORDERED
    if (aMilestone !== bMilestone) return aMilestone - bMilestone
    if (a.order !== b.order) return a.order - b.order
    return a.id.localeCompare(b.id)
  })

  const rows = ordered.map((step) => {
    const milestone = milestoneById.get(step.milestoneId)

    // The two order columns keep the stored values on purpose, so the #345 ban
    // is disabled here rather than satisfied. A spreadsheet is not a screen: the
    // sheet ships Milestone Order beside Step Order, so the pair `(2, 1)` is
    // unambiguous in a way the bare "1" on a screen is not, and a reader
    // reconstructing the process sorts on both. Substituting a running position
    // would also make the column disagree with what the grid's editor writes.
    return [
      text(milestone?.name),
      // eslint-disable-next-line no-restricted-syntax -- see above: exported data, not a label
      milestone ? String(milestone.order) : '',
      text(teamNames.get(step.teamId)),
      step.id,
      step.label,
      // eslint-disable-next-line no-restricted-syntax -- see above: exported data, not a label
      String(step.order),
      joinList(step.suppliers),
      joinList(step.inputs),
      joinList(step.outputs),
      joinList(step.customers),
      formatSystems(step.systems, systemNames),
      text(step.trigger),
      text(step.result),
      text(step.kpi),
      String(gapCounts.get(step.id) ?? 0),
      formatTimestamp(step.createdAt),
    ]
  })

  return toCsv(STEPS_CSV_COLUMNS, rows)
}

export interface GapsCsvInput {
  gaps: Gap[]
  /** Only used to resolve Step Label; a process gap has no step. */
  steps: Step[]
  teams: Team[]
}

/**
 * `Team` is the gap's owning team (`ownerTeamId`), not the step's — a process gap
 * has no step at all, and the step's own team stays reachable via Step ID.
 */
export function buildGapsCsv({ gaps, steps, teams }: GapsCsvInput): string {
  const teamNames = nameById(teams)
  const stepLabels = new Map(steps.map((step) => [step.id, step.label]))

  const ordered = [...gaps].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id.localeCompare(b.id)
  })

  const rows = ordered.map((gap) => {
    const jiraTickets = gap.links
      .filter((link) => link.type === 'jira')
      .map((link) => link.label)

    return [
      gap.id,
      text(gap.stepId),
      gap.stepId ? text(stepLabels.get(gap.stepId)) : '',
      gap.ownerTeamId ? text(teamNames.get(gap.ownerTeamId)) : '',
      SEVERITY_LABELS[gap.severity],
      gap.priority === null || gap.priority === undefined ? '' : String(gap.priority),
      GAP_STATUS_LABELS[gap.status],
      gap.rootCause ? ROOT_CAUSE_LABELS[gap.rootCause] : '',
      gap.observed,
      gap.expected,
      text(gap.fixIdea),
      gap.timeToFix ? TIME_TO_FIX_LABELS[gap.timeToFix] : '',
      joinList(jiraTickets),
      formatTimestamp(gap.createdAt),
      formatTimestamp(gap.closedAt),
    ]
  })

  return toCsv(GAPS_CSV_COLUMNS, rows)
}

/**
 * UTF-8 with a byte-order mark (PRD 4.12.2).
 *
 * Excel on Windows reads a BOM-less CSV as the legacy ANSI code page, which
 * turns every accented character and arrow into mojibake. The BOM is what makes
 * the file open correctly by double-click.
 */
export function csvToBytes(csv: string): Uint8Array {
  return new TextEncoder().encode(`\uFEFF${csv}`)
}

/** `[project-slug]_steps_[YYYY-MM-DD].csv`, per PRD 4.12.2. */
export function buildCsvFilename(
  projectName: string,
  kind: CsvExportKind,
  date: Date = new Date()
): string {
  return buildExportFilename(projectName, kind, 'csv', date)
}
