/**
 * SIPOC Validator - Validates process steps for completeness
 *
 * Validates all 5 SIPOC components:
 * - Supplier: Who provides the inputs (except where the process starts)
 * - Input: What is received (except where the process starts)
 * - Process: The action/label (always required)
 * - Output: What is produced (except where the process ends)
 * - Customer: Who receives outputs (except where the process ends)
 *
 * Reference: ZIP-144 - SIPOC Validation & Auto-Gap Detection
 */

import type { Milestone, Step, ValidationResult } from '../data/types'
import { compareRank, rankOf, rankKey } from './stepSequence'

export type { ValidationResult } from '../data/types'

/**
 * Check if an array field is empty or contains only empty strings
 *
 * Exported so the gap auto-status rule (`lib/gapAutoStatus.ts`) decides "filled"
 * by the same blank-string rule this validator uses to decide "missing".
 */
export function isArrayEmpty(arr: string[] | undefined | null): boolean {
  if (!arr || arr.length === 0) return true
  return arr.every(item => !item || item.trim() === '')
}

/**
 * Where the process starts and where it ends, as ranks.
 *
 * The exemption is for the two ends of a PROCESS: its opening step has nobody
 * to receive from, its closing step nobody to hand to. A milestone boundary is
 * neither. `order` is scoped to its milestone (#299), so `order === 1` became
 * true once per milestone and the highest order likewise — the exemption fired
 * N times instead of once, and a milestone holding a single step was both first
 * and last, so every SIPOC field on it was exempt and it drew a green tick no
 * matter how empty it was (#344).
 *
 * Ranking on `(milestone.order, step.order)` — the pair the Discovery grid,
 * the diagram and both exports already rank by — makes it fire once.
 *
 * Parallel steps share a rank, so two branches that both open the process are
 * both exempt, as are two that both close it. That is deliberate: a parallel
 * pair is one position, and neither branch has a predecessor to receive from.
 */
function processEnds(
  allSteps: Step[],
  milestoneById: Map<string, Milestone>
): { first: string | null; last: string | null } {
  if (allSteps.length === 0) return { first: null, last: null }

  const ranks = allSteps.map(s => rankOf(s, milestoneById))
  let first = ranks[0]
  let last = ranks[0]
  for (const rank of ranks) {
    if (compareRank(rank, first) < 0) first = rank
    if (compareRank(rank, last) > 0) last = rank
  }

  return { first: rankKey(first), last: rankKey(last) }
}

/**
 * Validate a single step's SIPOC components
 *
 * @param step - The step to validate
 * @param allSteps - Every step in the project. Must be the unfiltered list: a
 *   filtered one moves the process's ends onto rows a filter happens to have
 *   left visible, and chain validation reads neighbours.
 * @param milestoneById - The project's milestones by id, for ranking. An empty
 *   map ranks every step by `order` alone, which is project-wide rather than
 *   per-milestone, so a caller that has not loaded milestones yet degrades to
 *   the pre-#299 reading rather than to the #344 bug.
 * @returns ValidationResult with missing fields and issues
 */
export function validateStep(
  step: Step,
  allSteps: Step[],
  milestoneById: Map<string, Milestone>
): ValidationResult {
  const missingFields: string[] = []
  const issues: string[] = []

  const ends = processEnds(allSteps, milestoneById)
  const rank = rankKey(rankOf(step, milestoneById))
  const isFirst = rank === ends.first
  const isLast = rank === ends.last
  
  // 1. Validate Supplier (required except for first step)
  if (!isFirst && isArrayEmpty(step.suppliers)) {
    missingFields.push('supplier')
    issues.push('Supplier is required (who provides the inputs)')
  }
  
  // 2. Validate Input (required except for first step)
  if (!isFirst && isArrayEmpty(step.inputs)) {
    missingFields.push('input')
    issues.push('Input is required (what is received)')
  }
  
  // 3. Validate Process (always required)
  if (!step.label || step.label.trim() === '') {
    missingFields.push('process')
    issues.push('Process description is required')
  }
  
  // 4. Validate Output (required except for last step)
  if (!isLast && isArrayEmpty(step.outputs)) {
    missingFields.push('output')
    issues.push('Output is required (what is produced)')
  }
  
  // 5. Validate Customer (required except for last step)
  if (!isLast && isArrayEmpty(step.customers)) {
    missingFields.push('customer')
    issues.push('Customer is required (who receives the output)')
  }
  
  // 6. CHAIN VALIDATION: Check if outputs/customers match next step's inputs/suppliers
  //
  // Deliberately still scoped to the step's own milestone. #344 moved the
  // first/last EXEMPTION to process ends but left this where it was, so a step
  // that closes a milestone now has to declare an output and a customer, and
  // nothing here complains that they do not reach the next milestone. That
  // half is #239: extending the chain across the boundary would auto-raise gaps
  // at every boundary in every existing project, which is a product decision
  // rather than a fix.
  if (!isLast && !isArrayEmpty(step.outputs) && !isArrayEmpty(step.customers)) {
    // Find next steps (same milestone, higher order)
    const nextSteps = allSteps
      .filter(s => s.milestoneId === step.milestoneId && s.order > step.order)
      .sort((a, b) => a.order - b.order)
    
    if (nextSteps.length > 0) {
      // Check if any customer matches a supplier in the next N steps
      const customerCount = step.customers.filter(c => c && c.trim()).length
      const stepsToCheck = nextSteps.slice(0, Math.max(customerCount, 3))
      
      const unmatchedCustomers = step.customers.filter(customer => {
        if (!customer || !customer.trim()) return false
        return !stepsToCheck.some(nextStep => nextStep.suppliers.includes(customer))
      })
      
      if (unmatchedCustomers.length > 0) {
        missingFields.push('customer')
        issues.push(`Customer(s) not matched in next step: ${unmatchedCustomers.join(', ')}`)
      }
      
      // Check if any output matches an input in the immediate next step
      const immediateNext = nextSteps[0]
      if (immediateNext && !isArrayEmpty(immediateNext.inputs)) {
        const hasMatchingOutput = step.outputs.some(output => 
          output && output.trim() && immediateNext.inputs.includes(output)
        )
        
        if (!hasMatchingOutput) {
          missingFields.push('output')
          issues.push('Output does not match input in next step')
        }
      }
    }
  }
  
  return {
    isValid: missingFields.length === 0,
    missingFields,
    issues,
  }
}

/**
 * Validate multiple steps at once
 *
 * @param steps - Array of steps to validate
 * @param milestoneById - The project's milestones by id, for ranking
 * @returns Map of step ID to validation result
 */
export function validateSteps(
  steps: Step[],
  milestoneById: Map<string, Milestone>
): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>()

  for (const step of steps) {
    const result = validateStep(step, steps, milestoneById)
    results.set(step.id, result)
  }

  return results
}


