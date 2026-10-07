/**
 * SwimlaneBackground - Background component for team swimlanes
 *
 * Renders one band per lane behind the nodes, each with a gutter down its left
 * carrying the team's colour swatch, name and step count.
 *
 * The band is ink and rule; the swatch is the only place team colour appears here
 * (#212). Tinting the whole band by team put the same colour in a second place and
 * made a wide lane read as a coloured region rather than a row.
 *
 * Kept deliberately in step with `buildSwimlaneSvg` in services/exportDiagram.ts,
 * which redraws exactly this markup for an image export, and held there by
 * SwimlaneParity.test.tsx, which serialises both and diffs them. Geometry, colours
 * and draw order all come from lib/diagramInk.ts so the two agree by construction
 * rather than by review — see that file for why `var()` cannot be used inside an
 * <svg> that html-to-image has to serialise.
 *
 * Every shape carries presentation *attributes* rather than a style object, for the
 * same reason: it is what the export emits, so the two are directly comparable.
 *
 * Reference: PRD Section 4.5 - Diagram Generation
 * Ticket: ZIP-90
 */

import { memo } from 'react'
import { useViewport } from 'reactflow'
import type { SwimlaneLayout } from '../../lib/layout'
import {
  GUTTER_PADDING,
  LANE_COUNT_OFFSET,
  LANE_LABEL_GUTTER,
  LANE_STYLE,
  LANE_SWATCH_GAP,
  LANE_SWATCH_SIZE,
} from '../../lib/diagramInk'

interface SwimlaneBackgroundProps {
  swimlanes: SwimlaneLayout[]
}

/**
 * Swimlane Background Component
 * Renders as an SVG overlay behind nodes using ELK-calculated positions
 * CRITICAL: Uses React Flow's viewport transform to stay aligned with nodes
 */
function SwimlaneBackground({ swimlanes }: SwimlaneBackgroundProps) {
  // Get React Flow's viewport transform (x, y, zoom) to match node coordinates
  const { x, y, zoom } = useViewport()

  if (swimlanes.length === 0) {
    return null
  }

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      {/* Apply React Flow's viewport transform so swimlanes move/zoom with nodes */}
      <g transform={`translate(${x}, ${y}) scale(${zoom})`}>
        {swimlanes.map((lane) => {
          // Geometry comes from the lane itself: layout.ts sizes every band to
          // the widest lane's contents, so a wide process is no longer cut short
          // by a hard-coded width (#197).
          const gutterWidth = Math.min(LANE_LABEL_GUTTER, lane.width)
          const textX = lane.x + GUTTER_PADDING + LANE_SWATCH_SIZE + LANE_SWATCH_GAP
          const nameY = lane.y + GUTTER_PADDING + LANE_SWATCH_SIZE

          return (
            <g key={lane.id}>
              {/* Lane band */}
              <rect
                x={lane.x}
                y={lane.y}
                width={lane.width}
                height={lane.height}
                fill={LANE_STYLE.bandFill}
              />

              {/* 1px separator under the band. 2px divides, 1px separates. */}
              <line
                x1={lane.x}
                y1={lane.y + lane.height}
                x2={lane.x + lane.width}
                y2={lane.y + lane.height}
                stroke={LANE_STYLE.bandRule}
                strokeWidth={LANE_STYLE.bandRuleWidth}
              />

              {/* Gutter: the lane's identity, held off the process itself by a 2px edge */}
              <rect
                x={lane.x}
                y={lane.y}
                width={gutterWidth}
                height={lane.height}
                fill={LANE_STYLE.gutterFill}
              />
              <line
                x1={lane.x + gutterWidth}
                y1={lane.y}
                x2={lane.x + gutterWidth}
                y2={lane.y + lane.height}
                stroke={LANE_STYLE.gutterRule}
                strokeWidth={LANE_STYLE.gutterRuleWidth}
              />

              {/* Team colour swatch — one of only two places team colour is drawn */}
              <rect
                x={lane.x + GUTTER_PADDING}
                y={lane.y + GUTTER_PADDING}
                width={LANE_SWATCH_SIZE}
                height={LANE_SWATCH_SIZE}
                fill={lane.color}
              />

              {/* Lane name */}
              <text
                x={textX}
                y={nameY}
                fontSize={LANE_STYLE.nameFontSize}
                fontWeight={LANE_STYLE.nameFontWeight}
                letterSpacing={LANE_STYLE.nameLetterSpacing}
                fill={LANE_STYLE.nameFill}
              >
                {lane.name.toUpperCase()}
              </text>

              {/* Step count, set below the name rather than in a filled badge */}
              <text
                x={textX}
                y={nameY + LANE_COUNT_OFFSET}
                fontSize={LANE_STYLE.countFontSize}
                fontWeight={LANE_STYLE.countFontWeight}
                fill={LANE_STYLE.countFill}
              >
                {lane.nodeCount}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

// Export memoized version for performance
export default memo(SwimlaneBackground)
