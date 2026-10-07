import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// `no-restricted-syntax` selector sets.
//
// These are consts, and the blocks below spread them, because flat config
// *replaces* a rule's options rather than merging them. Two config objects that
// both match a file and both set `no-restricted-syntax` mean the later one wins
// and the earlier one's selectors vanish with no error and a passing lint — the
// gate goes quietly dead exactly as #234 describes for `tsc`. It has already
// happened twice in this file: once deleting the dialog bans, once silently
// leaving `src/lib` and `src/services` outside the `order` guard. So: every
// block that sets the rule spreads every set that applies to its files.

/**
 * Ban synchronous blocking dialogs. They freeze the JS main thread (ZIP-379)
 * and are invisible to programmatic test drivers.
 */
const BLOCKING_DIALOG_SELECTORS = [
  {
    selector: 'MemberExpression[object.name="window"][property.name="confirm"]',
    message: 'Use a React confirmation dialog instead of window.confirm().',
  },
  {
    selector: 'MemberExpression[object.name="window"][property.name="alert"]',
    message: 'Use a React notification (toast) instead of window.alert().',
  },
  {
    selector: 'MemberExpression[object.name="window"][property.name="prompt"]',
    message: 'Use a React input component instead of window.prompt().',
  },
]

/**
 * Ban printing a stored `order` straight into a user-facing string (#345).
 *
 * `steps."order"` numbers a step within its milestone, so the moment a project
 * has a second milestone the value appears nowhere on screen — the grid's `#`
 * column shows a running position across the whole process. Fifteen surfaces
 * drifted into printing the stored value, one issue per PR.
 *
 * **What this catches, exactly:** a `MemberExpression` named `order` as the
 * direct child of a template literal, a JSX expression container, a `+` with a
 * string literal on either side, or a `String()` call. That is the shape the
 * fifteen sites actually had.
 *
 * **What it does not catch:** a value moved through a variable first
 * (`const n = step.order`), a conditional inside the template
 * (`${flag ? a.order : b.order}`), `.toString()`, template nesting, and any
 * interpolation of a field not literally named `order`. It makes the common
 * shapes hard to write; it is not a proof that the family cannot recur.
 *
 * The fix idiom `${displayNumbers?.get(step.id) ?? step.order}` passes, because
 * the member expression sits under a `LogicalExpression` rather than directly
 * under the template — as does any call to a `processPositions` accessor.
 *
 * It keys on the property name alone, so it also fires on `milestone.order`
 * (project-scoped, and legitimately displayed) and on `key={row.order}`. Both
 * are real matches rather than bugs in the selector: disable them on the line
 * with a reason, which is the record of why that one is not the defect.
 */
const STORED_ORDER_DISPLAY_SELECTORS = [
  {
    selector: 'TemplateLiteral > MemberExpression[property.name="order"]',
    message:
      "Printing a stored `order`: it is scoped to the milestone and names nothing on screen (#345). Use the process position — `displayNumbers?.get(row.id) ?? row.order`, or `processPositions` from src/lib/stepSequence.",
  },
  {
    selector: 'JSXExpressionContainer > MemberExpression[property.name="order"]',
    message:
      "Printing a stored `order`: it is scoped to the milestone and names nothing on screen (#345). Use the process position — `displayNumbers?.get(row.id) ?? row.order`, or `processPositions` from src/lib/stepSequence.",
  },
  {
    // A string literal on either side: `'Order #' + step.order` and
    // `step.order + ' of six'` are both the defect, while `step.order + 1` is
    // arithmetic on the value being written.
    selector:
      'BinaryExpression[operator="+"][left.type="Literal"] > MemberExpression[property.name="order"], BinaryExpression[operator="+"][right.type="Literal"][right.value=/^\\D/] > MemberExpression[property.name="order"]',
    message:
      "Concatenating a stored `order` into a string: it is scoped to the milestone and names nothing on screen (#345). Use the process position — `displayNumbers?.get(row.id) ?? row.order`.",
  },
  {
    selector: 'CallExpression[callee.name="String"] > MemberExpression[property.name="order"]',
    message:
      "Stringifying a stored `order`: it is scoped to the milestone and names nothing on screen (#345). Use the process position, or disable this line with a reason if the stored value is genuinely what belongs there.",
  },
]

/**
 * Ban silent `<*Id> || ''` fallbacks in converter neighborhoods (ZIP-381,
 * ZIP-393). An empty-string fallback on a NOT NULL FK column produces rows that
 * pass SQL but fail Zod row validation on read — silent data corruption.
 * Resolve a real id (or a sentinel like the "Unassigned" team), or throw
 * upstream; never `|| ''`.
 *
 * Deliberately narrower than the sets above: component code has legitimate
 * `someId || ''` for form state, and widening this would flag seven of them.
 */
const FK_EMPTY_STRING_SELECTORS = [
  {
    selector:
      'LogicalExpression[operator="||"][left.type="MemberExpression"][left.property.name=/Id$/][right.type="Literal"][right.value=""]',
    message:
      "Silent `<*Id> || ''` fallback on a FK-shaped field — see ZIP-381 / ZIP-393. Resolve a real id (or sentinel) upstream, or throw.",
  },
  {
    selector:
      'LogicalExpression[operator="||"][left.type="Identifier"][left.name=/Id$/][right.type="Literal"][right.value=""]',
    message:
      "Silent `<*Id> || ''` fallback on a FK-shaped field — see ZIP-381 / ZIP-393. Resolve a real id (or sentinel) upstream, or throw.",
  },
]

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Tests are exempt throughout: they legitimately spy on window.confirm and
    // build fixtures out of stored orders.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/__tests__/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use a React confirmation dialog instead of confirm().' },
        { name: 'alert', message: 'Use a React notification (toast) instead of alert().' },
        { name: 'prompt', message: 'Use a React input component instead of prompt().' },
      ],
      'no-restricted-syntax': [
        'error',
        ...BLOCKING_DIALOG_SELECTORS,
        ...STORED_ORDER_DISPLAY_SELECTORS,
      ],
    },
  },
  {
    // The converter neighborhoods add the FK ban. Both sets above are respread
    // rather than inherited — see the note at the top of this file.
    files: ['src/services/**/*.ts', 'src/lib/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...BLOCKING_DIALOG_SELECTORS,
        ...STORED_ORDER_DISPLAY_SELECTORS,
        ...FK_EMPTY_STRING_SELECTORS,
      ],
    },
  },
])
