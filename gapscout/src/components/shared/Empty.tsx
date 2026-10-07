/**
 * Empty - the one empty-cell convention for every table (#203).
 *
 * Six tables previously disagreed: an em-dash in Gaps, a bare hyphen in
 * Discovery, an italic em-dash in Glossary, and prose ("No description",
 * "No tags", "None") in the other three registries. A blank cell should read
 * as a cell with nothing in it, not as a sentence, so it is one glyph
 * everywhere.
 */
export function Empty() {
  return <span className="text-gs-ink-faint">—</span>
}

export default Empty
