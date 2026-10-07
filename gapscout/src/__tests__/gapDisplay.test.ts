/**
 * Unit tests for the gap severity/status display helpers (issue #202).
 *
 * These helpers used to hand back literal hex, which every gap pill applied as
 * an inline style. They now hand back class names from the token sheet, so what
 * matters is the mapping and the absence of colour: a returned '#' means a
 * second source of truth for colour has crept back into the components.
 */

import { describe, expect, it } from 'vitest'
import { TriangleAlert, CheckCircle, Clock } from 'lucide-react'
import { formatRelativeTime, getSeverityInfo, getStatusInfo } from '../components/Gaps/gapDisplay'

describe('getSeverityInfo', () => {
  it.each([
    ['H', 'High', 'sev sev-h'],
    ['M', 'Medium', 'sev sev-m'],
    ['L', 'Low', 'sev sev-l'],
  ])('maps %s to its weight class', (severity, label, className) => {
    expect(getSeverityInfo(severity)).toEqual({ label, className })
  })

  it('degrades an unknown severity to the quiet weight', () => {
    expect(getSeverityInfo('nonsense')).toEqual({ label: 'Unknown', className: 'sev sev-l' })
  })
})

describe('getStatusInfo', () => {
  it.each([
    ['Open', TriangleAlert, 'st st-open'],
    ['Review', Clock, 'st'],
    ['Closed', CheckCircle, 'st'],
  ])('maps %s to its icon and chip class', (status, icon, className) => {
    expect(getStatusInfo(status)).toEqual({ icon, className })
  })

  it('degrades an unknown status to the plain chip', () => {
    expect(getStatusInfo('nonsense')).toEqual({ icon: TriangleAlert, className: 'st' })
  })
})

describe('no helper returns colour', () => {
  const severities = ['H', 'M', 'L', 'nonsense']
  const statuses = ['Open', 'Review', 'Closed', 'nonsense']

  it('returns no hex literal from any severity', () => {
    for (const severity of severities) {
      expect(JSON.stringify(getSeverityInfo(severity))).not.toContain('#')
    }
  })

  it('returns no hex literal from any status', () => {
    for (const status of statuses) {
      const { className } = getStatusInfo(status)
      expect(className).not.toContain('#')
    }
  })
})

describe('formatRelativeTime', () => {
  it('reads back in the largest unit that fits', () => {
    const now = Date.now()
    expect(formatRelativeTime(now)).toBe('Just now')
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('5 minutes ago')
    expect(formatRelativeTime(now - 60 * 60_000)).toBe('1 hour ago')
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000)).toBe('3 days ago')
  })
})
