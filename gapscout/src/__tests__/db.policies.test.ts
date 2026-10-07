/**
 * Write-path tests for Policies and Glossary CRUD (ZIP-341, ZIP-342).
 *
 * Verifies that createPolicy / updatePolicy / createGlossaryEntry /
 * updateGlossaryEntry serialize JSON arrays via serializeArray() before
 * passing them to the adapter, and that updatePolicy appends updated_at
 * while updateGlossaryEntry does not (no such column in the glossary table).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
}))

vi.mock('../services/db/sqlJsAdapter', () => ({
  SqlJsAdapter: class {
    initialize = vi.fn().mockResolvedValue(undefined)
    execute = mockExecute
    select = mockSelect
    close = vi.fn()
  },
}))

import {
  initDB,
  createPolicy,
  updatePolicy,
  createGlossaryEntry,
  updateGlossaryEntry,
  serializeArray,
} from '../services/db'

describe('createPolicy — write path (ZIP-341)', () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    mockExecute.mockClear()
    mockSelect.mockClear()
  })

  it('serializes related_milestones as JSON before writing to DB', async () => {
    await createPolicy({
      projectId: 'proj-1',
      title: 'Test Policy',
      content: 'Policy content',
      relatedMilestones: ['ms-1', 'ms-2'],
      tags: [],
    })

    expect(mockExecute).toHaveBeenCalledTimes(3) // 1: INSERT INTO policies, 2: INSERT INTO search_index, 3: touch the project (#395)
    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(serializeArray(['ms-1', 'ms-2']))
  })

  it('serializes tags as JSON before writing to DB', async () => {
    await createPolicy({
      projectId: 'proj-1',
      title: 'Test Policy',
      content: 'Policy content',
      relatedMilestones: [],
      tags: ['compliance', 'finance'],
    })

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(serializeArray(['compliance', 'finance']))
  })

  it('maps undefined sourceDoc to null at position $5', async () => {
    await createPolicy({
      projectId: 'proj-1',
      title: 'Test Policy',
      content: 'Policy content',
      relatedMilestones: [],
      tags: [],
    })

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params[4]).toBeNull() // source_doc is $5 in the INSERT
  })
})

describe('updatePolicy — write path (ZIP-341)', () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    mockExecute.mockClear()
    mockSelect.mockClear()
  })

  it('serializes relatedMilestones as JSON in the UPDATE params', async () => {
    await updatePolicy('policy-1', { relatedMilestones: ['ms-3', 'ms-4'] }, 'proj-1')

    const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/UPDATE policies SET/)
    expect(sql).toMatch(/related_milestones =/)
    expect(params).toContain(serializeArray(['ms-3', 'ms-4']))
  })

  it('serializes tags as JSON in the UPDATE params', async () => {
    await updatePolicy('policy-1', { tags: ['sox', 'gdpr'] }, 'proj-1')

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(serializeArray(['sox', 'gdpr']))
  })

  it('appends updated_at to the SET clause', async () => {
    await updatePolicy('policy-1', { title: 'Updated Title' }, 'proj-1')

    const [sql] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/updated_at = \$\d+/)
  })

  it('is a no-op when called with an empty changes object', async () => {
    await updatePolicy('policy-1', {}, 'proj-1')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('createGlossaryEntry — write path (ZIP-342)', () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    mockExecute.mockClear()
    mockSelect.mockClear()
  })

  it('serializes related_steps as JSON before writing to DB', async () => {
    await createGlossaryEntry({
      projectId: 'proj-1',
      term: 'SIPOC',
      definition: 'Process framework',
      relatedSteps: ['step-1', 'step-2'],
      tags: [],
    })

    expect(mockExecute).toHaveBeenCalledTimes(3) // 1: INSERT INTO glossary, 2: INSERT INTO search_index, 3: touch the project (#395)
    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(serializeArray(['step-1', 'step-2']))
  })

  it('serializes tags as JSON before writing to DB', async () => {
    await createGlossaryEntry({
      projectId: 'proj-1',
      term: 'SIPOC',
      definition: 'Process framework',
      relatedSteps: [],
      tags: ['methodology', 'process'],
    })

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(serializeArray(['methodology', 'process']))
  })

  it('maps undefined acronym to null at position $5', async () => {
    await createGlossaryEntry({
      projectId: 'proj-1',
      term: 'SIPOC',
      definition: 'Process framework',
      relatedSteps: [],
      tags: [],
    })

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params[4]).toBeNull() // acronym is $5 in the INSERT
  })
})

describe('updateGlossaryEntry — write path (ZIP-342)', () => {
  beforeEach(async () => {
    mockSelect.mockReset().mockResolvedValue([])
    mockExecute.mockReset().mockResolvedValue({ rowsAffected: 0 })
    await initDB()
    mockExecute.mockClear()
    mockSelect.mockClear()
  })

  it('serializes relatedSteps as JSON in the UPDATE params', async () => {
    await updateGlossaryEntry('entry-1', { relatedSteps: ['step-a', 'step-b'] }, 'proj-1')

    const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/UPDATE glossary SET/)
    expect(sql).toMatch(/related_steps =/)
    expect(params).toContain(serializeArray(['step-a', 'step-b']))
  })

  it('serializes tags as JSON in the UPDATE params', async () => {
    await updateGlossaryEntry('entry-1', { tags: ['jargon', 'acronym-term'] }, 'proj-1')

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(serializeArray(['jargon', 'acronym-term']))
  })

  it('does NOT include updated_at in the SET clause (no such column in glossary)', async () => {
    await updateGlossaryEntry('entry-1', { term: 'New Term' }, 'proj-1')

    const [sql] = mockExecute.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toMatch(/updated_at/)
  })

  it('is a no-op when called with an empty changes object', async () => {
    await updateGlossaryEntry('entry-1', {}, 'proj-1')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
