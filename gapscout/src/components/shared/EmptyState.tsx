import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

/**
 * EmptyState - the one grammar for empty, loading and error (#205).
 *
 * Eleven empty states used to ship four visual languages and nine raw emoji,
 * each a full-viewport poster: `py-16`, a `text-6xl` glyph, and prose centred
 * in dead space. The design's fifth rule is that these are panels, not
 * posters, so all three states render here: a heading, one sentence, one
 * action, inside the frame the filled state uses.
 *
 * Named EmptyState rather than Empty because #203 already owns
 * `shared/Empty.tsx` — the em-dash that fills an empty table *cell*.
 */

export type StateKind = 'empty' | 'loading' | 'error'

export interface EmptyStateProps {
  kind?: StateKind
  /** What this is. For loading, what is being opened. */
  title: string
  /** One sentence saying why, or what is being read. */
  message: ReactNode
  /** The single action offered. Errors usually offer a retry. */
  action?: ReactNode
  /** Extra classes on the panel. */
  className?: string
}

export function EmptyState({
  kind = 'empty',
  title,
  message,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`state ${kind === 'error' ? 'state-error' : ''} ${className}`}
      role={kind === 'error' ? 'alert' : undefined}
      aria-busy={kind === 'loading' || undefined}
    >
      <h3 className="state-title">
        {kind === 'error' && (
          <TriangleAlert
            size={16}
            strokeWidth={2}
            className="flex-shrink-0 text-gs-accent"
            aria-hidden="true"
          />
        )}
        {title}
      </h3>
      <p className="state-message">{message}</p>
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}

export default EmptyState
