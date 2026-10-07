/**
 * Unit tests for the diagram export service (issue #152, PRD 4.12.3).
 *
 * jsdom cannot rasterise, so html-to-image is mocked and the assertions cover
 * the pure geometry, the filename contract, and the options handed to the
 * renderer — including the swimlane overlay that the capture depends on.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Node } from 'reactflow'
import type { SwimlaneLayout } from '../lib/layout'

const { toPng, toSvg } = vi.hoisted(() => ({
  toPng: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  toSvg: vi.fn().mockResolvedValue('data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E'),
}))

vi.mock('html-to-image', () => ({ toPng, toSvg }))

import {
  EXPORT_PADDING,
  MAX_EXPORT_EDGE_PX,
  buildDiagramFilename,
  buildSwimlaneSvg,
  computeExportDimensions,
  getDiagramBounds,
  renderDiagramImage,
} from '../services/exportDiagram'

function node(id: string, x: number, y: number, width = 180, height = 60): Node {
  return { id, position: { x, y }, data: {}, width, height }
}

function lane(id: string, y: number, height: number, width = 1400): SwimlaneLayout {
  return { id, name: `Lane ${id}`, color: '#F59E0B', x: 0, y, width, height, nodeCount: 2 }
}

beforeEach(() => {
  toPng.mockClear()
  toSvg.mockClear()
})

describe('buildDiagramFilename', () => {
  it('slugifies the project name and stamps the date', () => {
    const name = buildDiagramFilename('P2P Process!', 'png', new Date(2026, 7, 31))
    expect(name).toBe('p2p-process_diagram_2026-08-31.png')
  })

  it('uses the requested extension', () => {
    expect(buildDiagramFilename('Onboarding', 'svg', new Date(2026, 0, 5))).toBe(
      'onboarding_diagram_2026-01-05.svg'
    )
  })

  it('falls back to "project" when the name has no usable characters', () => {
    expect(buildDiagramFilename('***', 'png', new Date(2026, 7, 31))).toBe(
      'project_diagram_2026-08-31.png'
    )
  })
})

describe('getDiagramBounds', () => {
  it('returns an empty box when there is nothing to draw', () => {
    expect(getDiagramBounds([], [])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('expands node bounds to cover the swimlane bands', () => {
    // Nodes occupy x 200..380; the band runs the full width of the diagram.
    const bounds = getDiagramBounds([node('a', 200, 100)], [lane('l1', 0, 400)])

    expect(bounds.x).toBe(0)
    expect(bounds.y).toBe(0)
    expect(bounds.width).toBe(1400)
    expect(bounds.height).toBe(400)
  })

  it('keeps node extents that reach past the lanes', () => {
    const bounds = getDiagramBounds([node('a', 1500, 0)], [lane('l1', 0, 100)])
    expect(bounds.width).toBe(1680)
  })

  it('follows the band width instead of a fixed 1400', () => {
    // Bands are sized to the widest lane's contents (#197), so a wide process
    // must not be cropped back to the old constant.
    const bounds = getDiagramBounds([node('a', 200, 100)], [lane('l1', 0, 400, 2200)])
    expect(bounds.width).toBe(2200)
  })
})

describe('computeExportDimensions', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 500 }

  it('pads the graph and multiplies by the requested scale', () => {
    const dims = computeExportDimensions(bounds, 2)

    expect(dims.cssWidth).toBe(1000 + EXPORT_PADDING * 2)
    expect(dims.cssHeight).toBe(500 + EXPORT_PADDING * 2)
    expect(dims.pixelWidth).toBe(dims.cssWidth * 2)
    expect(dims.pixelHeight).toBe(dims.cssHeight * 2)
    expect(dims.clamped).toBe(false)
  })

  it('offsets a graph laid out at negative coordinates back into frame', () => {
    const dims = computeExportDimensions({ x: -300, y: -50, width: 400, height: 200 }, 1)

    expect(dims.translateX).toBe(300 + EXPORT_PADDING)
    expect(dims.translateY).toBe(50 + EXPORT_PADDING)
  })

  it('clamps the scale so a large diagram stays inside the canvas limit', () => {
    const huge = { x: 0, y: 0, width: 12000, height: 4000 }
    const dims = computeExportDimensions(huge, 3)

    expect(dims.clamped).toBe(true)
    expect(dims.scale).toBeLessThan(3)
    expect(Math.max(dims.pixelWidth, dims.pixelHeight)).toBeLessThanOrEqual(MAX_EXPORT_EDGE_PX)
  })

  it('leaves a scale that already fits untouched', () => {
    const dims = computeExportDimensions(bounds, 3)
    expect(dims.scale).toBe(3)
    expect(dims.clamped).toBe(false)
  })

  it('reports zero for an empty graph', () => {
    const dims = computeExportDimensions({ x: 0, y: 0, width: 0, height: 0 }, 2)
    expect(dims.pixelWidth).toBe(0)
    expect(dims.pixelHeight).toBe(0)
  })
})

describe('buildSwimlaneSvg', () => {
  const twoLanes = () =>
    buildSwimlaneSvg([lane('l1', 0, 200), lane('l2', 200, 200)], {
      x: 0,
      y: 0,
      width: 1400,
      height: 400,
    })

  it('draws a band, a gutter and a lane identity per lane', () => {
    const svg = twoLanes()

    expect(svg.querySelectorAll('g')).toHaveLength(2)
    // Per lane: band, gutter, swatch.
    expect(svg.querySelectorAll('rect')).toHaveLength(6)
    // Per lane: the band's 1px separator and the gutter's 2px edge.
    expect(svg.querySelectorAll('line')).toHaveLength(4)
    expect(Array.from(svg.querySelectorAll('text')).map((t) => t.textContent)).toEqual([
      'LANE L1',
      '2',
      'LANE L2',
      '2',
    ])
  })

  /**
   * The AC that is easiest to regress: team colour belongs in exactly two places
   * across the whole canvas, and the lane gutter's swatch is one of them. Counting
   * rather than asserting presence is the point — the previous treatment tinted the
   * band, stroked it, stroked the label box, filled a badge and coloured the text,
   * and every one of those would pass a presence check (#212).
   */
  it('spends team colour on the swatch and nowhere else', () => {
    const svg = twoLanes()
    const all = Array.from(svg.querySelectorAll('*'))
    const teamColor = lane('l1', 0, 200).color

    const filled = all.filter((el) => el.getAttribute('fill') === teamColor)
    expect(filled).toHaveLength(2) // one swatch per lane, and nothing else

    expect(all.filter((el) => el.getAttribute('stroke') === teamColor)).toHaveLength(0)
  })

  it('draws square corners', () => {
    const svg = twoLanes()
    expect(Array.from(svg.querySelectorAll('*')).filter((el) => el.hasAttribute('rx'))).toHaveLength(
      0
    )
  })

  it('holds the gutter inside a narrow lane rather than overrunning it', () => {
    const svg = buildSwimlaneSvg([lane('narrow', 0, 200, 90)], {
      x: 0,
      y: 0,
      width: 90,
      height: 200,
    })
    const widths = Array.from(svg.querySelectorAll('rect')).map((r) =>
      Number(r.getAttribute('width'))
    )
    expect(Math.max(...widths)).toBeLessThanOrEqual(90)
  })

  it('sits behind the nodes', () => {
    const svg = buildSwimlaneSvg([lane('l1', 0, 200)], { x: 0, y: 0, width: 1400, height: 200 })
    expect(svg.style.zIndex).toBe('-1')
  })
})

describe('renderDiagramImage', () => {
  let viewport: HTMLElement

  beforeEach(() => {
    viewport = document.createElement('div')
    document.body.appendChild(viewport)
  })

  it('renders PNG at the requested pixel ratio with a background', async () => {
    const result = await renderDiagramImage(
      viewport,
      [node('a', 0, 0, 1000, 500)],
      [],
      { format: 'png', scale: 2, background: '#FFFFFF' }
    )

    expect(toPng).toHaveBeenCalledTimes(1)
    expect(toSvg).not.toHaveBeenCalled()

    const [element, config] = toPng.mock.calls[0]
    expect(element).toBe(viewport)
    expect(config.pixelRatio).toBe(2)
    expect(config.backgroundColor).toBe('#FFFFFF')
    expect(config.width).toBe(1000 + EXPORT_PADDING * 2)
    expect(result.width).toBe((1000 + EXPORT_PADDING * 2) * 2)
    expect(result.dataUrl).toBe('data:image/png;base64,AAAA')
  })

  it('omits backgroundColor entirely when a transparent export is asked for', async () => {
    await renderDiagramImage(viewport, [node('a', 0, 0)], [], {
      format: 'png',
      scale: 1,
      background: null,
    })

    expect(toPng.mock.calls[0][1]).not.toHaveProperty('backgroundColor')
  })

  it('uses toSvg for SVG and does not upscale it', async () => {
    const result = await renderDiagramImage(viewport, [node('a', 0, 0, 1000, 500)], [], {
      format: 'svg',
      scale: 3,
      background: null,
    })

    expect(toSvg).toHaveBeenCalledTimes(1)
    expect(toPng).not.toHaveBeenCalled()
    expect(toSvg.mock.calls[0][1].pixelRatio).toBe(1)
    expect(result.width).toBe(1000 + EXPORT_PADDING * 2)
  })

  it('attaches the swimlane overlay for the capture and removes it afterwards', async () => {
    let svgPresentDuringCapture = false
    toPng.mockImplementationOnce(async (el: HTMLElement) => {
      svgPresentDuringCapture = el.querySelector('svg') !== null
      return 'data:image/png;base64,AAAA'
    })

    await renderDiagramImage(viewport, [node('a', 0, 0)], [lane('l1', 0, 200)], {
      format: 'png',
      scale: 1,
      background: null,
    })

    expect(svgPresentDuringCapture).toBe(true)
    expect(viewport.querySelector('svg')).toBeNull()
  })

  it('removes the overlay even when the capture throws', async () => {
    toPng.mockRejectedValueOnce(new Error('canvas blew up'))

    await expect(
      renderDiagramImage(viewport, [node('a', 0, 0)], [lane('l1', 0, 200)], {
        format: 'png',
        scale: 1,
        background: null,
      })
    ).rejects.toThrow('canvas blew up')

    expect(viewport.querySelector('svg')).toBeNull()
  })

  it('refuses to render an empty diagram', async () => {
    await expect(
      renderDiagramImage(viewport, [], [], { format: 'png', scale: 1, background: null })
    ).rejects.toThrow('Diagram is empty')
    expect(toPng).not.toHaveBeenCalled()
  })
})
