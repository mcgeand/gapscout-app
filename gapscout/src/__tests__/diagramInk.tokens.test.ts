/**
 * The diagram's export-visible colours come from `globals.css`, not from a copy.
 *
 * `diagramInk.ts` reads each token out of the stylesheet's `:root` block at module
 * init, because an `<svg>` descendant in an html-to-image capture never receives a
 * computed style and so cannot use `var()`. That parse is the single point of
 * failure for every band, gutter and edge stroke in an exported PNG or SVG: if it
 * silently returned an empty string, the shapes would fall back to SVG's defaults —
 * black fills and invisible strokes — and no other test would notice.
 *
 * So this checks the parse against the stylesheet independently, reading the file
 * from disk rather than through the same `?raw` import the module uses.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as ink from '../lib/diagramInk'

// Resolved from the project root rather than `import.meta.url`: the jsdom
// environment gives modules an http:// URL, which `fileURLToPath` rejects.
const fromRoot = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const CSS = fromRoot('src/styles/globals.css')

/** The same `:root` block the module reads, found independently of it. */
const ROOT = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')))

const declared = (name: string) => new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(ROOT)?.[1].trim()

const TOKENS: ReadonlyArray<[keyof typeof ink, string]> = [
  ['INK', 'gs-ink'],
  ['INK_MUTED', 'gs-ink-muted'],
  ['INK_FAINT', 'gs-ink-faint'],
  ['RULE', 'gs-rule'],
  ['BG', 'gs-bg'],
  ['SUNKEN', 'gs-sunken'],
  ['SURFACE', 'gs-surface'],
]

describe('diagramInk reads its colours from globals.css', () => {
  it.each(TOKENS)('%s is whatever --%s says', (exported, tokenName) => {
    expect(ink[exported]).toBe(declared(tokenName))
  })

  /**
   * The failure that matters. A regex that stopped matching would hand every caller
   * `undefined` or `''`, and an SVG attribute set to either paints black.
   */
  it.each(TOKENS)('%s is a usable colour, not an empty parse', (exported) => {
    expect(ink[exported]).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('derives the rgb triple from the ink token rather than restating it', () => {
    const [, r, g, b] = /^#(..)(..)(..)$/.exec(ink.INK as string)!
    expect(ink.INK_RGB).toBe([r, g, b].map((h) => parseInt(h, 16)).join(', '))
  })

  it('leaves no hex literal in the module itself', () => {
    const source = fromRoot('src/lib/diagramInk.ts')
    // Only the hexToRgb character class may mention hex digits; no #rrggbb anywhere.
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/)
  })
})
