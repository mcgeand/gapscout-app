/**
 * Jira issue keys, read out of a ticket URL.
 *
 * An Atlassian project key starts with a letter and may carry digits and
 * underscores after it, so `P2P`, `ABC1` and `X2` are all legal. The old
 * `[A-Z]+-[0-9]+` skipped past the digit and stored `P2P-42` as `P-42`.
 * Single-letter keys still match. A key cannot start partway through a run
 * of capitals or digits either, or `2P-42` would read as `P-42`; that guard
 * is a prefix group rather than a lookbehind so older WebKit builds parse it.
 *
 * Ticket: #280
 */

import type { Link } from '../data/types'

const JIRA_KEY = /(?:^|[^A-Z0-9_])([A-Z][A-Z0-9_]*-[0-9]+)/

/** The issue key in `url`, or null when it holds none. */
export function extractJiraKey(url: string): string | null {
  const match = url.match(JIRA_KEY)
  return match ? match[1] : null
}

/**
 * A Jira link whose label is derived from its URL again. The label was only
 * ever computed from the URL, so a stored value written by the old parser is
 * a stale copy rather than something a person chose. A URL with no key keeps
 * whatever label it had. A malformed row passes through untouched, so the
 * schema check that follows reports it rather than this throwing first.
 */
export function withJiraLabel(link: Link): Link {
  if (link?.type !== 'jira' || typeof link.url !== 'string') return link
  const key = extractJiraKey(link.url)
  return key && key !== link.label ? { ...link, label: key } : link
}
