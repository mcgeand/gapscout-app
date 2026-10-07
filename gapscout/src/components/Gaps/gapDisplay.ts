/**
 * Shared display helpers for gap status/severity/timestamps.
 * Used by GapsTable and RightPanel.
 */

import { TriangleAlert, CheckCircle, Clock } from 'lucide-react'

/**
 * Format timestamp to relative time (e.g., "2 days ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'Just now'
}

/**
 * Severity as weight, not hue.
 *
 * Solid = high, outlined = medium, quiet = low (`.sev-*` in globals.css). This
 * reads faster in a table and survives greyscale print and image export, which
 * a three-hue ramp does not. Layout utilities stay on the call site; these
 * classes carry only the typographic weight.
 */
export function getSeverityInfo(severity: string): { label: string; className: string } {
  switch (severity) {
    case 'H':
      return { label: 'High', className: 'sev sev-h' }
    case 'M':
      return { label: 'Medium', className: 'sev sev-m' }
    case 'L':
      return { label: 'Low', className: 'sev sev-l' }
    default:
      return { label: 'Unknown', className: 'sev sev-l' }
  }
}

/**
 * Status as a quiet ink chip; the icon distinguishes the state.
 *
 * The accent is not used here. It has three jobs — primary action, active tab,
 * high severity — and status is not one of them; in a register where most rows
 * are Open, a red chip on most rows would stop meaning "look here". Open reads
 * at full ink, Review and Closed sit back at `--gs-ink-muted`.
 */
export function getStatusInfo(status: string): { icon: typeof TriangleAlert; className: string } {
  switch (status) {
    case 'Open':
      return { icon: TriangleAlert, className: 'st st-open' }
    case 'Review':
      return { icon: Clock, className: 'st' }
    case 'Closed':
      return { icon: CheckCircle, className: 'st' }
    default:
      return { icon: TriangleAlert, className: 'st' }
  }
}
