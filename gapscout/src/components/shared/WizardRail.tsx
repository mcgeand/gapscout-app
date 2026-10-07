import { Check } from 'lucide-react'

/**
 * The progress rail both wizards draw (#220).
 *
 * It existed twice, character for character, in `SipocWizard` and
 * `ProjectSetupWizard`, and both copies predated the token sheet: the active
 * step was an inline `var(--color-scout-orange)`, the done state was
 * `bg-green-100` with a `✓` glyph, and the connector was `bg-green-300`. None of
 * those three colours is in the palette, and the glyph is an emoji in a product
 * that has none outside `StepRow`'s validation column.
 *
 * Here it is one accent for the active step — the "active tab" job it already
 * has — ink for what is done, and Lucide `check` at the sizes the rest of the
 * chrome uses.
 */
export interface WizardRailProps {
  /** Step names, left to right. */
  steps: readonly string[]
  /** 1-based index of the step being shown. */
  current: number
  /** Hides the labels below `sm`, for a rail in a narrow dialog. */
  compactLabels?: boolean
}

export function WizardRail({ steps, current, compactLabels = false }: WizardRailProps) {
  return (
    <ol className="flex items-center" aria-label="Progress">
      {steps.map((name, index) => {
        const position = index + 1
        const isCurrent = position === current
        const isDone = position < current

        return (
          <li key={name} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-gs-2">
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center text-[12px] font-bold ${
                  isCurrent
                    ? 'bg-gs-accent text-gs-on-accent'
                    : isDone
                      ? 'bg-gs-ink text-gs-on-ink'
                      : 'bg-gs-sunken text-gs-ink-faint'
                }`}
                aria-hidden="true"
              >
                {isDone ? <Check size={16} strokeWidth={2} /> : position}
              </span>
              <span
                className={`text-[11px] font-bold uppercase tracking-[0.08em] ${
                  compactLabels ? 'hidden sm:inline' : ''
                } ${isCurrent ? 'text-gs-ink' : isDone ? 'text-gs-ink-muted' : 'text-gs-ink-faint'}`}
              >
                {name}
              </span>
              <span className="sr-only">
                {isDone ? '(done)' : isCurrent ? '(current step)' : '(not started)'}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span
                className={`mx-gs-3 h-0.5 flex-1 ${isDone ? 'bg-gs-ink' : 'bg-gs-rule'}`}
                aria-hidden="true"
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
