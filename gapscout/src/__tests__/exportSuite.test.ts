/**
 * Unit tests for the export plan builder (issue #150, PRD 4.12).
 *
 * The plan is where multi-format export can go quietly wrong: two selected
 * formats resolving to one filename overwrites a file the user asked for, and a
 * needlessly duplicated diagram render doubles the slowest step. Neither shows
 * up in a type check, and neither is visible from the modal, so both are
 * asserted here.
 */

import { describe, expect, it } from 'vitest'
import {
  EXPORT_FORMATS,
  MARKDOWN_IMAGE_BACKGROUND,
  buildExportPlan,
  buildMarkdownImageFilename,
  planDiagramRenders,
  type ExportFormatId,
  type ExportPlanInput,
  type RenderedDiagram,
} from '../services/exportSuite'
import type { Gap, Project, Step, Team } from '../data/types'

const CREATED = Date.UTC(2026, 0, 15, 9, 30, 0)
const GENERATED = new Date(Date.UTC(2026, 8, 2, 12, 0, 0))

const project: Project = {
  id: 'p1',
  name: 'Procure to Pay',
  description: 'How a purchase request becomes a paid invoice.',
  createdAt: CREATED,
  updatedAt: CREATED,
}

const team: Team = {
  id: 't1',
  projectId: 'p1',
  name: 'Finance',
  color: '#F59E0B',
  order: 0,
  tags: [],
  createdAt: CREATED,
}

const step: Step = {
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
  systems: [],
  trigger: 'Request submitted',
  result: 'Approved',
  kpi: '2 day turnaround',
  comments: [],
  links: [],
  gapIds: [],
  createdAt: CREATED,
  updatedAt: CREATED,
}

const gap: Gap = {
  id: 'g1',
  projectId: 'p1',
  stepId: 's1',
  observed: 'Approvals sit unread',
  expected: 'Approved within 2 days',
  severity: 'H',
  status: 'Open',
  links: [],
  createdAt: CREATED,
  updatedAt: CREATED,
}

/** Distinct payloads, so a shared file is provable by content and not just name. */
function image(marker: string, background: string | null): RenderedDiagram {
  return {
    dataUrl: `data:image/png;base64,${btoa(marker)}`,
    background,
    clamped: false,
  }
}

function plan(
  selection: ExportFormatId[],
  overrides: Partial<ExportPlanInput> = {}
): ReturnType<typeof buildExportPlan> {
  return buildExportPlan({
    selection,
    project,
    steps: [step],
    gaps: [gap],
    teams: [team],
    milestones: [{ id: 'm1', projectId: 'p1', name: 'Approval', order: 0, relatedPolicies: [], createdAt: CREATED, updatedAt: CREATED }],
    systems: [],
    policies: [],
    glossary: [],
    generatedAt: GENERATED,
    ...overrides,
  })
}

function names(files: ReturnType<typeof buildExportPlan>): string[] {
  return files.map((file) => file.name)
}

function text(file: ReturnType<typeof buildExportPlan>[number]): string {
  return new TextDecoder().decode(file.contents)
}

describe('EXPORT_FORMATS', () => {
  it('exposes every format the modal offers, with unique ids', () => {
    const ids = EXPORT_FORMATS.map((format) => format.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['diagram-png', 'diagram-svg', 'mermaid', 'markdown', 'csv-steps', 'csv-gaps'])
  })

  it('marks only the diagram-derived formats as needing a generated diagram', () => {
    const needs = EXPORT_FORMATS.filter((format) => format.needsDiagram).map((f) => f.id)
    expect(needs).toEqual(['diagram-png', 'diagram-svg', 'markdown'])
  })
})

describe('planDiagramRenders', () => {
  it('renders the diagram once when the PNG and the pack want the same image', () => {
    const renders = planDiagramRenders(['diagram-png', 'markdown'], MARKDOWN_IMAGE_BACKGROUND)

    expect(renders.markdownReusesPng).toBe(true)
    expect(renders.markdownPng).toBeNull()
    expect(renders.png).toEqual({ background: MARKDOWN_IMAGE_BACKGROUND })
  })

  it('renders twice when the standalone PNG is transparent and the pack is not', () => {
    const renders = planDiagramRenders(['diagram-png', 'markdown'], null)

    expect(renders.markdownReusesPng).toBe(false)
    expect(renders.png).toEqual({ background: null })
    expect(renders.markdownPng).toEqual({ background: MARKDOWN_IMAGE_BACKGROUND })
  })

  it('still forces an opaque pack image when no standalone PNG is selected', () => {
    const renders = planDiagramRenders(['markdown'], null)

    expect(renders.png).toBeNull()
    expect(renders.markdownPng).toEqual({ background: MARKDOWN_IMAGE_BACKGROUND })
  })

  it('asks for no render at all when only CSVs are selected', () => {
    const renders = planDiagramRenders(['csv-steps', 'csv-gaps'], MARKDOWN_IMAGE_BACKGROUND)

    expect(renders.png).toBeNull()
    expect(renders.svg).toBeNull()
    expect(renders.markdownPng).toBeNull()
  })
})

describe('buildExportPlan', () => {
  it('carries the persisted SIPOC into the document pack (#93)', () => {
    const files = plan(['markdown'], {
      markdownDiagram: image('opaque-png', MARKDOWN_IMAGE_BACKGROUND),
      sipoc: {
        projectId: 'p1',
        suppliers: ['Warehouse'],
        inputs: ['Pick list'],
        process: 'Pick the order. Pack the order.',
        outputs: ['Packed carton'],
        customers: ['Courier'],
      },
    })

    expect(text(files[0])).toContain('Pick the order. Pack the order.')
    expect(text(files[0])).not.toContain('No SIPOC summary has been captured')
  })

  it('says so in the pack when no SIPOC has been captured', () => {
    const files = plan(['markdown'], {
      markdownDiagram: image('opaque-png', MARKDOWN_IMAGE_BACKGROUND),
    })

    expect(text(files[0])).toContain('No SIPOC summary has been captured')
  })

  it('names a single CSV the way the standalone export does', () => {
    expect(names(plan(['csv-gaps']))).toEqual(['procure-to-pay_gaps_2026-09-02.csv'])
  })

  it('returns one file per selected format, in list order', () => {
    const files = plan(['csv-gaps', 'csv-steps', 'diagram-svg'], {
      svgDiagram: image('svg', MARKDOWN_IMAGE_BACKGROUND),
    })

    expect(names(files)).toEqual([
      'procure-to-pay_diagram_2026-09-02.svg',
      'procure-to-pay_steps_2026-09-02.csv',
      'procure-to-pay_gaps_2026-09-02.csv',
    ])
  })

  it('writes the shared image once when the PNG and the pack agree', () => {
    const shared = image('shared-png', MARKDOWN_IMAGE_BACKGROUND)
    const files = plan(['diagram-png', 'markdown'], { pngDiagram: shared })

    expect(names(files)).toEqual([
      'procure-to-pay_diagram_2026-09-02.png',
      'procure-to-pay_process_doc_2026-09-02.md',
    ])
    // The document must point at the one image that is actually written.
    expect(text(files[1])).toContain('](./procure-to-pay_diagram_2026-09-02.png)')
  })

  it('gives the pack image its own name when it differs from the standalone PNG', () => {
    const files = plan(['diagram-png', 'markdown'], {
      pngDiagram: image('transparent-png', null),
      markdownDiagram: image('opaque-png', MARKDOWN_IMAGE_BACKGROUND),
    })

    expect(names(files)).toEqual([
      'procure-to-pay_diagram_2026-09-02.png',
      'procure-to-pay_process_doc_2026-09-02.md',
      'procure-to-pay_process_doc_diagram_2026-09-02.png',
    ])
    expect(new Set(names(files)).size).toBe(3)
    expect(text(files[1])).toContain('](./procure-to-pay_process_doc_diagram_2026-09-02.png)')
    // Distinct payloads prove the transparent image was not silently reused.
    expect(files[0].contents).not.toEqual(files[2].contents)
  })

  it('keeps the plain image name when the pack is exported on its own', () => {
    const files = plan(['markdown'], {
      markdownDiagram: image('opaque-png', MARKDOWN_IMAGE_BACKGROUND),
    })

    expect(names(files)).toEqual([
      'procure-to-pay_process_doc_2026-09-02.md',
      'procure-to-pay_diagram_2026-09-02.png',
    ])
  })

  it('never emits two files with the same name for any selection', () => {
    const files = plan(EXPORT_FORMATS.map((format) => format.id), {
      pngDiagram: image('transparent-png', null),
      svgDiagram: image('svg', null),
      markdownDiagram: image('opaque-png', MARKDOWN_IMAGE_BACKGROUND),
    })

    // Every format plus the pack's own image, which differs from the standalone PNG.
    expect(files).toHaveLength(EXPORT_FORMATS.length + 1)
    expect(new Set(names(files)).size).toBe(files.length)
  })

  it('writes the Mermaid flowchart from the step data with no diagram rendered (#151)', () => {
    const files = plan(['mermaid'])

    expect(names(files)).toEqual(['procure-to-pay_diagram_2026-09-02.mmd'])
    expect(files[0].mimeType).toBe('text/vnd.mermaid')
    expect(text(files[0])).toContain('flowchart LR')
    expect(text(files[0])).toContain('["Review purchase request"]')
  })

  it('refuses to plan a diagram format without its rendered image', () => {
    expect(() => plan(['diagram-png'])).toThrow(/no PNG was rendered/)
    expect(() => plan(['markdown'])).toThrow(/no diagram image was rendered/)
  })

  it('never borrows an unselected PNG for the pack, which nothing would write', () => {
    // Reusing it would suppress the pack's own image push and leave the document
    // linking a file absent from the plan, so this has to fail loudly instead.
    expect(() =>
      plan(['markdown'], { pngDiagram: image('stray-png', MARKDOWN_IMAGE_BACKGROUND) })
    ).toThrow(/no diagram image was rendered/)
  })

  it('writes an image for every image the document links', () => {
    const selections: ExportFormatId[][] = [
      ['markdown'],
      ['diagram-png', 'markdown'],
      ['diagram-png', 'diagram-svg', 'markdown', 'csv-steps', 'csv-gaps'],
    ]

    for (const selection of selections) {
      const files = plan(selection, {
        ...(selection.includes('diagram-png') ? { pngDiagram: image('png', null) } : {}),
        ...(selection.includes('diagram-svg') ? { svgDiagram: image('svg', null) } : {}),
        markdownDiagram: image('opaque-png', MARKDOWN_IMAGE_BACKGROUND),
      })

      const doc = files.find((file) => file.name.endsWith('.md'))!
      const linked = /!\[Process Diagram\]\(\.\/(.+?)\)/.exec(text(doc))![1]
      expect(names(files), `selection ${selection.join('+')}`).toContain(linked)
    }
  })

  it('keeps the CSV byte-order mark so Excel reads UTF-8', () => {
    // Asserted on bytes: TextDecoder swallows the BOM, so decoded text cannot see it.
    expect(Array.from(plan(['csv-steps'])[0].contents.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })
})

describe('buildMarkdownImageFilename', () => {
  it('uses the plain diagram name unless a distinct one is required', () => {
    expect(buildMarkdownImageFilename('Procure to Pay', false, GENERATED)).toBe(
      'procure-to-pay_diagram_2026-09-02.png'
    )
    expect(buildMarkdownImageFilename('Procure to Pay', true, GENERATED)).toBe(
      'procure-to-pay_process_doc_diagram_2026-09-02.png'
    )
  })
})
