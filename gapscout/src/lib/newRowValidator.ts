/**
 * New Row Validator - Validates new rows before save
 * 
 * Requirements for new rows (ZIP-146):
 * - Order number (always required)
 * - At least ONE SIPOC field (Supplier, Input, Process, Output, Customer)
 * 
 * Reference: ZIP-146 - New Row Save Behavior
 */

import type { Step } from '../data/types'

export interface NewRowValidation {
  isValid: boolean
  missingRequirements: string[] // e.g., ['Order number', 'At least one SIPOC field']
  invalidFields: string[] // e.g., ['order', 'sipoc']
  hasData: boolean // True if user entered any data
}

/**
 * Validate a new row before save
 */
export function validateNewRow(step: Partial<Step>): NewRowValidation {
  const missingRequirements: string[] = []
  const invalidFields: string[] = []
  
  // 1. Check Order number
  if (step.order === undefined || step.order === null || step.order < 1) {
    missingRequirements.push('Order number')
    invalidFields.push('order')
  }
  
  // 2. Check at least ONE SIPOC field
  const hasSupplier = step.suppliers && step.suppliers.length > 0 && step.suppliers.some(s => s.trim())
  const hasInput = step.inputs && step.inputs.length > 0 && step.inputs.some(i => i.trim())
  const hasProcess = step.label && step.label.trim()
  const hasOutput = step.outputs && step.outputs.length > 0 && step.outputs.some(o => o.trim())
  const hasCustomer = step.customers && step.customers.length > 0 && step.customers.some(c => c.trim())
  
  const hasSIPOC = hasSupplier || hasInput || hasProcess || hasOutput || hasCustomer
  
  if (!hasSIPOC) {
    missingRequirements.push('At least one SIPOC field (Supplier, Input, Process, Output, or Customer)')
    invalidFields.push('sipoc')
  }
  
  // 3. Check if user has entered ANY data (for cancel confirmation)
  const hasData = Boolean(
    (step.order !== undefined && step.order > 0) ||
    hasSupplier ||
    hasInput ||
    hasProcess ||
    hasOutput ||
    hasCustomer ||
    (step.trigger && step.trigger.trim()) ||
    (step.notes && step.notes.trim()) ||
    (step.result && step.result.trim())
  )
  
  return {
    isValid: missingRequirements.length === 0,
    missingRequirements,
    invalidFields,
    hasData,
  }
}

/**
 * Get a user-friendly validation message
 */
export function getNewRowValidationMessage(validation: NewRowValidation): string {
  if (validation.isValid) {
    return ''
  }
  
  return validation.missingRequirements.join(' • ')
}

