/**
 * StepNode - Custom React Flow node for process steps
 *
 * A square-cornered card with a 2px ink border and a 5px team-colour left edge —
 * the only place besides the lane gutter swatch where team colour is drawn (#212).
 * Because nothing else on the canvas is saturated, the accent border and corner tag
 * on a step with gaps read unambiguously as "gaps here".
 *
 * Nodes are ordinary HTML, so html-to-image inlines their computed styles (with
 * `var()` already resolved) into an export. That is why they style with `gs-*`
 * utilities while the swimlanes, which are SVG, cannot — see lib/diagramInk.ts.
 *
 * Reference: PRD Section 4.5 - Diagram Generation (Node Styling)
 * Ticket: ZIP-90
 */

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { StepNodeData } from '../../lib/graphBuilder'

/** Ink dots, so the connection points do not become a third home for team colour. */
const HANDLE_STYLE = {
  background: 'var(--gs-ink)',
  width: '8px',
  height: '8px',
  borderRadius: 0,
  border: 'none',
} as const

/**
 * Step Node Component
 * Receives node data from React Flow
 */
function StepNode({ data, selected }: NodeProps<StepNodeData>) {
  const { label, step, teamColor, teamName, gapCount } = data
  const hasGaps = gapCount > 0
  const systems = step.systems ?? []

  return (
    <div
      className={[
        'step-node relative w-[180px] cursor-pointer bg-gs-surface px-gs-3 py-gs-3 border-2',
        // Ink all round; a step with gaps swaps that for the accent and keeps
        // its team edge. Both are classes so the token stays the single source.
        hasGaps ? 'border-gs-accent' : 'border-gs-ink',
        // Selection is a second ink rule outside the border, not a shadow —
        // nothing on this canvas floats.
        selected ? 'outline-2 outline-offset-2 outline-gs-ink' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      // Team colour is user data, not a token, so it is the one inline value here.
      style={{ borderLeft: `5px solid ${teamColor}` }}
      title={`${label}\nTeam: ${teamName}`}
    >
      {/* Input Handle (left) */}
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />

      <div className="step-node-content">
        {/* Step Label */}
        <div className="text-[12.5px] font-semibold leading-[1.35] text-gs-ink break-words">
          {label}
        </div>

        {/* Systems, set as a quiet meta line rather than a filled badge */}
        {systems.length > 0 && (
          <div
            className="mt-gs-1 font-mono text-[9.5px] font-semibold text-gs-ink-muted break-words"
            title={`Uses ${systems.length} system${systems.length > 1 ? 's' : ''}: ${systems.join(', ')}`}
          >
            {systems.join(' · ')}
          </div>
        )}
      </div>

      {/* Output Handle (right) */}
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />

      {/* Gap corner tag. The one accent mark on the canvas, so it needs no icon. */}
      {hasGaps && (
        <div
          className="absolute -top-0.5 -right-0.5 bg-gs-accent px-1 py-px font-mono text-[9.5px] font-bold text-gs-on-accent"
          title={`${gapCount} gap${gapCount > 1 ? 's' : ''} identified`}
        >
          {gapCount} {gapCount > 1 ? 'GAPS' : 'GAP'}
        </div>
      )}

      {/* Parallel marker. Bottom-right: the gap tag owns top-right and a step can
          be both, and the left side is the team edge. `∥` is data in Archivo, the
          same call StepRow makes. */}
      {data.isParallel && (
        <div
          className="absolute -bottom-0.5 -right-0.5 bg-gs-ink px-1 py-px text-[9.5px] font-bold leading-[1.4] text-gs-on-ink"
          title="Parallel step (runs at same time as another step)"
        >
          ∥
        </div>
      )}
    </div>
  )
}

// Export memoized version for performance
export default memo(StepNode)
