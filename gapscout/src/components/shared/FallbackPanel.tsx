import type { ReactNode } from 'react'
import { fallbackStyles } from './fallbackStyles'

/**
 * FallbackPanel - the panel `RouteFallbacks` and `ErrorBoundary` render (#205).
 *
 * Same grammar as `EmptyState` — heading, one sentence, one action — but drawn
 * with inline styles, because these two render before or around the app shell
 * where the stylesheet may not have loaded. See `fallbackStyles` for why the
 * tokens carry literal fallbacks.
 */

export interface FallbackPanelProps {
  title: string
  message: ReactNode
  actions?: ReactNode
  children?: ReactNode
}

export function FallbackPanel({ title, message, actions, children }: FallbackPanelProps) {
  return (
    <div style={fallbackStyles.ground}>
      <div style={fallbackStyles.panel}>
        <h1 style={fallbackStyles.title}>{title}</h1>
        <p style={fallbackStyles.message}>{message}</p>
        {children}
        {actions && <div style={fallbackStyles.actions}>{actions}</div>}
      </div>
    </div>
  )
}

export default FallbackPanel
