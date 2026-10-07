import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  addComment,
  commentsNewestFirst,
  editComment,
  removeComment,
  validateCommentText,
} from '../lib/stepComments'
import { serializeArray, stepRowToStep } from '../services/db'
import { MAX_LENGTH } from '../data/constants'
import type { Comment, StepRow } from '../data/types'

const comment = (id: string, createdAt: number, text = `text ${id}`): Comment => ({
  id,
  text,
  createdAt,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('validateCommentText', () => {
  it('rejects text that is empty once trimmed', () => {
    expect(validateCommentText('')).toBe('empty')
    expect(validateCommentText('   \n  ')).toBe('empty')
  })

  it('rejects text over the schema cap', () => {
    expect(validateCommentText('a'.repeat(MAX_LENGTH.COMMENT_TEXT))).toBeNull()
    expect(validateCommentText('a'.repeat(MAX_LENGTH.COMMENT_TEXT + 1))).toBe('too-long')
  })

  it('measures the cap after trimming, so surrounding whitespace does not count', () => {
    expect(validateCommentText(`  ${'a'.repeat(MAX_LENGTH.COMMENT_TEXT)}  `)).toBeNull()
  })
})

describe('addComment', () => {
  it('appends a trimmed comment with an id and a timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)

    const next = addComment([], '  Needs a second approver  ')

    expect(next).toHaveLength(1)
    expect(next![0]).toMatchObject({
      text: 'Needs a second approver',
      createdAt: 1_700_000_000_000,
    })
    expect(next![0].id).toBeTruthy()
    expect(next![0]).not.toHaveProperty('author')
  })

  it('does not mutate the array it was given', () => {
    const existing = [comment('c1', 1)]
    const next = addComment(existing, 'Second')

    expect(existing).toHaveLength(1)
    expect(next).toHaveLength(2)
  })

  it('records a trimmed author when one is supplied', () => {
    const next = addComment([], 'Text', '  Danny  ')
    expect(next![0].author).toBe('Danny')
  })

  it('omits the author key when it is blank', () => {
    const next = addComment([], 'Text', '   ')
    expect(next![0]).not.toHaveProperty('author')
  })

  it('refuses invalid text rather than writing a thread that cannot be read back', () => {
    expect(addComment([], '   ')).toBeNull()
    expect(addComment([], 'a'.repeat(MAX_LENGTH.COMMENT_TEXT + 1))).toBeNull()
  })
})

describe('editComment', () => {
  it('replaces the text and leaves createdAt alone', () => {
    const existing = [comment('c1', 10), comment('c2', 20)]
    const next = editComment(existing, 'c2', '  Rewritten  ')

    expect(next).toEqual([
      { id: 'c1', text: 'text c1', createdAt: 10 },
      { id: 'c2', text: 'Rewritten', createdAt: 20 },
    ])
  })

  it('returns null for an unknown id', () => {
    expect(editComment([comment('c1', 10)], 'missing', 'Text')).toBeNull()
  })

  it('returns null for invalid text', () => {
    const existing = [comment('c1', 10)]
    expect(editComment(existing, 'c1', '  ')).toBeNull()
    expect(editComment(existing, 'c1', 'a'.repeat(MAX_LENGTH.COMMENT_TEXT + 1))).toBeNull()
  })
})

describe('removeComment', () => {
  it('drops just the named comment', () => {
    const existing = [comment('c1', 10), comment('c2', 20), comment('c3', 30)]
    expect(removeComment(existing, 'c2')).toEqual([existing[0], existing[2]])
    expect(existing).toHaveLength(3)
  })

  it('returns null for an unknown id', () => {
    expect(removeComment([comment('c1', 10)], 'missing')).toBeNull()
  })
})

describe('commentsNewestFirst', () => {
  it('orders by createdAt descending', () => {
    const stored = [comment('old', 10), comment('newest', 30), comment('middle', 20)]
    expect(commentsNewestFirst(stored).map(c => c.id)).toEqual(['newest', 'middle', 'old'])
  })

  it('breaks a same-millisecond tie on insertion order, newest insertion first', () => {
    const stored = [comment('first', 100), comment('second', 100), comment('third', 100)]
    expect(commentsNewestFirst(stored).map(c => c.id)).toEqual(['third', 'second', 'first'])
  })

  it('does not mutate the stored order', () => {
    const stored = [comment('old', 10), comment('new', 30)]
    commentsNewestFirst(stored)
    expect(stored.map(c => c.id)).toEqual(['old', 'new'])
  })
})

/**
 * The persistence contract, without a database.
 *
 * A comment these helpers build is only really saved if it survives
 * serialize → row → `stepRowToStep`. Nothing downstream enforces the schema:
 * `dbUpdateStep` writes with no Zod pass, and `validateRow` only warns and
 * returns the row unchanged. So an over-long comment round-trips intact with a
 * console warning behind it — which is exactly why the helpers refuse one at
 * the point it is typed.
 */
describe('a comment survives the row round trip', () => {
  const rowFor = (comments: Comment[]): StepRow => ({
    id: 'step-1',
    project_id: 'project-1',
    label: 'Review request',
    team_id: 'team-1',
    milestone_id: 'milestone-1',
    order: 1,
    suppliers: '[]',
    inputs: '[]',
    outputs: '[]',
    customers: '[]',
    systems: '[]',
    trigger: null,
    result: null,
    kpi: null,
    decision: 0,
    branches: null,
    notes: null,
    comments: serializeArray(comments),
    links: '[]',
    gap_ids: '[]',
    diagram_position: null,
    validation_status: null,
    created_at: 1,
    updated_at: 1,
  })

  it('reads back exactly what was written, author and all', () => {
    const written = addComment(
      addComment([], 'First note')!,
      'Second note',
      'Danny'
    )!

    expect(stepRowToStep(rowFor(written)).comments).toEqual(written)
  })

  it('accepts a comment at the full length cap', () => {
    const written = addComment([], 'a'.repeat(MAX_LENGTH.COMMENT_TEXT))!
    expect(stepRowToStep(rowFor(written)).comments[0].text).toHaveLength(
      MAX_LENGTH.COMMENT_TEXT
    )
  })

  it('only warns when a comment breaks the schema, so the UI is the real gate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const overLong: Comment = {
      id: 'c1',
      text: 'a'.repeat(MAX_LENGTH.COMMENT_TEXT + 1),
      createdAt: 1,
    }

    // It comes back intact rather than throwing or being dropped — the bad
    // value would simply live in the database.
    expect(stepRowToStep(rowFor([overLong])).comments).toEqual([overLong])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('schema validation failed')
    )

    warn.mockRestore()
  })
})
