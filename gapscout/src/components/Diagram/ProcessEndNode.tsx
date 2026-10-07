/**
 * ProcessEndNode - Visual endpoint for terminal customers
 *
 * Represents where a process terminates - a customer that doesn't
 * have their own process steps (like NetSuite receiving final output)
 *
 * A dashed 2px ink border is what says "terminal"; the 💻/🏁 badge that used to
 * say it is gone (#212). A customer that is a team keeps the 5px team edge a step
 * has, because it sits in that team's lane. A system or an external party has no
 * team colour to draw, so `teamColor` arrives as `--gs-rule` from graphBuilder.
 */

import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import type { ProcessEndNodeData } from '../../lib/graphBuilder'

function ProcessEndNode({ data }: NodeProps<ProcessEndNodeData>) {
  const { label, entityName, teamColor, isSystem } = data

  return (
    <div
      className="w-[200px] border-2 border-dashed border-gs-ink bg-gs-surface px-gs-3 py-gs-2"
      // Team colour is user data, not a token, so it is the one inline value here.
      style={{ borderLeft: `5px solid ${teamColor}` }}
    >
      {/* Input Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: 'var(--gs-ink)',
          width: 8,
          height: 8,
          borderRadius: 0,
          border: 'none',
        }}
      />

      {/* Label */}
      <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-gs-ink-muted">
        {label}
      </div>

      {/* Entity Name */}
      <div className="mt-px text-[12.5px] font-semibold leading-[1.35] text-gs-ink break-words">
        {entityName}
      </div>

      {/* System/Team kind, as a rule-outlined tag rather than a filled badge */}
      <span className="mt-gs-1 inline-block border border-gs-rule px-1 py-px font-mono text-[9px] font-semibold text-gs-ink-muted">
        {isSystem ? 'System' : 'Team'}
      </span>
    </div>
  )
}

export default ProcessEndNode
