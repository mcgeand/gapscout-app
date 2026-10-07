# Node Context Menu

Right-click context menu for diagram nodes. DiagramCanvas opens it two ways: `onNodeContextMenu`, a right-click on a node, and `onSelectionContextMenu`, a right-click on the selection rectangle a Shift+drag box-select leaves behind (that rectangle covers the nodes it holds, so the nodes' own event never fires there).

Four flat rows, or five while the in-app clipboard holds steps. Reference: artboard 7b of the GapScout UI Unification canvas (issue #218), which draws five rows — its fifth, "Insert a step after", is omitted here because the diagram has no create path to run it, and #417 owns building one.

## Menu Items

In order, with exact labels:

1. **Edit step** (hint ⏎) — Opens StepEditModal
2. **Add a gap here** — Opens GapForm against this step
3. **Copy as JSON** (hint ⌘C) — Copies this step. With a multi-selection that includes the right-clicked step, the label counts it: **Copy 3 steps as JSON**, and all three are copied.
4. **Paste N steps after** (hint ⌘V) — **Only when the clipboard holds steps.** Reads **Paste 1 step after** for one, **Paste 2 steps after** for two. Opens PasteStepsModal anchored on this step.
5. **Delete step** (hint ⌫) — Confirms, then removes the step

The delete row is styled with danger text (`--gs-accent-ink`) and preceded by a 1px separator.

## Copy

Copy writes the `gapscout/steps` envelope (`{ kind, version, sourceProjectId, steps }`) to two places: the in-app buffer in `state/diagramClipboard.ts` first, the OS clipboard second, pretty-printed.

The buffer is the source of truth. A `navigator.clipboard.writeText` that rejects — no permission, no secure context — still counts as a copy, because paste inside the app reads the buffer: the toast says **Copied 3 steps as JSON** (or **Step copied as JSON** for one) either way, and the failure goes to `console.warn` rather than to the user.

`copyStepsAsJson(steps, projectId)` lives in `copySteps.ts` rather than in either component, because DiagramCanvas binds ⌘C on the pane to the same behaviour and "the same" has to mean the same code — and a component file that also exports a function breaks fast refresh.

## Keyboard Shortcuts

While the menu is open, document-level keydown handlers run:

- **Enter** — Executes the focused row
- **ArrowUp / ArrowDown** — Moves focus between rows (wraps at end)
- **Cmd+C / Ctrl+C** — Copies as JSON
- **Cmd+V / Ctrl+V** — Pastes after this step (opens the modal); no-op when the buffer is empty
- **Backspace / Delete** — Deletes step
- **Escape** — Closes menu
- **Tab** — Closes menu (focus leaves it)

Focus initially lands on the first row. Hover and focus styling are identical (2px `--gs-accent` left border).

DiagramCanvas binds the same two shortcuts on the pane — ⌘C copies the current multi-selection, ⌘V opens the paste modal with no anchor so the steps append — and it stands down while this menu is open, so neither shortcut runs twice.

## ARIA

- Container: `role="menu"`, `aria-label="Step actions"`
- Items: `role="menuitem"`, each with `aria-keyshortcuts` naming the bound key(s) — the paste row carries `Meta+V Control+V`
- Separator: `role="separator"` div above the delete row

## Positioning & Display

Fixed position at click point (clientX, clientY), z-index `var(--gs-z-popover)`. Closes on:
- Outside mousedown
- Escape or Tab key
- After any action (edit, add gap, copy, paste, delete)

## Props

```
step: Step | null
position: { x: number; y: number } | null
onClose: () => void
onEdit: (step: Step) => void
onDelete: (step: Step) => void
onAddGap: (step: Step) => void
selectedSteps?: Step[]        // the multi-selection in process order, when it contains `step`
onPaste?: (anchor: Step) => void
```
