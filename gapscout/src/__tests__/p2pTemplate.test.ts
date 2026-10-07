/**
 * The shipped P2P template has to be loadable, and this file is the proof.
 *
 * It runs the real loader's `materializeTemplate` (#146) over the real file, then
 * holds the result to the same standards a hand-built project is held to — the
 * entity schemas, the SIPOC validator, and the graph builder. So this covers the
 * *content* of p2p.json; `templateService.test.ts` covers the service around it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'

import { findTemplateReferenceErrors, type ProcessTemplate } from '../data/templateSchema'
import {
  GapSchema,
  GlossaryEntrySchema,
  MilestoneSchema,
  PolicySchema,
  SIPOCSchema,
  StepSchema,
  SystemSchema,
  TeamSchema,
} from '../data/schemas'
import { materializeTemplate, parseTemplate } from '../services/templateService'
import { stepsToNodesEdges } from '../lib/graphBuilder'
import { compareRank, milestonesById, rankKey, rankOf } from '../lib/stepSequence'
import { validateSteps } from '../lib/sipocValidator'

/**
 * Read off disk rather than `import`ed: `public/` is outside tsconfig's `include`
 * and JSON imports are not enabled, and reading the served path is what proves
 * the file the loader will fetch is the file being checked.
 *
 * Vitest's root is the package directory, the same directory CI runs the suite
 * from, so cwd is the anchor.
 */
const TEMPLATE_PATH = resolve(process.cwd(), 'public/templates/p2p.json')

function readTemplate(): ProcessTemplate {
  return parseTemplate(JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8')))
}

describe('P2P template', () => {
  const template = readTemplate()
  const seeded = materializeTemplate(template, nanoid())

  describe('the file itself', () => {
    it('parses against ProcessTemplateSchema', () => {
      // readTemplate() already threw if it did not; this pins the identity so a
      // renamed file cannot quietly satisfy the rest of the suite.
      expect(template.id).toBe('p2p')
      expect(template.name).toBe('Procure-to-Pay')
    })

    it('has no dangling references, duplicate keys, or broken step ordering', () => {
      expect(findTemplateReferenceErrors(template)).toEqual([])
    })

    it('carries every entity type the app stores', () => {
      // PRD Appendix D: 6 teams, 4 milestones, 20 steps, 3 policies, 5 gaps.
      expect(template.teams).toHaveLength(6)
      expect(template.milestones).toHaveLength(4)
      expect(template.steps).toHaveLength(20)
      expect(template.policies).toHaveLength(3)
      expect(template.gaps).toHaveLength(5)
      // Not in Appendix D, but a step's `systems` holds system names, and an
      // empty glossary or SIPOC makes those views open blank on a demo project.
      expect(template.systems.length).toBeGreaterThan(0)
      expect(template.glossary.length).toBeGreaterThan(0)
      expect(template.sipoc).toBeDefined()
    })

    it('uses every team it declares', () => {
      const used = new Set(template.steps.map((step) => step.teamKey))
      expect([...template.teams].filter((team) => !used.has(team.key))).toEqual([])
    })
  })

  describe('once materialized', () => {
    it('produces entities the app schemas accept', () => {
      for (const team of seeded.teams) expect(() => TeamSchema.parse(team)).not.toThrow()
      for (const system of seeded.systems) expect(() => SystemSchema.parse(system)).not.toThrow()
      for (const m of seeded.milestones) expect(() => MilestoneSchema.parse(m)).not.toThrow()
      for (const step of seeded.steps) expect(() => StepSchema.parse(step)).not.toThrow()
      for (const policy of seeded.policies) expect(() => PolicySchema.parse(policy)).not.toThrow()
      for (const gap of seeded.gaps) expect(() => GapSchema.parse(gap)).not.toThrow()
      for (const e of seeded.glossary) expect(() => GlossaryEntrySchema.parse(e)).not.toThrow()
      expect(() => SIPOCSchema.parse(seeded.sipoc)).not.toThrow()
    })

    it('opens with a clean Discovery grid — no SIPOC validation issues', () => {
      const results = validateSteps(seeded.steps, milestonesById(seeded.milestones))
      const labelById = new Map(seeded.steps.map((step) => [step.id, step.label]))

      const failures = [...results.entries()]
        .filter(([, result]) => !result.isValid)
        .map(([id, result]) => `${labelById.get(id)}: ${result.issues.join('; ')}`)

      expect(failures).toEqual([])
    })

    it('runs no two steps in parallel by accident', () => {
      // A shared (milestone, order) is how a parallel branch is authored, and
      // nothing in this template is parallel — so a tie here is the wizard bug
      // (#169, #216) shipped as data.
      const byId = milestonesById(seeded.milestones)
      const ranks = seeded.steps.map((step) => rankKey(rankOf(step, byId)))
      expect(new Set(ranks).size).toBe(seeded.steps.length)
    })
  })

  describe('as a diagram', () => {
    const graph = stepsToNodesEdges(
      seeded.steps,
      seeded.milestones,
      seeded.teams,
      seeded.systems,
      [],
    )
    const stepIds = new Set(seeded.steps.map((step) => step.id))

    it('draws a node for every step', () => {
      const stepNodes = graph.nodes.filter((node) => stepIds.has(node.id))
      expect(stepNodes).toHaveLength(20)
    })

    it('leaves no step stranded', () => {
      const connected = new Set(graph.edges.flatMap((edge) => [edge.source, edge.target]))
      const orphans = seeded.steps.filter((step) => !connected.has(step.id))
      expect(orphans.map((step) => step.label)).toEqual([])
    })

    it('carries the flow from each step to the next within a milestone', () => {
      const byId = new Map(seeded.steps.map((step) => [step.id, step]))
      const pairs = new Set(graph.edges.map((edge) => `${edge.source}->${edge.target}`))

      const missing = seeded.steps
        .map((step) => {
          const next = seeded.steps.find(
            (candidate) =>
              candidate.milestoneId === step.milestoneId && candidate.order === step.order + 1,
          )
          return next && !pairs.has(`${step.id}->${next.id}`)
            ? `${byId.get(step.id)!.label} → ${next.label}`
            : null
        })
        .filter((gap): gap is string => gap !== null)

      expect(missing).toEqual([])
    })

    it('ends where the process ends, and nowhere else', () => {
      // A customer no later step names as a supplier becomes a "Process End"
      // node. Only the final hand-off should produce one, so a mid-process party
      // that nothing downstream picks up shows up here as an extra terminus.
      const endNodes = graph.nodes.filter((node) => !stepIds.has(node.id))
      expect(endNodes.map((node) => node.id).sort()).toEqual([
        'end-Business Unit',
        'end-Vendor',
      ])
    })

    it('keeps hand-offs local instead of arcing across the process', () => {
      // This template drew a span-16 arc when its parties were bare team names,
      // because `createSipocEdges` matched a customer against every later step
      // naming it. It now takes only the nearest (#363), so a regression here
      // most likely means that rule went, not that the template changed.
      // Ranked, not indexed: the JSON array's order is not authoritative, so
      // measuring spans by array position would go quietly wrong the moment a
      // step is added anywhere but the end.
      const byId = milestonesById(seeded.milestones)
      const positionById = new Map(
        [...seeded.steps]
          .sort((a, b) => compareRank(rankOf(a, byId), rankOf(b, byId)))
          .map((step, index) => [step.id, index]),
      )

      const spans = graph.edges
        .filter((edge) => stepIds.has(edge.source) && stepIds.has(edge.target))
        .map((edge) => positionById.get(edge.target)! - positionById.get(edge.source)!)

      expect(Math.max(...spans)).toBeLessThanOrEqual(4)
      // Exactly one edge runs backwards: the rejection loop.
      expect(spans.filter((span) => span < 0)).toHaveLength(1)
    })

    it('draws both branches off the one decision point', () => {
      const decisions = seeded.steps.filter((step) => step.decision)
      expect(decisions).toHaveLength(1)

      const decision = decisions[0]
      const approved = seeded.stepIdByKey.get('release-approved-requisition')
      const rejected = seeded.stepIdByKey.get('create-purchase-requisition')

      const branchEdges = graph.edges.filter(
        (edge) =>
          edge.source === decision.id &&
          (edge.target === approved || edge.target === rejected) &&
          edge.style?.strokeDasharray !== undefined,
      )

      expect(branchEdges).toHaveLength(2)
      // The rejection is a rework loop: it points back up the chain, which is
      // exactly why branch edges are exempt from the forward-only rule.
      expect(branchEdges.map((edge) => edge.target)).toContain(rejected)
    })
  })
})
