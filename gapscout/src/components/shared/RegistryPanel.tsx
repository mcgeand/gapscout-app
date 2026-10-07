import { useId, type ReactNode } from 'react'

/**
 * RegistryPanel - the in-page shell for the four registries (#207).
 *
 * Teams, Systems, Policies and Glossary used to be dialogs opened from four
 * `Manage …` buttons in the board header. They are destinations now, so they
 * render here: the same head/body/foot grammar as `Modal`, minus the backdrop
 * and the close button that made it a dialog.
 *
 * The `action` slot is the answer to #207's first decision. The board header
 * holds one primary action for the whole board (`Run SIPOC Wizard`); each
 * registry owns its own (`+ Add Team`), which is why that slot lives here
 * rather than being pushed up into the header per tab.
 */

export interface RegistryPanelProps {
  /** Rendered in the head and used as the panel's accessible name. */
  title: string
  /** One sentence under the title. */
  description?: ReactNode
  /** The registry's own primary action. */
  action?: ReactNode
  /** The registry's totals, on a rule under the table. */
  summary?: ReactNode
  children: ReactNode
}

export function RegistryPanel({
  title,
  description,
  action,
  summary,
  children,
}: RegistryPanelProps) {
  const titleId = useId()

  return (
    <section className="registry" aria-labelledby={titleId}>
      <div className="registry-head">
        <div className="min-w-0">
          <h2 id={titleId} className="registry-title">
            {title}
          </h2>
          {description && <p className="registry-description">{description}</p>}
        </div>
        {action && <div className="flex flex-shrink-0 items-center gap-gs-2">{action}</div>}
      </div>

      <div className="registry-body">{children}</div>

      {summary && <div className="registry-foot">{summary}</div>}
    </section>
  )
}

export default RegistryPanel
