/**
 * The `--gs-*` values the diagram needs as literal strings, read out of
 * `globals.css` at build time.
 *
 * Why they have to be literals at all: everything the diagram draws inside an
 * `<svg>` — the edge strokes, the swimlane bands and their gutters — is invisible
 * to html-to-image's style inlining. `cloneChildren`
 * (node_modules/html-to-image/lib/clone-node.js:130) returns early for any `<svg>`,
 * so its descendants are cloned by attribute only and never get a computed style. A
 * `var(--gs-*)` reference there resolves to nothing in the capture and the shape
 * falls back to SVG's defaults — a black fill, or no stroke at all.
 *
 * Why they are not *restated* here: CLAUDE.md says a hex value lives in
 * `globals.css` and nowhere else, and a hand-copied second list is exactly the
 * drift the rule exists to prevent. So the stylesheet is imported as text and each
 * token is read out of its `:root` block when this module initialises. There is one
 * source; this file only projects it into a form an SVG attribute can carry.
 *
 * A renamed or deleted token therefore fails loudly at startup rather than silently
 * painting a shape black.
 *
 * Node components are ordinary HTML, not SVG, so they are NOT covered here: their
 * computed styles do get inlined (clone-node.js:164) with `var()` already resolved,
 * which is why they style with `gs-*` utilities like the rest of the app. Nothing
 * that could use a utility should reach for a value from this file.
 */

import globalsCss from '../styles/globals.css?raw'

/**
 * The `:root` block the tokens are declared in.
 *
 * Scoped to the first one deliberately: `globals.css` has later `:root`-prefixed
 * blocks, and #193's dark mode will add more. An export is a light-ground document,
 * so the base declarations are the right ones to read.
 */
const ROOT_BLOCK = (() => {
  const start = globalsCss.indexOf(':root {')
  const end = start === -1 ? -1 : globalsCss.indexOf('\n}', start)
  if (start === -1 || end === -1) {
    throw new Error('diagramInk: no :root block in globals.css — the token source moved')
  }
  return globalsCss.slice(start, end)
})()

/** One token's value, or a loud failure naming it. */
function token(name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(ROOT_BLOCK)
  const value = match?.[1].trim()
  if (!value) {
    throw new Error(`diagramInk: --${name} is not declared in the :root block of globals.css`)
  }
  return value
}

/** `--gs-ink` — structural edges. */
export const INK = token('gs-ink')
/** `--gs-ink` as an `rgb()` triple, for the places that need it with an alpha. */
export const INK_RGB = hexToRgb(INK)
/** `--gs-ink-muted` — lane names, at a size where `--gs-ink-faint` would fail AA. */
export const INK_MUTED = token('gs-ink-muted')
/** `--gs-ink-faint` — edge lines and other marks that must recede behind the nodes. */
export const INK_FAINT = token('gs-ink-faint')
/** `--gs-rule` — 1px separators. */
export const RULE = token('gs-rule')
/** `--gs-bg` — the lane gutter's ground. */
export const BG = token('gs-bg')
/** `--gs-sunken` — the lane band's ground. */
export const SUNKEN = token('gs-sunken')
/** `--gs-surface` — edge label backgrounds. */
export const SURFACE = token('gs-surface')

/**
 * Space reserved down the left of every band for the lane's identity, and the width
 * of the gutter block drawn there.
 *
 * It lives here rather than in `layout.ts` so that this module imports no other
 * *module*: `layout.ts` imports `graphBuilder.ts`, which reads `INK_FAINT` and
 * `RULE` from here at module-init time, so a re-export from `layout.ts` would close
 * the loop diagramInk → layout → graphBuilder → diagramInk. ES modules tolerate a
 * cycle until someone reads a `const` across it before it initialises, and these are
 * read during evaluation — the failure would be a TDZ `ReferenceError` that appears
 * or vanishes with import order. The stylesheet import above is inert here: `?raw`
 * resolves to a string at build time and cannot participate in a cycle.
 *
 * `layout.ts` imports it to place the first column; the two lane renderers import
 * it to draw the block that fills the space.
 */
export const LANE_LABEL_GUTTER = 180

/** `#rrggbb` to the `r, g, b` triple an `rgba()` needs. */
function hexToRgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`diagramInk: expected a 6-digit hex, got "${hex}"`)
  return m.slice(1).map(pair => parseInt(pair, 16)).join(', ')
}

/** Side of the square team-colour swatch in the lane gutter. */
export const LANE_SWATCH_SIZE = 10

/**
 * Everything else the gutter is laid out from.
 *
 * These live here for the same reason the colours do: two renderers draw the lanes
 * and the export is faithful only while they agree. A number declared twice makes
 * them agree by coincidence rather than by construction.
 */
/** Inset of the gutter's contents from its top-left corner. */
export const GUTTER_PADDING = 16
/** Gap between the swatch and the lane name. */
export const LANE_SWATCH_GAP = 8
/** Baseline drop from the lane name to the step count below it. */
export const LANE_COUNT_OFFSET = 18

/**
 * Lane band and gutter, shared by the on-screen renderer and the export.
 *
 * Team colour appears exactly once per lane, as the gutter swatch's fill. The band
 * itself is ink and rule: tinting it by team put the same colour in a second place
 * and made a wide lane read as a coloured region rather than a row.
 */
export const LANE_STYLE = {
  /** Band ground. */
  bandFill: SUNKEN,
  /** 1px separator under each band. 2px divides, 1px separates. */
  bandRule: RULE,
  bandRuleWidth: 1,
  /** Gutter ground and its 2px structural edge against the lane's contents. */
  gutterFill: BG,
  gutterRule: INK,
  gutterRuleWidth: 2,
  /** Lane name. */
  nameFill: INK_MUTED,
  nameFontSize: '11px',
  nameFontWeight: '700',
  nameLetterSpacing: '1.1px',
  /** Step count, set beside the name rather than in a filled badge. */
  countFill: INK,
  countFontSize: '11px',
  countFontWeight: '700',
} as const

/**
 * Edge label colours.
 *
 * Duplicated between `diagram.css` (which styles the on-screen labels) and
 * `DEFAULT_EDGE_OPTIONS` in `DiagramCanvas` (which inlines them so the export can
 * see them). Both must match these values.
 */
export const EDGE_LABEL = {
  color: INK,
  background: SURFACE,
  border: RULE,
} as const
