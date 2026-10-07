/**
 * The template loading service (#146).
 *
 * `p2pTemplate.test.ts` covers the *content* of the shipped file; this covers
 * the service around it — the catalogue, the parse gate, and what `applyTemplate`
 * actually writes.
 *
 * The round-trip runs against the in-memory adapter and reads every entity back
 * through `db.ts`'s own list functions, so a template that materializes cleanly
 * but writes a broken row is caught here rather than in the app.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/db/sqlJsAdapter', async () => {
  const { InMemoryAdapter } = await import('./helpers/inMemoryAdapter')
  return { SqlJsAdapter: InMemoryAdapter }
})

/**
 * `applyTemplate`'s catch is the code that runs once something has already gone
 * wrong, which makes it the part least likely to be exercised by hand. These
 * flags let one write fail on demand; with both false every wrapper calls
 * straight through, so the rest of this file drives the real `db.ts`.
 */
const seedFailure = vi.hoisted(() => ({ createStep: false, deleteProject: false }))

vi.mock('../services/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/db')>()
  return {
    ...actual,
    createProject: vi.fn((...args: Parameters<typeof actual.createProject>) =>
      actual.createProject(...args),
    ),
    createStep: vi.fn((...args: Parameters<typeof actual.createStep>) =>
      seedFailure.createStep
        ? Promise.reject(new Error('createStep exploded'))
        : actual.createStep(...args),
    ),
    createGap: vi.fn((...args: Parameters<typeof actual.createGap>) => actual.createGap(...args)),
    deleteProject: vi.fn((...args: Parameters<typeof actual.deleteProject>) =>
      seedFailure.deleteProject
        ? Promise.reject(new Error('deleteProject exploded'))
        : actual.deleteProject(...args),
    ),
  }
})

import { InMemoryAdapter } from './helpers/inMemoryAdapter'
import { setDB } from '../services/db/connection'
import { logger } from '../lib/logger'
import {
  createGap,
  createProject,
  deleteProject,
  getProject,
  getSipoc,
  initDB,
  listGaps,
  listGlossaryEntries,
  listMilestones,
  listPolicies,
  listSteps,
  listSystems,
  listTeams,
} from '../services/db'
import {
  TEMPLATE_CATALOG,
  applyTemplate,
  loadTemplate,
  materializeTemplate,
  parseTemplate,
} from '../services/templateService'
import type { ProcessTemplate } from '../data/templateSchema'

function readTemplateFile(id: string): unknown {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `public/templates/${id}.json`), 'utf-8'),
  )
}

describe('TEMPLATE_CATALOG', () => {
  it('offers at least one template', () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThan(0)
  })

  it('matches the files on disk, entry for entry', () => {
    // The catalogue exists because the bundled frontend cannot list a directory.
    // That makes drift possible, and this is what makes it loud: #147 and #148
    // each add a file and an entry, and a mismatch fails here rather than
    // offering a template that 404s.
    for (const entry of TEMPLATE_CATALOG) {
      const template = parseTemplate(readTemplateFile(entry.id))
      expect(template.id).toBe(entry.id)
      expect(template.name).toBe(entry.name)
    }
  })
})

describe('loadTemplate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses an id the catalogue does not list, without reaching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    // The catalogue lookup is what keeps the fetched path to one this build
    // ships, rather than whatever string a caller hands in.
    await expect(loadTemplate('../secrets')).rejects.toThrow('Unknown template "../secrets"')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports the status when the file is not served', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })),
    )

    // A catalogue entry whose JSON was never added, which is the shape #147 and
    // #148 will fail in if only half of each lands.
    await expect(loadTemplate('p2p')).rejects.toThrow(
      'Could not load template "p2p": 404 Not Found',
    )
  })

  it('parses what it fetched, so a served-but-broken file still fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ id: 'p2p', name: 'Nope' }) })),
    )

    await expect(loadTemplate('p2p')).rejects.toThrow()
  })
})

describe('parseTemplate', () => {
  it('rejects JSON that does not match the schema', () => {
    expect(() => parseTemplate({ id: 'nope' })).toThrow()
  })

  it('rejects a schema-valid template whose references dangle', () => {
    const template = readTemplateFile('p2p') as { steps: Array<{ teamKey: string }> }
    template.steps[0].teamKey = 'no-such-team'

    // The Zod pass accepts it — `teamKey` is a well-formed key — so this is
    // findTemplateReferenceErrors doing the work, which is the point of running
    // both before anything is written.
    expect(() => parseTemplate(template)).toThrow(/names unknown team "no-such-team"/)
  })
})

describe('materializeTemplate', () => {
  const template = parseTemplate(readTemplateFile('p2p')) as ProcessTemplate

  it('resolves a backward branch to a step minted earlier in the file', () => {
    const seeded = materializeTemplate(template, 'proj-1')
    const decision = seeded.steps.find((step) => step.decision)!
    const targets = decision.branches!.map((branch) => branch.toStepId)

    // Every branch target is a real step id, including the rejection loop's,
    // which points back up the chain. This is why ids are minted up front
    // rather than discovered as the writes go.
    for (const target of targets) {
      expect(seeded.steps.some((step) => step.id === target)).toBe(true)
    }
    expect(targets).toContain(seeded.stepIdByKey.get('create-purchase-requisition'))
  })

  it('gives every entity the project id it was materialized for', () => {
    const seeded = materializeTemplate(template, 'proj-1')
    const entities = [
      ...seeded.teams,
      ...seeded.systems,
      ...seeded.milestones,
      ...seeded.steps,
      ...seeded.policies,
      ...seeded.gaps,
      ...seeded.glossary,
    ]
    expect(entities.every((entity) => entity.projectId === 'proj-1')).toBe(true)
    expect(seeded.sipoc?.projectId).toBe('proj-1')
  })

  it('mints fresh ids on every call', () => {
    const first = materializeTemplate(template, 'proj-1')
    const second = materializeTemplate(template, 'proj-2')
    expect(first.steps[0].id).not.toBe(second.steps[0].id)
  })
})

describe('applyTemplate', () => {
  const template = parseTemplate(readTemplateFile('p2p')) as ProcessTemplate

  beforeEach(async () => {
    setDB(new InMemoryAdapter())
    await initDB()
  })

  it('writes every entity the template carries', async () => {
    const projectId = await applyTemplate(template, {
      name: 'P2P audit',
      description: 'Seeded from the shipped template',
      state: 'current',
    })

    const project = await getProject(projectId)
    expect(project?.name).toBe('P2P audit')
    expect(project?.state).toBe('current')

    expect(await listTeams(projectId)).toHaveLength(template.teams.length)
    expect(await listSystems(projectId)).toHaveLength(template.systems.length)
    expect(await listMilestones(projectId)).toHaveLength(template.milestones.length)
    expect(await listSteps(projectId)).toHaveLength(template.steps.length)
    expect(await listPolicies(projectId)).toHaveLength(template.policies.length)
    expect(await listGaps(projectId)).toHaveLength(template.gaps.length)
    expect(await listGlossaryEntries(projectId)).toHaveLength(template.glossary.length)
    expect(await getSipoc(projectId)).not.toBeNull()
  })

  it('reads back steps whose team, milestone and branches resolve to stored rows', async () => {
    const projectId = await applyTemplate(template, { name: 'P2P audit' })

    const teamIds = new Set((await listTeams(projectId)).map((team) => team.id))
    const milestoneIds = new Set((await listMilestones(projectId)).map((m) => m.id))
    const steps = await listSteps(projectId)
    const stepIds = new Set(steps.map((step) => step.id))

    for (const step of steps) {
      expect(teamIds.has(step.teamId)).toBe(true)
      expect(milestoneIds.has(step.milestoneId)).toBe(true)
      for (const branch of step.branches ?? []) {
        expect(stepIds.has(branch.toStepId)).toBe(true)
      }
    }

    // The JSON columns are the ones a write/read mismatch would silently empty.
    const withBranches = steps.filter((step) => (step.branches?.length ?? 0) > 0)
    expect(withBranches).toHaveLength(1)
    expect(steps.some((step) => step.suppliers.length > 0)).toBe(true)
  })

  it('links policies and milestones back to each other', async () => {
    const projectId = await applyTemplate(template, { name: 'P2P audit' })

    const policies = await listPolicies(projectId)
    const milestones = await listMilestones(projectId)
    const policyById = new Map(policies.map((policy) => [policy.id, policy]))

    // Stored on both entities independently, so a one-sided write reads fine
    // from one screen and wrong from the other.
    for (const milestone of milestones) {
      for (const policyId of milestone.relatedPolicies) {
        expect(policyById.get(policyId)?.relatedMilestones).toContain(milestone.id)
      }
    }
    expect(milestones.some((m) => m.relatedPolicies.length > 0)).toBe(true)
  })

  it('hangs gaps and glossary entries off stored steps and teams', async () => {
    const projectId = await applyTemplate(template, { name: 'P2P audit' })

    const stepIds = new Set((await listSteps(projectId)).map((step) => step.id))
    const teamIds = new Set((await listTeams(projectId)).map((team) => team.id))

    for (const gap of await listGaps(projectId)) {
      if (gap.stepId !== undefined) expect(stepIds.has(gap.stepId)).toBe(true)
      if (gap.ownerTeamId !== undefined) expect(teamIds.has(gap.ownerTeamId)).toBe(true)
    }
    for (const entry of await listGlossaryEntries(projectId)) {
      for (const stepId of entry.relatedSteps) expect(stepIds.has(stepId)).toBe(true)
    }
  })

  it('keeps two projects seeded from the same template apart', async () => {
    const first = await applyTemplate(template, { name: 'Current P2P' })
    const second = await applyTemplate(template, { name: 'Future P2P', state: 'future' })

    expect(first).not.toBe(second)
    expect(await listSteps(first)).toHaveLength(template.steps.length)
    expect(await listSteps(second)).toHaveLength(template.steps.length)

    const firstTeams = (await listTeams(first)).map((team) => team.id)
    const secondTeams = (await listTeams(second)).map((team) => team.id)
    expect(firstTeams.filter((id) => secondTeams.includes(id))).toEqual([])
  })

  it('leaves the seeded project reading as created, not edited (#395)', async () => {
    // Every create in the seed moves the project's `updated_at`, so without the
    // reset `applyTemplate` ends with a project the card calls "Edited" before
    // anyone has opened it.
    //
    // The clock is driven one tick per read rather than left to the machine:
    // the whole seed can land inside a single millisecond here, and then equal
    // timestamps would prove nothing about whether the reset ran.
    let tick = 1_700_000_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (tick += 1))

    try {
      const projectId = await applyTemplate(template, { name: 'P2P audit' })
      const project = await getProject(projectId)

      expect(project).not.toBeNull()
      expect(project?.updatedAt).toBe(project?.createdAt)
      // The clock did move while the seed ran, so the equality above is the
      // reset's doing and not a stopped clock's.
      expect(tick).toBeGreaterThan(project?.createdAt ?? 0)
    } finally {
      clock.mockRestore()
    }
  })

  it('rejects a blank project name before writing anything', async () => {
    await expect(applyTemplate(template, { name: '   ' })).rejects.toThrow(
      /Project name is required/,
    )
    expect(vi.mocked(createProject)).not.toHaveBeenCalled()
  })
})

describe('applyTemplate — when a write fails part way', () => {
  const template = parseTemplate(readTemplateFile('p2p')) as ProcessTemplate

  beforeEach(async () => {
    seedFailure.createStep = false
    seedFailure.deleteProject = false
    vi.clearAllMocks()
    setDB(new InMemoryAdapter())
    await initDB()
  })

  it('deletes the project it created and rethrows the write that failed', async () => {
    seedFailure.createStep = true

    await expect(applyTemplate(template, { name: 'P2P audit' })).rejects.toThrow(
      'createStep exploded',
    )

    const createdId = await vi.mocked(createProject).mock.results[0].value
    expect(vi.mocked(deleteProject)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deleteProject)).toHaveBeenCalledWith(createdId)
    expect(await getProject(createdId)).toBeNull()

    // Steps precede gaps, so a failure in the step loop must not have reached them.
    expect(vi.mocked(createGap)).not.toHaveBeenCalled()
  })

  it('reports the seed error, not the cleanup error, when the cleanup also fails', async () => {
    seedFailure.createStep = true
    seedFailure.deleteProject = true
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => {})

    // The caller has to hear about the write that broke. Surfacing the delete
    // instead would name the recovery rather than the fault.
    await expect(applyTemplate(template, { name: 'P2P audit' })).rejects.toThrow(
      'createStep exploded',
    )

    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged.mock.calls[0][0]).toBe('Failed to remove a partially seeded project')
    expect((logged.mock.calls[0][1] as Error).message).toBe('deleteProject exploded')
    expect(vi.mocked(createGap)).not.toHaveBeenCalled()

    // What a failed cleanup leaves behind: a half-seeded project the UI has no
    // way to remove until #314 lands.
    const createdId = await vi.mocked(createProject).mock.results[0].value
    expect(await getProject(createdId)).not.toBeNull()

    logged.mockRestore()
  })
})
