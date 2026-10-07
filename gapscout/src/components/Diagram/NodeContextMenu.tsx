/**
 * NodeContextMenu - Right-click context menu for diagram nodes
 *
 * Four flat rows, or five while the in-app clipboard holds steps:
 * - Edit step (⏎) - opens StepEditModal
 * - Add a gap here - opens GapForm against this step
 * - Copy as JSON (⌘C) - puts the step, or the whole selection, on the clipboard
 * - Paste N steps after (⌘V) - only while the buffer holds steps; opens
 *   PasteStepsModal anchored on this step
 * - Delete step (⌫) - confirms, then removes the step
 *
 * Artboard 7b draws five rows and its fifth, "Insert a step after", is still
 * omitted: the diagram has no create path to run it, and #417 owns building
 * one. The paste row is not that row wearing a different label — it writes rows
 * that already exist somewhere rather than creating an empty one.
 *
 * Copy writes the `gapscout/steps` envelope to the in-app buffer first and to
 * the OS clipboard second. The buffer is the source of truth, so a clipboard
 * write that fails still counts as a copy: paste inside the app works either
 * way, and only the console hears about it.
 *
 * The shortcut hints are wired, not decoration: while the menu is open a
 * document-level keydown runs the same handlers the rows do. Arrow keys walk the
 * rows and move focus, so the accent bar that marks hover also marks focus.
 *
 * Reference: PRD Section 4.6 - Bidirectional Editing
 * Ticket: ZIP-95, #155
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useDiagramClipboard } from '../../state/diagramClipboard'
import { copyStepsAsJson } from './copySteps'
import type { Step } from '../../data/types'

interface NodeContextMenuProps {
  step: Step | null
  position: { x: number; y: number } | null
  onClose: () => void
  onEdit: (step: Step) => void
  onDelete: (step: Step) => void
  onAddGap: (step: Step) => void
  /**
   * The current multi-selection in process order, when the right-clicked step is
   * part of it. Copy takes the selection instead of the one step.
   */
  selectedSteps?: Step[]
  /** Opens the paste modal anchored after this step. */
  onPaste?: (anchor: Step) => void
}

interface MenuItem {
  label: string
  /** Keyboard hint drawn right-aligned; the same key runs `onClick`. */
  hint?: string
  keyShortcuts?: string
  onClick: () => void
  /** Delete is the only row that takes the accent, and it takes it as text. */
  danger?: boolean
  separator?: boolean
}

/**
 * The resting row already owns a 2px transparent left border so that gaining the
 * accent bar on hover or focus tints an edge rather than shifting the label.
 */
const ROW_BASE =
  'flex w-full items-center gap-gs-3 border-l-2 border-transparent px-gs-4 py-gs-2 text-left text-sm outline-none transition-colors hover:border-gs-accent hover:bg-gs-sunken focus:border-gs-accent focus:bg-gs-sunken'

export default function NodeContextMenu({
  step,
  position,
  onClose,
  onEdit,
  onDelete,
  onAddGap,
  selectedSteps,
  onPaste,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const clipboard = useDiagramClipboard(state => state.clipboard)

  const isOpen = Boolean(position && step)

  // A right-click inside a multi-selection copies the whole selection; one on a
  // node outside it copies that node alone, which is what the pointer pointed at.
  const copyTargets: Step[] = useMemo(() => {
    if (!step) return []
    const inSelection =
      selectedSteps && selectedSteps.length > 1 && selectedSteps.some(one => one.id === step.id)
    return inSelection ? selectedSteps : [step]
  }, [step, selectedSteps])

  const pasteCount = clipboard?.steps.length ?? 0

  /**
   * Copy the step, or the whole selection, as JSON
   */
  const handleCopy = useCallback(async () => {
    if (!step || copyTargets.length === 0) return
    onClose()
    await copyStepsAsJson(copyTargets, step.projectId)
  }, [step, copyTargets, onClose])

  // ⌘V with an empty buffer does nothing at all — not even close the menu. The
  // row it belongs to is not drawn then, and a shortcut that opens a paste
  // dialog with nothing to paste is a dead end dressed up as an action.
  const handlePaste = useCallback(() => {
    if (!step || pasteCount === 0) return
    onPaste?.(step)
    onClose()
  }, [step, pasteCount, onPaste, onClose])

  const handleEdit = useCallback(() => {
    if (!step) return
    onEdit(step)
    onClose()
  }, [step, onEdit, onClose])

  const handleDelete = useCallback(() => {
    if (!step) return
    onDelete(step)
    onClose()
  }, [step, onDelete, onClose])

  const handleAddGap = useCallback(() => {
    if (!step) return
    onAddGap(step)
    onClose()
  }, [step, onAddGap, onClose])

  const menuItems: MenuItem[] = [
    {
      label: 'Edit step',
      hint: '⏎',
      keyShortcuts: 'Enter',
      onClick: handleEdit,
    },
    {
      label: 'Add a gap here',
      onClick: handleAddGap,
    },
    {
      label: copyTargets.length > 1 ? `Copy ${copyTargets.length} steps as JSON` : 'Copy as JSON',
      hint: '⌘C',
      keyShortcuts: 'Meta+C Control+C',
      onClick: handleCopy,
    },
    // Only when there is something to paste: a row that says "Paste 0 steps
    // after" is a row that cannot run.
    ...(pasteCount > 0
      ? [
          {
            label: pasteCount > 1 ? `Paste ${pasteCount} steps after` : 'Paste 1 step after',
            hint: '⌘V',
            keyShortcuts: 'Meta+V Control+V',
            onClick: handlePaste,
          },
        ]
      : []),
    {
      label: 'Delete step',
      hint: '⌫',
      keyShortcuts: 'Backspace Delete',
      onClick: handleDelete,
      danger: true,
      separator: true,
    },
  ]

  // Focus the first row when the menu opens, so Enter has somewhere honest to
  // land and the arrow keys have a starting point.
  useEffect(() => {
    if (!isOpen) return
    itemRefs.current[0]?.focus()
  }, [isOpen, position])

  // Close on an outside mousedown; run the shortcuts the hints promise.
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const focusedIndex = () =>
      itemRefs.current.findIndex((el) => el && el === document.activeElement)

    const moveFocus = (delta: number) => {
      const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
      if (items.length === 0) return
      const current = focusedIndex()
      const next = current < 0 ? 0 : (current + delta + items.length) % items.length
      items[next]?.focus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          onClose()
          return
        // Focus leaving the menu closes it, which is the WAI-ARIA menu pattern:
        // Tab moves to the next element in the page, not between the rows.
        case 'Tab':
          onClose()
          return
        case 'ArrowDown':
          event.preventDefault()
          moveFocus(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          moveFocus(-1)
          return
        case 'Enter': {
          // A focused button fires its own click on Enter; preventDefault stops
          // that synthesised click so the focused row runs exactly once.
          event.preventDefault()
          const index = focusedIndex()
          itemRefs.current[index < 0 ? 0 : index]?.click()
          return
        }
        case 'Backspace':
        case 'Delete':
          event.preventDefault()
          handleDelete()
          return
        case 'c':
        case 'C':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault()
            void handleCopy()
          }
          return
        case 'v':
        case 'V':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault()
            handlePaste()
          }
          return
        default:
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose, handleCopy, handleDelete, handlePaste])

  // Don't render if no position or step
  if (!position || !step) {
    return null
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Step actions"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 'var(--gs-z-popover)',
      }}
      // `nokey` is React Flow's opt-out class: its global key handler reads
      // Backspace unless the event target sits inside `.nokey` (it only exempts
      // inputs otherwise), and the menu's own ⌫ binding must not race it. The
      // canvas also passes `deleteKeyCode={null}` now, which disarms that
      // handler; the class stays because it is the menu's own guarantee rather
      // than a borrowed one. See isInputDOMNode in @reactflow/core.
      className="nokey flex min-w-[220px] flex-col border-2 border-gs-ink bg-gs-surface py-gs-1"
    >
      {menuItems.map((item, index) => (
        <div key={item.label}>
          {item.separator && <div role="separator" className="my-gs-1 border-t border-gs-rule" />}

          <button
            type="button"
            role="menuitem"
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            onClick={item.onClick}
            aria-keyshortcuts={item.keyShortcuts}
            className={`${ROW_BASE} ${item.danger ? 'font-semibold text-gs-accent-ink' : 'text-gs-ink'}`}
          >
            <span>{item.label}</span>
            {item.hint && (
              <span className="ml-auto font-mono text-xs text-gs-ink-muted">{item.hint}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}
