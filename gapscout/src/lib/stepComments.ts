/**
 * Pure helpers for a step's discussion thread (#157, PRD §4.9).
 *
 * `Step.comments` is a JSON array on the `steps` row, so there is no service
 * function to own the rules — the caller builds the next array and hands it to
 * `stepsStore.updateStep({ comments })`. These helpers are that owner.
 *
 * Trimming and the length cap are enforced here rather than only on the
 * textarea, because nothing downstream will do it: `dbUpdateStep` serialises the
 * patch straight to SQL with no Zod pass, and the read path's
 * `validateRow(StepSchema, …)` only warns to the console and hands the row back
 * unchanged. An empty or over-long comment therefore round-trips silently — the
 * UI is the only place it can be refused.
 */

import { nanoid } from 'nanoid'
import { MAX_LENGTH } from '../data/constants'
import type { Comment } from '../data/types'

/** Why a comment text was refused, or `null` when it is acceptable. */
export type CommentTextError = 'empty' | 'too-long'

/**
 * Validate the raw text of a comment as typed.
 *
 * Mirrors `CommentSchema`: non-empty after trimming, at most
 * `MAX_LENGTH.COMMENT_TEXT` characters.
 */
export function validateCommentText(text: string): CommentTextError | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 'empty'
  if (trimmed.length > MAX_LENGTH.COMMENT_TEXT) return 'too-long'
  return null
}

/**
 * Append a comment, returning a new array.
 *
 * Returns `null` when the text is not acceptable, so a caller cannot write an
 * invalid thread by ignoring a boolean.
 */
export function addComment(
  comments: Comment[],
  text: string,
  author?: string
): Comment[] | null {
  if (validateCommentText(text) !== null) return null
  const comment: Comment = {
    id: nanoid(),
    text: text.trim(),
    createdAt: Date.now(),
    ...(author?.trim() ? { author: author.trim() } : {}),
  }
  return [...comments, comment]
}

/**
 * Replace one comment's text, returning a new array.
 *
 * `createdAt` is deliberately untouched: it is what the thread is ordered by,
 * so an edit that bumped it would silently reorder the discussion.
 */
export function editComment(
  comments: Comment[],
  id: string,
  text: string
): Comment[] | null {
  if (validateCommentText(text) !== null) return null
  if (!comments.some(c => c.id === id)) return null
  return comments.map(c => (c.id === id ? { ...c, text: text.trim() } : c))
}

/** Remove one comment, returning a new array, or `null` when the id is unknown. */
export function removeComment(comments: Comment[], id: string): Comment[] | null {
  if (!comments.some(c => c.id === id)) return null
  return comments.filter(c => c.id !== id)
}

/**
 * Display order: newest first (PRD §4.9).
 *
 * Storage stays in insertion order, so the reverse is what breaks a
 * same-millisecond tie — two comments added inside one tick then read newest
 * first rather than in whichever order a stable sort happened to leave them.
 */
export function commentsNewestFirst(comments: Comment[]): Comment[] {
  return [...comments].reverse().sort((a, b) => b.createdAt - a.createdAt)
}
