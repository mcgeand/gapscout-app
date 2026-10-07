/**
 * exportMarkdown - The whole project as one Markdown process document
 *
 * Reference: PRD Section 4.12.1 - Markdown Pack Export
 * Issue: #154
 *
 * Pure builders only, matching services/exportCSV.ts and services/exportDiagram.ts:
 * this module turns store data into text, and the caller owns the diagram render
 * and the save dialog (services/saveFile).
 *
 * Section order and table columns follow the PRD and are asserted in the tests —
 * the document is pasted into Coda and Confluence, so its shape is a contract.
 */

import {
  GAP_STATUS_LABELS,
  ROOT_CAUSE_LABELS,
  SEVERITY_LABELS,
} from '../data/constants'
import type {
  Gap,
  GlossaryEntry,
  Milestone,
  Policy,
  Project,
  SIPOC,
  Step,
  System,
  Team,
} from '../data/types'
import { buildExportFilename } from './exportFilename'

/** PRD 4.12.1, Detailed Steps. */
export const STEPS_TABLE_COLUMNS = [
  'Team',
  'Action',
  'Inputs',
  'Outputs',
  'Systems',
  'KPI',
] as const

/** PRD 4.12.1, Gap Analysis. */
export const GAPS_TABLE_COLUMNS = [
  'ID',
  'Step',
  'Severity',
  'Status',
  'Root Cause',
  'Expected',
  'Fix Idea',
  'Jira',
] as const

/** PRD 4.12.1, Jira References. */
export const JIRA_TABLE_COLUMNS = ['Ticket', 'URL', 'Related Gap'] as const

/** PRD 4.12.1, Glossary. */
export const GLOSSARY_TABLE_COLUMNS = ['Term', 'Definition'] as const

/** Matches exportCSV's multi-value joining so the two exports read alike. */
const LIST_SEPARATOR = '; '

/** Sorts anything with no milestone (or an orphaned one) to the end. */
const UNORDERED = Number.MAX_SAFE_INTEGER

/** Heading for steps whose milestone was deleted, so no step is dropped. */
const UNASSIGNED_MILESTONE = 'Unassigned'

/** Placeholder for a section the project has no data for. */
const NONE = '*None recorded*'

export interface ProcessDocInput {
  project: Project
  steps: Step[]
  gaps: Gap[]
  teams: Team[]
  milestones: Milestone[]
  systems: System[]
  policies: Policy[]
  glossary: GlossaryEntry[]
  /** Not persisted yet (#93), so absent for every export until that lands. */
  sipoc?: SIPOC
  /** No field on Project; the caller collects it. PRD 4.12.1. */
  processOwner?: string
  /** Relative name of the diagram image written beside the .md. */
  diagramImageFilename?: string
  /** Injectable for deterministic tests. */
  generatedAt?: Date
}

/**
 * Escape a value for a GFM table cell.
 *
 * A raw pipe ends the cell and shifts every column after it; a raw newline ends
 * the row and drops the rest. Both appear in ordinary step and gap free text
 * ("→ Step 2 if rejected", a multi-line Result), so this is what "tables format
 * properly" actually rests on.
 */
export function escapeTableCell(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>')
    .trim()
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

function joinList(values: string[] | undefined): string {
  if (!values) return ''
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(LIST_SEPARATOR)
}

function nameById<T extends { id: string; name: string }>(entities: T[]): Map<string, string> {
  return new Map(entities.map((entity) => [entity.id, entity.name]))
}

/**
 * `Step.systems` holds system *names* as written in the grid, but an id can end
 * up there too. Mirrors exportCSV: resolve ids, pass anything else through.
 */
function formatSystems(values: string[], systemNames: Map<string, string>): string {
  return joinList(values.map((value) => systemNames.get(value) ?? value))
}

function bulletList(values: string[]): string {
  const items = values.map((value) => value.trim()).filter((value) => value.length > 0)
  if (items.length === 0) return NONE
  return items.map((item) => `- ${item}`).join('\n')
}

function table(columns: readonly string[], rows: string[][]): string {
  const header = `| ${columns.join(' | ')} |`
  const divider = `|${columns.map(() => '---').join('|')}|`
  const body = rows.map((row) => `| ${row.map(escapeTableCell).join(' | ')} |`)
  return [header, divider, ...body].join('\n')
}

/** ISO-8601 UTC, so a document generated anywhere is unambiguous. */
function formatTimestamp(date: Date): string {
  return date.toISOString()
}

/**
 * Milestone-then-step order, matching the CSV export, so the document reads in
 * process order and two exports of unchanged data diff cleanly.
 */
function sortSteps(steps: Step[], milestoneById: Map<string, Milestone>): Step[] {
  return [...steps].sort((a, b) => {
    const aMilestone = milestoneById.get(a.milestoneId)?.order ?? UNORDERED
    const bMilestone = milestoneById.get(b.milestoneId)?.order ?? UNORDERED
    if (aMilestone !== bMilestone) return aMilestone - bMilestone
    if (a.order !== b.order) return a.order - b.order
    return a.id.localeCompare(b.id)
  })
}

/**
 * Policies governing a milestone, from both directions of the relationship.
 *
 * `Milestone.relatedPolicies` and `Policy.relatedMilestones` are maintained by
 * different screens, so either one alone under-reports.
 */
function governingPolicies(milestone: Milestone, policies: Policy[]): string[] {
  const titles = new Map<string, string>()

  for (const policy of policies) {
    const linked =
      milestone.relatedPolicies.includes(policy.id) ||
      policy.relatedMilestones.includes(milestone.id)
    if (linked) titles.set(policy.id, policy.title)
  }

  return [...titles.values()]
}

function sipocSection(sipoc: SIPOC | undefined): string {
  if (!sipoc) {
    return [
      '## SIPOC Overview',
      '',
      '*No SIPOC summary has been captured for this project.*',
    ].join('\n')
  }

  return [
    '## SIPOC Overview',
    '',
    '### Suppliers',
    '',
    bulletList(sipoc.suppliers),
    '',
    '### Inputs',
    '',
    bulletList(sipoc.inputs),
    '',
    '### Process',
    '',
    sipoc.process.trim() || NONE,
    '',
    '### Outputs',
    '',
    bulletList(sipoc.outputs),
    '',
    '### Customers',
    '',
    bulletList(sipoc.customers),
  ].join('\n')
}

function diagramSection(filename: string | undefined): string {
  if (!filename) {
    return [
      '## Process Flow Diagram',
      '',
      '*No diagram image was included in this export.*',
    ].join('\n')
  }

  // Relative link: the image is written into the same folder as the .md, so the
  // pack stays portable when the folder is moved or zipped.
  return ['## Process Flow Diagram', '', `![Process Diagram](./${filename})`].join('\n')
}

function stepsSection(input: ProcessDocInput): string {
  const { steps, teams, milestones, systems, policies } = input
  const teamNames = nameById(teams)
  const systemNames = nameById(systems)
  const milestoneById = new Map(milestones.map((milestone) => [milestone.id, milestone]))

  const ordered = sortSteps(steps, milestoneById)
  if (ordered.length === 0) {
    return ['## Detailed Steps', '', NONE].join('\n')
  }

  // Insertion order follows `ordered`, which already sorts orphans last, so the
  // groups come out in process order without a second sort.
  const groups = new Map<string, Step[]>()
  for (const step of ordered) {
    const key = milestoneById.has(step.milestoneId) ? step.milestoneId : ''
    const group = groups.get(key)
    if (group) group.push(step)
    else groups.set(key, [step])
  }

  const blocks: string[] = ['## Detailed Steps']

  for (const [milestoneId, groupSteps] of groups) {
    const milestone = milestoneById.get(milestoneId)
    blocks.push('', `### Milestone: ${milestone?.name ?? UNASSIGNED_MILESTONE}`)

    if (milestone) {
      const governing = governingPolicies(milestone, policies)
      if (governing.length > 0) {
        blocks.push('', `**Governing Policies**: ${governing.join(', ')}`)
      }
    }

    const rows = groupSteps.map((step) => [
      text(teamNames.get(step.teamId)),
      step.label,
      joinList(step.inputs),
      joinList(step.outputs),
      formatSystems(step.systems, systemNames),
      text(step.kpi),
    ])

    blocks.push('', table(STEPS_TABLE_COLUMNS, rows))
  }

  return blocks.join('\n')
}

/** Jira tickets render as links; a ticket with no URL degrades to plain text. */
function formatJiraLinks(gap: Gap): string {
  return gap.links
    .filter((link) => link.type === 'jira')
    .map((link) => (link.url ? `[${link.label}](${link.url})` : link.label))
    .join(LIST_SEPARATOR)
}

/**
 * Oldest first, matching the CSV export. The store holds gaps newest-first, so
 * both gap tables sort through this rather than reading store order — otherwise
 * Jira References would run backwards against the Gap Analysis table above it.
 */
function sortGaps(gaps: Gap[]): Gap[] {
  return [...gaps].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id.localeCompare(b.id)
  })
}

function gapsSection(ordered: Gap[], steps: Step[]): string {
  const stepLabels = new Map(steps.map((step) => [step.id, step.label]))

  const blocks: string[] = ['## Gap Analysis', '']

  if (ordered.length === 0) {
    blocks.push(NONE)
    return blocks.join('\n')
  }

  const rows = ordered.map((gap) => [
    gap.id,
    gap.stepId ? text(stepLabels.get(gap.stepId)) : '',
    SEVERITY_LABELS[gap.severity],
    GAP_STATUS_LABELS[gap.status],
    gap.rootCause ? ROOT_CAUSE_LABELS[gap.rootCause] : '',
    gap.expected,
    text(gap.fixIdea),
    formatJiraLinks(gap),
  ])

  const countByStatus = (status: Gap['status']) =>
    ordered.filter((gap) => gap.status === status).length

  blocks.push(
    table(GAPS_TABLE_COLUMNS, rows),
    '',
    '**Summary**:',
    '',
    `- Total Gaps: ${ordered.length}`,
    `- High Severity: ${ordered.filter((gap) => gap.severity === 'H').length}`,
    `- Open: ${countByStatus('Open')} | Review: ${countByStatus('Review')} | Closed: ${countByStatus('Closed')}`
  )

  return blocks.join('\n')
}

function jiraSection(ordered: Gap[]): string {
  const rows: string[][] = []

  for (const gap of ordered) {
    for (const link of gap.links) {
      if (link.type !== 'jira') continue
      rows.push([link.label, link.url, gap.id])
    }
  }

  if (rows.length === 0) {
    return ['## Jira References', '', NONE].join('\n')
  }

  return ['## Jira References', '', table(JIRA_TABLE_COLUMNS, rows)].join('\n')
}

function glossarySection(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) {
    return ['## Glossary', '', NONE].join('\n')
  }

  const ordered = [...glossary].sort((a, b) =>
    a.term.localeCompare(b.term, undefined, { sensitivity: 'base' })
  )

  const rows = ordered.map((entry) => [
    entry.acronym ? `${entry.term} (${entry.acronym})` : entry.term,
    entry.definition,
  ])

  return ['## Glossary', '', table(GLOSSARY_TABLE_COLUMNS, rows)].join('\n')
}

/**
 * Build the full process document (PRD 4.12.1).
 *
 * Sections are always present even when empty: a reader scanning for "Gap
 * Analysis" should find the heading and read "none recorded" rather than wonder
 * whether the export dropped it.
 */
export function buildProcessDocMarkdown(input: ProcessDocInput): string {
  const { project, gaps, steps, glossary, sipoc, processOwner, diagramImageFilename } = input
  const generatedAt = input.generatedAt ?? new Date()
  const orderedGaps = sortGaps(gaps)

  // Two trailing spaces are a Markdown hard line break, so Generated and
  // Process Owner stay on separate lines instead of reflowing into one.
  const metadata = [`**Generated**: ${formatTimestamp(generatedAt)}`]
  if (processOwner?.trim()) {
    metadata.push(`**Process Owner**: ${processOwner.trim()}`)
  }

  const sections = [
    `# ${project.name} — Process Documentation`,
    '',
    metadata.join('  \n'),
    '',
    '---',
    '',
    ['## Executive Summary', '', project.description?.trim() || NONE].join('\n'),
    '',
    '---',
    '',
    sipocSection(sipoc),
    '',
    '---',
    '',
    diagramSection(diagramImageFilename),
    '',
    '---',
    '',
    stepsSection(input),
    '',
    '---',
    '',
    gapsSection(orderedGaps, steps),
    '',
    '---',
    '',
    jiraSection(orderedGaps),
    '',
    '---',
    '',
    glossarySection(glossary),
    '',
    '---',
    '',
    `*Generated by GapScout v${__APP_VERSION__}*`,
    '',
  ]

  return sections.join('\n')
}

/**
 * UTF-8, deliberately without a byte-order mark.
 *
 * The CSV export writes one because Excel needs it, but a BOM ahead of `# ` is
 * read as part of the heading text by several Markdown parsers and breaks the
 * document title.
 */
export function markdownToBytes(markdown: string): Uint8Array {
  return new TextEncoder().encode(markdown)
}

/**
 * `[project-slug]_process_doc_[YYYY-MM-DD].md`.
 *
 * PRD 4.12.1 writes the stamp as `YYYYMMDD`, but every other export in 4.12 uses
 * the dashed form and shares `buildExportFilename`; one naming rule across the
 * suite beats matching a single inconsistent line of the spec.
 */
export function buildMarkdownFilename(projectName: string, date: Date = new Date()): string {
  return buildExportFilename(projectName, 'process_doc', 'md', date)
}
