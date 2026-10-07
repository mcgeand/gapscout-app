/**
 * One rail, drawn once (#220).
 *
 * `SipocWizard` and `ProjectSetupWizard` each carried their own copy, identical
 * down to the whitespace and both predating the token sheet: the active step was
 * an inline `var(--color-scout-orange)`, the done state `bg-green-100` with a
 * `✓`, the connector `bg-green-300`. None of those three colours is in the
 * palette and the glyph is an emoji.
 *
 * The render tests pin the states; the source assertions pin the thing that made
 * the duplication expensive — a fix applied to one copy and not the other.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { WizardRail } from '../components/shared/WizardRail'

const WIZARDS = [
  'src/components/Sipoc/SipocWizard.tsx',
  'src/components/Setup/ProjectSetupWizard.tsx',
]

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf-8')
}

describe('WizardRail', () => {
  it('marks the step you are on, what is behind it and what is ahead', () => {
    render(<WizardRail steps={['Capture', 'Review', 'Save']} current={2} />)

    expect(screen.getByText('Capture').parentElement).toHaveTextContent('(done)')
    expect(screen.getByText('Review').parentElement).toHaveTextContent('(current step)')
    expect(screen.getByText('Save').parentElement).toHaveTextContent('(not started)')
  })

  it('numbers the steps that are still ahead and ticks the ones behind', () => {
    const { container } = render(<WizardRail steps={['One', 'Two', 'Three']} current={3} />)

    // Two ticks behind, and the current step still shows its number.
    expect(container.querySelectorAll('svg')).toHaveLength(2)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})

describe('both wizards draw the shared rail', () => {
  it.each(WIZARDS)('%s renders WizardRail rather than its own', path => {
    const code = source(path)
    expect(code).toContain('<WizardRail')
    expect(code).toContain("from '../shared/WizardRail'")
  })

  it.each(WIZARDS)('%s carries none of the rail colours the palette retired', path => {
    const code = source(path)
    expect(code).not.toContain('--color-scout-orange')
    expect(code).not.toContain('--color-deep-navy')
    expect(code).not.toContain('bg-green-')
    expect(code).not.toContain('text-green-')
  })
})
