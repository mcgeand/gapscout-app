/**
 * ExportModal - Pick several export formats and write them in one go
 *
 * Reference: PRD Section 4.12 - Export Suite
 * Issue: #150
 *
 * Replaces the per-format dropdown that #152/#153/#154 grew one button at a
 * time. The format list comes from services/exportSuite, so #151 (Mermaid) adds
 * a row there rather than a branch here.
 *
 * The modal owns the diagram scale and background because they are export
 * settings, not canvas state; DiagramCanvas only supplies the live viewport.
 */

import { useCallback, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Modal } from '../shared/Modal'
import type { Node } from 'reactflow'
import type { SwimlaneLayout } from '../../lib/layout'
import type { Gap, GlossaryEntry, Milestone, Policy, Project, SIPOC, Step, System, Team } from '../../data/types'
import { renderDiagramImage } from '../../services/exportDiagram'
import {
  EXPORT_FORMATS,
  MARKDOWN_IMAGE_BACKGROUND,
  buildExportPlan,
  planDiagramRenders,
  type ExportFormatId,
  type RenderedDiagram,
} from '../../services/exportSuite'
import { saveFile, saveFilePack, type SaveFilePackFile } from '../../services/saveFile'
import { captureProjectScope, isProjectScopeCurrent } from '../../state/workspaceScope'

/** PRD 4.12.3 offers 1x, 2x and 3x; 2x is the documented default. */
const EXPORT_SCALES = [1, 2, 3] as const

/** Opens with the two formats a first-time export almost always wants. */
const DEFAULT_SELECTION: ExportFormatId[] = ['diagram-png', 'markdown']

export interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
  /** Null while the project is still loading; the modal says so rather than failing on Export. */
  project: Project | null
  steps: Step[]
  gaps: Gap[]
  teams: Team[]
  milestones: Milestone[]
  systems: System[]
  policies: Policy[]
  glossary: GlossaryEntry[]
  /** Null until the SIPOC wizard has been run; the Markdown pack then says so. */
  sipoc: SIPOC | null
  /** The live `.react-flow__viewport`, or null before the diagram is generated. */
  getViewport: () => HTMLElement | null
  nodes: Node[]
  swimlanes: SwimlaneLayout[]
  /** False before Generate has run: the formats captured from the canvas cannot be produced. */
  hasDiagram: boolean
  /**
   * When diagram formats are disabled, replaces the default "Generate the diagram
   * first" hint — e.g. from the board header, where the user is not on Diagram (#327).
   */
  diagramUnavailableHint?: string
}

/** Set only when renderDiagramImage reduced the scale, so the notice can say to what. */
interface ClampedInfo {
  width: number
  height: number
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number; label: string }
  | { kind: 'done'; files: string[]; location: string; clamped: ClampedInfo | null }
  | { kind: 'error'; message: string }

export default function ExportModal({
  isOpen,
  onClose,
  project,
  steps,
  gaps,
  teams,
  milestones,
  systems,
  policies,
  glossary,
  sipoc,
  getViewport,
  nodes,
  swimlanes,
  hasDiagram,
  diagramUnavailableHint,
}: ExportModalProps) {
  // The modal stays mounted while closed, so the selection, scale and background
  // survive a close. Reopening deliberately offers the last export again — the
  // common case is re-running the same set after an edit.
  const [selection, setSelection] = useState<ExportFormatId[]>(DEFAULT_SELECTION)
  const [scale, setScale] = useState(2)
  const [whiteBackground, setWhiteBackground] = useState(true)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const isRunning = phase.kind === 'running'

  // A selection of a disabled format cannot be exported, so the button and the
  // plan both read this rather than the raw checkbox state.
  const effectiveSelection = useMemo(
    () =>
      selection.filter(
        (id) => hasDiagram || !EXPORT_FORMATS.find((format) => format.id === id)?.needsDiagram
      ),
    [selection, hasDiagram]
  )

  const showsDiagramOptions = effectiveSelection.some(
    (id) => EXPORT_FORMATS.find((format) => format.id === id)?.needsDiagram
  )

  const diagramDisabledHint =
    diagramUnavailableHint ?? 'Generate the diagram first'

  const toggle = useCallback((id: ExportFormatId) => {
    // Clearing the phase retires the previous run's success panel: it names
    // files that no longer match what is now selected.
    setPhase({ kind: 'idle' })
    setSelection((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    )
  }, [])

  const handleClose = useCallback(() => {
    if (isRunning) return
    setPhase({ kind: 'idle' })
    onClose()
  }, [isRunning, onClose])

  const runExport = useCallback(async () => {
    if (!project) {
      setPhase({ kind: 'error', message: 'Project is still loading — try the export again.' })
      return
    }
    if (effectiveSelection.length === 0) return

    // A render can take seconds. If the user switches project meanwhile, the
    // props in this closure describe the project they left, so writing them
    // would save the old workspace's data under a stale name.
    const scope = captureProjectScope(project.id)
    if (!scope) return

    const background = whiteBackground ? MARKDOWN_IMAGE_BACKGROUND : null
    const renders = planDiagramRenders(effectiveSelection, background)
    const renderCount = [renders.png, renders.svg, renders.markdownPng].filter(Boolean).length
    // Renders plus one step for the write itself, so the counter reaches its total.
    const total = renderCount + 1

    let done = 0
    const advance = (label: string) => {
      setPhase({ kind: 'running', done, total, label })
    }

    advance('Preparing export')

    let clamped: ClampedInfo | null = null

    try {
      let viewport: HTMLElement | null = null
      if (renderCount > 0) {
        viewport = getViewport()
        if (!viewport) throw new Error('Generate the diagram before exporting')
      }

      const capture = async (
        format: 'png' | 'svg',
        imageBackground: string | null,
        label: string
      ): Promise<RenderedDiagram> => {
        advance(label)
        const result = await renderDiagramImage(viewport!, nodes, swimlanes, {
          format,
          scale,
          background: imageBackground,
        })
        done += 1
        if (result.clamped) clamped = { width: result.width, height: result.height }
        return { dataUrl: result.dataUrl, background: imageBackground, clamped: result.clamped }
      }

      /** Abandon the run when the workspace moved on under a slow render. */
      const stale = () => {
        if (isProjectScopeCurrent(scope)) return false
        setPhase({ kind: 'idle' })
        return true
      }

      const pngDiagram = renders.png
        ? await capture('png', renders.png.background, 'Rendering diagram PNG')
        : undefined
      const svgDiagram = renders.svg
        ? await capture('svg', renders.svg.background, 'Rendering diagram SVG')
        : undefined
      const markdownDiagram = renders.markdownPng
        ? await capture('png', renders.markdownPng.background, 'Rendering document image')
        : undefined

      if (stale()) return

      const generatedAt = new Date()
      const files: SaveFilePackFile[] = buildExportPlan({
        selection: effectiveSelection,
        project,
        steps,
        gaps,
        teams,
        milestones,
        systems,
        policies,
        glossary,
        ...(sipoc ? { sipoc } : {}),
        ...(pngDiagram ? { pngDiagram } : {}),
        ...(svgDiagram ? { svgDiagram } : {}),
        ...(markdownDiagram ? { markdownDiagram } : {}),
        generatedAt,
      })

      advance(files.length === 1 ? `Writing ${files[0].name}` : `Writing ${files.length} files`)

      // One file keeps the save dialog PRD 4.12.3 describes. Two or more must use
      // the folder picker: tauri-plugin-dialog scopes `save()` to the single chosen
      // file, so writing a sibling beside it is denied — see services/saveFile.ts.
      const location =
        files.length === 1
          ? await saveFile({
              defaultName: files[0].name,
              contents: files[0].contents,
              filters: [fileFilter(files[0].name)],
              ...(files[0].mimeType ? { mimeType: files[0].mimeType } : {}),
            })
          : await saveFilePack({ title: 'Choose a folder for the export', files })

      // Null means the user dismissed the dialog, which is not an error.
      if (location === null) {
        setPhase({ kind: 'idle' })
        return
      }

      if (stale()) return

      setPhase({
        kind: 'done',
        files: files.map((file) => file.name),
        location,
        clamped,
      })
    } catch (error) {
      // A failure after a project switch belongs to a workspace the user has
      // left; surfacing it would attach the old project's error to the new one.
      if (!isProjectScopeCurrent(scope)) {
        setPhase({ kind: 'idle' })
        return
      }
      console.error('Export failed:', error)
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Export failed',
      })
    }
  }, [
    project,
    effectiveSelection,
    whiteBackground,
    getViewport,
    nodes,
    swimlanes,
    scale,
    steps,
    gaps,
    teams,
    milestones,
    systems,
    policies,
    glossary,
    sipoc,
  ])

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Export"
      description="Choose one or more formats. Everything selected is written in a single pass."
      size="sm"
      footer={
        <>
          <button onClick={handleClose} disabled={isRunning} className="btn-secondary">
            {phase.kind === 'done' ? 'Done' : 'Cancel'}
          </button>
          <button
            onClick={runExport}
            disabled={isRunning || effectiveSelection.length === 0}
            className="btn-primary inline-flex items-center gap-gs-2"
          >
            <Download size={16} strokeWidth={2} />
            {isRunning ? 'Exporting…' : `Export ${effectiveSelection.length || ''}`.trim()}
          </button>
        </>
      }
    >
          <div className="flex flex-col gap-gs-2 mb-gs-6">
            {EXPORT_FORMATS.map((format) => {
              const disabled = format.needsDiagram && !hasDiagram
              return (
                <label
                  key={format.id}
                  className={`flex items-start gap-gs-2 border border-gs-rule p-gs-3 ${
                    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-[2px] accent-gs-accent"
                    checked={effectiveSelection.includes(format.id)}
                    disabled={disabled || isRunning}
                    onChange={() => toggle(format.id)}
                  />
                  <span className="flex-1">
                    <span className="block text-[13px] font-semibold text-gs-ink">
                      {format.label}
                    </span>
                    <span className="block text-xs text-gs-ink-muted mt-gs-1">
                      {disabled ? diagramDisabledHint : format.hint}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          {showsDiagramOptions && (
            <div className="mb-gs-6">
              <div className="text-xs font-semibold text-gs-ink-muted mb-gs-1">Diagram scale</div>
              <div className="flex gap-gs-2">
                {EXPORT_SCALES.map((option) => (
                  <button
                    key={option}
                    onClick={() => setScale(option)}
                    disabled={isRunning}
                    aria-pressed={scale === option}
                    className={scale === option ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
                  >
                    {option}x
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-gs-2 mt-gs-3 text-[13px] text-gs-ink cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-gs-accent"
                  checked={whiteBackground}
                  disabled={isRunning}
                  onChange={(event) => setWhiteBackground(event.target.checked)}
                />
                White background
              </label>
              {/* Only true when a standalone PNG is also selected — without one
                  the pack's image keeps the plain name and splits from nothing. */}
              {!whiteBackground &&
                effectiveSelection.includes('markdown') &&
                effectiveSelection.includes('diagram-png') && (
                <p className="text-xs text-gs-ink-muted mt-gs-1">
                  The Markdown pack keeps an opaque image so it stays readable in dark-themed
                  wikis, so it gets its own file.
                </p>
              )}
            </div>
          )}

          {phase.kind === 'running' && (
            <div
              role="status"
              aria-live="polite"
              className="border border-gs-rule p-gs-3 mb-gs-4 text-[13px] text-gs-ink"
            >
              <div className="flex justify-between">
                <span>{phase.label}…</span>
                <span className="text-gs-ink-muted">
                  {phase.done} of {phase.total}
                </span>
              </div>
              <div className="h-[4px] bg-gs-rule-faint mt-gs-2">
                <div
                  className="h-full bg-gs-accent transition-[width] duration-150"
                  style={{ width: `${(phase.done / phase.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {phase.kind === 'done' && (
            <div
              role="status"
              aria-live="polite"
              className="border-2 border-gs-ink p-gs-3 mb-gs-4 text-[13px]"
            >
              <div className="font-semibold text-gs-ink">
                Exported {phase.files.length} {phase.files.length === 1 ? 'file' : 'files'}
              </div>
              <ul className="mt-gs-2 flex flex-col gap-gs-1 text-gs-ink-muted">
                {phase.files.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <div className="mt-gs-2 text-xs text-gs-ink-muted break-all">{phase.location}</div>
              {phase.clamped && (
                <div className="mt-gs-2 text-xs text-gs-accent-ink">
                  Image scale was reduced to {phase.clamped.width}x{phase.clamped.height} to stay
                  within image size limits.
                </div>
              )}
            </div>
          )}

          {phase.kind === 'error' && (
            <div
              role="alert"
              className="border-2 border-gs-accent p-gs-3 mb-gs-4 text-[13px] text-gs-accent-ink"
            >
              {phase.message}
            </div>
          )}

    </Modal>
  )
}

/** Save-dialog filter for the single-file path, derived from the built filename. */
function fileFilter(name: string): { name: string; extensions: string[] } {
  const extension = name.slice(name.lastIndexOf('.') + 1)
  return { name: extension.toUpperCase(), extensions: [extension] }
}
