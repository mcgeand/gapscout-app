/**
 * The two swimlane renderers must draw the same thing.
 *
 * `SwimlaneBackground` paints the lanes on screen; `buildSwimlaneSvg` repaints them
 * into the capture, because the on-screen component is a *sibling* of the React Flow
 * viewport and html-to-image would otherwise drop every band. An export is faithful
 * only while the two agree, and nothing but a human eye was checking that.
 *
 * So this serialises both and diffs them. It is the test that would have caught the
 * class of bug the whole arrangement exists to avoid — a colour, coordinate or shape
 * changed on one side only.
 */

import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { SwimlaneLayout } from '../lib/layout'

vi.mock('reactflow', () => ({
  // Identity transform, so the on-screen coordinates are raw graph units — the
  // same space buildSwimlaneSvg draws in.
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

import SwimlaneBackground from '../components/Diagram/SwimlaneBackground'
import { buildSwimlaneSvg } from '../services/exportDiagram'
import { LANE_LABEL_GUTTER } from '../lib/diagramInk'

const LANES: SwimlaneLayout[] = [
  { id: 'l1', name: 'Procurement', color: '#3B82F6', x: 0, y: 0, width: 1400, height: 200, nodeCount: 3 },
  { id: 'l2', name: 'Finance', color: '#10B981', x: 0, y: 200, width: 1400, height: 200, nodeCount: 5 },
]

const BOUNDS = { x: 0, y: 0, width: 1400, height: 400 }

/** The shape-bearing children of a lane group, as `tag{attr=value,…}` strings. */
function shapes(root: Element): string[] {
  return Array.from(root.querySelectorAll('rect, line, text')).map((el) => {
    const attrs = Array.from(el.attributes)
      .map((a) => [a.name, a.value] as const)
      // React and createElementNS order attributes differently; sort so the
      // comparison is about values, not authoring order.
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name}=${value}`)
      .join(',')
    return `${el.tagName.toLowerCase()}{${attrs}}${el.textContent ?? ''}`
  })
}

function screenShapes(lanes: SwimlaneLayout[]): string[] {
  const { container } = render(<SwimlaneBackground swimlanes={lanes} />)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('SwimlaneBackground rendered nothing')
  return shapes(svg)
}

const exportShapes = (lanes: SwimlaneLayout[], bounds = BOUNDS) =>
  shapes(buildSwimlaneSvg(lanes, bounds))

describe('swimlane renderers draw the same lanes', () => {
  it('agrees shape for shape on a normal diagram', () => {
    expect(screenShapes(LANES)).toEqual(exportShapes(LANES))
  })

  it('agrees on the gutter clamp in a lane narrower than the gutter', () => {
    const narrow: SwimlaneLayout[] = [{ ...LANES[0], width: LANE_LABEL_GUTTER - 90 }]
    expect(screenShapes(narrow)).toEqual(
      exportShapes(narrow, { x: 0, y: 0, width: LANE_LABEL_GUTTER - 90, height: 200 })
    )
  })

  it('agrees on a single lane', () => {
    expect(screenShapes([LANES[1]])).toEqual(
      exportShapes([LANES[1]], { x: 0, y: 200, width: 1400, height: 200 })
    )
  })
})

describe('SwimlaneBackground', () => {
  it('draws nothing when there are no lanes', () => {
    const { container } = render(<SwimlaneBackground swimlanes={[]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  /**
   * The same count-don't-presence check the export side makes: team colour gets the
   * gutter swatch and nothing else. The band used to be tinted and stroked with it.
   */
  it('spends team colour on the swatch and nowhere else', () => {
    const { container } = render(<SwimlaneBackground swimlanes={LANES} />)
    const all = Array.from(container.querySelectorAll('*'))

    for (const lane of LANES) {
      expect(all.filter((el) => el.getAttribute('fill') === lane.color)).toHaveLength(1)
      expect(all.filter((el) => el.getAttribute('stroke') === lane.color)).toHaveLength(0)
    }
  })
})
