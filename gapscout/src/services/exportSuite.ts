/**
 * exportSuite - Turn a set of chosen formats into the files to write
 *
 * Reference: PRD Section 4.12 - Export Suite
 * Issue: #150
 *
 * The builders (exportDiagram, exportCSV, exportMarkdown, exportMermaid) each
 * produce one artefact. This module is what lets a user pick several at once: it decides
 * which files a selection yields, what they are called, and how many diagram
 * renders are actually needed.
 *
 * Deliberately DOM-free — rasterising is the caller's job (`renderDiagramImage`
 * needs a live viewport), so the plan is built from already-rendered images.
 * That keeps every naming and de-duplication rule under vitest, which cannot
 * rasterise. See services/exportDiagram.ts for the capture itself.
 */

import type { Gap, GlossaryEntry, Milestone, Policy, Project, SIPOC, Step, System, Team } from '../data/types'
import { buildCsvFilename, buildGapsCsv, buildStepsCsv, csvToBytes } from './exportCSV'
import { buildDiagramFilename } from './exportDiagram'
import { buildExportFilename } from './exportFilename'
import { buildMarkdownFilename, buildProcessDocMarkdown, markdownToBytes } from './exportMarkdown'
import { buildMermaid, buildMermaidFilename, mermaidToBytes } from './exportMermaid'
import { dataUrlToBytes, type SaveFilePackFile } from './saveFile'

/**
 * One row in the modal's format list.
 *
 * Keeping the list data-driven is what let #151 (Mermaid) land as a row here
 * plus a branch in `buildExportPlan`, with no change to the modal.
 */
export type ExportFormatId =
  | 'diagram-png'
  | 'diagram-svg'
  | 'mermaid'
  | 'markdown'
  | 'csv-steps'
  | 'csv-gaps'

export interface ExportFormatDescriptor {
  id: ExportFormatId
  label: string
  /** Shown under the label in the modal. */
  hint: string
  /** True when the format cannot be produced without a generated diagram. */
  needsDiagram: boolean
}

/** Order here is the order the modal renders. */
export const EXPORT_FORMATS: readonly ExportFormatDescriptor[] = [
  {
    id: 'diagram-png',
    label: 'Diagram PNG',
    hint: 'Raster image at the scale below',
    needsDiagram: true,
  },
  {
    id: 'diagram-svg',
    label: 'Diagram SVG',
    hint: 'Vector image, scale-independent',
    needsDiagram: true,
  },
  {
    id: 'mermaid',
    label: 'Diagram Mermaid',
    // Built from the step data, not the canvas, so it needs no Generate first.
    hint: 'Flowchart text for wikis and READMEs',
    needsDiagram: false,
  },
  {
    id: 'markdown',
    label: 'Markdown pack',
    hint: 'Process document plus its diagram image',
    needsDiagram: true,
  },
  {
    id: 'csv-steps',
    label: 'Steps CSV',
    hint: 'One row per step, with SIPOC columns',
    needsDiagram: false,
  },
  {
    id: 'csv-gaps',
    label: 'Gaps CSV',
    hint: 'One row per gap, with severity and status',
    needsDiagram: false,
  },
] as const

export const DIAGRAM_FORMAT_IDS: readonly ExportFormatId[] = EXPORT_FORMATS.filter(
  (format) => format.needsDiagram
).map((format) => format.id)

const MIME: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  mmd: 'text/vnd.mermaid',
  md: 'text/markdown',
  csv: 'text/csv',
}

/** A diagram already captured by the caller, tagged with the settings it used. */
export interface RenderedDiagram {
  dataUrl: string
  /** null when captured transparent. */
  background: string | null
  /** True when renderDiagramImage reduced the requested scale. */
  clamped: boolean
}

export interface ExportPlanInput {
  selection: readonly ExportFormatId[]
  project: Project
  steps: Step[]
  gaps: Gap[]
  teams: Team[]
  milestones: Milestone[]
  systems: System[]
  policies: Policy[]
  glossary: GlossaryEntry[]
  /** Absent until the SIPOC wizard has been run; the pack then prints a placeholder. */
  sipoc?: SIPOC
  /** Present when `diagram-png` is selected; captured with the user's background choice. */
  pngDiagram?: RenderedDiagram
  /** Present when `diagram-svg` is selected. */
  svgDiagram?: RenderedDiagram
  /**
   * Present when `markdown` is selected. Always opaque white — a transparent PNG
   * renders as a black rectangle against Confluence's and Coda's dark themes, and
   * this image exists to be read inside a document.
   */
  markdownDiagram?: RenderedDiagram
  generatedAt?: Date
}

/**
 * Which diagram captures a selection needs, and with what background.
 *
 * The Markdown pack forces an opaque white image while a standalone PNG honours
 * the background checkbox. When those agree the same bytes serve both, so the
 * expensive `renderDiagramImage` call runs once rather than twice.
 */
export interface DiagramRenderRequest {
  png: { background: string | null } | null
  svg: { background: string | null } | null
  markdownReusesPng: boolean
  markdownPng: { background: string } | null
}

export const MARKDOWN_IMAGE_BACKGROUND = '#FFFFFF'

export function planDiagramRenders(
  selection: readonly ExportFormatId[],
  background: string | null
): DiagramRenderRequest {
  const wantsPng = selection.includes('diagram-png')
  const wantsSvg = selection.includes('diagram-svg')
  const wantsMarkdown = selection.includes('markdown')

  const markdownReusesPng = wantsPng && wantsMarkdown && background === MARKDOWN_IMAGE_BACKGROUND

  return {
    png: wantsPng ? { background } : null,
    svg: wantsSvg ? { background } : null,
    markdownReusesPng,
    markdownPng: wantsMarkdown && !markdownReusesPng ? { background: MARKDOWN_IMAGE_BACKGROUND } : null,
  }
}

/**
 * Name for the Markdown pack's diagram image.
 *
 * It normally takes the plain `[project]_diagram_[date].png` name and, when a
 * standalone PNG is also being written, that one file serves both. It only needs
 * its own name when the two images differ — a transparent standalone PNG beside
 * the pack's opaque one — which without a suffix would silently overwrite.
 */
export function buildMarkdownImageFilename(
  projectName: string,
  distinct: boolean,
  date: Date = new Date()
): string {
  return distinct
    ? buildExportFilename(projectName, 'process_doc_diagram', 'png', date)
    : buildDiagramFilename(projectName, 'png', date)
}

/**
 * The files a selection produces, in the order they are written.
 *
 * Returns them rather than saving so the caller can choose between the save
 * dialog (exactly one file) and the folder picker (more than one) — see
 * services/saveFile.ts for why a multi-file export cannot use `save()`.
 */
export function buildExportPlan(input: ExportPlanInput): SaveFilePackFile[] {
  const {
    selection,
    project,
    steps,
    gaps,
    teams,
    milestones,
    systems,
    policies,
    glossary,
    sipoc,
    pngDiagram,
    svgDiagram,
    markdownDiagram,
    generatedAt = new Date(),
  } = input

  const files: SaveFilePackFile[] = []

  if (selection.includes('diagram-png')) {
    if (!pngDiagram) throw new Error('Diagram PNG selected but no PNG was rendered')
    files.push({
      name: buildDiagramFilename(project.name, 'png', generatedAt),
      contents: dataUrlToBytes(pngDiagram.dataUrl),
      mimeType: MIME.png,
    })
  }

  if (selection.includes('diagram-svg')) {
    if (!svgDiagram) throw new Error('Diagram SVG selected but no SVG was rendered')
    files.push({
      name: buildDiagramFilename(project.name, 'svg', generatedAt),
      contents: dataUrlToBytes(svgDiagram.dataUrl),
      mimeType: MIME.svg,
    })
  }

  if (selection.includes('mermaid')) {
    files.push({
      name: buildMermaidFilename(project.name, generatedAt),
      contents: mermaidToBytes(buildMermaid({ project, steps, gaps, teams, milestones, systems, generatedAt })),
      mimeType: MIME.mmd,
    })
  }

  if (selection.includes('markdown')) {
    // Falling back to pngDiagram is only sound when the standalone PNG is itself
    // in the plan: that push is what writes the shared file. Reusing it otherwise
    // would suppress the pack's own image and leave the document linking a file
    // nothing wrote, so an unselected PNG is not a fallback and the guard fires.
    const hasStandalonePng = selection.includes('diagram-png')
    const image = markdownDiagram ?? (hasStandalonePng ? pngDiagram : undefined)
    if (!image) throw new Error('Markdown pack selected but no diagram image was rendered')

    // The suffix exists only to avoid overwriting a standalone PNG that differs.
    // With no standalone PNG in the plan there is nothing to collide with, so the
    // pack keeps the plain name it has shipped since #154.
    const sharesPngFile = hasStandalonePng && image === pngDiagram
    const collidesWithPng = hasStandalonePng && !sharesPngFile
    const imageName = buildMarkdownImageFilename(project.name, collidesWithPng, generatedAt)

    const markdown = buildProcessDocMarkdown({
      project,
      steps,
      gaps,
      teams,
      milestones,
      systems,
      policies,
      glossary,
      sipoc,
      diagramImageFilename: imageName,
      generatedAt,
    })

    files.push({
      name: buildMarkdownFilename(project.name, generatedAt),
      contents: markdownToBytes(markdown),
      mimeType: MIME.md,
    })

    // Only written when it is not already in the plan as the standalone PNG.
    if (!sharesPngFile) {
      files.push({
        name: imageName,
        contents: dataUrlToBytes(image.dataUrl),
        mimeType: MIME.png,
      })
    }
  }

  if (selection.includes('csv-steps')) {
    files.push({
      name: buildCsvFilename(project.name, 'steps', generatedAt),
      contents: csvToBytes(buildStepsCsv({ steps, gaps, teams, milestones, systems })),
      mimeType: MIME.csv,
    })
  }

  if (selection.includes('csv-gaps')) {
    files.push({
      name: buildCsvFilename(project.name, 'gaps', generatedAt),
      contents: csvToBytes(buildGapsCsv({ gaps, steps, teams })),
      mimeType: MIME.csv,
    })
  }

  return files
}
