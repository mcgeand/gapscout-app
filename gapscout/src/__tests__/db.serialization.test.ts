/**
 * Tests for database serialization/deserialization functions
 *
 * These are critical paths that handle JSON data stored in SQLite.
 * Corrupted JSON should be handled gracefully without crashing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  serializeArray,
  deserializeArray,
  serializeObject,
  deserializeObject,
  setStrictDeserializationMode,
  stepRowToStep,
  policyRowToPolicy,
  glossaryRowToEntry,
} from '../services/db'
import type { StepRow, PolicyRow, GlossaryEntryRow } from '../data/types'

describe('serializeArray', () => {
  it('should serialize an empty array', () => {
    expect(serializeArray([])).toBe('[]')
  })

  it('should serialize a string array', () => {
    expect(serializeArray(['a', 'b', 'c'])).toBe('["a","b","c"]')
  })

  it('should serialize a number array', () => {
    expect(serializeArray([1, 2, 3])).toBe('[1,2,3]')
  })

  it('should serialize an array of objects', () => {
    const arr = [{ id: '1', name: 'Test' }]
    expect(serializeArray(arr)).toBe('[{"id":"1","name":"Test"}]')
  })
})

describe('deserializeArray', () => {
  it('should return empty array for null input', () => {
    expect(deserializeArray(null)).toEqual([])
  })

  it('should return empty array for empty string', () => {
    expect(deserializeArray('')).toEqual([])
  })

  it('should deserialize a valid JSON array', () => {
    expect(deserializeArray('["a","b","c"]')).toEqual(['a', 'b', 'c'])
  })

  it('should deserialize an array of objects', () => {
    const json = '[{"id":"1","name":"Test"}]'
    expect(deserializeArray(json)).toEqual([{ id: '1', name: 'Test' }])
  })

  describe('error handling', () => {
    beforeEach(() => {
      // Ensure strict mode is off for these tests
      setStrictDeserializationMode(false)
    })

    it('should return empty array for invalid JSON', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(deserializeArray('not valid json')).toEqual([])
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return empty array when JSON is not an array', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(deserializeArray('{"key": "value"}')).toEqual([])
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return empty array for primitive JSON values', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(deserializeArray('"just a string"')).toEqual([])
      expect(deserializeArray('123')).toEqual([])
      expect(deserializeArray('true')).toEqual([])
      consoleSpy.mockRestore()
    })

    it('should include context in warning messages', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      deserializeArray('invalid', 'step.suppliers')
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('step.suppliers'),
        expect.anything()
      )
      consoleSpy.mockRestore()
    })
  })

  describe('strict mode', () => {
    beforeEach(() => {
      setStrictDeserializationMode(true)
    })

    afterEach(() => {
      setStrictDeserializationMode(false)
    })

    it('should throw on invalid JSON in strict mode', () => {
      expect(() => deserializeArray('invalid json')).toThrow()
    })

    it('should throw when JSON is not an array in strict mode', () => {
      expect(() => deserializeArray('{"key": "value"}')).toThrow()
    })
  })
})

describe('serializeObject', () => {
  it('should serialize an empty object', () => {
    expect(serializeObject({})).toBe('{}')
  })

  it('should serialize an object with properties', () => {
    expect(serializeObject({ x: 10, y: 20 })).toBe('{"x":10,"y":20}')
  })

  it('should serialize nested objects', () => {
    const obj = { position: { x: 10, y: 20 }, name: 'Test' }
    expect(serializeObject(obj)).toBe('{"position":{"x":10,"y":20},"name":"Test"}')
  })
})

describe('deserializeObject', () => {
  it('should return null for null input', () => {
    expect(deserializeObject(null)).toBeNull()
  })

  it('should return null for empty string', () => {
    expect(deserializeObject('')).toBeNull()
  })

  it('should deserialize a valid JSON object', () => {
    expect(deserializeObject('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 })
  })

  describe('error handling', () => {
    beforeEach(() => {
      setStrictDeserializationMode(false)
    })

    it('should return null for invalid JSON', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(deserializeObject('not valid json')).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return null when JSON is an array', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(deserializeObject('[1,2,3]')).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return null for primitive JSON values', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(deserializeObject('"just a string"')).toBeNull()
      expect(deserializeObject('123')).toBeNull()
      expect(deserializeObject('null')).toBeNull()
      consoleSpy.mockRestore()
    })

    it('should include context in warning messages', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      deserializeObject('invalid', 'step.diagramPosition')
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('step.diagramPosition'),
        expect.anything()
      )
      consoleSpy.mockRestore()
    })
  })

  describe('strict mode', () => {
    beforeEach(() => {
      setStrictDeserializationMode(true)
    })

    afterEach(() => {
      setStrictDeserializationMode(false)
    })

    it('should throw on invalid JSON in strict mode', () => {
      expect(() => deserializeObject('invalid json')).toThrow()
    })

    it('should throw when JSON is an array in strict mode', () => {
      expect(() => deserializeObject('[1,2,3]')).toThrow()
    })
  })
})

describe('round-trip serialization', () => {
  it('should round-trip an array', () => {
    const original = ['supplier1', 'supplier2', 'supplier3']
    const serialized = serializeArray(original)
    const deserialized = deserializeArray<string>(serialized)
    expect(deserialized).toEqual(original)
  })

  it('should round-trip an object', () => {
    const original = { x: 100, y: 200 }
    const serialized = serializeObject(original)
    const deserialized = deserializeObject<{ x: number; y: number }>(serialized)
    expect(deserialized).toEqual(original)
  })

  it('should round-trip complex nested data', () => {
    const original = [
      { id: '1', text: 'Comment 1', createdAt: 1234567890 },
      { id: '2', text: 'Comment 2', createdAt: 1234567891 },
    ]
    const serialized = serializeArray(original)
    const deserialized = deserializeArray(serialized)
    expect(deserialized).toEqual(original)
  })
})

describe('stepRowToStep — the legacy validation_status column (#176)', () => {
  const baseRow: StepRow = {
    id: 'step-1',
    project_id: 'proj-1',
    label: 'Test step',
    team_id: 'team-1',
    milestone_id: 'ms-1',
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
    comments: '[]',
    links: '[]',
    gap_ids: '[]',
    diagram_position: null,
    validation_status: null,
    created_at: 1_000_000,
    updated_at: 1_000_000,
  }

  it('ignores a populated validation_status column', () => {
    // Legacy rows still carry a snapshot. Validation is derived from the
    // current step list now (#176), so nothing may reach the Step object and
    // resurrect a stale verdict.
    const stale = { isValid: false, missingFields: ['supplier'], issues: ['Supplier required'] }
    const step = stepRowToStep({ ...baseRow, validation_status: JSON.stringify(stale) })
    expect(step).not.toHaveProperty('validationStatus')
  })

  it('accepts a NULL validation_status column', () => {
    expect(stepRowToStep({ ...baseRow, validation_status: null })).not.toHaveProperty(
      'validationStatus'
    )
  })
})

describe('policyRowToPolicy — JSON column round-trips (ZIP-341)', () => {
  const baseRow: PolicyRow = {
    id: 'policy-1',
    project_id: 'proj-1',
    title: 'Data Retention Policy',
    content: 'All records must be retained for 7 years.',
    source_doc: null,
    related_milestones: '[]',
    test_notes: null,
    tags: '[]',
    created_at: 1000000,
    updated_at: 1000000,
  }

  it('deserializes related_milestones JSON array correctly', () => {
    const row: PolicyRow = { ...baseRow, related_milestones: '["ms-1","ms-2"]' }
    const policy = policyRowToPolicy(row)
    expect(policy.relatedMilestones).toEqual(['ms-1', 'ms-2'])
  })

  it('deserializes tags JSON array correctly', () => {
    const row: PolicyRow = { ...baseRow, tags: '["compliance","finance"]' }
    const policy = policyRowToPolicy(row)
    expect(policy.tags).toEqual(['compliance', 'finance'])
  })

  it('maps empty JSON arrays to empty arrays', () => {
    const policy = policyRowToPolicy(baseRow)
    expect(policy.relatedMilestones).toEqual([])
    expect(policy.tags).toEqual([])
  })

  it('maps null source_doc to undefined', () => {
    const policy = policyRowToPolicy({ ...baseRow, source_doc: null })
    expect(policy.sourceDoc).toBeUndefined()
  })

  it('maps empty-string source_doc to undefined (clearing behavior)', () => {
    const policy = policyRowToPolicy({ ...baseRow, source_doc: '' })
    expect(policy.sourceDoc).toBeUndefined()
  })

  it('maps null test_notes to undefined', () => {
    const policy = policyRowToPolicy({ ...baseRow, test_notes: null })
    expect(policy.testNotes).toBeUndefined()
  })

  it('returns empty array for malformed related_milestones JSON', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const policy = policyRowToPolicy({ ...baseRow, related_milestones: 'not-valid-json' })
    expect(policy.relatedMilestones).toEqual([])
    consoleSpy.mockRestore()
  })

  it('returns empty array for malformed tags JSON', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const policy = policyRowToPolicy({ ...baseRow, tags: 'not-valid-json' })
    expect(policy.tags).toEqual([])
    consoleSpy.mockRestore()
  })

  it('round-trips related_milestones through serializeArray/deserializeArray', () => {
    const original = ['ms-1', 'ms-2', 'ms-3']
    const row: PolicyRow = { ...baseRow, related_milestones: serializeArray(original) }
    const policy = policyRowToPolicy(row)
    expect(policy.relatedMilestones).toEqual(original)
  })

  it('maps all scalar fields correctly', () => {
    const policy = policyRowToPolicy({
      ...baseRow,
      source_doc: 'https://docs.example.com/policy',
      test_notes: 'Verify quarterly',
    })
    expect(policy.id).toBe('policy-1')
    expect(policy.projectId).toBe('proj-1')
    expect(policy.title).toBe('Data Retention Policy')
    expect(policy.sourceDoc).toBe('https://docs.example.com/policy')
    expect(policy.testNotes).toBe('Verify quarterly')
    expect(policy.createdAt).toBe(1000000)
    expect(policy.updatedAt).toBe(1000000)
  })
})

describe('glossaryRowToEntry — JSON column round-trips (ZIP-342)', () => {
  const baseRow: GlossaryEntryRow = {
    id: 'entry-1',
    project_id: 'proj-1',
    term: 'SIPOC',
    definition: 'Suppliers, Inputs, Process, Outputs, Customers',
    acronym: null,
    related_steps: '[]',
    tags: '[]',
    created_at: 2000000,
  }

  it('deserializes related_steps JSON array correctly', () => {
    const row: GlossaryEntryRow = { ...baseRow, related_steps: '["step-1","step-2"]' }
    const entry = glossaryRowToEntry(row)
    expect(entry.relatedSteps).toEqual(['step-1', 'step-2'])
  })

  it('deserializes tags JSON array correctly', () => {
    const row: GlossaryEntryRow = { ...baseRow, tags: '["process","methodology"]' }
    const entry = glossaryRowToEntry(row)
    expect(entry.tags).toEqual(['process', 'methodology'])
  })

  it('maps empty JSON arrays to empty arrays', () => {
    const entry = glossaryRowToEntry(baseRow)
    expect(entry.relatedSteps).toEqual([])
    expect(entry.tags).toEqual([])
  })

  it('maps null acronym to undefined', () => {
    const entry = glossaryRowToEntry({ ...baseRow, acronym: null })
    expect(entry.acronym).toBeUndefined()
  })

  it('maps a present acronym through correctly', () => {
    const entry = glossaryRowToEntry({ ...baseRow, acronym: 'SIPOC' })
    expect(entry.acronym).toBe('SIPOC')
  })

  it('returns empty array for malformed related_steps JSON', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entry = glossaryRowToEntry({ ...baseRow, related_steps: 'not-valid-json' })
    expect(entry.relatedSteps).toEqual([])
    consoleSpy.mockRestore()
  })

  it('returns empty array for malformed tags JSON', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entry = glossaryRowToEntry({ ...baseRow, tags: 'not-valid-json' })
    expect(entry.tags).toEqual([])
    consoleSpy.mockRestore()
  })

  it('round-trips related_steps through serializeArray/deserializeArray', () => {
    const original = ['step-a', 'step-b', 'step-c']
    const row: GlossaryEntryRow = { ...baseRow, related_steps: serializeArray(original) }
    const entry = glossaryRowToEntry(row)
    expect(entry.relatedSteps).toEqual(original)
  })

  it('maps all scalar fields correctly', () => {
    const entry = glossaryRowToEntry({ ...baseRow, acronym: 'SIPOC' })
    expect(entry.id).toBe('entry-1')
    expect(entry.projectId).toBe('proj-1')
    expect(entry.term).toBe('SIPOC')
    expect(entry.definition).toBe('Suppliers, Inputs, Process, Outputs, Customers')
    expect(entry.createdAt).toBe(2000000)
  })
})
