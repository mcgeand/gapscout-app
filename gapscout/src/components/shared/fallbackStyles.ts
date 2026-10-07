import type { CSSProperties } from 'react'

/**
 * fallbackStyles - the state grammar for the shells that render outside it (#205).
 *
 * `RouteFallbacks` and `ErrorBoundary` sit before or around the app shell,
 * where the stylesheet may not have loaded, so they keep inline styles rather
 * than component classes. This is the one place a token is restated as a
 * literal: each `var()` carries the token's own value as its fallback, so the
 * panel is right when globals.css is there and still legible when it is not.
 *
 * Everything inside the shell uses `EmptyState` instead.
 */

const ink = 'var(--gs-ink, #201e1d)'
const inkMuted = 'var(--gs-ink-muted, #605d5d)'
const surface = 'var(--gs-surface, #ffffff)'
const bg = 'var(--gs-bg, #f3f2f2)'
const rule = 'var(--gs-rule, #d7d3d3)'
const accent = 'var(--gs-accent, #ec3013)'
const font = 'var(--gs-font, "Archivo", system-ui, sans-serif)'

export const fallbackStyles = {
  ground: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '32px',
    backgroundColor: bg,
    fontFamily: font,
  } satisfies CSSProperties,
  panel: {
    width: '100%',
    maxWidth: '560px',
    backgroundColor: surface,
    border: `2px solid ${ink}`,
    padding: '24px',
  } satisfies CSSProperties,
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 700,
    color: ink,
  } satisfies CSSProperties,
  message: {
    margin: '8px 0 0',
    maxWidth: '62ch',
    fontSize: '13px',
    lineHeight: 1.5,
    color: inkMuted,
  } satisfies CSSProperties,
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '16px',
    flexWrap: 'wrap',
  } satisfies CSSProperties,
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: font,
    backgroundColor: accent,
    color: 'var(--gs-on-accent, #ffffff)',
    border: `2px solid ${accent}`,
    borderRadius: 0,
    cursor: 'pointer',
    textDecoration: 'none',
  } satisfies CSSProperties,
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: font,
    backgroundColor: surface,
    color: ink,
    border: `2px solid ${ink}`,
    borderRadius: 0,
    cursor: 'pointer',
    textDecoration: 'none',
  } satisfies CSSProperties,
  helpText: {
    margin: '16px 0 0',
    fontSize: '12px',
    color: inkMuted,
  } satisfies CSSProperties,
  detail: {
    marginTop: '16px',
    border: `1px solid ${rule}`,
    padding: '12px',
    fontSize: '12px',
    fontFamily: 'var(--gs-mono, ui-monospace, "SF Mono", Menlo, monospace)',
    color: inkMuted,
    wordBreak: 'break-word',
  } satisfies CSSProperties,
}
