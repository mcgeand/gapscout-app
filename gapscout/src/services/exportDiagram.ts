/**
 * exportDiagram - Render the process diagram to a PNG or SVG image
 *
 * Reference: PRD Section 4.12.3 - PNG/SVG Diagram Export
 * Issue: #152
 *
 * The React Flow viewport holds the nodes and edges, but the swimlane bands are
 * drawn by SwimlaneBackground as a *sibling* of the viewport with its own copy of
 * the pan/zoom transform. Capturing the viewport alone therefore loses every lane,
 * so `renderDiagramImage` temporarily grafts an equivalent SVG into the viewport
 * (where it inherits the transform for free) and removes it once the capture ends.
 */

import { toPng, toSvg } from 'html-to-image'
import { getNodesBounds } from 'reactflow'
import type { Node } from 'reactflow'
import type { SwimlaneLayout } from '../lib/layout'
import {
  GUTTER_PADDING,
  LANE_COUNT_OFFSET,
  LANE_LABEL_GUTTER,
  LANE_STYLE,
  LANE_SWATCH_GAP,
  LANE_SWATCH_SIZE,
} from '../lib/diagramInk'
import { buildExportFilename } from './exportFilename'

export type DiagramExportFormat = 'png' | 'svg'

export interface DiagramExportOptions {
  format: DiagramExportFormat
  /** 1x, 2x or 3x. PRD 4.12.3. */
  scale: number
  /** Solid background colour, or null for transparent. */
  background: string | null
}

/** Blank margin left around the diagram, in graph units. */
export const EXPORT_PADDING = 40

/**
 * Browsers refuse to allocate a canvas beyond a per-edge limit and simply hand
 * back a blank image. 16384px is the smallest ceiling in common use (Chrome and
 * WebKit); staying under it is what keeps large diagrams from "crashing".
 */
export const MAX_EXPORT_EDGE_PX = 16384

export interface DiagramBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ExportDimensions {
  /** Layout size handed to html-to-image, in CSS pixels. */
  cssWidth: number
  cssHeight: number
  /** Pixel size of the resulting image (cssWidth x scale). */
  pixelWidth: number
  pixelHeight: number
  /** Transform that brings the whole graph inside the captured box. */
  translateX: number
  translateY: number
  /** Effective scale after clamping to MAX_EXPORT_EDGE_PX. */
  scale: number
  /** True when the requested scale had to be reduced to fit the canvas limit. */
  clamped: boolean
}

/**
 * Union of the node bounding box and the swimlane bands.
 *
 * A band is wider than the nodes it holds — it runs the full width of the
 * diagram — so sizing the export from nodes alone would crop it.
 */
export function getDiagramBounds(nodes: Node[], swimlanes: SwimlaneLayout[]): DiagramBounds {
  if (nodes.length === 0 && swimlanes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  if (nodes.length > 0) {
    const nodeBounds = getNodesBounds(nodes)
    minX = nodeBounds.x
    minY = nodeBounds.y
    maxX = nodeBounds.x + nodeBounds.width
    maxY = nodeBounds.y + nodeBounds.height
  }

  for (const lane of swimlanes) {
    minX = Math.min(minX, lane.x)
    minY = Math.min(minY, lane.y)
    maxX = Math.max(maxX, lane.x + lane.width)
    maxY = Math.max(maxY, lane.y + lane.height)
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Size the output image, reducing the scale rather than emitting a blank canvas
 * when the requested size exceeds what the browser will rasterise.
 */
export function computeExportDimensions(
  bounds: DiagramBounds,
  scale: number,
  maxEdgePx: number = MAX_EXPORT_EDGE_PX
): ExportDimensions {
  const cssWidth = Math.ceil(bounds.width + EXPORT_PADDING * 2)
  const cssHeight = Math.ceil(bounds.height + EXPORT_PADDING * 2)

  if (bounds.width <= 0 || bounds.height <= 0) {
    return {
      cssWidth: 0,
      cssHeight: 0,
      pixelWidth: 0,
      pixelHeight: 0,
      translateX: 0,
      translateY: 0,
      scale,
      clamped: false,
    }
  }

  const maxScale = maxEdgePx / Math.max(cssWidth, cssHeight)
  const effectiveScale = Math.min(scale, maxScale)

  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.round(cssWidth * effectiveScale),
    pixelHeight: Math.round(cssHeight * effectiveScale),
    translateX: -bounds.x + EXPORT_PADDING,
    translateY: -bounds.y + EXPORT_PADDING,
    scale: effectiveScale,
    clamped: effectiveScale < scale,
  }
}

/**
 * `[project]_diagram_[date].[ext]`, sharing one naming rule with the CSV and
 * Markdown exports (PRD 4.12).
 */
export function buildDiagramFilename(
  projectName: string,
  format: DiagramExportFormat,
  date: Date = new Date()
): string {
  return buildExportFilename(projectName, 'diagram', format, date)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function setAttrs(el: Element, attrs: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value))
  }
}

/**
 * Rebuild SwimlaneBackground's markup as a detached SVG in graph coordinates.
 *
 * Kept deliberately in step with SwimlaneBackground.tsx: same geometry, same
 * colours, so the exported image matches what is on screen. Both read their
 * literals from lib/diagramInk.ts, which is the one place the `--gs-*` values are
 * copied — an `<svg>` descendant never receives an inlined computed style, so a
 * `var()` here would resolve to nothing in the capture.
 */
export function buildSwimlaneSvg(swimlanes: SwimlaneLayout[], bounds: DiagramBounds): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.style.position = 'absolute'
  svg.style.left = '0'
  svg.style.top = '0'
  svg.style.overflow = 'visible'
  svg.style.pointerEvents = 'none'
  // The viewport's transform makes it a stacking context, so a negative z-index
  // puts the lanes behind the nodes without escaping the diagram.
  svg.style.zIndex = '-1'
  setAttrs(svg, { width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) })

  for (const lane of swimlanes) {
    const gutterWidth = Math.min(LANE_LABEL_GUTTER, lane.width)
    const textX = lane.x + GUTTER_PADDING + LANE_SWATCH_SIZE + LANE_SWATCH_GAP
    const nameY = lane.y + GUTTER_PADDING + LANE_SWATCH_SIZE

    const laneGroup = document.createElementNS(SVG_NS, 'g')

    const band = document.createElementNS(SVG_NS, 'rect')
    setAttrs(band, {
      x: lane.x,
      y: lane.y,
      width: lane.width,
      height: lane.height,
      fill: LANE_STYLE.bandFill,
    })
    laneGroup.appendChild(band)

    const bandRule = document.createElementNS(SVG_NS, 'line')
    setAttrs(bandRule, {
      x1: lane.x,
      y1: lane.y + lane.height,
      x2: lane.x + lane.width,
      y2: lane.y + lane.height,
      stroke: LANE_STYLE.bandRule,
      'stroke-width': LANE_STYLE.bandRuleWidth,
    })
    laneGroup.appendChild(bandRule)

    const gutter = document.createElementNS(SVG_NS, 'rect')
    setAttrs(gutter, {
      x: lane.x,
      y: lane.y,
      width: gutterWidth,
      height: lane.height,
      fill: LANE_STYLE.gutterFill,
    })
    laneGroup.appendChild(gutter)

    const gutterRule = document.createElementNS(SVG_NS, 'line')
    setAttrs(gutterRule, {
      x1: lane.x + gutterWidth,
      y1: lane.y,
      x2: lane.x + gutterWidth,
      y2: lane.y + lane.height,
      stroke: LANE_STYLE.gutterRule,
      'stroke-width': LANE_STYLE.gutterRuleWidth,
    })
    laneGroup.appendChild(gutterRule)

    // Team colour swatch — one of only two places team colour is drawn.
    const swatch = document.createElementNS(SVG_NS, 'rect')
    setAttrs(swatch, {
      x: lane.x + GUTTER_PADDING,
      y: lane.y + GUTTER_PADDING,
      width: LANE_SWATCH_SIZE,
      height: LANE_SWATCH_SIZE,
      fill: lane.color,
    })
    laneGroup.appendChild(swatch)

    const labelText = document.createElementNS(SVG_NS, 'text')
    setAttrs(labelText, {
      x: textX,
      y: nameY,
      'font-size': LANE_STYLE.nameFontSize,
      'font-weight': LANE_STYLE.nameFontWeight,
      'letter-spacing': LANE_STYLE.nameLetterSpacing,
      fill: LANE_STYLE.nameFill,
    })
    labelText.textContent = lane.name.toUpperCase()
    laneGroup.appendChild(labelText)

    const countText = document.createElementNS(SVG_NS, 'text')
    setAttrs(countText, {
      x: textX,
      y: nameY + LANE_COUNT_OFFSET,
      'font-size': LANE_STYLE.countFontSize,
      'font-weight': LANE_STYLE.countFontWeight,
      fill: LANE_STYLE.countFill,
    })
    countText.textContent = String(lane.nodeCount)
    laneGroup.appendChild(countText)

    svg.appendChild(laneGroup)
  }

  return svg
}

export interface RenderDiagramResult {
  dataUrl: string
  width: number
  height: number
  /** True when the requested scale was reduced to stay within canvas limits. */
  clamped: boolean
}

/**
 * Capture `viewportEl` (the `.react-flow__viewport` element) as an image.
 *
 * The viewport is captured rather than the React Flow root because the root is
 * clipped to the visible window; the viewport holds the full graph and is merely
 * transformed, so overriding that transform yields the whole diagram. Controls,
 * MiniMap and the dotted Background are siblings of the viewport and so are
 * excluded for free.
 */
export async function renderDiagramImage(
  viewportEl: HTMLElement,
  nodes: Node[],
  swimlanes: SwimlaneLayout[],
  options: DiagramExportOptions
): Promise<RenderDiagramResult> {
  const bounds = getDiagramBounds(nodes, swimlanes)
  const dimensions = computeExportDimensions(bounds, options.scale)

  if (dimensions.pixelWidth === 0 || dimensions.pixelHeight === 0) {
    throw new Error('Diagram is empty')
  }

  const swimlaneSvg = swimlanes.length > 0 ? buildSwimlaneSvg(swimlanes, bounds) : null
  if (swimlaneSvg) {
    viewportEl.appendChild(swimlaneSvg)
  }

  // width/height are CSS pixels; pixelRatio multiplies them into output pixels.
  // SVG output is vector, so pixelRatio is irrelevant there and left at 1.
  const config = {
    width: dimensions.cssWidth,
    height: dimensions.cssHeight,
    pixelRatio: options.format === 'png' ? dimensions.scale : 1,
    ...(options.background ? { backgroundColor: options.background } : {}),
    style: {
      width: `${dimensions.cssWidth}px`,
      height: `${dimensions.cssHeight}px`,
      transform: `translate(${dimensions.translateX}px, ${dimensions.translateY}px)`,
      transformOrigin: '0 0',
    },
  }

  try {
    const dataUrl =
      options.format === 'png' ? await toPng(viewportEl, config) : await toSvg(viewportEl, config)

    return {
      dataUrl,
      width: options.format === 'png' ? dimensions.pixelWidth : dimensions.cssWidth,
      height: options.format === 'png' ? dimensions.pixelHeight : dimensions.cssHeight,
      clamped: options.format === 'png' && dimensions.clamped,
    }
  } finally {
    swimlaneSvg?.remove()
  }
}
