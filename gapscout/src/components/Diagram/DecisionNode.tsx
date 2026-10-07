/**
 * DecisionNode - Custom React Flow node for decision points
 *
 * A 2px ink diamond. Unlike a step, it carries no team colour: mock 2d draws it
 * ink-only, and the 5px left edge a step uses has nowhere to sit on a rotated
 * square. The lane it is in already says who owns it (#212).
 *
 * Reference: PRD Section 4.5 - Diagram Generation (Node Types)
 * Ticket: ZIP-90
 */

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { StepNodeData } from '../../lib/graphBuilder'

/** Ink dots, matching StepNode so no connection point is a home for team colour. */
const HANDLE_STYLE = {
  background: 'var(--gs-ink)',
  width: '8px',
  height: '8px',
  borderRadius: 0,
  border: 'none',
} as const

/**
 * Decision Node Component
 * Renders as a diamond (rotated square)
 */
function DecisionNode({ data, selected }: NodeProps<StepNodeData>) {
  const { label, teamName } = data

  return (
    <div
      className="decision-node-wrapper relative h-[100px] w-[100px] cursor-pointer"
      title={`${label}\nTeam: ${teamName}`}
    >
      {/* Input Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ ...HANDLE_STYLE, left: '10px', top: '50%' }}
      />

      {/* Diamond Shape */}
      <div
        className={[
          'decision-node-diamond absolute left-1/2 top-1/2 h-[70px] w-[70px] border-2 border-gs-ink bg-gs-surface',
          // Selection reads as a second ink rule, not a shadow.
          selected ? 'outline-2 outline-offset-2 outline-gs-ink' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ transform: 'translate(-50%, -50%) rotate(45deg)' }}
      />

      {/* Label (rotated back to normal) */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 w-[60px] -translate-x-1/2 -translate-y-1/2 overflow-hidden text-center text-[11px] font-bold leading-[1.2] text-gs-ink break-words"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {label}
      </div>

      {/* Output Handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ ...HANDLE_STYLE, right: '10px', top: '50%' }}
      />

      {/* Additional Output Handle (bottom) for multi-branch decisions */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ ...HANDLE_STYLE, bottom: '10px', left: '50%' }}
      />

      {/* Additional Output Handle (top) for complex branches */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ ...HANDLE_STYLE, top: '10px', left: '50%' }}
      />
    </div>
  )
}

// Export memoized version for performance
export default memo(DecisionNode)
