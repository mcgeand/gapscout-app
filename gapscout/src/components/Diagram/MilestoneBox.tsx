/**
 * MilestoneBox - A collapsed milestone, drawn as one node in place of its steps
 *
 * Ink only. A milestone is not a team, so unlike a step it carries no 5px team
 * edge — the same argument DecisionNode makes, and the reason the box can span
 * several lanes without claiming any of them (#212's rule that team colour appears
 * in exactly two places is untouched by this node). The open-gap count reuses the
 * step's accent corner tag, so the accent keeps its three jobs.
 *
 * The box's height is the bands it spans, set on the node by lib/layout.ts, so the
 * card fills its wrapper rather than declaring a size of its own.
 *
 * Reference: PRD Section 4.5.2 - Collapse/Expand Milestones
 * Issue: #156
 */

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { MilestoneNodeData } from '../../lib/graphBuilder'

/** Ink dots, matching StepNode so no connection point is a home for team colour. */
const HANDLE_STYLE = {
  background: 'var(--gs-ink)',
  width: '8px',
  height: '8px',
  borderRadius: 0,
  border: 'none',
} as const

function MilestoneBox({ data, selected }: NodeProps<MilestoneNodeData>) {
  const { label, stepCount, gapCount } = data
  const hasGaps = gapCount > 0

  return (
    <div
      className={[
        'relative flex h-full w-full cursor-pointer flex-col justify-center',
        'bg-gs-surface px-gs-3 py-gs-3 border-2 border-gs-ink',
        // Selection is a second ink rule outside the border, not a shadow.
        selected ? 'outline-2 outline-offset-2 outline-gs-ink' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={`${label}\nCollapsed milestone — click to expand`}
    >
      {/* Input Handle (left) */}
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />

      <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-gs-ink-muted">
        Milestone
      </div>

      <div className="mt-px text-[12.5px] font-semibold leading-[1.35] text-gs-ink break-words">
        {label}
      </div>

      {/* Counts, set as a quiet meta line rather than filled badges */}
      <div className="mt-gs-1 font-mono text-[9.5px] font-semibold text-gs-ink-muted">
        {stepCount} {stepCount === 1 ? 'step' : 'steps'}
      </div>

      {/* Output Handle (right) */}
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />

      {/* Gap corner tag, exactly as a step draws its own. */}
      {hasGaps && (
        <div
          className="absolute -top-0.5 -right-0.5 bg-gs-accent px-1 py-px font-mono text-[9.5px] font-bold text-gs-on-accent"
          title={`${gapCount} gap${gapCount > 1 ? 's' : ''} in this milestone`}
        >
          {gapCount} {gapCount > 1 ? 'GAPS' : 'GAP'}
        </div>
      )}
    </div>
  )
}

export default memo(MilestoneBox)
