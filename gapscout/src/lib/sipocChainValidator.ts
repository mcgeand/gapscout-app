import type { Step } from '../data/types'

export interface ChainValidation {
  status: 'perfect' | 'warning' | 'broken' | 'end' | 'start'
  message: string
  details: string[]
}

export function validateStepChain(
  currentStep: Step,
  allSteps: Step[],
  currentIndex: number
): ChainValidation {
  const isFirstStep = currentIndex === 0
  const isLastStep = currentIndex === allSteps.length - 1
  const nextStep = isLastStep ? null : allSteps[currentIndex + 1]

  const customerCount = currentStep.customers.length
  const stepsToCheck = allSteps.slice(currentIndex + 1, currentIndex + 1 + customerCount)

  if (isFirstStep && !nextStep) {
    return {
      status: 'start',
      message: 'First and only step',
      details: [],
    }
  }

  if (isFirstStep) {
    const hasOutputs = currentStep.outputs.length > 0
    const hasCustomers = currentStep.customers.length > 0

    if (!hasOutputs && !hasCustomers) {
      return {
        status: 'broken',
        message: 'Missing outputs and customers',
        details: ['Add outputs to pass to next step', 'Add customers to receive outputs'],
      }
    }

    if (!hasOutputs || !hasCustomers) {
      const gaps = []
      if (!hasOutputs) gaps.push('Missing outputs')
      if (!hasCustomers) gaps.push('Missing customers')
      return {
        status: 'warning',
        message: gaps.join(', '),
        details: gaps.map((g) => `Add ${g.toLowerCase()} to complete SIPOC`),
      }
    }

    const unmatchedCustomers = currentStep.customers.filter(
      (customer) => !stepsToCheck.some((step) => step.suppliers.includes(customer))
    )

    if (unmatchedCustomers.length > 0) {
      return {
        status: 'warning',
        message: `${unmatchedCustomers.length} unmatched customer(s)`,
        details: [
          `Customer(s) not found as suppliers in next ${customerCount} step(s):`,
          ...unmatchedCustomers.map((c) => `   • "${c}" - add step with this as supplier`),
          '',
          'Matched customers:',
          ...currentStep.customers
            .filter((c) => !unmatchedCustomers.includes(c))
            .map((c) => `   "${c}"`),
        ],
      }
    }

    return {
      status: 'perfect',
      message: 'Entry point ready',
      details: [
        'All outputs and customers defined',
        ...currentStep.customers.map(
          (c) => `Customer "${c}" matched in next ${customerCount} step(s)`
        ),
      ],
    }
  }

  if (!nextStep) {
    return {
      status: 'end',
      message: 'Exit point',
      details: [],
    }
  }

  const outputsMatch = currentStep.outputs.some((out) => nextStep.inputs.includes(out))

  const unmatchedCustomers = currentStep.customers.filter(
    (customer) => !stepsToCheck.some((step) => step.suppliers.includes(customer))
  )

  const details: string[] = []
  let hasIssues = false

  if (outputsMatch) {
    const matched = currentStep.outputs.filter((out) => nextStep.inputs.includes(out))
    details.push(`Output "${matched.join(', ')}" → Input in next step`)
  } else {
    hasIssues = true
    details.push(`Outputs not used as inputs in next step`)
    if (currentStep.outputs.length > 0 && nextStep.inputs.length > 0) {
      details.push(`   Suggestion: Change next step inputs to include "${currentStep.outputs[0]}"`)
    }
  }

  if (unmatchedCustomers.length > 0) {
    hasIssues = true
    details.push('')
    details.push(`${unmatchedCustomers.length} unmatched customer(s) in next ${customerCount} step(s):`)
    unmatchedCustomers.forEach((c) => {
      details.push(`   • "${c}" - add step with this as supplier`)
    })
  }

  const matchedCustomers = currentStep.customers.filter((c) => !unmatchedCustomers.includes(c))
  if (matchedCustomers.length > 0) {
    details.push('')
    details.push('Matched customers:')
    matchedCustomers.forEach((c) => {
      const matchingStepIndices = stepsToCheck
        .map((step, idx) => (step.suppliers.includes(c) ? currentIndex + 1 + idx + 1 : -1))
        .filter((idx) => idx !== -1)
      if (matchingStepIndices.length > 0) {
        details.push(`   "${c}" → Supplier in step #${matchingStepIndices[0]}`)
      }
    })
  }

  if (!hasIssues && outputsMatch) {
    return {
      status: 'perfect',
      message: 'Perfect SIPOC chain',
      details,
    }
  }

  if (!hasIssues || (outputsMatch && unmatchedCustomers.length === 0)) {
    return {
      status: 'warning',
      message: 'Partial chain match',
      details,
    }
  }

  return {
    status: 'warning',
    message:
      unmatchedCustomers.length > 0
        ? `${unmatchedCustomers.length} unmatched customer(s)`
        : 'Chain incomplete',
    details,
  }
}
