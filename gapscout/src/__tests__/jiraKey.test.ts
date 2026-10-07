import { describe, expect, it } from 'vitest'
import { extractJiraKey, withJiraLabel } from '../lib/jiraKey'
import type { Link } from '../data/types'

function link(overrides: Partial<Link>): Link {
  return { id: 'l1', url: '', label: '', type: 'jira', createdAt: 1, ...overrides }
}

describe('extractJiraKey', () => {
  it.each([
    ['https://acme.atlassian.net/browse/P2P-42', 'P2P-42'],
    ['https://acme.atlassian.net/browse/ABC1-7', 'ABC1-7'],
    ['https://acme.atlassian.net/browse/X2-1', 'X2-1'],
    ['https://acme.atlassian.net/browse/MY_PROJ-9', 'MY_PROJ-9'],
    ['https://acme.atlassian.net/browse/PROJ-123', 'PROJ-123'],
    ['https://acme.atlassian.net/browse/Q-5', 'Q-5'],
    [
      'https://acme.atlassian.net/jira/software/projects/P2P/boards/1?selectedIssue=P2P-42',
      'P2P-42',
    ],
  ])('reads %s as %s', (url, key) => {
    expect(extractJiraKey(url)).toBe(key)
  })

  it('returns null when the URL holds no key', () => {
    expect(extractJiraKey('https://acme.atlassian.net/browse/')).toBeNull()
    expect(extractJiraKey('https://acme.atlassian.net/browse/2P-42')).toBeNull()
  })
})

describe('withJiraLabel', () => {
  it('recomputes a label the old parser truncated', () => {
    const stale = link({ url: 'https://acme.atlassian.net/browse/P2P-42', label: 'P-42' })
    expect(withJiraLabel(stale)).toEqual({ ...stale, label: 'P2P-42' })
  })

  it('returns the same object when the label is already right', () => {
    const good = link({ url: 'https://acme.atlassian.net/browse/PROJ-123', label: 'PROJ-123' })
    expect(withJiraLabel(good)).toBe(good)
  })

  it('keeps the label when the URL holds no key', () => {
    const odd = link({ url: 'https://acme.atlassian.net/', label: 'Board' })
    expect(withJiraLabel(odd)).toBe(odd)
  })

  it('leaves non-Jira links alone', () => {
    const doc = link({ url: 'https://docs.example/ABC-1', label: 'Spec', type: 'gdrive' })
    expect(withJiraLabel(doc)).toBe(doc)
  })
})
