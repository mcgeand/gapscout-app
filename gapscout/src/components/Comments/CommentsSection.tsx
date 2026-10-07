/**
 * CommentsSection - the discussion thread on one step (#157).
 *
 * Reference: PRD Section 4.9 - Comments on Steps
 *
 * `Step.comments` is a JSON array on the step row, so every action here writes
 * the whole thread back through `stepsStore.updateStep`. Two writes started from
 * the same array would each build from a stale copy and the second would drop
 * the first, so `save` refuses to start a second one. The guard is correctness,
 * not polish — and it lives on a ref rather than on `isSaving`, because a render
 * has to happen before state reaches an event handler's closure and two keydowns
 * can land inside that window.
 *
 * The textareas deliberately stay enabled while a write is in flight. Disabling
 * the element the user is typing in blurs it, so focus would be lost on every
 * Enter — in a feature whose whole interaction is type, Enter, type again.
 *
 * `updateStep` toasts and rethrows on failure, so the catch here only has to
 * leave the draft where the user can retry it — a second toast would say the
 * same thing twice.
 */

import { useRef, useState } from 'react'
import { ConfirmModal } from '../shared/ConfirmModal'
import { EmptyState } from '../shared/EmptyState'
import { formatRelativeTime } from '../Gaps/gapDisplay'
import { MAX_LENGTH } from '../../data/constants'
import type { Comment, Step } from '../../data/types'
import {
  addComment,
  commentsNewestFirst,
  editComment,
  removeComment,
  validateCommentText,
} from '../../lib/stepComments'
import { useStepsStore } from '../../state/stepsStore'

interface CommentsSectionProps {
  step: Step
}

/** Enough of a comment to tell one row's actions from another's, spoken aloud. */
const actionLabelFor = (comment: Comment): string =>
  comment.text.length > 40 ? `${comment.text.slice(0, 40)}…` : comment.text

export default function CommentsSection({ step }: CommentsSectionProps) {
  const { updateStep } = useStepsStore()

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Comment | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)

  const comments = step.comments ?? []
  const ordered = commentsNewestFirst(comments)

  /** Write a whole thread back. Returns whether it committed. */
  const save = async (next: Comment[]): Promise<boolean> => {
    if (savingRef.current) return false
    savingRef.current = true
    setIsSaving(true)
    try {
      await updateStep(step.id, { comments: next }, step.projectId)
      return true
    } catch {
      // `updateStep` has already reported it.
      return false
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  const handleAdd = async () => {
    const submitted = draft
    const next = addComment(comments, submitted)
    if (!next) return
    // Clear only what was actually submitted. The composer stays enabled during
    // the write, so the user may already be typing the next comment into it —
    // a bare `setDraft('')` would wipe that.
    if (await save(next)) setDraft(prev => (prev === submitted ? '' : prev))
  }

  const handleStartEdit = (comment: Comment) => {
    setEditingId(comment.id)
    setEditDraft(comment.text)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const handleSaveEdit = async (id: string) => {
    const next = editComment(comments, id, editDraft)
    if (!next) return
    if (await save(next)) handleCancelEdit()
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    const next = removeComment(comments, pendingDelete.id)
    setPendingDelete(null)
    if (!next) return
    await save(next)
  }

  // Enter submits, Shift+Enter starts a new line (PRD §4.9). A predicate rather
  // than a handler factory: a factory called during render that closes over
  // `savingRef` trips `react-hooks/refs`.
  const isPlainEnter = (event: React.KeyboardEvent) =>
    event.key === 'Enter' && !event.shiftKey

  const draftIsValid = validateCommentText(draft) === null
  const editIsValid = validateCommentText(editDraft) === null

  return (
    <section aria-labelledby="comments-heading">
      {/* h3, not h4, even though this sits under the drawer's h3 title:
          `EmptyState` hard-codes an h3, so an h4 here would nest a level it
          skips back over. Levelling `EmptyState` is a shared-component change
          and gets its own issue. */}
      <h3
        id="comments-heading"
        className="text-xs font-semibold uppercase tracking-wide text-gs-ink-muted"
      >
        Comments
      </h3>

      <div className="mt-gs-3 space-y-gs-2">
        {ordered.length === 0 ? (
          <EmptyState
            title="No comments yet"
            message="A comment records what the team knows about this step that the fields do not say."
          />
        ) : (
          ordered.map(comment => (
            <article
              key={comment.id}
              className="border border-gs-rule p-gs-3"
              aria-label={`Comment from ${formatRelativeTime(comment.createdAt)}`}
            >
              {editingId === comment.id ? (
                <>
                  <label className="sr-only" htmlFor={`comment-edit-${comment.id}`}>
                    Edit comment
                  </label>
                  <textarea
                    id={`comment-edit-${comment.id}`}
                    className="textarea-field w-full"
                    rows={3}
                    value={editDraft}
                    maxLength={MAX_LENGTH.COMMENT_TEXT}
                    onChange={e => setEditDraft(e.target.value)}
                    onKeyDown={event => {
                      if (!isPlainEnter(event)) return
                      event.preventDefault()
                      if (editIsValid && !isSaving) void handleSaveEdit(comment.id)
                    }}
                  />
                  <div className="mt-gs-2 flex gap-gs-2">
                    <button
                      className="btn-primary"
                      disabled={!editIsValid || isSaving}
                      onClick={() => void handleSaveEdit(comment.id)}
                    >
                      Save
                    </button>
                    <button className="btn-secondary" disabled={isSaving} onClick={handleCancelEdit}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm text-gs-ink">{comment.text}</p>
                  <div className="mt-gs-2 flex items-center justify-between gap-gs-2">
                    <span className="text-xs text-gs-ink-faint">
                      {/* No stored author means the app has no identity to write
                          yet (#125), not that nobody wrote it — this is a
                          single-user desktop app, so the reader is the author.
                          The fallback is display-only: nothing is written, so
                          #125 can fill in a real name from Settings without
                          rewriting comments made before it landed. */}
                      {comment.author?.trim() || 'You'} ·{' '}
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                    <span className="flex gap-gs-2">
                      {/* The visible label stays one word, but every row would
                          otherwise announce as an identical "Edit, button". */}
                      <button
                        className="btn-ghost"
                        disabled={isSaving}
                        aria-label={`Edit comment: ${actionLabelFor(comment)}`}
                        onClick={() => handleStartEdit(comment)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-ghost"
                        disabled={isSaving}
                        aria-label={`Delete comment: ${actionLabelFor(comment)}`}
                        onClick={() => setPendingDelete(comment)}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                </>
              )}
            </article>
          ))
        )}
      </div>

      <div className="mt-gs-3">
        <label className="sr-only" htmlFor="comment-draft">
          Add a comment
        </label>
        <textarea
          id="comment-draft"
          className="textarea-field w-full"
          rows={3}
          placeholder="Add a comment"
          value={draft}
          maxLength={MAX_LENGTH.COMMENT_TEXT}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={event => {
            if (!isPlainEnter(event)) return
            event.preventDefault()
            if (draftIsValid && !isSaving) void handleAdd()
          }}
        />
        <button
          className="btn-primary mt-gs-2 w-full"
          disabled={!draftIsValid || isSaving}
          onClick={() => void handleAdd()}
        >
          Add Comment
        </button>
      </div>

      {pendingDelete && (
        <ConfirmModal
          isOpen
          onClose={() => setPendingDelete(null)}
          title="Delete Comment?"
          description={
            <>
              <p>This comment will be permanently deleted.</p>
              <p className="mt-gs-2 border border-gs-rule p-gs-3 text-xs text-gs-ink">
                {pendingDelete.text}
              </p>
            </>
          }
          confirmAction={{
            label: 'Delete Comment',
            style: 'danger',
            onClick: () => void handleConfirmDelete(),
          }}
        />
      )}
    </section>
  )
}
