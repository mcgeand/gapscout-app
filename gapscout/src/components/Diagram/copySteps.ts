/**
 * Copying steps to the clipboard (#155).
 *
 * Its own module, small as it is, because two surfaces run it — the node
 * context menu's "Copy as JSON" row and DiagramCanvas's ⌘C on the pane — and
 * "the canvas copies exactly like the menu" has to mean the same code rather
 * than a second copy of it. It cannot live in either component: a component
 * file that also exports a function breaks fast refresh.
 */
import toast from 'react-hot-toast'
import { serializeClipboard, useDiagramClipboard } from '../../state/diagramClipboard'
import type { Step } from '../../data/types'

/**
 * Put these steps on both clipboards, in the order given, and say so.
 *
 * The in-app buffer is the source of truth and the OS clipboard is the copy
 * that travels, so a `writeText` that rejects — no permission, no secure
 * context — is not a failed copy: paste inside the app still works, the toast
 * still says so, and only the console hears about it. The buffer write is
 * outside the try for the opposite reason: it failing is a bug, not a browser
 * declining, and swallowing it would report a copy that never happened.
 */
export async function copyStepsAsJson(steps: readonly Step[], projectId: string): Promise<void> {
  const payload = useDiagramClipboard.getState().copy(steps, projectId)

  try {
    await navigator.clipboard.writeText(serializeClipboard(payload))
  } catch (error) {
    console.warn('Could not write the copied steps to the OS clipboard:', error)
  }

  toast.success(steps.length > 1 ? `Copied ${steps.length} steps as JSON` : 'Step copied as JSON')
}
